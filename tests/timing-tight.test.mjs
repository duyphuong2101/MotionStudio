import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTiming, sceneGaps } from '../engine/timing.mjs';
import { beatSnap } from '../engine/beats.mjs';
import { loadStudioConfig } from '../engine/core.mjs';

const CFG = { wordsPerSecond: { default: 2.6 }, leadIn: 0.2, tailOut: 0.5, lastSceneHold: 1, minScene: 2.2, tight: { leadIn: 0.15, tailOut: 0.4 } };
const WPS = 2.6;
const script = () => ({
  scenes: [
    { id: 'a', vo: 'one two three four five six seven eight' },
    { id: 'b', vo: 'one two three four five' },
    { id: 'c', vo: 'one two three four' },
  ],
});
const words = (sc) => sc.vo.split(' ').length;
// Seconds from the cut to the first word, and from the end of the estimated speech to the next cut.
const gaps = (timing, s) => timing.scenes.map((t, i) => {
  const first = timing.words.find((w) => w.scene === t.id).start;
  return { head: Math.round((first - t.start) * 1000) / 1000, tail: Math.round((t.end - first - words(s.scenes[i]) / WPS) * 1000) / 1000 };
});

test('a standard timing keeps the config lead-in and tail, byte for byte', () => {
  const s = script();
  const plain = estimateTiming(s, CFG);
  assert.deepEqual(estimateTiming(s, CFG, 'en', null, null, null, false), plain);
  assert.deepEqual(plain.scenes.map((x) => x.end), [3.777, 6.4, 9.138]);
  assert.equal(plain.duration, 9.138);
  assert.deepEqual(gaps(plain, s), [{ head: 0.2, tail: 0.5 }, { head: 0.2, tail: 0.5 }, { head: 0.2, tail: 1 }]);
});

test('a tight timing starts each line 0.15 s after the cut and cuts 0.4 s after it, except the last scene', () => {
  const s = script();
  const tight = estimateTiming(s, CFG, 'en', null, null, null, true);
  assert.deepEqual(gaps(tight, s), [{ head: 0.15, tail: 0.4 }, { head: 0.15, tail: 0.4 }, { head: 0.15, tail: 1 }]);
  assert.deepEqual(tight.scenes.map((x) => x.end), [3.627, 6.1, 8.788]);
});

test('the shipped config carries the tight gaps', () => {
  const t = loadStudioConfig().timing;
  assert.deepEqual(t.tight, { leadIn: 0.15, tailOut: 0.4 });
  assert.ok(t.tight.leadIn < t.leadIn && t.tight.tailOut < t.tailOut);
});

test('tight keeps pace minimums; a pace tail can shorten the tight tail but never lengthen it', () => {
  const pace = { quick: { perShot: 1.8, minScene: 2.2, tail: 0.25 }, normal: { perShot: 3, minScene: 3.5 }, focus: { perShot: 4, minScene: 5, tail: 1.2 } };
  assert.deepEqual(sceneGaps(CFG, pace.quick, false, true), { lead: 0.15, tail: 0.25 });
  assert.deepEqual(sceneGaps(CFG, pace.focus, false, true), { lead: 0.15, tail: 0.4 });
  assert.deepEqual(sceneGaps(CFG, pace.focus, true, true), { lead: 0.15, tail: 1 });
  assert.deepEqual(sceneGaps(CFG, pace.focus, false, false), { lead: 0.2, tail: 1.2 }, 'standard keeps the pace tail');
  const s = { scenes: [{ id: 'a', vo: 'short line', pace: 'focus' }, { id: 'b', vo: Array(16).fill('word').join(' '), pace: 'focus' }, { id: 'c', vo: 'end' }] };
  const t = estimateTiming(s, CFG, 'en', pace, null, null, true);
  assert.equal(t.scenes[0].end, 5, 'a short focus line still holds the focus minimum');
  assert.equal(Math.round((t.scenes[1].end - t.scenes[1].start) * 1000) / 1000, Math.round((0.15 + 16 / WPS + 0.4) * 1000) / 1000, 'a long focus line cuts 0.4 s after it');
});

test('beat snapping still applies after the tight gaps', () => {
  const s = script();
  const snapped = estimateTiming(s, CFG, 'en', null, null, beatSnap({ period: 0.5, offset: 0 }), true);
  for (const sc of snapped.scenes) assert.equal(Math.round(sc.end * 1000) % 500, 0, `${sc.id} ends on a beat (${sc.end})`);
  const free = estimateTiming(s, CFG, 'en', null, null, null, true);
  snapped.scenes.forEach((sc, i) => assert.ok(sc.end >= free.scenes[i].end, `${sc.id} only grows`));
});
