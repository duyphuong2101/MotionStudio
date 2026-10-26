import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { createProject } from '../engine/jobs.mjs';
import { probeMedia } from '../engine/media.mjs';
import { transitionPreview, transitionPreviewFile } from '../engine/transition-preview.mjs';

const P = 'zz-test-xprev';

// Real ffmpeg: a demo is two brand-coloured scenes joined by the preset, reused until the brand changes.
test('a transition demo is built once per project and brand, with the preset length', { timeout: 120000 }, async (t) => {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  t.after(() => fs.rmSync(path.join(DIRS.out, '_preview', 'transitions', P), { recursive: true, force: true }));
  createProject({ id: P, name: 'Demo Test' });
  const p = await transitionPreview(P, 'dip-black');
  assert.equal(p.url, `/xpreview/${P}/dip-black.mp4`);
  assert.equal(p.duration, 2.4);
  const file = transitionPreviewFile(P, 'dip-black.mp4');
  const info = await probeMedia(file);
  assert.ok(Math.abs(info.duration - 2.4) < 0.1, `demo lasts ${info.duration}`);
  const made = fs.statSync(file).mtimeMs;
  await transitionPreview(P, 'dip-black');
  assert.equal(fs.statSync(file).mtimeMs, made, 'reused, not rebuilt');
  await assert.rejects(() => transitionPreview(P, 'wobble'), /Unknown transition: wobble/);
  assert.throws(() => transitionPreviewFile(P, '../x.mp4'), /Not found/);
  assert.throws(() => transitionPreviewFile(P, 'dip-black.png'), /Not found/);
});
