import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson, readJson } from '../engine/core.mjs';
import {
  createProject, validateBrief, saveBrief, setStatus, getStatus, jobFile, humanEdit, mergeRespectingLocks, editDirtyFrom, BULLET_ASSET_LOCK,
} from '../engine/jobs.mjs';
import { validateSource } from '../engine/script.mjs';
import { commit } from '../engine/pipeline.mjs';
import { bulletShot, shotField, shotAction, applyShot } from '../ui/shots.js';

const ASSETS = ['inbox.png', 'queue.webp', 'logo.svg'];
const source = () => ({ name: 'CSR Console', bullets: [
  { text: 'One inbox for every channel', ref: 'p1' },
  { text: 'Approvals in one queue', ref: 'p2' },
  { text: 'Replies in under a minute', ref: 'p3' },
] });
const withAsset = (i, asset) => { const s = source(); s.bullets[i].asset = asset; return s; };

test('a bullet screenshot must be a png, jpg or webp file in the project assets', () => {
  assert.deepEqual(validateSource(withAsset(0, 'inbox.png'), { assets: ASSETS }), []);
  assert.deepEqual(validateSource(source()), [], 'a source without screenshots needs no asset list');
  assert.ok(validateSource(withAsset(0, 'missing.png'), { assets: ASSETS }).some((e) => e.includes('bullets[0].asset "missing.png" is not in the project assets. Upload it in the Brand tab')));
  assert.ok(validateSource(withAsset(1, '../inbox.png'), { assets: ASSETS }).some((e) => e.includes('bullets[1].asset is not a valid file name')));
  assert.ok(validateSource(withAsset(1, 42), { assets: ASSETS }).some((e) => e.includes('not a valid file name')));
  assert.ok(validateSource(withAsset(2, 'logo.svg'), { assets: ASSETS }).some((e) => e.includes('must be a .png, .jpg or .webp image')));
});

test('an edit that only sets screenshots locks them per bullet and keeps the job status', () => {
  const { doc, changed } = humanEdit('source', source(), withAsset(2, 'inbox.png'), 'ana');
  assert.deepEqual(changed, [BULLET_ASSET_LOCK]);
  assert.ok(!doc.locks.bullets, 'the claims stay open for the Director');
  assert.deepEqual(doc.locks[BULLET_ASSET_LOCK].assets, { 'Replies in under a minute': 'inbox.png' });
  assert.equal(doc.locks[BULLET_ASSET_LOCK].by, 'ana');
  assert.equal(editDirtyFrom('source', doc, changed), null);

  const { doc: again } = humanEdit('source', doc, { ...withAsset(0, 'queue.webp'), locks: undefined }, 'ben');
  assert.deepEqual(again.locks[BULLET_ASSET_LOCK].assets, { 'Replies in under a minute': null, 'One inbox for every channel': 'queue.webp' }, 'earlier choices add up, a removal is a choice too');
});

test('a source edit that changes a claim still sends the job back to step 4', () => {
  const after = withAsset(2, 'inbox.png');
  after.bullets[2].text = 'Replies in seconds';
  const { doc, changed } = humanEdit('source', source(), after, 'ana');
  assert.deepEqual(changed, ['bullets']);
  assert.equal(editDirtyFrom('source', doc, changed), 4);
  assert.equal(editDirtyFrom('source', doc), 4);
});

test('a director commit keeps the screenshots a person chose and may set the others', () => {
  const before = withAsset(0, 'queue.webp');
  const { doc: existing } = humanEdit('source', before, withAsset(2, 'inbox.png'), 'ana'); // ana moved the screenshot from 0 to 2
  const draft = { name: 'CSR Console', bullets: [
    { text: 'Replies in under a minute', ref: 'p3' },
    { text: 'One inbox for every channel', ref: 'p1', asset: 'queue.webp' },
    { text: 'Approvals in one queue', ref: 'p2', asset: 'queue.webp' },
  ] };
  const { doc, kept } = mergeRespectingLocks('source', existing, draft);
  assert.ok(kept.includes(BULLET_ASSET_LOCK));
  assert.equal(doc.bullets[0].asset, 'inbox.png', 'follows the bullet text, not its position');
  assert.equal(doc.bullets[1].asset, undefined, 'a screenshot the person removed stays removed');
  assert.equal(doc.bullets[2].asset, 'queue.webp', 'a bullet the person never touched is the Director\'s');
});

