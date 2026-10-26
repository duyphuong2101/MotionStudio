import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson } from '../engine/core.mjs';
import {
  validateBrief, saveBrief, setStatus, getStatus, jobFile, humanEdit, mergeRespectingLocks, editDirtyFrom, loadTemplate,
} from '../engine/jobs.mjs';
import { validateScript, DRAFT_NOTE_MAX } from '../engine/script.mjs';
import { commit, prepare, render } from '../engine/pipeline.mjs';
import { inDirectorQueue } from '../server/director.mjs';

const beats = loadTemplate('explainer').beats;
const PLACEHOLDER = '[Write what the voice says in this scene]';
const base = () => ({ scenes: [
  { id: 'intro', kind: 'title', vo: 'How it works.', title: 'How it works' },
  { id: 's1', kind: 'step', vo: 'First you ask.', title: 'Ask', icon: 'chat', source: 'bullets[0]' },
] });
const draftScene = (more = {}) => ({ id: 'step-1', kind: 'step', vo: PLACEHOLDER, title: 'First step', icon: 'chat', source: 'bullets[1]', draft: { note: 'show the approval queue' }, ...more });
const withDraft = () => { const s = base(); s.scenes.push(draftScene()); return s; };

test('a script with a draft scene is valid to save and the draft key is not "ignored"', () => {
  const { errors, warnings } = validateScript(withDraft(), beats);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'no "ignored" warning and no placeholder warning on a draft scene');
});

test('a draft scene needs a note within the limit', () => {
  const empty = base(); empty.scenes.push(draftScene({ draft: { note: '  ' } }));
  assert.ok(validateScript(empty, beats).errors.some((e) => e.includes('step-1: a draft scene needs a note')));
  const long = base(); long.scenes.push(draftScene({ draft: { note: 'x'.repeat(DRAFT_NOTE_MAX + 1) } }));
  assert.ok(validateScript(long, beats).errors.some((e) => e.includes(`limit ${DRAFT_NOTE_MAX}`)));
});

test('a placeholder voice line outside a draft is a warning, not an error', () => {
  const s = base(); s.scenes[1].vo = PLACEHOLDER;
  const { errors, warnings } = validateScript(s, beats);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.startsWith('s1: the voice line is still a placeholder')));
});

test('saving drafts sends the job back to step 4, so the Director queue picks it up', () => {
  assert.equal(editDirtyFrom('script', withDraft()), 4);
  assert.equal(editDirtyFrom('script', base()), 5);
  assert.equal(editDirtyFrom('source', base()), 4);
  assert.ok(inDirectorQueue({ status: 'dirty', dirty_from: editDirtyFrom('script', withDraft()) }));
  assert.ok(!inDirectorQueue({ status: 'dirty', dirty_from: editDirtyFrom('script', base()) }));
});

test('a new draft scene locks its kind, source and the order, never its content fields', () => {
  const before = { ...base(), locks: { 'scene:s1.title': { by: 'ana', at: 't0', note: '' } } };
  const { doc, changed } = humanEdit('script', before, withDraft(), 'ana');
  assert.ok(changed.includes('scenes'));
  for (const k of ['scenes', 'scene:step-1.kind', 'scene:step-1.source', 'scene:s1.title']) assert.ok(doc.locks[k], `${k} locked`);
  for (const f of ['vo', 'title', 'icon']) assert.ok(!doc.locks[`scene:step-1.${f}`], `${f} must stay open for the Director`);
  assert.equal(doc.locks['scene:s1.title'].at, 't0', "other scenes' locks unchanged");
  const d = doc.scenes.find((s) => s.id === 'step-1').draft;
  assert.equal(d.note, 'show the approval queue');
  assert.equal(d.by, 'ana');
  assert.ok(d.at);
});

test('turning a locked scene into a draft frees its content fields but keeps its source', () => {
  const lock = { by: 'ana', at: 't0', note: '' };
  const before = { ...base(), locks: { 'scene:s1.title': lock, 'scene:s1.vo': lock } };
  const after = base();
  after.scenes[1].draft = { note: 'show the inbox instead' };
  const { doc, changed } = humanEdit('script', before, after, 'ben');
  assert.ok(changed.includes('scene:s1.draft'), 'a draft alone is a change worth saving');
  assert.ok(!doc.locks['scene:s1.title'] && !doc.locks['scene:s1.vo']);
  assert.ok(doc.locks['scene:s1.source'] && doc.locks['scene:s1.kind']);
  assert.ok(!Object.keys(doc.locks).some((k) => k.endsWith('.draft')), 'the draft note is never a lock');
});

test('a director commit fills the draft but keeps the kind, source and order the person chose', () => {
  const before = { ...base(), locks: { 'scene:s1.title': { by: 'ana', at: 't0', note: '' } } };
  const { doc: existing } = humanEdit('script', before, withDraft(), 'ana');
  const filled = { scenes: [
    { id: 'step-1', kind: 'diagram', vo: 'Then it goes to review.', title: 'Review', nodes: ['A', 'B'], source: 'bullets[3]' },
    { id: 'intro', kind: 'title', vo: 'Hi.', title: 'New title' },
    { id: 's1', kind: 'step', vo: 'Ask.', title: 'Changed', icon: 'chat', source: 'bullets[0]' },
  ] };
  const { doc } = mergeRespectingLocks('script', existing, filled);
  assert.deepEqual(doc.scenes.map((s) => s.id), ['intro', 's1', 'step-1']);
  const d = doc.scenes[2];
  assert.equal(d.kind, 'step');
  assert.equal(d.source, 'bullets[1]');
  assert.equal(d.title, 'Review');
  assert.equal(d.draft, undefined);
  assert.equal(doc.scenes[1].title, 'Ask', 'a locked field of another scene survives');
});

const P = 'zz-test-drafts';
const ID = 'drafts-16x9';
function seedJob(t, status, script) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  writeJson(jobFile(P, ID, 'script.json'), script);
  setStatus(P, ID, status, 'test');
}

test('prepare and render refuse a script that still has draft scenes', async (t) => {
  seedJob(t, { status: 'dirty', dirty_from: 4 }, withDraft());
  await assert.rejects(prepare(P, ID), (e) => e.code === 409 && /1 draft scene\(s\) waiting — click Run Director/.test(e.message));
  setStatus(P, ID, { status: 'approved' }, 'test');
  await assert.rejects(render(P, ID), /draft scene\(s\) waiting/);
});

test('a director commit rejects a leftover draft and accepts the filled scene', (t) => {
  const { doc } = humanEdit('script', base(), withDraft(), 'ana');
  seedJob(t, { status: 'scripting' }, doc);
  writeJson(jobFile(P, ID, 'script.draft.json'), withDraft());
  assert.throws(() => commit(P, ID, 'script', 'director'), /Draft scene\(s\) not filled: step-1/);
  const filled = base();
  filled.scenes.push({ id: 'step-1', kind: 'step', vo: 'Then you approve.', title: 'Approve', icon: 'bolt', source: 'bullets[1]' });
  writeJson(jobFile(P, ID, 'script.draft.json'), filled);
  commit(P, ID, 'script', 'director');
  assert.equal(readJson(jobFile(P, ID, 'script.json')).scenes[2].draft, undefined);
  assert.equal(getStatus(P, ID).status, 'scripted');
});
