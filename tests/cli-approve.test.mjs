import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, briefFile, setStatus, getStatus } from '../engine/jobs.mjs';
import { approve, canRender } from '../engine/pipeline.mjs';

const P = 'zz-test-cli-approve';
const ID = 'promo-9x16';

const cli = (...args) => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: String(e.stderr) };
  }
};

function seed(t) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'CLI approve' });
  writeJson(briefFile(P, ID), validateBrief({ id: ID, project: P, template: 'promo', format: '9:16', duration: 15, director: 'seat', message: 'm' }));
  setStatus(P, ID, { status: 'awaiting_review', step: 8, approvedBy: null }, 'storyboard ready for review', 'test');
}

test('the CLI cannot approve: it points to the UI and the job stays awaiting review', (t) => {
  seed(t);
  const { host, port } = loadStudioConfig().server;
  const r = cli('approve', P, ID, '--by', 'cursor-agent');
  assert.equal(r.code, 1);
  assert.ok(r.stderr.includes(`A person approves in the UI: open http://${host}:${port}`), r.stderr);
  const st = getStatus(P, ID);
  assert.deepEqual([st.status, st.step, st.approvedBy], ['awaiting_review', 8, null]);
  assert.ok(!canRender(st));
  assert.ok(!st.history.some((h) => h.event === 'storyboard approved'));
});

test('render from the CLI is refused until a person approved in the UI', (t) => {
  seed(t);
  const r = cli('render', P, ID);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Cannot render while the job is "awaiting_review"/);
  // The UI path (server → approve()) still works.
  assert.equal(approve(P, ID, 'person').status, 'approved');
});
