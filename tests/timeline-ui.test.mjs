// The Timeline's pure helpers (ui/timeline.js): twins of the engine's limits, block layout from timing.json, reorder,
// cue snapping as ui-story places shots, cut sound choices per template, and the script each edit writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { MAX_HOLD } from '../engine/script.mjs';
import { CUT_SOUNDS as BRAND_CUT_SOUNDS } from '../engine/brand.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import {
  HOLD_MAX, CUT_SOUNDS, CUE_LEAD, roundHold, fmtSec, sceneSpans, totalOf, moveItem, dropIndex, cueKey, cueWord, snapWord, stepWord,
  shotTimes, cueRange, sfxOptions, takesCue, editScript,
} from '../ui/timeline.js';

const CFG = { wordsPerSecond: { default: 2.6 }, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2, minScene: 2.5 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.002, `${msg}: ${a} vs ${b}`);
const TEMPLATES = fs.readdirSync(DIRS.templates).filter((id) => fs.existsSync(path.join(DIRS.templates, id, 'beats.json')));

test('the Timeline limits are the engine\'s', () => {
  assert.equal(HOLD_MAX, MAX_HOLD);
  assert.deepEqual(CUT_SOUNDS, BRAND_CUT_SOUNDS);
});

test('roundHold keeps a hold in 0.1 s steps between 0 and 4', () => {
  assert.equal(roundHold(0.04), 0);
  assert.equal(roundHold(0.29), 0.3, 'no float tail (0.30000000000000004)');
  assert.equal(roundHold(1.26), 1.3);
  assert.equal(roundHold(9), 4);
  assert.equal(roundHold(-2), 0);
  assert.equal(roundHold('x'), 0);
  assert.equal(fmtSec(1.26), '1.3 s');
});

test('blocks take their length from the last prepare without its hold, then add the hold the script sets now', () => {
  const script = { scenes: [
    { id: 'a', kind: 'step', vo: 'One two three four five six.', hold: 1 },
    { id: 'b', kind: 'step', vo: 'Then the next line.' },
  ] };
  const timing = estimateTiming(script, CFG);
  const now = editScript(script, { hold: 'a', value: 2.5 });
  now.scenes.push({ id: 'new', kind: 'step', vo: 'A scene added after the storyboard.' });
  const [a, b, added] = sceneSpans(now, timing);
  near(a.base, timing.scenes[0].end - timing.scenes[0].start - 1, 'a without the old hold');
  near(a.length, a.base + 2.5, 'a with the new hold');
  near(b.start, a.length, 'b starts where a ends now');
  near(b.length, timing.scenes[1].end - timing.scenes[1].start, 'b keeps its length');
  assert.equal(added.estimated, true);
  near(added.length, Math.max(2, 6 / 2.6 + 1), 'a scene with no timing yet is estimated from its words');
  assert.deepEqual(a.words.map((w) => w.w), ['One', 'two', 'three', 'four', 'five', 'six.']);
  near(a.words[0].at, CFG.leadIn, 'word times are scene-relative');
  near(totalOf([a, b, added]), a.length + b.length + added.length, 'total');
});

test('a dragged block lands after the blocks whose middle it passed', () => {
  const spans = [{ start: 0, length: 2 }, { start: 2, length: 4 }, { start: 6, length: 1 }];
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(ids, 0, dropIndex(spans, 0, 5)), ['b', 'a', 'c'], 'past b\'s middle (4 s)');
  assert.deepEqual(moveItem(ids, 0, dropIndex(spans, 0, 7)), ['b', 'c', 'a'], 'past c\'s middle too');
  assert.deepEqual(moveItem(ids, 2, dropIndex(spans, 2, 0.5)), ['c', 'a', 'b'], 'before a\'s middle');
  assert.deepEqual(moveItem(ids, 1, dropIndex(spans, 1, 4)), ids, 'not far enough: same place');
  assert.deepEqual(ids, ['a', 'b', 'c'], 'the list itself is not changed');
});

// click then click save done: "click" twice, so the second can only be named once the first is matched.
const W = [['Click,', 0.3], ['then', 0.8], ['click', 1.3], ['Save.', 2.6], ['Done!', 4.4]].map(([w, at]) => ({ w, at, end: at + 0.3 }));

test('a cue snaps to the nearest word the renderer would find there, with punctuation trimmed', () => {
  assert.equal(cueWord('Click,'), 'Click');
  assert.equal(cueWord('«Save»'), 'Save');
  assert.equal(cueKey('Click,'), 'click');
  assert.notEqual(snapWord(W, 1.3), 2, 'a repeated word is found at its first place');
  assert.equal(snapWord(W, 1.3, 1), 2, 'after a cue on "then" the second "click" is the first one found');
  assert.equal(snapWord(W, 4, -1, 4), 3, 'never at or past the next cued word');
  assert.equal(snapWord([], 1), -1);
  assert.equal(stepWord(W, 1, 1), 3, 'the arrow key skips the repeated word');
  assert.equal(stepWord(W, 3, -1), 1);
  assert.equal(stepWord(W, 4, 1), -1, 'no word after the last');
});

