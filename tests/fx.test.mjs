import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateScript } from '../engine/script.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { readTemplate } from '../engine/templates.mjs';
import { composeBeats } from '../engine/mix.mjs';

const PICS = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
const gallery = (photos, extra = {}) => ({ id: 'g', kind: 'gallery', vo: 'Kick-off and launch day.', photos, source: 'bullets[0]', ...extra });

test('a lifestyle gallery takes 2-4 image prints with short captions', () => {
  const b = readTemplate('lifestyle');
  const ok = (sc) => validateScript({ scenes: [sc] }, b, { assets: PICS }).errors;
  assert.deepEqual(ok(gallery([{ asset: 'a.jpg', caption: 'Kick-off' }, { asset: 'b.jpg' }], { title: 'A year' })), []);
  assert.match(ok(gallery([{ asset: 'a.jpg' }])).join(), /photos must list 2-4 photos/);
  assert.match(ok(gallery(PICS.concat('a.jpg').map((asset) => ({ asset })))).join(), /photos must list 2-4/);
  assert.match(ok(gallery([{ asset: 'a.jpg', caption: 'x'.repeat(25) }, { asset: 'b.jpg' }])).join(), /caption at most 24/);
  assert.match(ok(gallery(['a.jpg', 'b.jpg'])).join(), /each photo is \{ "asset"/);
  assert.match(ok(gallery([{ asset: 'a.jpg' }, { asset: 'zz.jpg' }])).join(), /photo "zz.jpg" is not in the project assets/);
  assert.match(ok(gallery([{ asset: 'a.jpg' }, { asset: 'clip.mp4' }])).join(), /must be a \.png, \.jpg or \.webp image/);
});

test('a gallery mixes into another template', () => {
  const beats = composeBeats(readTemplate('explainer'), [readTemplate('lifestyle')]);
  assert.ok(beats.fields['lifestyle.gallery']);
  const script = { scenes: [
    { id: 't', kind: 'title', vo: 'How we built it.', title: 'How we built it' },
    { ...gallery([{ asset: 'a.jpg' }, { asset: 'b.jpg' }]), kind: 'lifestyle.gallery' },
  ] };
  assert.deepEqual(validateScript(script, beats, { assets: PICS }).errors, []);
});

test('a talking-head split or pip clip needs its screenshot', () => {
  const b = readTemplate('talking-head');
  assert.deepEqual(b.enums.layout, ['full', 'split', 'pip']);
  const clip = { id: 'c', kind: 'clip', asset: 'talk.mp4', layout: 'split' };
  assert.match(validateScript({ scenes: [clip] }, b, { assets: ['talk.mp4'] }).errors.join(), /layout split needs an image/);
  assert.deepEqual(validateScript({ scenes: [{ ...clip, layout: 'pip', image: 'a.jpg' }] }, b, { assets: ['talk.mp4', 'a.jpg'] }).errors, []);
  assert.match(validateScript({ scenes: [{ ...clip, layout: 'side' }] }, b, { assets: ['talk.mp4'] }).errors.join(), /layout must be full\|split\|pip/);
});

test('brand.leaks is a yes/no', () => {
  const base = {
    name: 'T', colors: { primary: '#112233', primary2: '#223344', secondary: '#ffcc00', bg: '#f5f5f5', ink: '#111111', muted: '#666666', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' }, voice: {}, music: {}, sources: { allowedHosts: ['example.com'] },
  };
  assert.equal(validateBrand({ ...base, leaks: true }).leaks, true);
  assert.equal('leaks' in validateBrand(base), false);
  assert.throws(() => validateBrand({ ...base, leaks: 1 }), /leaks must be true or false/);
});

// Real Chrome + ffmpeg: prepare plays every frame (no lint, played = jumped) for a gallery and for split and pip
// clips with light leaks on; the end states are where the layout says.
test('gallery, split, pip and light leaks prepare clean and land where they should', { timeout: 600000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const channel = loadStudioConfig().engine.chromeChannel;
  try { await (await chromium.launch({ channel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const { createProject, validateBrief, saveBrief, setStatus, jobFile } = await import('../engine/jobs.mjs');
  const { prepare } = await import('../engine/pipeline.mjs');
  const { openComposition, ffmpeg } = await import('../engine/media.mjs');
  const P = 'zz-test-fx';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'FX Test' });
  const A = path.join(DIRS.profiles, P, 'assets');
  fs.mkdirSync(A, { recursive: true });
  for (const f of PICS.slice(0, 3)) await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=400x400', '-frames:v', '1', path.join(A, f)], { timeoutMs: 30000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(A, 'talk.mp4')], { timeoutMs: 60000 });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), leaks: true, voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  const jobs = {
    life: { template: 'lifestyle', scenes: [
      gallery(PICS.slice(0, 3).map((asset, k) => ({ asset, caption: ['Kick-off', 'Release', 'Launch'][k] })), { title: 'A year' }),
      { id: 'cta', kind: 'cta', vo: 'Join us.', title: 'Join us', button: 'Sign up' }] },
    talk: { template: 'talking-head', scenes: [
      { id: 'sp', kind: 'clip', asset: 'talk.mp4', in: 0, out: 3, text: 'Here is the dashboard.', layout: 'split', image: 'a.jpg' },
      { id: 'pp', kind: 'clip', asset: 'talk.mp4', in: 3, out: 6, text: 'One click per report.', name: 'Anna', layout: 'pip', image: 'b.jpg' }] },
  };
  jobs.mixed = { template: 'explainer', mix: ['lifestyle'], scenes: [
    { id: 't', kind: 'title', vo: 'How we built it.', title: 'How we built it' },
    { ...gallery(PICS.slice(0, 2).map((asset) => ({ asset, caption: 'Day one' }))), kind: 'lifestyle.gallery' }] };
  for (const [ID, j] of Object.entries(jobs)) {
    saveBrief(validateBrief({ project: P, id: ID, template: j.template, ...(j.mix ? { mix: j.mix } : {}), format: '16:9', duration: 15, message: 'm' }));
    writeJson(jobFile(P, ID, 'source.json'), { name: 'FX', url: '', bullets: [{ text: 'A year of building.' }] });
    writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: j.scenes });
    setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
    const st = await prepare(P, ID, 'test');
    assert.equal(st.status, 'awaiting_review', `${ID}: ${JSON.stringify(st.lint?.findings)}`);
    const { browser, page, info } = await openComposition(jobFile(P, ID, 'index.html'), { channel, width: 1920, height: 1080 });
    try {
      const [first, second] = info.scenes;
      const at = async (x, fn) => { await page.evaluate((v) => window.seek(v), x); return page.evaluate(fn); };
      // The leak peaks on the cut and is gone mid-scene.
      assert.ok(await at(second.start, () => +getComputedStyle(document.getElementById('leak')).opacity) > 0.9);
      assert.equal(await at(second.start + 1.2, () => +getComputedStyle(document.getElementById('leak')).opacity), 0);
      if (ID === 'mixed') {
        assert.deepEqual(await at(second.end - 0.35, () => [...document.querySelectorAll('.t-lifestyle .pol')].map((p) => +getComputedStyle(p).opacity)), [1, 1]);
      } else if (ID === 'life') {
        const prints = await at(first.end - 0.35, () => [...document.querySelectorAll('.pol')].map((p) => +getComputedStyle(p).opacity));
        assert.deepEqual(prints, [1, 1, 1]);
        assert.ok(await at(first.start + 0.05, () => +getComputedStyle(document.querySelector('.pol')).opacity) < 0.05, 'no print before it lands');
      } else {
        assert.equal(await at(first.end - 0.3, () => getComputedStyle(document.getElementById('sp-cv')).clipPath), 'inset(0% 25%)');
        const pip = await at(second.end - 0.3, () => document.getElementById('pp-cv').getBoundingClientRect().toJSON());
        assert.ok(pip.width < 1920 * 0.3 && pip.right <= 1920 && pip.bottom <= 1080, JSON.stringify(pip));
        assert.equal(await at(second.end - 0.3, () => +getComputedStyle(document.getElementById('pp-l3')).opacity), 0, 'the lower third leaves a pip');
      }
    } finally {
      await browser.close();
    }
  }
});
