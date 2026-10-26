import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, getStatus, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { prepare, approve, render } from '../engine/pipeline.mjs';
import { probeMedia, ffmpegReport } from '../engine/media.mjs';

test('motion blur is a yes/no brief option that leaves an approved storyboard alone', (t) => {
  const P = 'zz-test-blur-edit';
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const b = { project: P, id: 'b-1x1', template: 'logo-reveal', format: '1:1', duration: 6, message: 'm' };
  assert.equal(validateBrief(b).motionBlur, false);
  assert.throws(() => validateBrief({ ...b, motionBlur: 1 }), /motionBlur must be true or false/);
  saveBrief(validateBrief(b));
  writeJson(jobFile(P, 'b-1x1', 'script.json'), { scenes: [] });
  setStatus(P, 'b-1x1', { status: 'approved', step: 9 }, 'test');
  const res = updateBrief(P, 'b-1x1', { ...b, motionBlur: true });
  assert.deepEqual(res.changed, ['motionBlur']);
  assert.equal(getStatus(P, 'b-1x1').status, 'approved', 'still approved: only the render changes');
});

// Real Chrome + ffmpeg: four sub-frames per frame, averaged, still 30 fps and the storyboard's length.
test('a blurred render keeps its length, its frame rate and a clean QA', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-blur-e2e', ID = 'sting-1x1';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Blur Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), logoText: 'Blur Test', voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  saveBrief(validateBrief({ project: P, id: ID, template: 'logo-reveal', format: '1:1', duration: 6, message: 'm', motionBlur: true }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Blur Test', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [{ id: 'reveal', kind: 'reveal', tagline: 'Fast moves blur' }] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  const file = jobFile(P, ID, 'final.mp4');
  const info = await probeMedia(file);
  assert.ok(Math.abs(info.duration - done.outputs.duration) < 0.1, `length ${info.duration} vs ${done.outputs.duration}`);
  const log = await ffmpegReport(['-i', file, '-map', '0:v', '-f', 'null', '-']);
  const frames = Number(/frame=\s*(\d+)/.exec(log.slice(log.lastIndexOf('frame=')))?.[1]);
  assert.ok(Math.abs(frames - Math.round(done.outputs.duration * 30)) <= 1, `${frames} frames at 30 fps`);
  assert.equal(done.outputs.qa.errors, 0, JSON.stringify(done.outputs.qa.findings));
});
