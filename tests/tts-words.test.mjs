import test from 'node:test';
import assert from 'node:assert/strict';
import { kokoroWords, innerBoundaries } from '../engine/tts.mjs';
import { voicedPauses } from '../engine/tts/kokoro.mjs';
import { speechOnset } from '../engine/stt.mjs';
import { startOnSpeech } from '../engine/pipeline.mjs';

const RATE = 24000;
// A tone where each [from, to] (seconds) is "speech" and everything else is silence.
const audio = (seconds, parts, rate = RATE, amp = 0.5) => {
  const s = new Float32Array(Math.round(seconds * rate));
  for (const [a, b] of parts) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) s[i] = amp * Math.sin(i / 3);
  return s;
};
const at = (words, w) => words.find((x) => x.w === w).at;

test('voicedPauses finds the silences inside the voice and ignores the edges', () => {
  const p = voicedPauses(audio(2.2, [[0.1, 1.0], [1.4, 2.0]]));
  assert.equal(p.length, 1);
  assert.ok(Math.abs(p[0].start - 1.0) < 0.03 && Math.abs(p[0].end - 1.4) < 0.03, JSON.stringify(p));
  assert.deepEqual(voicedPauses(audio(1, [[0.1, 0.9]])), []);
});

test('kokoroWords pins a comma to the pause the voice makes, so later words do not drift', () => {
  // The weights alone put "three" near 0.75 s; the voice pauses 1.0-1.4 s after "two,".
  const words = kokoroWords('one two, three four.', audio(2, [[0, 1.0], [1.4, 1.8]]));
  assert.deepEqual(words.map((w) => w.w), ['one', 'two,', 'three', 'four.']);
  assert.ok(Math.abs(at(words, 'three') - 1.4) < 0.03, `three at ${at(words, 'three')}`);
  assert.ok(at(words, 'one') < 0.03);
  assert.ok(at(words, 'two,') > 0.3 && at(words, 'two,') < 1.0);
  assert.ok(at(words, 'four.') > 1.45 && at(words, 'four.') < 1.8);
});

