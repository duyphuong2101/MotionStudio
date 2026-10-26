import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, loadTemplate } from '../engine/jobs.mjs';
import { prepare, approve, render, levelsOf, sizeFor } from '../engine/pipeline.mjs';
import { validateScript } from '../engine/script.mjs';
import { ffmpeg, openComposition, lintInPage } from '../engine/media.mjs';

test('levels follow loudness frame by frame and scale to a loud frame, not one peak', () => {
  const rate = 8000;
  const s = new Float32Array(rate * 2);
  for (let i = 0; i < s.length; i++) s[i] = (i < rate ? 0.1 : 0.5) * Math.sin(i * 0.3);
  s[10] = 1; // one click
  const lv = levelsOf(s, rate, 30);
  assert.ok(Math.abs(lv.length - 60) <= 1, `${lv.length} levels for 2 s`);
  assert.ok(lv[45] > lv[15] * 3, 'the loud second reads louder');
  assert.ok(lv[45] >= 0.95, 'loud frames reach the top');
});

test('audiogram clips take sound files and cover art that must exist', () => {
  const { beats } = loadTemplate('audiogram');
  const sc = { id: 'c1', kind: 'clip', asset: 'talk.mp3', image: 'cover.png', text: 'Hi', name: 'Ana' };
  assert.deepEqual(validateScript({ scenes: [sc] }, beats, { assets: ['talk.mp3', 'cover.png'] }).errors, []);
  assert.match(validateScript({ scenes: [sc] }, beats, { assets: ['talk.mp3'] }).errors.join(), /image "cover.png" is not in the project assets/);
});

// Real ffmpeg + Chrome: a sound that swells, a vertical audiogram, prepared and rendered.
test('an audiogram prepares from a sound file, its waveform follows the sound, and it renders', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const cfg = loadStudioConfig();
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-audiogram', ID = 'pod-9x16';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Pod Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), logoText: 'Pod Test', voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  // Quiet for 2 s, then loud: a waveform that ignores the sound would look the same in both halves.
  await ffmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='(if(lt(t,3),0.05,0.6))*sin(2*PI*220*t)':s=44100:d=8", path.join(DIRS.profiles, P, 'assets', 'talk.mp3')], { timeoutMs: 30000 });
  saveBrief(validateBrief({ project: P, id: ID, template: 'audiogram', format: '9:16', duration: 12, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Pod Test', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [
    { id: 'ep', kind: 'card', kicker: 'Episode 1', title: 'Small teams' },
    { id: 'c1', kind: 'clip', asset: 'talk.mp3', in: 1, out: 6, name: 'Ana Ruiz', role: 'Host', text: 'We shipped it in two weeks with four people.' },
  ] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');

  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  const timing = readJson(jobFile(P, ID, 'timing.json'));
  const lv = timing.footage.find((f) => f.id === 'c1').levels;
  assert.ok(Math.abs(lv.length - 150) <= 2, `${lv.length} levels for a 5 s clip`);
  assert.ok(fs.existsSync(jobFile(P, ID, 'footage.wav')), 'the clip sound is mixed');
  assert.ok(!fs.existsSync(jobFile(P, ID, 'clips/c1.mp4')), 'a sound-only clip makes no video');

  const { beats } = loadTemplate('audiogram');
  const { browser, page } = await openComposition(jobFile(P, ID, 'index.html'), { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '9:16') });
  try {
    const c = timing.scenes.find((s) => s.id === 'c1');
    const centre = (tm) => page.evaluate((x) => { window.seek(x); return document.getElementById('c1-b23').getBoundingClientRect().height; }, tm);
    const quiet = await centre(c.start + 1.0), loud = await centre(c.start + 3.5);
    assert.ok(loud > quiet * 3, `the centre bar is ${quiet}px while quiet and ${loud}px while loud`);
    assert.deepEqual(await page.evaluate(lintInPage, cfg.lint.safeArea), [], 'stays in the safe area');
    assert.match(await page.evaluate(() => document.getElementById('c1-tm').textContent), /^0:03 \/ 0:0[45]$/);
  } finally {
    await browser.close();
  }

  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.equal(done.status, 'done');
  assert.equal(done.outputs.audio, 'footage');
  assert.equal(done.outputs.qa.errors, 0, JSON.stringify(done.outputs.qa.findings));
});
