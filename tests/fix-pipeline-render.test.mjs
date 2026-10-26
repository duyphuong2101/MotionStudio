import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, getStatus, jobFile } from '../engine/jobs.mjs';
import { assertCommittable, canRender, claim, commit, render } from '../engine/pipeline.mjs';

const P = 'zz-test-fix-render';
const ID = 'retry-16x9';
function seed(t, status) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Retry' });
  saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  writeJson(jobFile(P, ID, 'script.json'), { scenes: [] });
  setStatus(P, ID, status, 'test');
}

test('canRender: approved or done, or a failed render that still carries its approval', () => {
  assert.ok(canRender({ status: 'approved' }));
  assert.ok(canRender({ status: 'done' }));
  assert.ok(canRender({ status: 'error', failed: 'render', approvedBy: 'ana' }));
  assert.ok(!canRender({ status: 'error', failed: 'render', approvedBy: null }), 'a new prepare dropped the approval');
  assert.ok(!canRender({ status: 'error', approvedBy: 'ana' }), 'a prepare error needs a new storyboard');
  assert.ok(!canRender({ status: 'awaiting_review', failed: 'render', approvedBy: 'ana' }));
});

test('a failed render records failed: render and keeps the approval; a claim clears it', async (t) => {
  seed(t, { status: 'approved', approvedBy: 'ana', duration: 4 });
  // No index.html: the render fails before any browser starts.
  await assert.rejects(render(P, ID, 'ana'));
  const st = getStatus(P, ID);
  assert.equal(st.status, 'error');
  assert.equal(st.failed, 'render');
  assert.equal(st.approvedBy, 'ana');
  assert.equal(claim(P, ID, 'director').failed, null, 'a non-error state clears failed');
});

test('a render retry from error needs failed: render and the storyboard files', async (t) => {
  seed(t, { status: 'error', error: 'lint failed', approvedBy: null });
  await assert.rejects(render(P, ID), (e) => e.code === 409 && /Cannot render while the job is "error"/.test(e.message));
  setStatus(P, ID, { failed: 'render', approvedBy: 'ana' }, 'test');
  await assert.rejects(render(P, ID), (e) => e.code === 409 && /storyboard files are gone: run prepare again/.test(e.message));
  assert.equal(getStatus(P, ID).status, 'error', 'a refused retry leaves the status alone');
});

const T0 = Date.parse('2026-10-23T10:00:00.000Z');
const ok = { kind: 'script', draft: { scenes: [] }, draftMs: T0 + 1000, template: 'explainer' };

test('a commit is refused while the job is preparing or rendering', () => {
  for (const status of ['preparing', 'rendering']) {
    assert.throws(() => assertCommittable({ status }, ok), (e) => e.code === 409 && /Wait for it to finish/.test(e.message));
  }
});

test('a commit is refused on an approved or rendered job and after a failed render', () => {
  for (const status of ['approved', 'done']) {
    assert.throws(() => assertCommittable({ status }, ok), (e) => e.code === 409 && /drop the approval/.test(e.message));
  }
  assert.throws(() => assertCommittable({ status: 'error', failed: 'render', approvedBy: 'ana' }, ok), /retry the render/);
});

test('after a storyboard only a draft written since is committed', () => {
  for (const status of ['awaiting_review', 'error']) {
    assert.doesNotThrow(() => assertCommittable({ status }, { ...ok, storyboardMs: T0 }), `${status}: a fresh fix round`);
    assert.throws(() => assertCommittable({ status }, { ...ok, draftMs: T0 - 1, storyboardMs: T0 }), /older than the current storyboard/);
  }
  assert.doesNotThrow(() => assertCommittable({ status: 'scripting' }, { ...ok, draftMs: T0 - 1, storyboardMs: T0 }), 'drafts written before a source commit still commit');
});

test('a draft finished before the run ended in error still commits when there is no storyboard', () => {
  // The status was written after the draft (a timeout), but no storyboard exists to be replaced.
  assert.doesNotThrow(() => assertCommittable({ status: 'error', updatedAt: new Date(T0 + 60000).toISOString() }, { ...ok, storyboardMs: null }));
});

test('a script draft for another template is refused; one without a template is checked by validation as before', () => {
  assert.throws(() => assertCommittable({ status: 'scripting' }, { ...ok, draft: { template: 'data-story', scenes: [] } }), (e) => e.code === 409 && /template "data-story"/.test(e.message));
  assert.doesNotThrow(() => assertCommittable({ status: 'scripting' }, { ...ok, draft: { template: 'explainer', scenes: [] } }));
  assert.doesNotThrow(() => assertCommittable({ status: 'scripting' }, { ...ok, kind: 'source', draft: { template: 'other' } }));
});

test('commit refuses a stale draft left over from before the storyboard', (t) => {
  seed(t, { status: 'awaiting_review', approvedBy: null });
  fs.writeFileSync(jobFile(P, ID, 'index.html'), '<!doctype html>', 'utf8');
  const file = jobFile(P, ID, 'script.draft.json');
  writeJson(file, { scenes: [] });
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(file, old, old);
  assert.throws(() => commit(P, ID, 'script', 'claude-seat'), (e) => e.code === 409 && /older than the current storyboard/.test(e.message));
  assert.ok(fs.existsSync(file), 'the refused draft stays for the person to inspect');
  assert.equal(getStatus(P, ID).status, 'awaiting_review');
});