test('kokoroWords pins every mark in order on a longer line', () => {
  const words = kokoroWords('alpha beta, gamma delta. epsilon zeta.', audio(3.3, [[0, 0.8], [1.3, 2.0], [2.5, 3.2]]));
  assert.ok(Math.abs(at(words, 'gamma') - 1.3) < 0.03, `gamma at ${at(words, 'gamma')}`);
  assert.ok(Math.abs(at(words, 'epsilon') - 2.5) < 0.03, `epsilon at ${at(words, 'epsilon')}`);
  const times = words.map((w) => w.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('kokoroWords gives every comma of a list its own pause, even when the next pause is longer', () => {
  // The weights put the first comma late; the longest pause in reach then is the one after "speed,".
  const words = kokoroWords('the marketing engine, speed, Auto-Ship, security, AI, and the platform upgrade.',
    audio(5.5, [[0, 1.05], [1.17, 1.69], [1.83, 2.37], [2.47, 3.25], [3.39, 3.93], [4.13, 5.4]]));
  for (const [w, t] of [['speed,', 1.17], ['Auto-Ship,', 1.83], ['security,', 2.47], ['AI,', 3.39], ['and', 4.13]]) {
    assert.ok(Math.abs(at(words, w) - t) < 0.03, `${w} at ${at(words, w)}`);
  }
});

test('kokoroWords pins a clear pause with no punctuation to the nearest word boundary', () => {
  const words = kokoroWords('third quarter revenue grew fourteen percent', audio(3, [[0, 1.2], [1.5, 2.8]]));
  const next = words.find((w) => w.at >= 1.45);
  assert.ok(next && Math.abs(next.at - 1.5) < 0.03, JSON.stringify(words));
  const short = kokoroWords('one two three four', audio(2, [[0, 1.0], [1.08, 1.8]]));
  assert.ok(!short.some((w) => Math.abs(w.at - 1.08) < 0.02), 'a 0.08 s gap with no punctuation is not a pin');
  // Kokoro breathes about 0.1 s before a name it spells out ("AMAD"): that pause is a boundary.
  const breath = kokoroWords('the team ran eight workstreams', audio(2.2, [[0, 0.6], [0.72, 2.0]]));
  assert.ok(breath.some((w) => Math.abs(w.at - 0.72) < 0.03), JSON.stringify(breath));
});

test('kokoroWords spreads by weight when there is no pause to pin', () => {
  const plain = kokoroWords('one two three four', audio(2, [[0, 1.8]]));
  assert.deepEqual(plain.map((w) => w.at), [...plain.map((w) => w.at)].sort((a, b) => a - b));
  const steady = kokoroWords('one two, three four.', audio(2, [[0, 1.8]]));
  assert.ok(at(steady, 'three') > 0.5 && at(steady, 'three') < 1.1, 'no pause: the weights decide');
  assert.deepEqual(kokoroWords('', audio(1, [[0, 1]])), []);
});

test('speechOnset finds where the voice starts over a quiet bed', () => {
  const s = audio(2, [[0, 2]], 16000, 0.02);
  for (let i = Math.round(0.3 * 16000); i < Math.round(1.5 * 16000); i++) s[i] = 0.6 * Math.sin(i / 3);
  assert.ok(Math.abs(speechOnset(s, 16000) - 0.3) < 0.03);
  assert.equal(speechOnset(new Float32Array(1600), 16000), 0);
});

test('speechOnset skips a click at the cut', () => {
  const s = audio(2, [[0.25, 1.5]], 16000, 0.4);
  for (let i = 0; i < 160; i++) s[i] = 0.9 * Math.sin(i / 2);
  assert.ok(Math.abs(speechOnset(s, 16000) - 0.25) < 0.03, `onset ${speechOnset(s, 16000)}`);
});

test('startOnSpeech moves only the words stamped before the speech', () => {
  const ws = [{ w: "I'm", start: 0, end: 0.4 }, { w: 'Adam', start: 0.42, end: 0.7 }];
  assert.deepEqual(startOnSpeech(ws, 0.28), [{ w: "I'm", start: 0.28, end: 0.4 }, ws[1]]);
  assert.equal(startOnSpeech(ws, 0), ws, 'speech from the start: unchanged');
  assert.deepEqual(startOnSpeech(ws, 0.4), [{ w: "I'm", start: 0.4, end: 0.58 }, { w: 'Adam', start: 0.6, end: 0.88 }], 'no room before the next word: it moves back');
  assert.deepEqual(startOnSpeech([], 0.3), []);
});

test('startOnSpeech spreads several early words from the onset to the first word placed after it', () => {
  const ws = [{ w: "I'm", start: 0, end: 0.2 }, { w: 'Adam', start: 0.22, end: 0.46 }, { w: 'J.', start: 0.48, end: 0.89 }];
  const out = startOnSpeech(ws, 0.28);
  assert.deepEqual(out.map((w) => w.start), [0.28, 0.38, 0.48]);
  assert.ok(out[0].end < out[1].start && out[1].end < out[2].start);
  assert.equal(out[2], ws[2]);
});

test('startOnSpeech with no room moves later words back only as far as they would overlap', () => {
  const ws = [['Oh', 0, 0.21], ['yeah', 0.23, 0.77], ['and', 0.79, 1.05], ['AI', 1.07, 1.28], ['ran', 1.7, 1.9]].map(([w, start, end]) => ({ w, start, end }));
  const out = startOnSpeech(ws, 0.72);
  assert.deepEqual(out.map((w) => w.start), [0.72, 0.92, 1.12, 1.4, 1.7]);
  assert.equal(out[4], ws[4]);
  assert.ok(out.every((w, i) => w.end > w.start && (i === 0 || w.start > out[i - 1].end)));
});

test('innerBoundaries marks the joins inside a word the voice says as several', () => {
  // "Niteco's AMAD team" said as "Nee-teh-co's Eh Em Eh Dee team": groups 1, 4, 1.
  assert.deepEqual([...innerBoundaries([1, 4, 1])], [1, 2, 3]);
  assert.equal(innerBoundaries(null), null);
  assert.equal(innerBoundaries([1, 1, 1]), null);
});

// NSC award film, 2026-10-28: Kokoro breathed between "Nee-teh-co's" and "Eh Em Eh Dee" (AMAD); the long hyphenated
// word was under-weighted, so the breath was pinned between "Em" and "Eh" and AMAD's caption lit 0.49 s early.
test('kokoroWords never pins a pause inside a spelled-out word: the boundary before it takes the pause', () => {
  const text = 'Nee-teh-co-s Eh Em Eh Dee team ran';
  const sound = audio(3.4, [[0, 1.3], [1.44, 3.2]]);
  const inner = innerBoundaries([1, 4, 1, 1]);
  const words = kokoroWords(text, sound, RATE, { inner });
  assert.ok(Math.abs(at(words, 'Eh') - 1.44) < 0.03, JSON.stringify(words));
  const second = words.filter((w) => w.w === 'Eh')[1].at;
  assert.ok(second > 1.5, 'no pin inside the spelled-out word');
});
