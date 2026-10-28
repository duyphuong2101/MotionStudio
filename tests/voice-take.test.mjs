import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, getStatus, setStatus, jobFile, createProject, loadTemplate } from '../engine/jobs.mjs';
import { alignTake, spokenTokens, numberWords, cutPlan, voicedFrames, takeGain, takeFilter, TAKE_DEFAULTS } from '../engine/voicetake.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { ffmpeg, ffmpegReport } from '../engine/media.mjs';
import os from 'node:os';

const LINES = [
  { id: 'hook', text: 'Month end used to take five days.' },
  { id: 'platform', text: 'Our platform closes the books in two.' },
  { id: 'cta', text: 'Book a demo today.' },
];
// Heard words as speech recognition reports them: 0.35 s a word, 0.8 s between lines, from `t0`.
function hear(texts, t0 = 0.5) {
  const out = [];
  let t = t0;
  for (const text of texts) {
    for (const w of text.split(/\s+/).filter(Boolean)) { out.push({ w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) }); t += 0.35; }
    t += 0.8;
  }
  return out;
}

test('an exact read times every script word on the heard word', () => {
  const heard = hear(LINES.map((l) => l.text));
  const r = alignTake(LINES, heard);
  assert.deepEqual(r.map((s) => s.id), ['hook', 'platform', 'cta']);
  assert.deepEqual(r.map((s) => s.match), [1, 1, 1]);
  assert.deepEqual(r[1].words.map((w) => w.w), ['Our', 'platform', 'closes', 'the', 'books', 'in', 'two.'], 'captions keep the script spelling');
  assert.equal(r[1].start, heard[7].start);
  assert.equal(r[2].end, heard.at(-1).end);
});

test('a slip and a misheard word still match; the missed word sits between its neighbours', () => {
  const heard = hear(['Month end used to take five days.', 'Our plattform closes the bucks in two.', 'Book a demo today.']);
  const r = alignTake(LINES, heard);
  const p = r[1];
  assert.equal(p.match, 0.86, 'books/bucks is too short to call close: 6 of 7');
  assert.equal(p.words[1].start, heard[8].start, 'plattform is close to platform');
  const books = p.words[4];
  assert.ok(books.start >= p.words[3].end && books.end <= p.words[5].start, JSON.stringify(p.words));
});

