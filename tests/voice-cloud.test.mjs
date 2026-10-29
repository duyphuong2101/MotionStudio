import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig, writeJson } from '../engine/core.mjs';
import { runDay } from '../server/caps.mjs';
import { profileDir, jobDir, jobFile } from '../engine/jobs.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { alignmentWords, lineKey, cloudTake, takeFile } from '../engine/cloudvoice.mjs';
import { speakScript } from '../engine/tts.mjs';
import { filesIn, planLines, lineRequest, lineFromAnswer, startCloudVoice, voiceCloudHas, voiceCloudState, usageToday, wavSeconds } from '../server/voice-cloud.mjs';

globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const V = loadStudioConfig().voiceCloud;
const KEY = 'sk_' + 'a1'.repeat(24);
const ENV = { [V.keyEnv]: KEY };
const P = 'zz-test-cloudvoice', J = 'clip';
const BRAND = {
  name: 'Cloud Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' }, voice: { tts: 'kokoro', voice: 'af_heart', say: { AMAD: 'Eh Em Eh Dee' }, cast: { numbers: 'am_michael' }, cloud: { voice: '21m00Tcm4TlvDq8ikWAM' } },
};
const SCRIPT = { lang: 'en', scenes: [
  { id: 'intro', kind: 'title', vo: 'Meet AMAD today.' },
  { id: 'nums', kind: 'title', vo: 'Ten times faster.', speaker: 'numbers' },
  { id: 'end', kind: 'title', vo: 'Try it now.' },
] };

/** A character alignment for `text`: each character a tenth of a second. */
const align = (text) => ({ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i / 10), character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10) });

let AUDIO;
test.before(async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cv-')), 'tone.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.8', '-ac', '1', '-ar', '24000', f]);
  AUDIO = fs.readFileSync(f).toString('base64');
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

function setup(t) {
  fs.mkdirSync(profileDir(P), { recursive: true });
  writeJson(path.join(profileDir(P), 'brand.json'), validateBrand(BRAND));
  fs.mkdirSync(jobDir(P, J), { recursive: true });
  writeJson(jobFile(P, J, 'script.json'), SCRIPT);
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cvlog-'));
  t.after(() => { for (const d of [profileDir(P), path.dirname(jobDir(P, J)), logs]) fs.rmSync(d, { recursive: true, force: true }); });
  return filesIn(logs);
}

function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  fn.calls = calls;
  return fn;
}
const ok = (_, init) => new Response(JSON.stringify({ audio_base64: AUDIO, alignment: align(JSON.parse(init.body).text) }), { status: 200, headers: { 'content-type': 'application/json' } });

