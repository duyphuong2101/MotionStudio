import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, setStatus, getStatus, jobFile, markDirty, STEPS } from '../engine/jobs.mjs';

const P = 'zz-fix-jobs-brief';
const ID = 'edit-16x9';

function job(t, { script = true, status = 'approved' } = {}) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const brief = validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' });
  saveBrief(brief);
  writeJson(jobFile(P, ID, 'source.json'), { name: 'n', bullets: [] });
  if (script) writeJson(jobFile(P, ID, 'script.json'), { scenes: [] });
  setStatus(P, ID, { status, step: 9 }, 'test');
  return brief;
}

/* ---------- which brief edits re-run what ---------- */
test('a platform change keeps the approval: QA reads the platform at render time', (t) => {
  const brief = job(t);
  const res = updateBrief(P, ID, { ...brief, platform: 'youtube' });
  assert.deepEqual(res.changed, ['platform']);
  assert.deepEqual([res.requeued, res.rePrepare], [false, false]);
  assert.equal(getStatus(P, ID).status, 'approved');
});

test('a director change keeps the job where it is: it only picks the backend of the next run', (t) => {
  const brief = job(t);
  const res = updateBrief(P, ID, { ...brief, director: 'claude' });
  assert.deepEqual(res.changed, ['director']);
  assert.equal(getStatus(P, ID).status, 'approved');
});

test('a format change rebuilds the storyboard from the same script', (t) => {
  const brief = job(t);
  const res = updateBrief(P, ID, { ...brief, format: '9:16', platform: 'tiktok' });
  assert.deepEqual(res.changed, ['format', 'platform']);
  assert.deepEqual([res.requeued, res.rePrepare], [false, true]);
  const st = getStatus(P, ID);
  assert.deepEqual([st.status, st.dirty_from, st.step], ['dirty', 5, 5]);
});

test('a format change before any script still goes to the Director', (t) => {
  const brief = job(t, { script: false, status: 'error' });
  const res = updateBrief(P, ID, { ...brief, format: '1:1' });
  assert.equal(res.requeued, true);
  assert.equal(getStatus(P, ID).dirty_from, 1);
});

test('content fields still send the job back to the Director', (t) => {
  const brief = job(t);
  for (const [k, v] of [['duration', 40], ['cta', 'Buy now'], ['lang', 'en-gb'], ['notes', 'shorter'], ['message', 'new']]) {
    setStatus(P, ID, { status: 'approved', dirty_from: null }, 'test');
    const res = updateBrief(P, ID, { ...brief, [k]: v });
    assert.deepEqual(res.changed, [k]);
    assert.equal(getStatus(P, ID).dirty_from, 1, k);
    updateBrief(P, ID, brief);
  }
});

/* ---------- setStatus and `failed` ---------- */
test('a status other than error clears failed unless the caller sets it', (t) => {
  job(t, { status: 'error' });
  setStatus(P, ID, { failed: 'render' }, 'test');
  assert.equal(setStatus(P, ID, { error: 'still' }, 'test').failed, 'render', 'a patch without a status keeps it');
  assert.equal(setStatus(P, ID, { status: 'error' }, 'test').failed, 'render', 'error keeps it');
  assert.equal(setStatus(P, ID, { status: 'dirty', failed: 'render' }, 'test').failed, 'render', 'an explicit value wins');
  assert.equal(setStatus(P, ID, { status: 'dirty' }, 'test').failed, null);
  assert.equal(getStatus(P, ID).failed, null);
});

/* ---------- reset-dirty ---------- */
test('markDirty sends a job back to a whole step 1-11 and records it', (t) => {
  job(t, { status: 'awaiting_review' });
  const st = markDirty(P, ID, '4', { by: 'ana' });
  assert.deepEqual([st.status, st.dirty_from, st.step], ['dirty', 4, 4]);
  assert.deepEqual([st.history.at(-1).event, st.history.at(-1).by], ['marked dirty from step 4', 'ana']);
});

test('markDirty refuses a missing, partial or out-of-range step', (t) => {
  job(t, { status: 'awaiting_review' });
  for (const bad of [undefined, '', 'x', '0', '2.5', String(STEPS.length + 1), '-1']) {
    assert.throws(() => markDirty(P, ID, bad), (e) => e.code === 400 && /whole number 1-11/.test(e.message), String(bad));
  }
  assert.equal(getStatus(P, ID).status, 'awaiting_review', 'nothing written');
});

test('markDirty refuses a busy job unless forced, and an unknown job', (t) => {
  job(t, { status: 'rendering' });
  assert.throws(() => markDirty(P, ID, 5), (e) => e.code === 409 && /Job is rendering.*--force/.test(e.message));
  assert.equal(getStatus(P, ID).status, 'rendering');
  const st = markDirty(P, ID, 5, { force: true });
  assert.equal(st.status, 'dirty');
  assert.match(st.history.at(-1).event, /forced while rendering/);
  assert.throws(() => markDirty(P, 'nope', 5), (e) => e.code === 404);
  assert.ok(!fs.existsSync(path.join(DIRS.out, P, 'nope')), 'no status file for an unknown job');
});

test('the CLI lists reset-dirty and fails without a step', (t) => {
  job(t, { status: 'awaiting_review' });
  const cli = path.join(ROOT, 'engine', 'cli.mjs');
  const opts = { cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true, shell: false };
  assert.match(execFileSync(process.execPath, [cli, 'help'], opts), /reset-dirty <project> <job> <step> \[--force\]/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'reset-dirty', P, ID], { ...opts, stdio: 'pipe' }), (e) => /whole number 1-11/.test(e.stderr));
  assert.equal(getStatus(P, ID).status, 'awaiting_review');
  assert.match(execFileSync(process.execPath, [cli, 'reset-dirty', P, ID, '5', '--by', 'cli-test'], opts), /dirty from step 5/);
});
