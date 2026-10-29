import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, getStatus, jobFile, loadBriefTemplate, diffLocks } from '../engine/jobs.mjs';
import { validateScript, stressAt } from '../engine/script.mjs';
import { voiceFor, voiceProblem, kokoroLang, sameLanguage, spokenLine, stressSpans, stressFilter, STRESS_DB } from '../engine/tts.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { estimateTiming } from '../engine/timing.mjs';

const P = 'zz-test-voicelang';
const brief = { id: 'v-16x9', project: P, template: 'explainer', format: '16:9', duration: 30, message: 'm' };

test('brand.voice.say changes what the voice says, word by word, and keeps how many spoken words each became', () => {
  const say = { Niteco: 'Nee-teh-co', AMAD: 'A M A D', '.NET': 'dot net', "Niteco's": 'Nee-teh-cos' };
  assert.deepEqual(spokenLine("In twenty twenty-six, Niteco's AMAD team ran.", say), { text: 'In twenty twenty-six, Nee-teh-cos A M A D team ran.', groups: [1, 1, 1, 1, 4, 1, 1] });
  assert.deepEqual(spokenLine('Niteco, .NET 10.', say), { text: 'Nee-teh-co, dot net 10.', groups: [1, 2, 1] }, 'trailing punctuation stays');
  assert.deepEqual(spokenLine("Niteco's team.", { Niteco: 'Nee-teh-co' }).text, "Nee-teh-co's team.", "a possessive 's stays on the word");
  assert.deepEqual(spokenLine('No match.', say), { text: 'No match.', groups: null });
  assert.deepEqual(spokenLine('AMAD', undefined), { text: 'AMAD', groups: null });
  assert.deepEqual(spokenLine('amad', { AMAD: 'A M A D' }).groups, null, 'a key matches its own case only');
  assert.deepEqual(spokenLine('constructor toString', {}).groups, null, 'no inherited keys');
});

