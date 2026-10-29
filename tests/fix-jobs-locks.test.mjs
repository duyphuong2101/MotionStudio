import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson } from '../engine/core.mjs';
import {
  validateBrief, saveBrief, updateBrief, loadBrief, setStatus, getStatus, jobFile, humanEdit, mergeRespectingLocks, commitBase,
} from '../engine/jobs.mjs';

/* ---------- a cleared and locked source field stays cleared ---------- */
const source = () => ({ name: 'CSR Console', image: 'hero.png', bullets: [{ text: 'Replies in under a minute', ref: 'p1' }] });

test('a source field the person cleared and locked stays absent after a director commit', () => {
  const { image, ...cleared } = source();
  const { doc: existing, changed } = humanEdit('source', source(), cleared, 'ana');
  assert.deepEqual(changed, ['image']);
  const { doc, kept } = mergeRespectingLocks('source', existing, { ...source(), image: 'other.png' });
  assert.ok(!('image' in doc), 'the Director\'s image does not come back');
  assert.deepEqual(kept, ['image']);
  assert.equal(doc.name, 'CSR Console', 'unlocked fields are the Director\'s');
});

test('a bullet screenshot lock is not treated as a cleared field', () => {
  const before = source();
  const after = { ...before, bullets: [{ ...before.bullets[0], asset: 'inbox.png' }] };
  const { doc: existing } = humanEdit('source', before, after, 'ana');
  const { doc, kept } = mergeRespectingLocks('source', existing, { ...source(), image: 'new.png' });
  assert.deepEqual(kept, ['bullets.asset']);
  assert.equal(doc.image, 'new.png');
  assert.equal(doc.bullets[0].asset, 'inbox.png');
});

/* ---------- locks carried across a template or mix change ---------- */
const P = 'zz-fix-jobs-locks';
const ID = 'carry-16x9';
const stamp = { by: 'anna', at: '2026-10-20T10:00:00.000Z', note: '' };

function scripted(t) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const brief = validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' });
  saveBrief(brief);
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Kept', bullets: [{ text: 'b', ref: 'r' }] });
  writeJson(jobFile(P, ID, 'script.json'), {
    scenes: [
      { id: 'hero', kind: 'title', vo: 'Mine to say.', title: 'My title' },
      { id: 's1', kind: 'step', vo: 'Step one.', title: 'One', icon: 'truck', source: 'bullets[0]' },
      { id: 'later', kind: 'step', vo: '[placeholder]', title: 'x', icon: 'truck', source: 'bullets[0]', draft: { note: 'fill me', by: 'anna', at: stamp.at } },
      { id: 'end', kind: 'cta', vo: 'Go now.', title: 'Try it', button: 'Start free' },
    ],
    locks: {
      scenes: stamp, 'scene:hero.kind': stamp, 'scene:hero.title': stamp, 'scene:hero.vo': stamp,
      'scene:s1.text': stamp, 'scene:later.source': stamp, 'scene:end.button': stamp,
    },
  });
  setStatus(P, ID, { status: 'awaiting_review', step: 8 }, 'test');
  return brief;
}

test('a mix change carries the field locks of scenes whose kind keeps the same rules', (t) => {
  const brief = scripted(t);
  const res = updateBrief(P, ID, { ...brief, mix: ['data-story'] }, { by: 'bob' });
  assert.equal(res.newScript, true);
  assert.ok(!fs.existsSync(jobFile(P, ID, 'script.json')));
  const carry = readJson(jobFile(P, ID, 'script.locks.json'));
  assert.deepEqual(Object.keys(carry.locks).sort(), ['scene:end.button', 'scene:hero.title', 'scene:hero.vo', 'scene:s1.text'],
    'order, kind and draft-scene locks belong to the old script and never carry');
  assert.deepEqual(carry.scenes.find((s) => s.id === 'hero'), { id: 'hero', kind: 'title', vo: 'Mine to say.', title: 'My title' });
  assert.deepEqual(carry.scenes.find((s) => s.id === 's1'), { id: 's1', kind: 'step' }, 'a locked field the person cleared carries as absent');
  assert.match(getStatus(P, ID).history.at(-1).event, /script moved to script\.prev\.json; locks carried: .*scene:hero\.title/);
  assert.equal(getStatus(P, ID).dirty_from, 3);
});

