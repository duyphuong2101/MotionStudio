import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript, voiceFitsClip } from '../engine/script.mjs';
import { alignTake, TAKE_DEFAULTS } from '../engine/voicetake.mjs';
import { parseLoudness, judge } from '../engine/qa.mjs';

/* ---------- a voice line over a clip that plays its own sound ---------- */
const clipScene = (over = {}) => ({ id: 'rec', kind: 'video', title: 'On air', video: 'rec.mp4', source: 'bullets[0]', ...over });
const clipWarnings = (scene) => validateScript({ scenes: [scene] }, loadTemplate('explainer').beats, { assets: ['rec.mp4'] })
  .warnings.filter((w) => w.includes('plays its own sound'));

test('a voice line on a sound clip scene is a warning; a muted clip or no voice line is not', () => {
  assert.deepEqual(clipWarnings(clipScene({ sound: true, vo: 'Watch this part closely.' })),
    ["rec: the clip plays its own sound under the voice line; if the voice runs longer than the clip, the scene holds the clip's last frame until the voice ends"]);
  assert.deepEqual(clipWarnings(clipScene({ sound: true, vo: '' })), []);
  assert.deepEqual(clipWarnings(clipScene({ sound: false, vo: 'Watch this part closely.' })), []);
  assert.deepEqual(clipWarnings(clipScene({ vo: 'Watch this part closely.' })), []);
});

test('voiceFitsClip: the estimated speech, after the lead-in, ends inside the clip', () => {
  assert.equal(voiceFitsClip(0, 1, 2.6), true, 'no voice always fits');
  assert.equal(voiceFitsClip(5, 2, 2.6), true, '1.92 s in 2 s');
  assert.equal(voiceFitsClip(6, 2, 2.6), false, '2.31 s in 2 s');
  assert.equal(voiceFitsClip(5, 2, 2.6, 0.2), false, 'the lead-in counts');
});

/* ---------- recorded take: short lines and one misheard word ---------- */
const LONG_A = 'Month end used to take five days.';
const LONG_B = 'Our platform closes the books in two.';
function hear(texts) {
  const out = [];
  let t = 0.5;
  for (const text of texts) {
    for (const w of text.split(/\s+/).filter(Boolean)) { out.push({ w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) }); t += 0.35; }
    t += 0.8;
  }
  return out;
}
const lines = (short) => [{ id: 'a', text: LONG_A }, { id: 'short', text: short }, { id: 'b', text: LONG_B }];

test('a 2 or 3 word line passes with one misheard word', () => {
  assert.equal(TAKE_DEFAULTS.maxMisses, 1);
  assert.equal(alignTake(lines('Book now.'), hear([LONG_A, 'Book cow.', LONG_B]))[1].match, 0.5);
  assert.equal(alignTake(lines('Try it today.'), hear([LONG_A, 'Try it now.', LONG_B]))[1].match, 0.67);
});

test('a short line still fails with two misses, or with its only word misheard', () => {
  assert.throws(() => alignTake(lines('Try it today.'), hear([LONG_A, 'Cry it now.', LONG_B])), /Scene short: the take says/);
  assert.throws(() => alignTake(lines('Hello.'), hear([LONG_A, 'Yellow.', LONG_B])), /Scene short/);
  assert.throws(() => alignTake(lines('Book now.'), hear([LONG_A, LONG_B])), /Scene short: the take says nothing here/);
});

test('maxMisses 0 keeps the plain share rule', () => {
  assert.throws(() => alignTake(lines('Book now.'), hear([LONG_A, 'Book cow.', LONG_B]), { maxMisses: 0 }), /Scene short/);
  assert.equal(alignTake(lines('Book now.'), hear([LONG_A, 'Book cow.', LONG_B]), { maxMisses: 0, minMatch: 0.5 })[1].match, 0.5);
});

test('a long line is held to the share rule: one miss passes, three do not', () => {
  assert.equal(alignTake(lines('Book now.'), hear([LONG_A, 'Book now.', 'Our platform closes the bucks in two.']))[2].match, 0.86);
  assert.throws(() => alignTake(lines('Book now.'), hear([LONG_A, 'Book now.', 'Our system shuts the ledger in two.'])), /Scene b/);
});

/* ---------- QA: a silent track and audio without a loudness pass ---------- */
const SILENT = `[Parsed_ebur128_1 @ 0000] Summary:

  Integrated loudness:
    I:         -inf LUFS
    Threshold: -inf LUFS

  Loudness range:
    LRA:         0.0 LU

  True peak:
    Peak:       -inf dBFS`;

const measured = (loudness) => ({ probe: { duration: 20, hasAudio: true, hasVideo: true }, loudness, black: [], freeze: [], captions: null });
const expect = { width: 1920, height: 1080, fps: 30, duration: 20, silent: false, format: '16:9', platformFormats: null };
const loudnessMsgs = (r) => r.findings.filter((f) => f.check === 'loudness').map((f) => f.msg);

test('ffmpeg\'s -inf reads as no measurement, not NaN', () => {
  assert.deepEqual(parseLoudness(SILENT), { integrated: null, range: 0, truePeak: null });
});

test('a silent track on a job that should have sound warns', () => {
  const r = judge(measured(parseLoudness(SILENT)), expect);
  assert.deepEqual(loudnessMsgs(r), ['the sound track is silent: check the voice and music']);
  assert.equal(judge(measured(parseLoudness(SILENT)), { ...expect, silent: true }).warnings, 0, 'an expected silence does not');
});

test('normalised: false skips the loudness target but keeps the silence and peak checks', () => {
  assert.deepEqual(loudnessMsgs(judge(measured({ integrated: -31, range: 2, truePeak: -6 }), { ...expect, normalised: false })), []);
  assert.equal(loudnessMsgs(judge(measured({ integrated: -31, range: 2, truePeak: -6 }), expect)).length, 1, 'without the flag the target holds');
  assert.equal(loudnessMsgs(judge(measured({ integrated: null, range: 0, truePeak: null }), { ...expect, normalised: false })).length, 1);
  assert.match(loudnessMsgs(judge(measured({ integrated: -31, range: 2, truePeak: -0.2 }), { ...expect, normalised: false }))[0], /true peak/);
});