test('a missing line fails naming the scene and quoting what the take says there', () => {
  const heard = hear([LINES[0].text, LINES[2].text]);
  assert.throws(() => alignTake(LINES, heard), (err) => {
    assert.equal(err.code, 400);
    assert.match(err.message, /^Scene platform: the take says nothing here but the script says 'Our platform closes the books in two\.'\. Re-record the line or edit the script\.$/);
    return true;
  });
  const other = hear([LINES[0].text, 'We sell shoes and socks online now.', LINES[2].text]);
  assert.throws(() => alignTake(LINES, other), /Scene platform: the take says 'We sell shoes and socks online now\.' but the script says 'Our platform/);
});

test('numbers match however they are written', () => {
  assert.deepEqual(spokenTokens('2026,'), ['twenty', 'twenty', 'six']);
  assert.deepEqual(spokenTokens('twenty-six'), ['twenty', 'six']);
  assert.deepEqual(spokenTokens('40%'), ['forty', 'percent']);
  assert.deepEqual(spokenTokens('$1,200'), ['one', 'thousand', 'two', 'hundred', 'dollars']);
  assert.deepEqual(spokenTokens('3.5'), ['three', 'point', 'five']);
  assert.deepEqual(spokenTokens('21st'), ['twenty', 'first']);
  assert.deepEqual(numberWords('2005'), ['two', 'thousand', 'five']);
  assert.deepEqual(spokenTokens('2026', false), ['2026'], 'other languages keep digits');
  const lines = [{ id: 'year', text: 'In twenty twenty-six, sales grew forty percent.' }, { id: 'end', text: 'Thank you.' }];
  const r = alignTake(lines, hear(['In 2026, sales grew 40%.', 'Thank you.']));
  assert.deepEqual(r.map((s) => s.match), [1, 1]);
  assert.deepEqual(r[0].words.map((w) => w.w), ['In', 'twenty', 'twenty-six,', 'sales', 'grew', 'forty', 'percent.']);
  assert.equal(r[0].words[1].start, r[0].words[2].start, 'both script words sit on the one heard "2026"');
});

test('words written apart and heard as one, or the other way round, still match', () => {
  const lines = [{ id: 'a', text: 'Month end used to take five days.' }, { id: 'b', text: 'Sell more ecommerce online.' }];
  const r = alignTake(lines, hear(['Monthend used to take five days.', 'Sell more e commerce online.']));
  assert.deepEqual(r.map((s) => s.match), [1, 1]);
  assert.deepEqual([r[0].words[0].start, r[0].words[1].start], [0.5, 0.5], 'both script words sit on "Monthend"');
  assert.deepEqual([r[1].words[2].start, r[1].words[2].end], [4.1, 4.75], 'ecommerce spans "e" (4.1) and "commerce" (to 4.75)');
});

test('a repeated phrase keeps the later copy, so the false start is left out of the scene', () => {
  const heard = hear([LINES[0].text, 'Our platform', 'Our platform closes the books in two.', LINES[2].text]);
  const r = alignTake(LINES, heard);
  assert.deepEqual([heard[7].w, heard[9].w], ['Our', 'Our']);
  assert.equal(r[1].start, heard[9].start, 'the retry, not the false start at 7');
  assert.equal(r[1].match, 1);
});

test('a count-in before and an extra line after the script are ignored', () => {
  const heard = hear(['Okay recording now.', ...LINES.map((l) => l.text), 'Let me do that last one again maybe.']);
  const r = alignTake(LINES, heard);
  assert.deepEqual(r.map((s) => s.match), [1, 1, 1]);
  assert.equal(r[0].start, heard[3].start);
  assert.equal(r[2].words.at(-1).end, heard[3 + 7 + 7 + 3].end, 'the scene ends on "today."');
});

test('the match threshold comes from config and can be loosened', () => {
  assert.equal(loadStudioConfig().voiceTake.minMatch, TAKE_DEFAULTS.minMatch);
  const heard = hear([LINES[0].text, 'Our system shuts the ledger in two.', LINES[2].text]);
  assert.throws(() => alignTake(LINES, heard), /Scene platform/);
  assert.equal(alignTake(LINES, heard, { minMatch: 0.5 })[1].match, 0.57, 'our, the, in, two: 4 of 7');
});

test('cuts widen to where the take is voiced and never cross the midpoint to the next scene', () => {
  const step = 0.01;
  const voiced = new Uint8Array(500);
  voiced.fill(1, 80, 200); // scene a voiced 0.8-2.0 s
  voiced.fill(1, 230, 400); // scene b voiced 2.3-4.0 s
  const spans = [{ start: 1.0, end: 1.9 }, { start: 2.5, end: 3.8 }];
  const [a, b] = cutPlan(spans, voiced, step, 5, { padding: 0.12, maxExtend: 0.5 });
  assert.deepEqual(a, { from: 0.68, to: 2.12 }, 'widened to the voice at 0.8-2.0 s, plus 0.12 s each side');
  assert.deepEqual(b, { from: 2.18, to: 4.12 });
  const [c, d] = cutPlan(spans, voiced, step, 5, { padding: 0.2, maxExtend: 0.5 });
  assert.deepEqual([c.to, d.from], [2.15, 2.15], 'a wide padding stops at the midpoint of the 2.0-2.3 s gap');
});

test('a span timed into silence is narrowed onto the voice', () => {
  const voiced = new Uint8Array(500);
  voiced.fill(1, 120, 300); // voice 1.2-3.0 s
  const [a] = cutPlan([{ start: 0.3, end: 3.6 }], voiced, 0.01, 5, { padding: 0.1, maxExtend: 0.5 });
  assert.deepEqual(a, { from: 1.1, to: 3.1 });
});

test('voiced frames bridge a short stop inside a word', () => {
  const rate = 16000, s = new Float32Array(rate);
  for (let i = 0; i < rate; i++) s[i] = (i < 4000 || (i > 4480 && i < 8000)) ? 0.3 * Math.sin(i / 5) : 0.0005 * Math.sin(i);
  const { voiced } = voicedFrames(s, rate);
  assert.equal(voiced[27], 1, 'a 30 ms dip counts as voice');
  assert.equal(voiced[70], 0);
});

test('the take is brought toward the target level, clamped and kept under the peak ceiling', () => {
  assert.equal(takeGain({ lufs: -30, peak: -12 }), 8);
  assert.equal(takeGain({ lufs: -30, peak: -5 }), 4, 'stops at −1 dBFS true peak');
  assert.equal(takeGain({ lufs: -50, peak: -30 }), 12, 'clamped');
  assert.equal(takeGain({ lufs: -16, peak: -2 }), -6);
  assert.equal(takeGain({ lufs: null, peak: null }), 0);
});

const P = 'zz-test-voicetake';
const brief = { id: 'take-16x9', project: P, template: 'explainer', format: '16:9', duration: 30, message: 'm' };

test('brand.voice.cleanup: an optional yes/no; off leaves the take chain as it was', async (t) => {
  assert.equal(takeFilter({ gainDb: 3, len: 2 }), 'volume=3dB,afade=t=in:d=0.01,afade=t=out:st=1.990:d=0.01', 'the chain every take used before');
  assert.ok(!takeFilter({ len: 2 }).includes('volume'), 'no level change at 0 dB');
  const clean = takeFilter({ gainDb: 3, len: 2, cleanup: true });
  assert.match(clean, /^highpass=f=80,afftdn=nf=-25,deesser,acompressor=[^,]+,volume=3dB,afade=t=in/);
  const base = { name: 'B', colors: { primary: '#111111', primary2: '#222222', secondary: '#333333', bg: '#ffffff', ink: '#000000', muted: '#666666', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' }, voice: { tts: 'none' }, sources: { allowedHosts: [] } };
  assert.equal(validateBrand({ ...base, voice: { tts: 'none', cleanup: true } }).voice.cleanup, true);
  assert.equal('cleanup' in validateBrand({ ...base, voice: { tts: 'none', cleanup: false } }).voice, false);
  assert.throws(() => validateBrand({ ...base, voice: { tts: 'none', cleanup: 'yes' } }), /voice.cleanup must be true or false/);

  // Real ffmpeg: 30 Hz rumble is cut hard, a 1 kHz voice-band tone keeps its level.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const level = async (src, af) => {
    const out = path.join(dir, 'o.wav');
    await ffmpeg(['-y', '-f', 'lavfi', '-i', src, ...(af ? ['-af', af] : []), '-ac', '1', '-ar', '48000', out], { timeoutMs: 60000 });
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(await ffmpegReport(['-i', out, '-af', 'volumedetect', '-f', 'null', '-']))[1]);
  };
  const hum = 'sine=frequency=30:sample_rate=48000:duration=2', tone = 'sine=frequency=1000:sample_rate=48000:duration=2';
  const humDrop = (await level(hum)) - (await level(hum, takeFilter({ len: 2, cleanup: true })));
  const toneDrop = (await level(tone)) - (await level(tone, takeFilter({ len: 2, cleanup: true })));
  assert.ok(humDrop > 12, `rumble down ${humDrop.toFixed(1)} dB`);
  assert.ok(Math.abs(toneDrop) < 6, `voice-band tone changed ${toneDrop.toFixed(1)} dB`);
});

test('voiceTake is an optional audio asset name, and changing only it needs a new storyboard', (t) => {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  assert.equal(validateBrief({ ...brief, voiceTake: 'take.m4a' }).voiceTake, 'take.m4a');
  assert.equal('voiceTake' in validateBrief(brief), false, 'absent stays absent');
  assert.throws(() => validateBrief({ ...brief, voiceTake: '../take.wav' }), /Invalid voiceTake name/);
  assert.throws(() => validateBrief({ ...brief, voiceTake: 'take.png' }), /voiceTake must be a \.wav, \.mp3 or \.m4a asset/);
  saveBrief(validateBrief(brief));
  writeJson(jobFile(P, brief.id, 'script.json'), { scenes: [] });
  const r = updateBrief(P, brief.id, { ...brief, voiceTake: 'take.wav' });
  assert.deepEqual(r.changed, ['voiceTake']);
  assert.equal(r.rePrepare, true);
  assert.equal(getStatus(P, brief.id).dirty_from, 5);
  assert.deepEqual(updateBrief(P, brief.id, { ...brief, voiceTake: 'take.wav' }).changed, [], 'same take, nothing changed');
  assert.deepEqual(updateBrief(P, brief.id, brief).changed, ['voiceTake'], 'clearing it is a change');
});

// Real local STT + Kokoro: a "recording" made by speaking each line and joining them, then a real prepare.
test('prepare uses a recorded take: scenes follow the take and captions use the script words', { timeout: 600000 }, async (t) => {
  const { sttStatus } = await import('../engine/stt.mjs');
  const { kokoroStatus, kokoroSpeak, writeWav } = await import('../engine/tts/kokoro.mjs');
  if (!sttStatus().available) { t.skip(`local speech-to-text is not available: ${sttStatus().reason}`); return; }
  if (!kokoroStatus().available) { t.skip(`Kokoro is not available: ${kokoroStatus().reason}`); return; }
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const { prepare } = await import('../engine/pipeline.mjs');
  const PE = 'zz-test-voicetake-e2e', ID = 'take-16x9';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], PE), { recursive: true, force: true })));
  createProject({ id: PE, name: 'Take Test' });
  const brandFile = path.join(DIRS.profiles, PE, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none', lang: 'en' }, music: { file: null, gainDb: -18 } });
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const { beats } = loadTemplate('explainer');
  const keep = ['title', 'step', 'cta'];
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((sl) => ({ ...sl, kind: sl.kind.filter((k) => keep.includes(k)) })) });
  assert.equal(script.scenes.length, LINES.length);
  script.scenes.forEach((sc, i) => { sc.vo = LINES[i].text; });
  // The take: each line spoken, 1.2 s of silence before, between and after, as one 24 kHz file.
  const RATE = 24000, gap = new Float32Array(Math.round(RATE * 1.2));
  const parts = [gap];
  const starts = [];
  let n = gap.length;
  for (const sc of script.scenes) {
    const { samples } = await kokoroSpeak(sc.vo, 'af_heart', 1, 'en-us');
    starts.push(n / RATE);
    parts.push(samples, gap);
    n += samples.length + gap.length;
  }
  const all = new Float32Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  writeWav(path.join(DIRS.profiles, PE, 'assets', 'take.wav'), all, RATE);
  saveBrief(validateBrief({ project: PE, id: ID, template: 'explainer', format: '16:9', duration: 30, message: 'm', voiceTake: 'take.wav' }));
  writeJson(jobFile(PE, ID, 'source.json'), { name: 'Take Test', url: '', bullets: [] });
  writeJson(jobFile(PE, ID, 'script.json'), script);
  setStatus(PE, ID, { status: 'scripted', step: 5 }, 'test');

  const st = await prepare(PE, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings || st.error));
  const timing = readJson(jobFile(PE, ID, 'timing.json'));
  assert.equal(timing.source, 'take');
  assert.equal(timing.voice, 'take.wav');
  assert.deepEqual(timing.take.scenes.map((s) => s.id), script.scenes.map((s) => s.id));
  assert.ok(timing.take.scenes.every((s) => s.match === 1), `Whisper hears this clean take whole: ${JSON.stringify(timing.take.scenes)}`);
  timing.take.scenes.forEach((s, i) => assert.ok(Math.abs(s.from - starts[i]) < 0.45, `${s.id} cut starts near ${starts[i].toFixed(2)} s: ${JSON.stringify(timing.take)}`));
  for (const sc of script.scenes) {
    assert.deepEqual(timing.words.filter((w) => w.scene === sc.id).map((w) => w.w), sc.vo.split(' '), `${sc.id} captions are the script words`);
  }
  // Scene lengths follow the take: each scene holds its cut plus the lead and tail, not a TTS estimate.
  for (const c of timing.take.scenes) {
    const s = timing.scenes.find((x) => x.id === c.id);
    assert.ok(s.end - s.start >= c.to - c.from - 0.3, `${c.id} holds its cut (${JSON.stringify(timing.scenes)})`);
  }
  assert.ok(fs.existsSync(jobFile(PE, ID, 'voice.wav')));
  assert.ok(!(st.lint?.findings || []).some((f) => f.el === 'voice'), 'no "No voice-over" warning');
  t.diagnostic(`take: ${JSON.stringify(timing.take)}`);

  // The same take without its middle line: prepare stops, naming that scene.
  const mid = script.scenes[1].id;
  const cut = Math.round(starts[1] * RATE), resume = Math.round(starts[2] * RATE);
  const missing = new Float32Array(all.length - (resume - cut));
  missing.set(all.subarray(0, cut));
  missing.set(all.subarray(resume), cut);
  writeWav(path.join(DIRS.profiles, PE, 'assets', 'take.wav'), missing, RATE);
  await assert.rejects(prepare(PE, ID, 'test'), (err) => {
    t.diagnostic(`error: ${err.message}`);
    assert.match(err.message, new RegExp(`^Scene ${mid}: the take says .* but the script says 'Our platform closes the books in two\\.'\\. Re-record the line or edit the script\\.$`));
    return true;
  });
  assert.equal(getStatus(PE, ID).status, 'error');
});
