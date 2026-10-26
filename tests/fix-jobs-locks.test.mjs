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
