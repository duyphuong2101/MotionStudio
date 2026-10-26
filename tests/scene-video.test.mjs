import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, loadTemplate } from '../engine/jobs.mjs';
import { prepare, approve, render, sizeFor } from '../engine/pipeline.mjs';
import { validateScript } from '../engine/script.mjs';
import { ffmpeg, openComposition } from '../engine/media.mjs';

test('a video scene names a video asset that exists; in, out and sound are checked', () => {
  const { beats } = loadTemplate('explainer');
  const base = { scenes: [{ id: 'title', kind: 'title', vo: 'v', title: 't' }, { id: 'v1', kind: 'video', vo: 'v', title: 't', video: 'rec.mp4', source: 'bullets[0]' }] };
  const errs = (patch, assets = ['rec.mp4']) => validateScript({ scenes: [base.scenes[0], { ...base.scenes[1], ...patch }] }, beats, { assets }).errors.join(' | ');
  assert.equal(errs({}), '');
  assert.match(errs({}, []), /video "rec.mp4" is not in the project assets/);
  assert.match(errs({ video: 'rec.png' }, ['rec.png']), /video must be a .mp4/);
  assert.match(errs({ in: 'soon' }), /in must be a number of seconds/);
  assert.match(errs({ sound: 'yes' }), /sound must be true or false/);
});

// Real ffmpeg + Chrome: a 4 s test clip shown twice, muted under the voice and then with its own sound.
test('footage plays inside a motion scene: muted under the voice, or with its sound setting the length', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const cfg = loadStudioConfig();
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-scenevideo', ID = 'how-16x9';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Video Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(DIRS.profiles, P, 'assets', 'rec.mp4')], { timeoutMs: 60000 });
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 20, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'x', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [
    { id: 'title', kind: 'title', vo: 'How the test clip looks.', title: 'Test clip' },
    { id: 'quiet', kind: 'video', vo: 'Here it plays without its sound while this line is read out loud.', title: 'Muted', video: 'rec.mp4', in: 1, out: 5, source: 'bullets[0]' },
    { id: 'loud', kind: 'video', vo: '', title: 'With sound', video: 'rec.mp4', in: 0, out: 3, sound: true, source: 'bullets[0]' },
  ] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));

  const timing = readJson(jobFile(P, ID, 'timing.json'));
  const loud = timing.scenes.find((s) => s.id === 'loud'), quiet = timing.scenes.find((s) => s.id === 'quiet');
  assert.ok(Math.abs((loud.end - loud.start) - 3) < 0.01, 'the scene with sound lasts as long as its clip');
  assert.deepEqual(timing.videos.map((v) => [v.id, v.sound]), [['quiet', false], ['loud', true]]);
  assert.ok(fs.existsSync(jobFile(P, ID, 'footage.wav')), 'the clip sound is mixed');
  assert.ok(fs.existsSync(jobFile(P, ID, 'clips/quiet.mp4')) && fs.existsSync(jobFile(P, ID, 'clips/loud.mp4')));

  const { beats } = loadTemplate('explainer');
  const { browser, page } = await openComposition(jobFile(P, ID, 'index.html'), { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') });
  try {
    const at = (x) => page.evaluate(async (tm) => { await window.seek(tm); return document.querySelector('video[data-clip="quiet"]').currentTime; }, x);
    assert.ok(Math.abs((await at(quiet.start + 1.2)) - 1.2) < 0.06, 'the clip follows the page clock');
    assert.ok(Math.abs((await at(quiet.start + 0.4)) - 0.4) < 0.06, 'and seeks back');
    // Near the end of the scene: the clip has run (it is 4 s long) or holds its last frame if the scene is longer.
    const late = quiet.end - 0.1, want = Math.min(4 - 0.04, late - quiet.start);
    const held = await at(late);
    assert.ok(Math.abs(held - want) < 0.08, `near the scene end the clip is at ${held}, expected about ${want}`);
  } finally {
    await browser.close();
  }
  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.match(done.outputs.audio, /footage/);
  assert.equal(done.outputs.qa.errors, 0, JSON.stringify(done.outputs.qa.findings));
});
