import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile } from '../engine/jobs.mjs';
import { createSequence, setSequenceStatus, getSequenceStatus, sequenceBudget, sequenceStatusView, listSequences } from '../engine/sequences.mjs';

const P = 'zz-fix-jobs-seq';
const LAND = { width: 1920, height: 1080 };

function done(id, seconds) {
  saveBrief(validateBrief({ id, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  setStatus(P, id, { status: 'done', outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: seconds } }, 'test');
  fs.writeFileSync(jobFile(P, id, 'final.mp4'), '');
}

function fixture(t) {
  t.after(() => ['briefs', 'out', 'sequences'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  done('open', 60);
  done('close', 30);
}

const film = (over = {}) => ({ id: 'film', project: P, title: 'Film', format: '16:9', transition: 'fade', parts: ['open', 'close'], ...over });

/* ---------- budget around a missing part ---------- */
test('a missing first part does not pull the next part before zero', (t) => {
  fixture(t);
  const b = sequenceBudget(P, film({ parts: ['gone', 'open'] }));
  assert.deepEqual(b.parts.map((p) => [p.id, p.start, p.duration]), [['gone', 0, 0], ['open', 0, 60]]);
  assert.equal(b.total, 60);
  assert.equal(b.overlap, 0, 'no transition overlaps a part that is not there');
});

test('a missing middle part overlaps neither neighbour', (t) => {
  fixture(t);
  const b = sequenceBudget(P, film({ parts: ['open', 'gone', 'close'] }));
  assert.deepEqual(b.parts.map((p) => p.start), [0, 60, 60]);
  assert.equal(b.total, 90);
  assert.equal(b.overlap, 0);
  assert.equal(sequenceBudget(P, film()).overlap, 0.4, 'two present parts still overlap by the fade');
  assert.equal(sequenceBudget(P, film()).total, 89.6);
});

/* ---------- stale on read ---------- */
function rendered(t) {
  fixture(t);
  createSequence(film());
  setSequenceStatus(P, 'film', { status: 'done', outputs: { final: 'final.mp4' } }, 'test');
  const final = jobFile(P, 'film', 'final.mp4');
  fs.writeFileSync(final, '');
  const past = new Date(Date.now() - 60000);
  for (const id of ['open', 'close']) fs.utimesSync(jobFile(P, id, 'final.mp4'), past, past);
  return final;
}

test('a done sequence whose parts are unchanged is not stale', (t) => {
  rendered(t);
  const st = sequenceStatusView(P, 'film');
  assert.deepEqual([st.status, st.stale, st.staleReason], ['done', false, '']);
  assert.equal(listSequences(P)[0].status.stale, false);
  assert.ok(!('stale' in getSequenceStatus(P, 'film')), 'nothing is written to status.json');
});

test('a part rendered after the sequence makes it stale, named in the reason', (t) => {
  rendered(t);
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(jobFile(P, 'close', 'final.mp4'), future, future);
  const st = listSequences(P)[0].status;
  assert.equal(st.status, 'done', 'the status value stays');
  assert.equal(st.stale, true);
  assert.equal(st.staleReason, 'close was rendered again. Render the sequence again.');
});

test('a part that is no longer done, or a missing final.mp4, makes it stale', (t) => {
  const final = rendered(t);
  setStatus(P, 'open', { status: 'dirty', dirty_from: 1 }, 'test');
  assert.equal(sequenceStatusView(P, 'film').staleReason, 'open is dirty. Render the sequence again.');
  fs.rmSync(final);
  assert.equal(sequenceStatusView(P, 'film').staleReason, 'final.mp4 is missing. Render the sequence again.');
});

test('a sequence that is not done is never stale', (t) => {
  rendered(t);
  setSequenceStatus(P, 'film', { status: 'draft' }, 'test');
  setStatus(P, 'open', { status: 'dirty', dirty_from: 1 }, 'test');
  assert.deepEqual([sequenceStatusView(P, 'film').stale, sequenceStatusView(P, 'film').staleReason], [false, '']);
});
