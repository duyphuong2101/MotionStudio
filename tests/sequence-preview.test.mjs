import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { ffmpeg, probeMedia } from '../engine/media.mjs';
import { createSequence, previewSequence, updateSequence, getSequenceStatus } from '../engine/sequences.mjs';

const P = 'zz-test-seqpreview';

// Real ffmpeg: two finished 1080p parts, previewed at a 360 px short side with their own joins; the status stays draft.
test('a quick preview joins the parts at low resolution without changing the sequence status', { timeout: 300000 }, async (t) => {
  t.after(() => ['profiles', 'briefs', 'sequences', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Preview Test' });
  for (const [id, color] of [['one', 'blue'], ['two', 'orange']]) {
    saveBrief(validateBrief({ id, project: P, template: 'explainer', format: '16:9', duration: 15, director: 'seat', message: 'm' }));
    fs.mkdirSync(path.dirname(jobFile(P, id, 'final.mp4')), { recursive: true });
    await ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', jobFile(P, id, 'final.mp4')], { timeoutMs: 60000 });
    setStatus(P, id, { status: 'done', outputs: { final: 'final.mp4', width: 1920, height: 1080, fps: 30, duration: 2 } }, 'test');
  }
  createSequence({ id: 'cut-16x9', project: P, format: '16:9', transition: 'cut', transitions: ['wipe-left'], parts: ['one', 'two'] });
  const st = await previewSequence(P, 'cut-16x9', 'test');
  assert.equal(st.status, 'draft', 'a preview is not a render');
  assert.deepEqual([st.preview.width, st.preview.height, st.preview.transitions], [640, 360, ['wipe-left']]);
  const file = jobFile(P, 'cut-16x9', 'preview.mp4');
  const info = await probeMedia(file);
  assert.ok(Math.abs(info.duration - 3.5) < 0.1, `preview lasts ${info.duration}`);
  assert.ok(fs.statSync(file).size < 400000, 'a small file: low resolution and a fast encode');
  // An edit other than the title drops the preview.
  updateSequence(P, 'cut-16x9', { transitions: ['fade'] });
  assert.ok(!fs.existsSync(file));
  assert.equal(getSequenceStatus(P, 'cut-16x9').preview, null);
});