// The renderer's own placement code (templates/ui-story CUE_TIMES), run on the same words, is the twin of shotTimes.
const CUE_TIMES = fs.readFileSync(path.join(DIRS.templates, 'ui-story', 'template.mjs'), 'utf8').match(/const CUE_TIMES = `([\s\S]*?)`;/)[1];
// eslint-disable-next-line no-new-func
const rendererTimes = new Function('words', 'sc', 's', 'e', 'n', `${CUE_TIMES}\nreturn T;`);

test('shot markers sit where ui-story starts each shot', () => {
  const S0 = 10, LEN = 6;
  const abs = W.map((x) => ({ w: x.w, start: S0 + x.at }));
  for (const cues of [['Save', null, 'Done'], [null, null], ['Click', 'click'], ['then', null, null, null], ['Done', 'Save']]) {
    const shots = cues.map((c) => (c ? { cue: c } : {}));
    const mine = shotTimes(shots, W, LEN);
    const theirs = rendererTimes(() => abs, { shots: shots.map((sh) => (sh.cue ? { cue: cueKey(sh.cue) } : {})) }, S0, S0 + LEN, shots.length);
    mine.forEach((x, k) => near(x.t, theirs[k] - S0, `${cues.join('/')} shot ${k}`));
  }
  const t = shotTimes([{ cue: 'Save' }, {}, { cue: 'Done' }], W, LEN);
  assert.deepEqual(t.map((x) => x.word), [3, -1, 4], 'which word each cue matched');
  near(t[0].t, 2.6 - CUE_LEAD, 'a cued shot starts just before its word');
  assert.deepEqual(shotTimes([{ cue: 'Done' }, { cue: 'Save' }], W, LEN).map((x) => x.word), [4, -1], 'a cue before the previous one is not found');
  assert.deepEqual(cueRange(t, 1), { lo: 3, hi: 4 }, 'the middle shot moves between its neighbours\' words');
  assert.deepEqual(cueRange(t, 0), { lo: -1, hi: 4 });
});

test('cut sounds are offered only on kinds whose template lists sfx, from its enum', () => {
  for (const id of TEMPLATES) {
    const { beats } = loadTemplate(id);
    for (const [kind, spec] of Object.entries(beats.fields)) {
      const opts = sfxOptions(beats, kind);
      if (![...spec.required, ...spec.optional].includes('sfx')) { assert.equal(opts, null, `${id}.${kind}`); continue; }
      assert.deepEqual(opts, beats.enums?.sfx || CUT_SOUNDS, `${id}.${kind}`);
      for (const n of opts) assert.ok(CUT_SOUNDS.includes(n), `${id}.${kind}: ${n} is a cut sound`);
    }
  }
  const mixed = { fields: { 'explainer.step': { required: [], optional: ['sfx'] } }, sources: { explainer: { enums: { sfx: ['hit', 'none'] } } }, enums: {} };
  assert.deepEqual(sfxOptions(mixed, 'explainer.step'), ['hit', 'none'], 'an extra kind follows its own template');
  assert.equal(sfxOptions(mixed, 'nope'), null);
});

test('only ui-story shot scenes take cues', () => {
  assert.equal(takesCue('ui-story', 'shot'), true);
  assert.equal(takesCue('explainer', 'ui-story.shot'), true, 'ui-story mixed into another brief');
  assert.equal(takesCue('app-walkthrough', 'shot'), false);
  assert.equal(takesCue('ui-story', 'title'), false);
});

test('each Timeline edit changes one thing, never the script it was given, and drops the locks', () => {
  const script = { look: 'calm', locks: { scenes: { by: 'x' } }, scenes: [
    { id: 'a', kind: 'title', vo: 'Hi.', hold: 2 },
    { id: 'b', kind: 'shot', vo: 'Click save.', shots: [{ asset: 'x.png', cue: 'save' }, { asset: 'y.png' }], sfx: 'hit' },
  ] };
  const copy = structuredClone(script);
  assert.deepEqual(editScript(script, { order: ['b', 'a'] }).scenes.map((s) => s.id), ['b', 'a']);
  assert.equal(editScript(script, { hold: 'a', value: 0 }).scenes[0].hold, undefined, 'a 0 s hold is removed');
  assert.equal(editScript(script, { hold: 'a', value: 1.26 }).scenes[0].hold, 1.3);
  assert.equal(editScript(script, { sfx: 'b', value: '' }).scenes[1].sfx, undefined, 'empty = the brand\'s cut sound');
  assert.equal(editScript(script, { sfx: 'b', value: 'whoosh' }).scenes[1].sfx, 'whoosh');
  assert.equal(editScript(script, { cue: 'b', shot: 1, value: 'Click' }).scenes[1].shots[1].cue, 'Click');
  assert.equal(editScript(script, { cue: 'b', shot: 0, value: '' }).scenes[1].shots[0].cue, undefined);
  const none = editScript(script, {});
  assert.equal(none.locks, undefined);
  assert.equal(none.look, 'calm');
  assert.deepEqual(script, copy, 'the input is untouched');
});
