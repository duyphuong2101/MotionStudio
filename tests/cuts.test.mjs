import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, updateBrief, getStatus, setStatus, jobFile, createProject, cutSlug } from '../engine/jobs.mjs';
import { prepare, approve, render } from '../engine/pipeline.mjs';
import { probeMedia } from '../engine/media.mjs';
import { pathToFileURL } from 'node:url';

const brief = { project: 'zz-test-cuts', template: 'explainer', format: '16:9', duration: 30, message: 'm' };

test('extra cuts are formats the template makes, other than the main one, at most three', () => {
  assert.deepEqual(validateBrief({ ...brief, id: 'a', alsoFormats: ['9:16', '1:1', '9:16'] }).alsoFormats, ['9:16', '1:1'], 'duplicates collapse');
  assert.deepEqual(validateBrief({ ...brief, id: 'a' }).alsoFormats, []);
  assert.throws(() => validateBrief({ ...brief, id: 'a', alsoFormats: ['16:9'] }), /already the main format/);
  assert.throws(() => validateBrief({ ...brief, id: 'a', template: 'ui-story', alsoFormats: ['9:16'] }), /9:16 not available/);
  assert.throws(() => validateBrief({ ...brief, id: 'a', alsoFormats: ['9:16', '1:1', '4:5', '2:3'] }), /At most 3/);
  assert.throws(() => validateBrief({ ...brief, id: 'a', template: 'talking-head', alsoFormats: ['9:16'] }), /footage template/);
  assert.throws(() => validateBrief({ ...brief, id: 'a', alsoFormats: '9:16' }), /list of formats/);
  assert.equal(cutSlug('9:16'), '9x16');
});

test('adding a cut after the script exists needs a new storyboard, not the Director', (t) => {
  const P = 'zz-test-cuts-edit';
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const b = { ...brief, project: P, id: 'c-16x9' };
  saveBrief(validateBrief(b));
  writeJson(jobFile(P, 'c-16x9', 'script.json'), { scenes: [] });
  const res = updateBrief(P, 'c-16x9', { ...b, alsoFormats: ['9:16'] });
  assert.deepEqual(res.changed, ['alsoFormats']);
  assert.equal(res.rePrepare, true);
  assert.equal(getStatus(P, 'c-16x9').dirty_from, 5);
});

// Runs Chrome and ffmpeg for real: a few seconds of logo sting, square plus a vertical cut.
test('prepare and render make every cut with its own stills, MP4 and QA receipt', { timeout: 240000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-cuts-e2e', ID = 'sting-1x1';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Cut Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), logoText: 'Cut Test', voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  saveBrief(validateBrief({ project: P, id: ID, template: 'logo-reveal', format: '1:1', duration: 6, message: 'm', alsoFormats: ['9:16'] }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Cut Test', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [{ id: 'reveal', kind: 'reveal', tagline: 'Two sizes, one script' }] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');

  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  assert.equal(st.cuts.length, 1);
  assert.deepEqual([st.cuts[0].format, st.cuts[0].width, st.cuts[0].height], ['9:16', 1080, 1920]);
  assert.ok(fs.existsSync(jobFile(P, ID, 'index-9x16.html')));
  assert.ok(st.cuts[0].stills.length && st.cuts[0].stills.every((s) => s.file.startsWith('stills/9x16/') && fs.existsSync(jobFile(P, ID, s.file))));

  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.equal(done.status, 'done');
  const o = done.outputs;
  assert.deepEqual([o.width, o.height], [1080, 1080]);
  assert.equal(o.cuts.length, 1);
  assert.equal(o.cuts[0].final, 'final-9x16.mp4');
  const info = await probeMedia(jobFile(P, ID, 'final-9x16.mp4'));
  assert.ok(Math.abs(info.duration - o.duration) < 0.15, 'the cut is as long as the main video');
  for (const [qa, receipt] of [[o.qa, 'qa.json'], [o.cuts[0].qa, 'qa-9x16.json']]) {
    assert.equal(qa.errors, 0, JSON.stringify(qa.findings));
    assert.ok(fs.existsSync(jobFile(P, ID, receipt)));
  }

  // The offline HTML copy plays from disk with every request to the network refused.
  assert.equal(o.html.file, 'video.html', JSON.stringify(o.html));
  const browser = await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true });
  try {
    const ctx = await browser.newContext();
    const asked = [];
    await ctx.route(/^https?:/, (route) => { asked.push(route.request().url()); return route.abort(); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(jobFile(P, ID, 'video.html')).href);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ player: !!document.getElementById('hv'), audio: document.getElementById('hv-audio')?.src.slice(0, 15), at: window.seek(1.5), vendor: document.querySelectorAll('script[src]').length }));
    assert.deepEqual(r, { player: true, audio: 'data:audio/mp4;', at: 1.5, vendor: 0 });
    assert.deepEqual(errors, []);
    assert.ok(asked.every((u) => u.startsWith('https://fonts.')), `only web fonts may be asked for: ${asked.join(', ')}`);
  } finally {
    await browser.close();
  }

  // A new storyboard removes the old cut files so nothing stale is handed out.
  setStatus(P, ID, { status: 'awaiting_review' }, 'test');
  fs.writeFileSync(jobFile(P, ID, 'final-4x5.mp4'), 'stale');
  await prepare(P, ID, 'test');
  assert.ok(!fs.existsSync(jobFile(P, ID, 'final-9x16.mp4')) && !fs.existsSync(jobFile(P, ID, 'final-4x5.mp4')) && !fs.existsSync(jobFile(P, ID, 'qa-9x16.json')));
});
