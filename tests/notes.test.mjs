import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS, writeJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, getStatus } from '../engine/jobs.mjs';
import { loadNotes, addNote, deleteNote, notesForDirector, MAX_NOTES, NOTE_CHARS, NOTES_FILE } from '../engine/notes.mjs';
import { directorContext } from '../engine/context.mjs';
import { reviewRoute } from '../server/review.mjs';

const P = 'zz-test-notes';
const timing = { duration: 12, scenes: [{ id: 'open', start: 0, end: 5 }, { id: 'stat', start: 5, end: 9 }, { id: 'close', start: 9, end: 12 }], words: [] };

function job(t, id) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  if (!fs.existsSync(path.join(DIRS.profiles, P))) createProject({ id: P, name: 'Notes Test' });
  saveBrief(validateBrief({ project: P, id, template: 'explainer', format: '16:9', duration: 30, message: 'm' }));
}

test('a note is pinned to a moment and its scene, kept in time order, and deleted by number', (t) => {
  job(t, 'pins');
  assert.throws(() => addNote(P, 'pins', { t: 2, text: 'too slow' }), /No storyboard yet/);
  writeJson(jobFile(P, 'pins', 'timing.json'), timing);
  const a = addNote(P, 'pins', { t: 6.256, text: '  The cut   here is too hard. ' }, 'phuong');
  assert.deepEqual([a.n, a.t, a.scene, a.text, a.by], [1, 6.26, 'stat', 'The cut here is too hard.', 'phuong']);
  addNote(P, 'pins', { t: 1, text: 'Start on the logo' });
  addNote(P, 'pins', { t: 12, text: 'Hold the end' });
  assert.deepEqual(loadNotes(P, 'pins').map((x) => [x.n, x.scene]), [[2, 'open'], [1, 'stat'], [3, 'close']], 'time order; the last frame is the last scene');
  assert.deepEqual(deleteNote(P, 'pins', 1).notes.map((x) => x.n), [2, 3]);
  assert.equal(addNote(P, 'pins', { t: 3, text: 'x' }).n, 4, 'numbers are never reused');
  assert.throws(() => deleteNote(P, 'pins', 1), /No note 1/);
});

test('a bad note is refused: empty, too long, outside the video, or one too many', (t) => {
  job(t, 'bad');
  writeJson(jobFile(P, 'bad', 'timing.json'), timing);
  assert.throws(() => addNote(P, 'bad', { t: 1, text: '   ' }), /Write the note first/);
  assert.throws(() => addNote(P, 'bad', { t: 1, text: 'x'.repeat(NOTE_CHARS + 1) }), new RegExp(`at most ${NOTE_CHARS}`));
  for (const tt of [-1, 12.5, 'abc', null]) assert.throws(() => addNote(P, 'bad', { t: tt, text: 'x' }), /t must be between 0 and 12/, String(tt));
  writeJson(jobFile(P, 'bad', NOTES_FILE), { notes: Array.from({ length: MAX_NOTES }, (_, i) => ({ n: i + 1, t: 1, scene: 'open', text: 'x' })) });
  assert.throws(() => addNote(P, 'bad', { t: 1, text: 'one more' }), /at most 40 notes/);
});

test('the Director gets the notes with their scene and a rule, never before its first run, and a layout rule always', (t) => {
  job(t, 'ctx');
  writeJson(jobFile(P, 'ctx', 'timing.json'), timing);
  assert.equal(getStatus(P, 'ctx').status, 'queued');
  addNote(P, 'ctx', { t: 7, text: 'Make the number bigger' });
  assert.deepEqual(notesForDirector(P, 'ctx'), [], 'a queued job has not been directed yet');
  setStatus(P, 'ctx', { status: 'dirty', dirty_from: 4, step: 4 }, 'test');
  const ctx = directorContext(P, 'ctx');
  assert.deepEqual(ctx.notes, [{ t: 7, scene: 'stat', text: 'Make the number bigger' }]);
  assert.match(ctx.notesRule, /never a source/);
  assert.match(ctx.layoutRule, /3 scenes in a row the same kind/);
  deleteNote(P, 'ctx', 1);
  assert.equal('notes' in directorContext(P, 'ctx'), false, 'no notes, no rule');
});

const PORT = 4803;
function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 10000,
      headers: { Host: `127.0.0.1:${PORT}`, ...(method !== 'GET' ? { 'X-Studio': '1' } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

test('notes routes add, list and delete; the review link reaches none of them', { timeout: 60000 }, async (t) => {
  job(t, 'routes');
  writeJson(jobFile(P, 'routes', 'timing.json'), timing);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 55000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 30000);
    const on = (d) => { out = (out + d).slice(-20000); if (out.includes('Motion Studio UI:')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
  const base = `/api/jobs/${P}/routes/notes`;
  assert.deepEqual((await call('GET', base)).json, { notes: [] });
  const made = await call('POST', base, { t: 9.5, text: 'Hold the logo longer' });
  assert.equal(made.status, 201);
  assert.equal(made.json.scene, 'close');
  assert.equal((await call('POST', base, { t: 99, text: 'x' })).status, 400);
  assert.deepEqual((await call('GET', base)).json.notes.map((x) => x.text), ['Hold the logo longer']);
  assert.equal((await call('DELETE', `${base}/abc`)).status, 400);
  assert.equal((await call('DELETE', `${base}/7`)).status, 404);
  assert.equal((await call('DELETE', `${base}/${made.json.n}`)).status, 200);
  assert.deepEqual((await call('GET', base)).json, { notes: [] });
  for (const [m, p] of [['GET', base], ['POST', base], ['DELETE', `${base}/1`]]) assert.equal(reviewRoute(m, p), null, `${m} ${p}`);
});