test('brand.voice.say is kept when every entry is one word and a short spoken form', () => {
  const b = { name: 'B', colors: { primary: '#111111', primary2: '#222222', secondary: '#ffcc00', bg: '#ffffff', ink: '#111111', muted: '#666666', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
  assert.deepEqual(validateBrand({ ...b, voice: { say: { AMAD: ' A M A D ', '.NET': 'dot net' } } }).voice.say, { AMAD: 'A M A D', '.NET': 'dot net' });
  assert.equal('say' in validateBrand(b).voice, false);
  assert.equal('say' in validateBrand({ ...b, voice: { say: {} } }).voice, false);
  assert.throws(() => validateBrand({ ...b, voice: { say: ['AMAD'] } }), /voice.say must map/);
  assert.throws(() => validateBrand({ ...b, voice: { say: { 'two words': 'x' } } }), /must be one word/);
  assert.throws(() => validateBrand({ ...b, voice: { say: { AMAD: '<b>' } } }), /must be 1-60/);
  assert.throws(() => validateBrand({ ...b, voice: { say: Object.fromEntries(Array.from({ length: 31 }, (_, i) => ['w' + i, 'x'])) } }), /at most 30/);
});

test('brand.voice.say takes a slashed word, and voice.cast names extra voices a scene picks with speaker', () => {
  const b = { name: 'B', colors: { primary: '#111111', primary2: '#222222', secondary: '#ffcc00', bg: '#ffffff', ink: '#111111', muted: '#666666', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
  assert.deepEqual(validateBrand({ ...b, voice: { say: { 'A/B': 'Eh and Bee' } } }).voice.say, { 'A/B': 'Eh and Bee' });
  assert.deepEqual(spokenLine('Twenty A/B tests.', { 'A/B': 'Eh and Bee' }), { text: 'Twenty Eh and Bee tests.', groups: [1, 3, 1] });
  assert.deepEqual(validateBrand({ ...b, voice: { cast: { numbers: 'am_michael' } } }).voice.cast, { numbers: 'am_michael' });
  assert.equal('cast' in validateBrand(b).voice, false);
  assert.throws(() => validateBrand({ ...b, voice: { cast: ['am_michael'] } }), /voice.cast must map/);
  assert.throws(() => validateBrand({ ...b, voice: { cast: { Numbers: 'am_michael' } } }), /lowercase/);
  assert.throws(() => validateBrand({ ...b, voice: { cast: { numbers: '../x' } } }), /unexpected characters/);
  assert.throws(() => validateBrand({ ...b, voice: { cast: { a: 'x', b: 'x', c: 'x', d: 'x', e: 'x' } } }), /at most 4/);
});

test('a scene speaker is checked in every template and locks like any scene field', () => {
  const { beats } = loadBriefTemplate(brief);
  const vo = 'One line.';
  const script = (speaker) => ({ scenes: [{ id: 'a', kind: 'title', title: 'T', vo, speaker }, { id: 'b', kind: 'step', title: 'S', text: 'x', icon: 'check', vo }, { id: 'c', kind: 'cta', title: 'C', vo }] });
  assert.equal(validateScript(script('numbers'), beats).warnings.some((w) => /speaker/.test(w)), false, 'not "ignored by this template"');
  assert.ok(validateScript(script('Not ok'), beats).errors.some((e) => /speaker must name a voice/.test(e)));
  assert.ok(diffLocks('script', script(undefined), script('numbers')).includes('scene:a.speaker'));
});

test('scene stress: phrases of the voice line said louder, checked against the line, ramped in ffmpeg', async () => {
  assert.deepEqual(stressAt('In September: eighteen and a half percent.', 'Eighteen and a half percent'), [2, 6]);
  assert.equal(stressAt('In September: eighteen percent.', 'nineteen percent'), null);
  const said = ['In', 'September:', 'eighteen', 'percent.'].map((w, i) => ({ w, at: i * 0.5 }));
  assert.deepEqual(stressSpans('In September: eighteen percent.', ['eighteen'], said, 2), [{ a: 0.94, b: 1.53 }], 'from the word to where the next one starts');
  assert.deepEqual(stressSpans('In September: eighteen percent.', ['eighteen percent'], said, 2), [{ a: 0.94, b: 2.03 }], 'the last word runs to the line end');
  assert.deepEqual(stressSpans('x', undefined, said, 2), []);
  assert.equal(stressFilter([]), '');
  const { beats } = loadBriefTemplate(brief);
  const one = (stress) => validateScript({ scenes: [{ id: 'a', kind: 'title', title: 'T', vo: 'Up nine point seven percent.', stress }, { id: 'b', kind: 'step', title: 'S', text: 'x', icon: 'check', vo: 'x' }, { id: 'c', kind: 'cta', title: 'C', vo: 'x' }] }, beats);
  assert.deepEqual(one(['nine point seven percent']).errors.filter((e) => /stress/.test(e)), []);
  assert.ok(one(['ten percent']).errors.some((e) => /not a run of words/.test(e)));
  assert.ok(one([]).errors.some((e) => /1-3 phrases/.test(e)));
  assert.ok(diffLocks('script', { scenes: [{ id: 'a', kind: 'title' }] }, { scenes: [{ id: 'a', kind: 'title', stress: ['x'] }] }).includes('scene:a.stress'));
  // The filter must parse and lift only the span: a steady tone measured inside and outside it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-'));
  const out = path.join(dir, 'o.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000', '-af', `${stressFilter([{ a: 0.5, b: 1.2 }])}volume=0.3`, out]);
  const pcm = fs.readFileSync(out).subarray(44);
  const rms = (t0, t1) => { let sum = 0, n = 0; for (let i = Math.round(t0 * 48000); i < Math.round(t1 * 48000); i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; n++; } return Math.sqrt(sum / n); };
  const db = 20 * Math.log10(rms(0.7, 1.0) / rms(1.5, 1.9));
  assert.ok(Math.abs(db - STRESS_DB) < 0.3, `stressed span is ${db.toFixed(2)} dB louder`);
  // Halfway up the 60 ms ramp (0.53 s) the gain is halfway too, not still 1 or already full.
  const half = 20 * Math.log10(1 + (10 ** (STRESS_DB / 20) - 1) / 2);
  const mid = 20 * Math.log10(rms(0.525, 0.535) / rms(1.5, 1.9));
  assert.ok(Math.abs(mid - half) < 0.6, `mid-ramp is ${mid.toFixed(2)} dB, want about ${half.toFixed(2)} dB`);
  fs.unlinkSync(out);
  fs.rmdirSync(dir);
});

test('a brief may set its own language and voice; bad values are refused', () => {
  const b = validateBrief({ ...brief, lang: 'es', voice: 'sapi:Microsoft Helena Desktop' });
  assert.equal(b.lang, 'es');
  assert.equal(b.voice, 'sapi:Microsoft Helena Desktop');
  assert.deepEqual([validateBrief(brief).lang, validateBrief(brief).voice], ['', ''], 'absent means the brand voice');
  assert.equal(validateBrief({ ...brief, voice: 'none:' }).voice, 'none:');
  assert.throws(() => validateBrief({ ...brief, lang: 'Spanish' }), /lang must look like/);
  assert.throws(() => validateBrief({ ...brief, voice: 'kokoro:../x' }), /voice must be/);
  assert.throws(() => validateBrief({ ...brief, voice: 'cloud:abc' }), /voice must be/);
});

test('the video voice is the brand voice with the brief on top', () => {
  const brand = { voice: { tts: 'kokoro', voice: 'af_heart', speed: 1.1, lang: 'en' } };
  assert.deepEqual(voiceFor(brand, {}), { tts: 'kokoro', voice: 'af_heart', speed: 1.1, lang: 'en' });
  assert.deepEqual(voiceFor(brand, { lang: 'es', voice: 'sapi:Microsoft Helena Desktop' }), { tts: 'sapi', voice: 'Microsoft Helena Desktop', speed: 1.1, lang: 'es' });
  assert.equal(voiceFor(brand, { voice: 'none:' }).tts, 'none');
  assert.equal(voiceFor({}, {}).lang, 'en');
});

test('Kokoro speaks English here; other languages and voices get a clear reason', () => {
  assert.equal(kokoroLang('af_heart'), 'en-us');
  assert.equal(kokoroLang('bf_emma'), 'en-gb');
  assert.equal(kokoroLang('ef_dora'), null);
  assert.equal(voiceProblem({ tts: 'kokoro', voice: 'bf_emma', lang: 'en-gb' }), null);
  assert.match(voiceProblem({ tts: 'kokoro', voice: 'af_heart', lang: 'es' }), /English only.*Windows voice/);
  assert.match(voiceProblem({ tts: 'kokoro', voice: 'ef_dora', lang: 'es' }), /phonemizer/);
  assert.equal(voiceProblem({ tts: 'sapi', voice: 'Microsoft Helena Desktop', lang: 'es' }), null, 'Windows voices are checked by culture at prepare');
  assert.ok(sameLanguage('es-ES', 'es') && !sameLanguage('en-US', 'es'));
});

test('British and American phonemes stay apart when one process asks for both', async () => {
  const { toPhonemes } = await import('../engine/tts/kokoro.mjs');
  const us = await toPhonemes('tomato', 'en-us');
  const gb = await toPhonemes('tomato', 'en-gb');
  assert.notEqual(us, gb, 'en-gb is not stuck on en-us');
  assert.equal(await toPhonemes('tomato', 'en-us'), us);
  assert.equal(await toPhonemes('tomato', 'en-gb'), gb);
});

test('estimated timing reads the base language when the region has no entry', () => {
  const cfg = { wordsPerSecond: { en: 2.6, es: 3, default: 2.4 }, leadIn: 0.2, tailOut: 0.5, lastSceneHold: 1, minScene: 0 };
  assert.equal(estimateTiming({ scenes: [{ id: 'a', vo: 'uno dos tres' }] }, cfg, 'es-mx').wordsPerSecond, 3);
  assert.equal(estimateTiming({ scenes: [{ id: 'a', vo: 'x' }] }, cfg, 'de').wordsPerSecond, 2.4);
});

test('after a script exists, a new voice only needs a new storyboard; a new language needs the Director', (t) => {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  saveBrief(validateBrief(brief));
  writeJson(jobFile(P, 'v-16x9', 'script.json'), { scenes: [] });

  const voice = updateBrief(P, 'v-16x9', { ...brief, voice: 'kokoro:bf_emma' });
  assert.deepEqual(voice.changed, ['voice']);
  assert.equal(voice.requeued, false);
  assert.equal(voice.rePrepare, true);
  assert.equal(getStatus(P, 'v-16x9').dirty_from, 5);

  const lang = updateBrief(P, 'v-16x9', { ...brief, voice: 'kokoro:bf_emma', lang: 'en-gb' });
  assert.deepEqual(lang.changed, ['lang']);
  assert.equal(lang.requeued, true);
  assert.equal(getStatus(P, 'v-16x9').dirty_from, 1);
});
