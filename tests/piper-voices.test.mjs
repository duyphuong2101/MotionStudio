import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseVoiceId, readModelCard, listPiperVoices, piperText, sherpaProblem, SHERPA_FILES, PIPER_TEXT_MAX } from '../engine/tts/piper.mjs';
import { voiceProblem, listVoices, previewVoice, piperStatus } from '../engine/tts.mjs';
import { validateBrief } from '../engine/jobs.mjs';
import { validateBrand } from '../engine/brand.mjs';

// Piper voices through sherpa-onnx (models/piper, models/sherpa-onnx; placed by a person, never downloaded by the tool).
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-piper-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('voice ids, model cards and the licence each voice is listed with', (t) => {
  assert.deepEqual(parseVoiceId('vi_VN-vivos-x_low (12)'), { name: 'vi_VN-vivos-x_low', speaker: 12 });
  assert.deepEqual(parseVoiceId('vi_VN-vais1000-medium'), { name: 'vi_VN-vais1000-medium', speaker: 0 });
  for (const bad of ['../x', 'vi_VN-vivos', 'vi-VN-vivos-low', 'vi_VN-vivos-x_low (1234)']) assert.equal(parseVoiceId(bad), null, bad);
  const nc = readModelCard('# Model card\n* Speakers: 65\n* Samplerate: 16,000Hz\n## Dataset\n* License: CC BY-NC-SA 4.0\n');
  assert.deepEqual(nc, { speakers: 65, sampleRate: 16000, license: 'CC BY-NC-SA 4.0', nonCommercial: true });
  assert.deepEqual(readModelCard('* Speakers: 1\n* License: https://creativecommons.org/licenses/by/4.0/\n'), { speakers: 1, sampleRate: null, license: 'CC BY 4.0', nonCommercial: false });
  assert.equal(readModelCard('').license, 'unknown');
  const dir = tmp(t);
  const voice = (name, card) => { const d = path.join(dir, name); fs.mkdirSync(path.join(d, 'espeak-ng-data'), { recursive: true }); for (const f of ['tokens.txt', `${name}.onnx`]) fs.writeFileSync(path.join(d, f), 'x'); fs.writeFileSync(path.join(d, 'MODEL_CARD'), card); };
  voice('vi_VN-vivos-x_low', '* Speakers: 65\n* License: CC BY-NC-SA 4.0\n');
  voice('vi_VN-vais1000-medium', '* Speakers: 1\n* License: https://creativecommons.org/licenses/by/4.0/\n');
  fs.mkdirSync(path.join(dir, 'not-a-voice'));
  fs.mkdirSync(path.join(dir, 'en_US-half-low'));
  const list = listPiperVoices(dir);
  assert.equal(list.length, 11, 'one single-speaker voice and the first ten of 65 speakers; half-made folders are skipped');
  assert.deepEqual(list[0], { id: 'vi_VN-vais1000-medium', culture: 'vi-VN', label: 'vais1000 · vi-VN · medium · CC BY 4.0', nonCommercial: false });
  assert.equal(list[1].id, 'vi_VN-vivos-x_low (0)');
  assert.match(list[1].label, /speaker 0 · x-low · non-commercial \(CC BY-NC-SA 4\.0\): tests and internal videos only$/);
});

test('the text guard keeps letters, marks, digits and plain punctuation, and caps the length', () => {
  assert.equal(piperText('  Xin chào — R&D: $5 <b>ok</b> 50% 👍\n'), 'Xin chào RD: 5 bok/b 50%');
  assert.equal(piperText('Tiếng Việt'), 'Tiếng Việt', 'NFC: a decomposed mark joins its letter');
  assert.equal(piperText('a'.repeat(PIPER_TEXT_MAX + 50)).length, PIPER_TEXT_MAX);
  assert.equal(piperText(null), '');
});

test('the runtime runs only when every file matches its pinned hash', (t) => {
  const dir = tmp(t);
  const pinned = {};
  for (const f of SHERPA_FILES) { fs.writeFileSync(path.join(dir, f), `build of ${f}`); pinned[f] = crypto.createHash('sha256').update(`build of ${f}`).digest('hex'); }
  assert.equal(sherpaProblem(dir, pinned), null);
  assert.match(sherpaProblem(dir, {}), /pins no sherpa-onnx files/);
  fs.writeFileSync(path.join(dir, 'onnxruntime.dll'), 'another build');
  assert.match(sherpaProblem(dir, pinned), /onnxruntime\.dll is not the pinned build/);
  fs.rmSync(path.join(dir, 'sherpa-onnx.dll'));
  assert.match(sherpaProblem(dir, pinned), /sherpa-onnx\.dll is missing/);
});

test('brands and briefs take piper voices; a voice in another language is named', () => {
  assert.equal(validateBrief({ project: 'demo', id: 'j', template: 'explainer', format: '16:9', duration: 30, message: 'm', voice: 'piper:vi_VN-vivos-x_low (3)' }).voice, 'piper:vi_VN-vivos-x_low (3)');
  assert.throws(() => validateBrief({ project: 'demo', id: 'j', template: 'explainer', format: '16:9', duration: 30, message: 'm', voice: 'piper:../x' }), /"piper:<voice>"/);
  const brand = { name: 'B', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
  assert.equal(validateBrand({ ...brand, voice: { tts: 'piper', voice: 'vi_VN-vais1000-medium', lang: 'vi' } }).voice.tts, 'piper');
  assert.throws(() => validateBrand({ ...brand, voice: { tts: 'espeak' } }), /voice\.tts must be kokoro, sapi, piper or none/);
  assert.equal(voiceProblem({ tts: 'piper', voice: 'vi_VN-vais1000-medium', lang: 'vi' }), null);
  assert.match(voiceProblem({ tts: 'piper', voice: 'vi_VN-vais1000-medium', lang: 'en' }), /speaks vi, and this video is "en"/);
  assert.match(voiceProblem({ tts: 'piper', voice: 'x', lang: 'vi' }), /not a voice folder name/);
});

test('with the runtime and a voice in place, a Vietnamese preview is spoken at 24 kHz', { timeout: 120000 }, async (t) => {
  const st = piperStatus();
  if (!st.available) { t.skip(`Piper is not set up here: ${st.reason}`); return; }
  const piper = (await listVoices()).find((e) => e.id === 'piper');
  const voice = piper.voices.find((v) => v.culture === 'vi-VN') || piper.voices[0];
  const dir = tmp(t);
  const wav = await previewVoice(dir, 'piper', voice.id, 1);
  const b = fs.readFileSync(wav);
  assert.deepEqual([b.readUInt32LE(24), b.readUInt16LE(22), b.readUInt16LE(34)], [24000, 1, 16]);
  const meta = JSON.parse(fs.readFileSync(wav.replace(/\.wav$/, '.json'), 'utf8'));
  assert.ok(meta.seconds > 2, `${meta.seconds} s`);
  if (voice.culture === 'vi-VN') assert.equal(meta.words[0].w, 'Xin', 'the preview is read in the voice\'s language');
  assert.ok(meta.words.every((w, i) => i === 0 || w.at >= meta.words[i - 1].at));
  assert.equal(fs.readdirSync(dir).filter((f) => /\.(in|raw)\.json$|\.native\.wav$/.test(f)).length, 0, 'no work files left');
});