test('the next director commit honours carried locks only on scenes of the same id and kind', (t) => {
  const brief = scripted(t);
  updateBrief(P, ID, { ...brief, mix: ['data-story'] });
  const base = commitBase(P, ID, 'script');
  assert.equal(base.carried, true, 'no script.json yet: the commit merges into the carried locks');
  assert.equal(commitBase(P, ID, 'source').name, 'Kept', 'a source commit still merges into source.json');
  const draft = { scenes: [
    { id: 'hero', kind: 'title', vo: 'New voice.', title: 'New title' },
    { id: 's1', kind: 'diagram', vo: 'Now a diagram.', title: 'Flow', nodes: ['a', 'b'], text: 'Director text', source: 'bullets[0]' },
    { id: 'end', kind: 'cta', vo: 'Go.', title: 'Try', button: 'Buy' },
  ] };
  const { doc, kept } = mergeRespectingLocks('script', base, draft);
  assert.deepEqual(doc.scenes[0], { id: 'hero', kind: 'title', vo: 'Mine to say.', title: 'My title' });
  assert.equal(doc.scenes[1].text, 'Director text', 's1 changed kind, so its carried lock does not apply');
  assert.equal(doc.scenes[2].button, 'Start free');
  assert.deepEqual(kept.sort(), ['scene:end.button', 'scene:hero.title', 'scene:hero.vo']);
  assert.deepEqual(Object.keys(doc.locks).sort(), kept, 'an unused carried lock lapses');
  assert.ok(!('carried' in doc));
});

test('once script.json exists the carried locks are not read again', (t) => {
  const brief = scripted(t);
  updateBrief(P, ID, { ...brief, mix: ['data-story'] });
  writeJson(jobFile(P, ID, 'script.json'), { scenes: [], locks: {} });
  assert.deepEqual(commitBase(P, ID, 'script'), { scenes: [], locks: {} });
});

test('a template change carries nothing when no kind keeps its rules, and removes an older carry', (t) => {
  const brief = scripted(t);
  writeJson(jobFile(P, ID, 'script.locks.json'), { carried: true, scenes: [], locks: { 'scene:x.title': stamp } });
  updateBrief(P, ID, { ...brief, template: 'event' });
  assert.ok(!fs.existsSync(jobFile(P, ID, 'script.locks.json')), 'event\'s cta takes other fields than explainer\'s');
  assert.equal(commitBase(P, ID, 'script'), null);
  assert.doesNotMatch(getStatus(P, ID).history.at(-1).event, /locks carried/);
  assert.equal(loadBrief(P, ID).template, 'event');
});

test('a second template change before the Director writes the script rechecks the carried locks and stays at step 3', (t) => {
  const brief = scripted(t);
  updateBrief(P, ID, { ...brief, mix: ['data-story'] });
  assert.ok(fs.existsSync(jobFile(P, ID, 'script.locks.json')));
  // explainer + data-story → event: no kind keeps its rules, so nothing may stay pinned.
  updateBrief(P, ID, { ...loadBrief(P, ID), mix: [], template: 'event' });
  assert.ok(!fs.existsSync(jobFile(P, ID, 'script.locks.json')), 'the carry is rechecked against event, not left as checked for the mix');
  assert.equal(getStatus(P, ID).dirty_from, 3, 'source.json is kept, so the Director starts at the script again');
  assert.match(getStatus(P, ID).history.at(-1).event, /carried locks rechecked/);
});

/* ---------- a Director draft never loses or moves a person's scene edits ---------- */
const edited = () => ({
  scenes: [
    { id: 'open', kind: 'title', vo: 'Hi.', title: 'Hello' },
    { id: 'point-1', kind: 'step', vo: 'Point one.', title: 'One', source: 'bullets[0]' },
    { id: 'point-2', kind: 'step', vo: 'My own words for two.', title: 'Two', source: 'bullets[1]' },
  ],
  locks: { 'scene:point-2.vo': stamp },
});

test('a draft that drops a scene a person edited is refused, naming the scene', () => {
  const draft = { scenes: edited().scenes.filter((s) => s.id !== 'point-2') };
  assert.throws(() => mergeRespectingLocks('script', edited(), draft), (e) => e.code === 409 && /drops scene\(s\) a person edited: point-2 \(vo\)/.test(e.message));
  const kept = mergeRespectingLocks('script', { ...edited(), locks: { ...edited().locks, scenes: stamp } }, draft);
  assert.equal(kept.doc.scenes.find((s) => s.id === 'point-2').vo, 'My own words for two.', 'with the order locked the scene stays anyway');
});

test('a draft that gives an edited scene another claim is refused; the same claim merges as before', () => {
  const moved = { scenes: edited().scenes.map((s) => (s.id === 'point-2' ? { ...s, vo: 'Director words.', source: 'bullets[2]' } : s)) };
  assert.throws(() => mergeRespectingLocks('script', edited(), moved), /point-2: the edits were written for source "bullets\[1\]", the draft gives "bullets\[2\]"/);
  const same = { scenes: edited().scenes.map((s) => (s.id === 'point-2' ? { ...s, vo: 'Director words.' } : s)) };
  assert.equal(mergeRespectingLocks('script', edited(), same).doc.scenes[2].vo, 'My own words for two.');
});
