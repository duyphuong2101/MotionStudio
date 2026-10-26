import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, writeJson, readJson } from '../engine/core.mjs';
import { melFilters, onnxMetadata, applyTimestampRules, segmentsOf, wordsOf, whisperStatus } from '../engine/stt/whisper.mjs';
import { transcribeAsset, loadTranscript, clipWords } from '../engine/stt.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { prepare } from '../engine/pipeline.mjs';

const WAVS = path.join(ROOT, 'models', 'whisper', 'test_wavs');
const haveModel = whisperStatus().available && fs.existsSync(path.join(WAVS, 'trans.txt'));

test('the mel filterbank has 80 triangular filters over 201 bins, rising in frequency', () => {
  const f = melFilters(80);
  assert.equal(f.length, 80);
  assert.ok(f.every((row) => row.length === 201 && row.every((v) => v >= 0)));
  const peaks = f.map((row) => row.indexOf(Math.max(...row)));
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] >= peaks[i - 1], 'filters move up in frequency');
  assert.ok(f.every((row) => row.some((v) => v > 0)), 'no empty filter');
});

test('ONNX metadata_props are read from the protobuf', () => {
  // ModelProto { ir_version: 7 (field 1), metadata_props (field 14): { key: "eot", value: "50257" } }
  const entry = Buffer.from([0x0a, 3, ...Buffer.from('eot'), 0x12, 5, ...Buffer.from('50257')]);
  const buf = Buffer.from([0x08, 7, 0x72, entry.length, ...entry]);
  assert.deepEqual(onnxMetadata(buf), { eot: '50257' });
});

test('timestamp rules: start with a timestamp in the first second, keep pairs, never go back', () => {
  const m = { tsBegin: 100, eot: 50 };
  const fresh = () => Float32Array.from({ length: 300 }, (_, i) => (i === 7 ? 5 : 0));
  let l = fresh();
  applyTimestampRules(l, [], m, { first: true });
  assert.ok(l[7] === -Infinity && l[100] > -Infinity && l[151] === -Infinity, 'first token: a timestamp of at most 1.0 s');
  l = fresh();
  l[50] = 10; // a likely end: the rule that prefers timestamps must not drown it (Whisper counts EOT as text)
  applyTimestampRules(l, [110, 7, 8, 140], m, { first: false });
  assert.ok(l[7] === -Infinity && l[50] > -Infinity && l[140] > -Infinity && l[139] === -Infinity, 'after text and a closing time: another time (not earlier) or the end');
  l = fresh();
  applyTimestampRules(l, [110, 7, 140, 140], m, { first: false });
  assert.ok(l[150] === -Infinity && l[7] > -Infinity, 'after a closed pair: text, not another timestamp');
});

test('tokens with timestamps become timed segments; words spread inside each', () => {
  const tokens = new Map([[1, Buffer.from(' Hello')], [2, Buffer.from(' world.')], [3, Buffer.from(' Again')]]);
  const m = { tsBegin: 100, tokens };
  const r = segmentsOf(m, [100, 1, 2, 150, 150, 3, 200]);
  assert.deepEqual(r.segments, [{ start: 0, end: 1, text: 'Hello world.' }, { start: 1, end: 2, text: 'Again' }]);
  assert.equal(r.unfinished, false);
  const cut = segmentsOf(m, [100, 1, 2, 150, 150, 3]);
  assert.equal(cut.unfinished, true, 'text with no closing time is marked unfinished');
  assert.equal(cut.lastDone, 1);
  const ws = wordsOf({ start: 2, end: 4, text: 'Hello world.' });
  assert.equal(ws.length, 2);
  assert.ok(ws[0].start === 2 && ws[1].end <= 4 && ws[1].start > ws[0].start);
});

const words = (s) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
/** Word error rate by edit distance. */
function wer(ref, hyp) {
  const a = words(ref), b = words(hyp);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / a.length;
}

