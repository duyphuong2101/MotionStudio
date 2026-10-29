import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson, readJson } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, getStatus } from '../engine/jobs.mjs';
import { recoverInflight, resetUnfinished, trackChild, untrackChild, probeProcesses, ownsProcess, exeName } from '../server/director.mjs';

const P = 'zz-test-director-recovery';
const JOBS = ['a', 'b', 'c', 'd', 'e'];
const T = Date.UTC(2026, 9, 23, 9, 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-recovery-'));
const wipe = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(() => { wipe(); fs.rmSync(tmp, { recursive: true, force: true }); });
wipe();
createProject({ id: P, name: 'Recovery' });
JOBS.forEach((id) => saveBrief(validateBrief({ id, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' })));

let n = 0;
const dirFor = () => fs.mkdtempSync(path.join(tmp, `d${n++}-`));
const set = (statuses) => Object.entries(statuses).forEach(([id, status]) => setStatus(P, id, { status }, 'test', 'test'));
const statuses = () => Object.fromEntries(JOBS.map((id) => [id, getStatus(P, id).status]));
const rec = (over) => ({ kind: 'job', action: 'prepare', project: P, pid: 0, exe: 'node', startedAt: T, ...over });

test('a run that ended early puts its scripting and preparing jobs into error, and leaves the rest', () => {
  set({ a: 'scripting', b: 'preparing', c: 'awaiting_review' });
  resetUnfinished(P, ['a', 'b', 'c'], { status: 'cancelled', message: 'Cancelled in the UI' });
  assert.deepEqual([getStatus(P, 'a').status, getStatus(P, 'b').status, getStatus(P, 'c').status], ['error', 'error', 'awaiting_review']);
  assert.equal(getStatus(P, 'a').error, 'Director run cancelled: Cancelled in the UI');
  assert.match(getStatus(P, 'b').error, /^Director run cancelled during prepare: Cancelled in the UI\. The prepare was stopped\. Click Run Director again\.$/);
  set({ a: 'preparing', b: 'scripting', c: 'awaiting_review' });
  resetUnfinished(P, ['a', 'b', 'c'], { status: 'done', message: 'Finished' });
  assert.equal(getStatus(P, 'a').status, 'preparing', 'a finished run leaves a prepare to its own status');
  assert.equal(getStatus(P, 'c').status, 'awaiting_review');
  assert.equal(getStatus(P, 'b').status, 'error', 'a job it claimed but never scripted is not left busy');
  assert.match(getStatus(P, 'b').error, /finished without writing a script/);
});

test('on start, children of a stopped server are killed only when the pid is still theirs, and their jobs leave the busy state', () => {
  const dir = dirFor();
  set({ a: 'preparing', b: 'rendering', c: 'scripting', d: 'awaiting_review', e: 'preparing' });
  writeJson(path.join(dir, '111.json'), { server: { pid: 111, startedAt: T, exe: 'node' }, children: {
    [`${P}/a`]: rec({ id: 'a', pid: 201 }),
    [`${P}/b`]: rec({ id: 'b', action: 'render', pid: 202 }),
    director: rec({ kind: 'director', action: 'director', jobs: ['c', 'd'], pid: 203, exe: 'claude' }),
    [`${P}/~shots:x.mp4`]: rec({ kind: 'asset', action: 'shots', asset: 'x.mp4', pid: 204 }),
  } });
  // Another server that still runs (the person's, or a test's on another port): its file is not touched.
  writeJson(path.join(dir, '222.json'), { server: { pid: 222, startedAt: T, exe: 'node' }, children: { [`${P}/e`]: rec({ id: 'e', pid: 205 }) } });
  const alive = new Map([
    [222, { name: 'node.exe', startedAt: T + 1000 }],
    [201, { name: 'node.exe', startedAt: T + 2000 }],
    [202, { name: 'chrome.exe', startedAt: T }], // the pid now runs another program
    [203, { name: 'claude.exe', startedAt: T + 10 * 60000 }], // the same program, started later: pid reuse
    [205, { name: 'node.exe', startedAt: T }],
  ]);
  const killed = [];
  const lines = recoverInflight({ dir, self: { pid: 999, startedAt: Date.now() }, probe: () => alive, kill: (pid) => killed.push(pid) });
  assert.deepEqual(killed, [201]);
  assert.deepEqual(statuses(), { a: 'error', b: 'error', c: 'error', d: 'awaiting_review', e: 'preparing' });
  assert.equal(getStatus(P, 'a').error, 'The UI server restarted while this job was preparing. Run it again.');
  assert.equal(getStatus(P, 'b').error, 'The UI server restarted while this job was rendering. Run it again.');
  assert.equal(getStatus(P, 'c').error, 'The UI server restarted during a Director run. Click Run Director again.');
  assert.equal(getStatus(P, 'a').history.at(-1).by, 'server');
  assert.deepEqual(lines, [`${P}/a (prepare, stopped)`, `${P}/b (render)`, 'director (director)', `${P}/~shots:x.mp4 (shots)`]);
  assert.deepEqual(fs.readdirSync(dir), ['222.json']);
});

test('a file under our own pid is an older server that is gone; a bad id in a record is reported, not used', () => {
  const dir = dirFor();
  set({ a: 'rendering' });
  writeJson(path.join(dir, '333.json'), { server: { pid: 333, startedAt: T, exe: 'node' }, children: {
    [`${P}/a`]: rec({ id: 'a', action: 'render', pid: 401 }),
    bad: rec({ id: '../x', pid: 402 }),
  } });
  const lines = recoverInflight({ dir, self: { pid: 333, startedAt: Date.now() }, probe: () => new Map([[333, { name: 'node', startedAt: T }]]), kill: () => assert.fail('nothing to kill') });
  assert.equal(getStatus(P, 'a').status, 'error');
  assert.match(lines[1], /^bad: could not reset \(/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(recoverInflight({ dir: path.join(dir, 'none'), probe: () => assert.fail('no probe without files') }), []);
});

test('trackChild and untrackChild keep one file per server and remove it when empty', () => {
  const dir = dirFor();
  const self = { pid: 444, startedAt: T };
  trackChild('k1', rec({ id: 'a', pid: 501 }), { dir, self });
  trackChild('k2', rec({ id: 'b', pid: 502 }), { dir, self });
  trackChild('k3', rec({ id: 'c', pid: undefined }), { dir, self });
  const doc = readJson(path.join(dir, '444.json'));
  assert.deepEqual([doc.server.pid, Object.keys(doc.children)], [444, ['k1', 'k2']]);
  untrackChild('k1', { dir, self });
  untrackChild('k2', { dir, self });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('ownsProcess matches the program name and a start time within a minute', () => {
  const r = rec({ pid: 1 });
  assert.ok(ownsProcess(r, { name: 'NODE.EXE', startedAt: T + 59000 }));
  assert.ok(!ownsProcess(r, { name: 'node.exe', startedAt: T + 61000 }));
  assert.ok(!ownsProcess(r, { name: 'claude.exe', startedAt: T }));
  assert.ok(!ownsProcess(r, undefined));
  assert.equal(exeName('C:\\Program Files\\nodejs\\node.exe'), 'node');
});

test('probeProcesses finds this test process with its name and start time', { timeout: 30000 }, () => {
  const info = probeProcesses([process.pid, 0, -1]).get(process.pid);
  assert.ok(info, 'this process is alive');
  assert.equal(exeName(info.name), exeName(process.execPath));
  assert.ok(Math.abs(info.startedAt - (Date.now() - process.uptime() * 1000)) < 60000);
});

test('on start, a process probe that failed leaves every in-flight record and job alone', () => {
  const dir = dirFor();
  set({ a: 'rendering' });
  writeJson(path.join(dir, '333.json'), { server: { pid: 333, startedAt: T, exe: 'node' }, children: { [`${P}/a`]: rec({ id: 'a', action: 'render', pid: 301 }) } });
  const killed = [];
  const lines = recoverInflight({ dir, self: { pid: 999, startedAt: Date.now() }, probe: () => null, kill: (pid) => killed.push(pid) });
  assert.deepEqual(killed, []);
  assert.equal(getStatus(P, 'a').status, 'rendering', 'a live server may still be rendering it');
  assert.ok(fs.existsSync(path.join(dir, '333.json')), 'the record stays for the next start');
  assert.match(lines.join(), /could not list running processes/);
});