const P = 'zz-test-shots';
const ID = 'tour-16x9';
function seed(t) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Shots' });
  fs.writeFileSync(path.join(DIRS.profiles, P, 'assets', 'inbox.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  saveBrief(validateBrief({ id: ID, project: P, template: 'ui-story', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  setStatus(P, ID, { status: 'scripting', step: 3 }, 'test');
}

test('a director commit refuses a screenshot that is not in the project assets', (t) => {
  seed(t);
  writeJson(jobFile(P, ID, 'source.draft.json'), withAsset(0, 'made-up.png'));
  assert.throws(() => commit(P, ID, 'source', 'director'), /bullets\[0\]\.asset "made-up\.png" is not in the project assets/);
  writeJson(jobFile(P, ID, 'source.draft.json'), withAsset(0, 'inbox.png'));
  commit(P, ID, 'source', 'director');
  assert.equal(readJson(jobFile(P, ID, 'source.json')).bullets[0].asset, 'inbox.png');
  assert.equal(getStatus(P, ID).step, 4);
});

test('cli context lists the bullet screenshots for the Director', (t) => {
  seed(t);
  writeJson(jobFile(P, ID, 'source.json'), withAsset(1, 'inbox.png'));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), 'context', P, ID], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const ctx = JSON.parse(out);
  assert.deepEqual(ctx.screenshots, [{ source: 'bullets[1]', asset: 'inbox.png' }]);
  assert.match(ctx.screenshotRule, /shots\[0\]\.asset/);
});

test('picking a claim source fills an empty or default image and only offers to replace a chosen one', () => {
  const src = withAsset(2, 'inbox.png');
  assert.equal(bulletShot(src, 'bullets[2]'), 'inbox.png');
  assert.equal(bulletShot(src, 'bullets[0]'), '');
  assert.equal(bulletShot(src, 'facts[2]'), '');
  assert.equal(shotField(['vo', 'title', 'shots', 'source']), 'shots');
  assert.equal(shotField(['vo', 'quote', 'asset']), 'asset');
  assert.equal(shotField(['vo', 'title']), '');

  const auto = 'aaa.png';
  const shot = { id: 's', kind: 'shot', shots: [{ asset: auto, focus: { x: 0, y: 0, w: 100, h: 100 }, cursor: { x: 5, y: 5 } }] };
  assert.equal(shotAction(shot, 'shots', 'inbox.png', auto), 'set');
  assert.equal(shotAction({ ...shot, shots: [] }, 'shots', 'inbox.png', auto), 'set');
  assert.equal(shotAction({ ...shot, shots: [{ asset: 'queue.webp' }] }, 'shots', 'inbox.png', auto), 'offer');
  assert.equal(shotAction({ ...shot, shots: [{ asset: 'inbox.png' }] }, 'shots', 'inbox.png', auto), '');
  assert.equal(shotAction({ asset: '' }, 'asset', 'inbox.png', auto), 'set');
  assert.equal(shotAction({ asset: 'queue.webp' }, 'asset', 'inbox.png', auto), 'offer');
  assert.equal(shotAction(shot, '', 'inbox.png', auto), '', 'no image field, nothing to do');

  const set = applyShot(shot, 'shots', 'inbox.png');
  assert.deepEqual(set.shots[0], { ...shot.shots[0], asset: 'inbox.png' }, 'focus and cursor stay');
  assert.equal(shot.shots[0].asset, auto, 'the input scene is not changed');
  assert.deepEqual(applyShot({ shots: [] }, 'shots', 'inbox.png').shots, [{ focus: null, asset: 'inbox.png' }]);
  assert.equal(applyShot({ asset: 'x.png' }, 'asset', 'inbox.png').asset, 'inbox.png');
});