test('the local model transcribes the reference recordings, stores the transcript and serves clip words', { timeout: 300000, skip: !haveModel && 'models/whisper is not installed' }, async (t) => {
  const P = 'zz-test-stt';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'STT Test' });
  const ref = Object.fromEntries(fs.readFileSync(path.join(WAVS, 'trans.txt'), 'utf8').trim().split(/\r?\n/).map((l) => [l.split(' ')[0], l.slice(l.indexOf(' ') + 1)]));
  fs.copyFileSync(path.join(WAVS, '1.wav'), path.join(DIRS.profiles, P, 'assets', 'talk.wav'));
  const doc = await transcribeAsset(P, 'talk.wav');
  assert.equal(doc.lang, 'en', 'the language is detected');
  const e = wer(ref['1.wav'], doc.segments.map((s) => s.text).join(' '));
  assert.ok(e <= 0.1, `word error rate ${Math.round(e * 100)}%`);
  for (let i = 1; i < doc.words.length; i++) assert.ok(doc.words[i].start >= doc.words[i - 1].start, 'words run forward');
  assert.ok(doc.segments.at(-1).end <= doc.duration + 0.05);
  assert.equal(loadTranscript(P, 'talk.wav').stale, undefined);

  const cw = await clipWords(P, 'talk.wav', 5, 6);
  assert.ok(cw.length > 5 && cw.every((w) => w.start >= 0 && w.end <= 6), 'clip words are relative to the clip and inside it');

  // Longer than one 29.5 s window: nothing at the window edge may be lost or said twice.
  const { ffmpeg } = await import('../engine/media.mjs');
  const twice = path.join(DIRS.profiles, P, 'assets', 'twice.wav');
  await ffmpeg(['-y', '-i', path.join(WAVS, '1.wav'), '-i', path.join(WAVS, '1.wav'), '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', twice], { timeoutMs: 30000 });
  const long = await transcribeAsset(P, 'twice.wav', { lang: 'en' });
  const text = long.segments.map((s) => s.text).join(' ');
  const e2 = wer(`${ref['1.wav']} ${ref['1.wav']}`, text);
  assert.ok(e2 <= 0.1, `word error rate across windows ${Math.round(e2 * 100)}%: ${text}`);
  assert.equal((text.match(/heaven/gi) || []).length, 2, 'each ending heard once');
  for (let i = 1; i < long.segments.length; i++) assert.ok(long.segments[i].start >= long.segments[i - 1].start, 'segments run forward');
});

test('prepare captions a footage clip with no typed text from what is said, and flags it for review', { timeout: 300000, skip: !haveModel && 'models/whisper is not installed' }, async (t) => {
  const P = 'zz-test-stt-prep', ID = 'pod-1x1';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'STT Prep' });
  const bf = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(bf, { ...readJson(bf), voice: { tts: 'none', lang: 'en' }, music: { file: null, gainDb: -18 } });
  fs.copyFileSync(path.join(WAVS, '0.wav'), path.join(DIRS.profiles, P, 'assets', 'talk.wav'));
  saveBrief(validateBrief({ project: P, id: ID, template: 'audiogram', format: '1:1', duration: 12, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'x', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [{ id: 'c1', kind: 'clip', asset: 'talk.wav', name: 'Reader' }] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  const timing = readJson(jobFile(P, ID, 'timing.json'));
  const said = timing.words.filter((w) => w.scene === 'c1').map((w) => w.w.toLowerCase().replace(/[^a-z]/g, ''));
  assert.ok(['nightfall', 'yellow', 'lamps'].every((x) => said.includes(x)), `captions heard: ${said.join(' ')}`);
  const sc = timing.scenes.find((s) => s.id === 'c1');
  assert.ok(timing.words.filter((w) => w.scene === 'c1').every((w) => w.start >= sc.start && w.end <= sc.end + 0.01));
  assert.ok(st.lint.findings.some((f) => f.el === 'captions' && /speech recognition/.test(f.msg)), 'the person is asked to read them');
  assert.ok(fs.readdirSync(jobFile(P, ID, 'stt')).length === 1, 'the words are cached for the next prepare');
});
