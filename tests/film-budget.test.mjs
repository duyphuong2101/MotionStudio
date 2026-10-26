import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, loadBrief, setStatus, getStatus, jobFile } from '../engine/jobs.mjs';
import {
  createSequence, updateSequence, loadSequence, getSequenceStatus, setSequenceStatus, sequenceBudget, sequencePlan, renderSequence,
} from '../engine/sequences.mjs';

/* ---------- fixtures: one rendered, one prepared and one unscripted part ---------- */
const P = 'zz-test-film';
const LAND = { width: 1920, height: 1080 };

function job(id, { template = 'explainer', duration = 30, status = 'queued', patch = {} } = {}) {
  saveBrief(validateBrief({ id, project: P, template, format: '16:9', duration, director: 'seat', message: 'm' }));
  if (status === 'queued') return;
  setStatus(P, id, { status, ...patch }, 'test');
  if (status === 'done') fs.writeFileSync(jobFile(P, id, 'final.mp4'), '');
}

function fixture(t) {
  t.after(() => ['briefs', 'out', 'sequences'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  job('open', { status: 'done', patch: { duration: 59, outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: 60 } } });
  job('middle', { status: 'awaiting_review', patch: { duration: 45.5 } });
  job('close', { duration: 30 });
}

const film = (over = {}) => ({ id: 'film', project: P, title: 'Film', format: '16:9', transition: 'cut', transitions: ['fade', 'cut'], parts: ['open', 'middle', 'close'], ...over });

/* ---------- target ---------- */
test('a target length is optional whole seconds, 10-1200', (t) => {
  fixture(t);
  for (const bad of [9, 1201, 12.5, '60', -1]) {
    assert.throws(() => createSequence(film({ targetDuration: bad })), /targetDuration must be whole seconds, 10-1200/, String(bad));
  }
  assert.equal(createSequence(film()).targetDuration, undefined, 'absent stays absent');
  assert.equal(updateSequence(P, 'film', { targetDuration: 200 }).sequence.targetDuration, 200);
  assert.equal(loadSequence(P, 'film').targetDuration, 200);
  assert.ok(!('targetDuration' in updateSequence(P, 'film', { targetDuration: null }).sequence), 'null clears it');
});

test('a target edit keeps the render, like a title edit', (t) => {
  fixture(t);
  job('second', { status: 'done', patch: { outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: 10 } } });
  createSequence(film({ parts: ['open', 'second'], transitions: [] }));
  setSequenceStatus(P, 'film', { status: 'done', outputs: { final: 'final.mp4' } }, 'test');
  fs.writeFileSync(jobFile(P, 'film', 'final.mp4'), '');
  assert.deepEqual(updateSequence(P, 'film', { targetDuration: 30 }).changed, ['targetDuration']);
  assert.equal(getSequenceStatus(P, 'film').status, 'done');
  assert.ok(fs.existsSync(jobFile(P, 'film', 'final.mp4')));
});

/* ---------- draft sequences ---------- */
test('a draft sequence takes unrendered parts but refuses to render, naming them', async (t) => {
  fixture(t);
  const made = createSequence(film());
  assert.deepEqual(made.parts, ['open', 'middle', 'close']);
  assert.deepEqual(updateSequence(P, 'film', { parts: ['close', 'open'] }).changed, ['parts', 'transitions']);
  await assert.rejects(renderSequence(P, 'film', 'test'), (e) => e.code === 409 && /Parts not ready: close: not rendered \(queued\)/.test(e.message));
  const st = getSequenceStatus(P, 'film');
  assert.equal(st.status, 'error');
  assert.match(st.error, /close: not rendered/);
  assert.throws(() => createSequence(film({ id: 'other', parts: ['open', 'nope'] })), (e) => e.code === 409 && /nope: no such job/.test(e.message));
});

/* ---------- budget ---------- */
test('the budget sums each part\'s current length minus the transition overlaps, as the join does', (t) => {
  fixture(t);
  const b = sequenceBudget(P, film({ targetDuration: 120 }));
  assert.deepEqual(b.parts.map((p) => [p.id, p.duration, p.from, p.estimate, p.start, p.ready]), [
    ['open', 60, 'render', false, 0, true],
    ['middle', 45.5, 'storyboard', false, 59.6, false],
    ['close', 30, 'brief', true, 105.1, false],
  ]);
  assert.equal(b.overlap, 0.4);
  assert.equal(b.total, 135.1);
  assert.equal(b.target, 120);
  assert.equal(b.delta, 15.1, 'over the target');
  assert.equal(b.estimate, true);
  assert.deepEqual(b.notReady, ['middle', 'close']);
  assert.equal(b.parts[1].reason, 'not rendered (awaiting_review)');
  assert.equal(b.parts[2].planned, 30);

  const plan = sequencePlan({
    parts: b.parts.map((p) => ({ id: p.id, file: `${p.id}.mp4`, duration: p.duration, hasAudio: true })),
    transition: 'cut', transitions: ['fade', 'cut'], fps: 30, crf: 18, size: LAND, out: 'x.mp4',
  });
  assert.equal(plan.duration, b.total, 'same total as the join');
  assert.deepEqual(plan.starts, b.parts.map((p) => p.start));

  const cut = sequenceBudget(P, film({ transitions: ['cut', 'cut'], targetDuration: 200 }));
  assert.equal(cut.total, 135.5);
  assert.equal(cut.delta, -64.5, 'under the target');
  assert.equal(sequenceBudget(P, film()).delta, null, 'no target, no delta');
});

