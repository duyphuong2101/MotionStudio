// The Timeline's engine side: `hold` (quiet after a scene's line) on every template, in the timing and the pacing, and
// Timeline edits (order, hold, cut sound, shot cue) kept through the next Director commit like any person edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { loadTemplate, humanEdit, mergeRespectingLocks } from '../engine/jobs.mjs';
import { validateScript, MAX_HOLD } from '../engine/script.mjs';
import { estimateTiming, sceneHold } from '../engine/timing.mjs';
import { voiceHolds } from '../engine/pipeline.mjs';
import { pacing } from '../engine/review.mjs';
import { editScript } from '../ui/timeline.js';

const CFG = { wordsPerSecond: { default: 2.6 }, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2, minScene: 2.5 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.002, `${msg}: ${a} vs ${b}`);
const TEMPLATES = fs.readdirSync(DIRS.templates).filter((id) => fs.existsSync(path.join(DIRS.templates, id, 'beats.json')));

const three = (hold) => ({ scenes: [
  { id: 'a', kind: 'step', vo: 'One two three four five six seven eight nine ten.', ...(hold === undefined ? {} : { hold }) },
  { id: 'b', kind: 'step', vo: 'Then the next line comes in.' },
  { id: 'c', kind: 'cta', vo: 'Try it today.' },
] });

test('hold is a scene field of every template: a number of seconds from 0 to 4', () => {
  assert.equal(MAX_HOLD, 4);
  for (const id of TEMPLATES) {
    const { beats } = loadTemplate(id);
    const kind = Object.keys(beats.fields)[0];
    const check = (hold) => {
      const r = validateScript({ scenes: [{ id: 'a', kind, hold }] }, beats);
      return { errs: r.errors.filter((e) => e.includes('hold')), ignored: r.warnings.some((w) => w.includes('"hold"')) };
    };
    for (const ok of [0, 0.1, 2.5, 4, '1.5', '']) {
      const { errs, ignored } = check(ok);
      assert.deepEqual(errs, [], `${id}: hold ${JSON.stringify(ok)} is valid`);
      assert.equal(ignored, false, `${id}: hold is not an ignored field`);
    }
    for (const bad of [4.1, -0.1, true, [1], { s: 1 }, 'soon', ' ']) {
      assert.deepEqual(check(bad).errs, ['a: hold must be 0 to 4 seconds'], `${id}: hold ${JSON.stringify(bad)} is refused`);
    }
  }
});

test('sceneHold reads a hold as the timing takes it: blank is 0, out of range is clamped', () => {
  assert.equal(sceneHold({}), 0);
  assert.equal(sceneHold({ hold: '' }), 0);
  assert.equal(sceneHold({ hold: '2' }), 2);
  assert.equal(sceneHold({ hold: 9 }), MAX_HOLD);
  assert.equal(sceneHold({ hold: -1 }), 0);
  assert.equal(sceneHold(null), 0);
});

test('a hold moves its scene end, starts the next scene later and grows the video by the same amount', () => {
  const plain = estimateTiming(three(), CFG);
  const held = estimateTiming(three(1.5), CFG);
  near(held.scenes[0].end, plain.scenes[0].end + 1.5, 'scene a ends later');
  near(held.scenes[1].start, held.scenes[0].end, 'scene b starts at the new cut');
  near(held.scenes[1].start, plain.scenes[1].start + 1.5, 'scene b starts later');
  near(held.duration, plain.duration + 1.5, 'the video grows');
  assert.equal(held.scenes[0].hold, 1.5, 'timing.json records the hold');
  assert.equal(plain.scenes[0].hold, undefined, 'no hold, no field: the timing is as before');
  const ws = (t, id) => t.words.filter((w) => w.scene === id);
  assert.deepEqual(ws(held, 'a'), ws(plain, 'a'), 'the line itself keeps its word times');
  ws(held, 'b').forEach((w, i) => near(w.start, ws(plain, 'b')[i].start + 1.5, `b word ${i}`));
});

test('a hold comes after a sound clip that fixes its scene, and after a line that outlasts the clip', () => {
  const s = three(1);
  assert.equal(estimateTiming(s, CFG, 'en', null, { a: 3 }).scenes[0].end, 4, 'a 3 s clip plus a 1 s hold');
  const fixed = { a: 1.5 };
  const first = estimateTiming(s, CFG, 'en', null, fixed);
  const held = voiceHolds(first, fixed, s, { cfg: CFG });
  const lastWord = first.words.filter((w) => w.scene === 'a').at(-1).end;
  near(held.a, lastWord + CFG.tailOut, 'the scene grows to the line and its tail');
  near(estimateTiming(s, CFG, 'en', null, held).scenes[0].end, lastWord + CFG.tailOut + 1, 'then the hold comes on top');
});