async function settle() {
  for (let i = 0; i < 1000 && voiceCloudHas(P); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(!voiceCloudHas(P), 'the run did not finish');
}

test('character times become words; the brand keeps a checked cloud voice', () => {
  assert.deepEqual(alignmentWords(align('Hi there.')), [{ w: 'Hi', at: 0, end: 0.2 }, { w: 'there.', at: 0.3, end: 0.9 }]);
  assert.deepEqual(alignmentWords({ characters: ['a'], character_start_times_seconds: [] }), []);
  assert.deepEqual(validateBrand(BRAND).voice.cloud, { provider: 'elevenlabs', voice: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_multilingual_v2' });
  assert.throws(() => validateBrand({ ...BRAND, voice: { cloud: { voice: 'bad id!' } } }), /voice\.cloud\.voice/);
  assert.throws(() => validateBrand({ ...BRAND, voice: { cloud: { voice: '21m00Tcm4TlvDq8ikWAM', provider: 'heygen' } } }), /voice\.cloud\.provider/);
  assert.ok(!('cloud' in validateBrand({ ...BRAND, voice: { tts: 'kokoro' } }).voice));
});

test('a run speaks the lines as the voice says them, skips cast speakers, and sends the key in a header only', () => {
  const brand = validateBrand(BRAND);
  const lines = planLines(SCRIPT, brand);
  assert.deepEqual(lines.map((l) => [l.id, l.text]), [['intro', 'Meet Eh Em Eh Dee today.'], ['end', 'Try it now.']]);
  assert.equal(lines[0].key, lineKey(brand.voice.cloud, 'Meet Eh Em Eh Dee today.'));
  assert.notEqual(lineKey(brand.voice.cloud, 'x'), lineKey({ ...brand.voice.cloud, voice: 'Other0000Voice' }, 'x'));
  const r = lineRequest({ voice: 'abcDEF123456', model: 'eleven_multilingual_v2', text: 'Hi' }, KEY);
  assert.equal(r.url, 'https://api.elevenlabs.io/v1/text-to-speech/abcDEF123456/with-timestamps?output_format=mp3_44100_128');
  assert.ok(!r.url.includes(KEY) && !r.init.body.includes(KEY));
  assert.equal(r.init.headers['xi-api-key'], KEY);
  assert.throws(() => lineFromAnswer({ alignment: align('x') }, 100), /without audio/);
  assert.throws(() => lineFromAnswer({ audio_base64: 'QUJD' }, 100), /without word times/);
  assert.throws(() => lineFromAnswer({ audio_base64: 'QUJD'.repeat(100), alignment: align('x') }, 100), /voiceCloud\.maxResponseBytes/);
});

test('Make cloud voice saves each missing line once with its words, counts it, and prepare uses it', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(ok);
  let done = null;
  assert.deepEqual(startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files, onDone: (r) => { done = r; } }), { started: true, lines: 2, chars: 35 });
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files }), (e) => e.code === 409);
  await settle();
  assert.equal(fetch.calls.length, 2);
  assert.equal(done?.made, 2);
  assert.deepEqual(usageToday(files.usage), { lines: 2, chars: 35 });
  const st = voiceCloudState(V, P, J, { env: ENV, files });
  assert.deepEqual([st.hasKey, st.lines, st.missing, st.last.status], [true, 2, [], 'done']);
  assert.ok(!JSON.stringify(st).includes(KEY), 'the state never carries the key');
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files }), /already has its cloud voice/);

  const brand = validateBrand(BRAND);
  const line = cloudTake(jobDir(P, J), brand.voice.cloud).get('Try it now.');
  assert.ok(line && Math.abs(line.seconds - 0.8) < 0.02 && line.words.length === 3);
  assert.ok(Math.abs(wavSeconds(fs.readFileSync(line.wav)) - 0.8) < 0.02);

  // Prepare hears the saved lines; the cast speaker keeps the local voice. Swap it for a silent scene so no TTS runs.
  const script = { lang: 'en', scenes: SCRIPT.scenes.filter((s) => !s.speaker) };
  const cfg = loadStudioConfig().timing;
  const timing = await speakScript(jobDir(P, J), script, brand, cfg, null);
  assert.deepEqual(timing.cloud, { used: ['intro', 'end'], stale: [] });
  const intro = timing.words.filter((w) => w.scene === 'intro').map((w) => w.w);
  assert.deepEqual(intro, ['Meet', 'AMAD', 'today.'], 'captions keep the script words; "Eh Em Eh Dee" maps back to AMAD');
  const end = timing.words.filter((w) => w.scene === 'end');
  assert.ok(Math.abs(end[1].start - end[0].start - 0.4) < 0.02, `word times come from the alignment: ${JSON.stringify(end)}`);
  assert.ok(fs.existsSync(path.join(jobDir(P, J), 'voice.wav')));
});

test('no key, a long line and the daily cap refuse before any call; a line not made has no saved take', (t) => {
  const files = setup(t);
  const fetch = fakeFetch(ok);
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: {}, fetch, files }), new RegExp(`Add ${V.keyEnv} to \\.env`));
  writeJson(files.usage, { day: runDay(), lines: V.maxLinesPerDay - 1, chars: 0 });
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files }), /Daily line limit/);
  writeJson(jobFile(P, J, 'script.json'), { scenes: [{ id: 'long', kind: 'title', vo: 'word '.repeat(V.maxCharsPerLine) }] });
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files }), /long: the line is longer/);
  assert.equal(fetch.calls.length, 0);
  assert.equal(cloudTake(jobDir(P, J), validateBrand(BRAND).voice.cloud).get('Anything else.'), null);
});

test('a 429 pauses the run, nothing retries, and the key never reaches the message or the log', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(() => new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: `quota used up for ${KEY}` } }), { status: 401, headers: { 'content-type': 'application/json' } }));
  startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files });
  await settle();
  assert.equal(fetch.calls.length, 1, 'no retry after a quota answer');
  const st = voiceCloudState(V, P, J, { env: ENV, files });
  assert.equal(st.last.status, 'error');
  assert.match(st.last.message, /quota or rate limit reached\. Paused until/);
  assert.ok(st.pause && !JSON.stringify(st).includes(KEY));
  assert.ok(!fs.readFileSync(path.join(files.dir, `${P}.log`), 'utf8').includes(KEY));
  assert.ok(!fs.readFileSync(files.pause, 'utf8').includes(KEY));
  assert.throws(() => startCloudVoice(V, { project: P, job: J, by: 'tester', env: ENV, fetch, files }), /Paused until/);
  assert.ok(!fs.existsSync(takeFile(jobDir(P, J))), 'nothing saved');
});