test('a part whose script is being rewritten counts its brief duration; a missing job counts nothing', (t) => {
  fixture(t);
  setStatus(P, 'middle', { status: 'dirty', dirty_from: 3 }, 'test');
  const b = sequenceBudget(P, film({ parts: ['open', 'middle', 'gone'] }));
  assert.deepEqual(b.parts.map((p) => [p.id, p.duration, p.from]), [['open', 60, 'render'], ['middle', 30, 'brief'], ['gone', 0, 'missing']]);
  assert.equal(b.parts[2].problem, 'missing');
  assert.equal(b.total, 89.6);
  // A prepare-only change (dirty from 5) keeps the storyboard length.
  setStatus(P, 'middle', { status: 'dirty', dirty_from: 5 }, 'test');
  assert.equal(sequenceBudget(P, film()).parts[1].from, 'storyboard');
});

/* ---------- template change after a script exists ---------- */
function scripted(t) {
  fixture(t);
  writeJson(jobFile(P, 'middle', 'source.json'), { name: 'Kept', bullets: [], locks: { name: { by: 'anna' } } });
  writeJson(jobFile(P, 'middle', 'script.json'), { scenes: [{ id: 'hero', title: 'Mine' }], locks: { 'scene:hero.title': { by: 'anna' } } });
  writeJson(jobFile(P, 'middle', 'script.prev.json'), { scenes: [], note: 'older' });
  return { ...loadBrief(P, 'middle') };
}

test('a template change moves the script to script.prev.json and sends the job back from step 3', (t) => {
  const brief = scripted(t);
  const res = updateBrief(P, 'middle', { ...brief, template: 'event' }, { by: 'bob' });
  assert.deepEqual(res.changed, ['template']);
  assert.equal(res.newScript, true);
  assert.equal(res.requeued, true);
  assert.equal(loadBrief(P, 'middle').template, 'event');
  assert.ok(!fs.existsSync(jobFile(P, 'middle', 'script.json')), 'no script, so no old locks reach the new one');
  assert.deepEqual(readJson(jobFile(P, 'middle', 'script.prev.json')).locks, { 'scene:hero.title': { by: 'anna' } }, 'the older prev is overwritten');
  assert.equal(readJson(jobFile(P, 'middle', 'source.json')).name, 'Kept', 'source stays');
  const st = getStatus(P, 'middle');
  assert.equal(st.status, 'dirty');
  assert.equal(st.dirty_from, 3);
  assert.equal(st.history.at(-1).by, 'bob');
  assert.match(st.history.at(-1).event, /template; script moved to script\.prev\.json/);
});

test('a sequence shows a re-templated part as not ready until it is rendered again', (t) => {
  const brief = scripted(t);
  setStatus(P, 'middle', { status: 'done', outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: 44 } }, 'test');
  fs.writeFileSync(jobFile(P, 'middle', 'final.mp4'), '');
  assert.equal(sequenceBudget(P, film()).parts[1].ready, true);
  updateBrief(P, 'middle', { ...brief, template: 'event' });
  const p = sequenceBudget(P, film()).parts[1];
  assert.deepEqual([p.ready, p.reason, p.from], [false, 'not rendered (dirty)', 'brief']);
});

test('a template change with a new message redoes the source; an earlier brief edit keeps its step', (t) => {
  const brief = scripted(t);
  updateBrief(P, 'middle', { ...brief, template: 'event', message: 'New' });
  assert.equal(getStatus(P, 'middle').dirty_from, 1);
  // Still dirty from 1 (the Director has not run): switching back keeps step 1.
  writeJson(jobFile(P, 'middle', 'script.json'), { scenes: [] });
  const res = updateBrief(P, 'middle', { ...brief, message: 'New' });
  assert.deepEqual([res.changed, res.newScript], [['template'], true]);
  assert.equal(getStatus(P, 'middle').dirty_from, 1);
});

test('a template change is refused while the job is busy, and the script stays', (t) => {
  const brief = scripted(t);
  for (const status of ['scripting', 'preparing', 'rendering']) {
    setStatus(P, 'middle', { status }, 'test');
    assert.throws(() => updateBrief(P, 'middle', { ...brief, template: 'event' }), (e) => e.code === 409 && e.message.includes(status));
  }
  assert.equal(loadBrief(P, 'middle').template, 'explainer');
  assert.ok(fs.existsSync(jobFile(P, 'middle', 'script.json')));
});