test('a pause the person set is not flagged as a long tail', () => {
  const timing = (hold) => ({ duration: 8, scenes: [{ id: 'a', start: 0, end: 5, ...(hold ? { hold } : {}) }, { id: 'b', start: 5, end: 8 }],
    words: [{ w: 'One', start: 0.3, end: 1.5, scene: 'a' }, { w: 'two.', start: 1.6, end: 3, scene: 'a' }, { w: 'Next.', start: 5.3, end: 6, scene: 'b' }] });
  const script = { scenes: [{ id: 'a', kind: 'step' }, { id: 'b', kind: 'cta' }] };
  assert.ok(pacing(timing(0), script).scenes[0].flags.includes('slowTail'), 'a 2 s tail without a hold is long');
  assert.deepEqual(pacing(timing(1.5), script).scenes[0].flags, [], 'with a 1.5 s hold the tail left is 0.5 s');
  assert.equal(pacing(timing(1.5), script).scenes[0].tail, 2, 'the tail column still shows the real tail');
});

test('Timeline edits lock like Script tab edits and survive the next Director commit', () => {
  const scene = (id, kind, more = {}) => ({ id, kind, vo: `The ${id} line says Save now.`, title: `Title ${id}`, source: `bullets[0]`, ...more });
  const before = { scenes: [scene('a', 'title'), scene('b', 'shot', { shots: [{ asset: 'x.png' }] }), scene('c', 'cta')] };
  let after = editScript(before, { order: ['c', 'a', 'b'] });
  after = editScript(after, { hold: 'a', value: 1.26 });
  after = editScript(after, { sfx: 'b', value: 'hit' });
  after = editScript(after, { cue: 'b', shot: 0, value: 'Save' });
  const { doc: edited, changed } = humanEdit('script', before, after, 'anna', 'Timeline: test');
  assert.deepEqual(changed.sort(), ['scene:a.hold', 'scene:b.sfx', 'scene:b.shots', 'scenes']);
  // The Director rewrites every text, keeps its own order and drops the person's hold, sound and cue.
  const draft = { scenes: [scene('a', 'title', { title: 'New a' }), scene('b', 'shot', { title: 'New b', shots: [{ asset: 'x.png' }] }), scene('c', 'cta', { title: 'New c' })] };
  const { doc, kept } = mergeRespectingLocks('script', edited, draft);
  assert.deepEqual(doc.scenes.map((s) => s.id), ['c', 'a', 'b'], 'the scene order the person dragged');
  const by = Object.fromEntries(doc.scenes.map((s) => [s.id, s]));
  assert.equal(by.a.hold, 1.3, 'the hold, in 0.1 s steps');
  assert.equal(by.b.sfx, 'hit');
  assert.equal(by.b.shots[0].cue, 'Save');
  assert.equal(by.a.title, 'New a', 'fields the person did not touch stay the Director\'s');
  for (const k of ['scenes', 'scene:a.hold', 'scene:b.sfx', 'scene:b.shots']) assert.ok(kept.includes(k), k);
});

test('a hold set back to 0 is removed, and that removal is kept too', () => {
  const before = { scenes: [{ id: 'a', kind: 'step', vo: 'Hi.', hold: 2 }] };
  const after = editScript(before, { hold: 'a', value: 0 });
  assert.equal('hold' in after.scenes[0], false);
  const { doc: edited } = humanEdit('script', before, after, 'anna');
  const { doc } = mergeRespectingLocks('script', edited, { scenes: [{ id: 'a', kind: 'step', vo: 'Hi there.', hold: 3 }] });
  assert.equal('hold' in doc.scenes[0], false, 'the Director cannot put back a pause the person took out');
});

test('a cue the Timeline writes passes the ui-story cue rule; a word outside the line names the fix', () => {
  const { beats } = loadTemplate('ui-story');
  const cueErrs = (cue) => validateScript({ scenes: [{ id: 'app', kind: 'shot', vo: 'Click, then press Save.', title: 'Real screen', shots: [{ asset: 'a.png', cue }] }] }, beats, { assets: ['a.png'] })
    .errors.filter((e) => e.includes('cue'));
  assert.deepEqual(cueErrs('Click'), []);
  assert.deepEqual(cueErrs('Save'), []);
  assert.deepEqual(cueErrs('Cancel'), ['app.shots[0]: cue "Cancel" is not a word of the voice line']);
});
