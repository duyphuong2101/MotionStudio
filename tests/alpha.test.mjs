import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { prepare, approve, render, overlayArgs } from '../engine/pipeline.mjs';
import { ffmpeg, ffmpegReport } from '../engine/media.mjs';

// Real Chrome + ffmpeg: a name card on a transparent page, rendered to ProRes 4444 with alpha plus the usual MP4.
test('an overlay template renders a .mov with real transparency next to its MP4', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const cfg = loadStudioConfig();
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-alpha', ID = 'name-16x9';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-alpha-'));
  t.after(() => {
    ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  createProject({ id: P, name: 'Alpha Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  saveBrief(validateBrief({ project: P, id: ID, template: 'lower-third', format: '16:9', duration: 6, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'x', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [{ id: 'ana', kind: 'lower', name: 'Ana Ruiz', role: 'Head of Operations', pace: 'quick' }] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.equal(done.outputs.alpha, 'alpha.mov');
  assert.ok(fs.existsSync(jobFile(P, ID, 'final.mp4')), 'the MP4 is still made');

  const probe = await ffmpegReport(['-i', jobFile(P, ID, 'alpha.mov'), '-frames:v', '1', '-f', 'null', '-']);
  assert.match(probe, /prores \(4444\)/);
  assert.match(probe, /yuva444p1[02]le/, 'the picture has an alpha plane');
  // One frame while the card is on screen: the background is see-through, the card is solid.
  const raw = path.join(tmp, 'f.raw');
  await ffmpeg(['-y', '-ss', '1.5', '-i', jobFile(P, ID, 'alpha.mov'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { timeoutMs: 30000 });
  const px = fs.readFileSync(raw);
  let clear = 0, solid = 0;
  // The card is 97% opaque by design, so "solid" means alpha of 200 or more.
  for (let i = 3; i < px.length; i += 4) { if (px[i] === 0) clear++; else if (px[i] >= 200) solid++; }
  const n = px.length / 4;
  assert.equal(n, 1920 * 1080);
  assert.ok(clear / n > 0.6, `${Math.round((clear / n) * 100)}% of the frame is transparent`);
  assert.ok(solid / n > 0.01, `${Math.round((solid / n) * 1000) / 10}% is the solid card`);
});

// ffmpeg only: the MP4 lays the overlay on the brand background, which must keep its colour when read back as BT.709.
test('the overlay MP4 keeps the brand background colour', { timeout: 120000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-alpha-bg-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clear = path.join(tmp, 'clear.mov'), out = path.join(tmp, 'out.mp4'), raw = path.join(tmp, 'bg.raw');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:r=30:d=1,format=rgba', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', clear], { timeoutMs: 60000 });
  await ffmpeg(overlayArgs({ bg: '#e63946', width: 320, height: 180, fps: 30, crf: 18, alpha: clear, out }), { timeoutMs: 60000 });
  await ffmpeg(['-y', '-ss', '0.5', '-i', out, '-frames:v', '1', '-vf', 'crop=8:8:150:80,scale=1:1:in_color_matrix=bt709:in_range=tv,format=rgb24', '-f', 'rawvideo', raw], { timeoutMs: 30000 });
  const got = [...fs.readFileSync(raw)];
  assert.ok(got.every((v, k) => Math.abs(v - [230, 57, 70][k]) <= 4), `#e63946 came back as rgb(${got})`);
  assert.deepEqual(overlayArgs({ bg: 'red;x', width: 2, height: 2, fps: 30, crf: 18, alpha: 'a', out: 'b' }).slice(1, 4), ['-f', 'lavfi', '-i'], 'a bad colour falls back');
  assert.match(overlayArgs({ bg: 'red;x', width: 2, height: 2, fps: 30, crf: 18, alpha: 'a', out: 'b' })[4], /^color=c=black:/);
});
