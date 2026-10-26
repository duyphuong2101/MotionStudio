// Template review fixes in real Chrome: the play-through check catches class, canvas and video state that a backward
// seek mis-restores; close cuts with leaks play clean; a clip that cannot reach its frame fails the seek; a long
// underline is drawn on each line; the corner logo follows an accent scene's luminance; an exported page with a 3D
// model reaches __ready from file://.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { openComposition, ffmpeg } from '../engine/media.mjs';
import { playCheck, PLAY_DEFAULTS } from '../engine/playcheck.mjs';
import { inlinePage } from '../engine/htmlvideo.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { sampleGlb } from '../engine/glb.mjs';
import { page } from '../templates/kit.mjs';
import { modelCanvas } from '../templates/model3d.mjs';

const cfg = loadStudioConfig();
const BRAND = {
  name: 'Fix Co', logo: null, logoDark: null, logoText: 'fix', site: '',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Arial', body: 'Arial', googleFonts: '' },
};
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 3, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1 };
const SIZE = { width: 1920, height: 1080 };
const GSAP = ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js'];

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-fixchrome-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  for (const d of ['vendor', 'assets', 'clips']) fs.mkdirSync(path.join(dir, d));
  for (const f of GSAP) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  return dir;
}

function write(dir, name, { scenes, body, js = '', css = '', brand = BRAND, timing = null, kinds = '{}' }) {
  const script = { lang: 'en', scenes: scenes.map((id) => ({ id, kind: 'x', vo: 'A short line for this scene to say.' })) };
  const tm = timing || estimateTiming(script, TIMING, 'en');
  const html = page({
    brand, script, timing: tm, size: SIZE, title: name, particles: false, body,
    css: `.t{position:absolute;font:700 60px Arial}${css}`,
    scenes: scenes.map((id) => ({ id, kind: 'x' })), js: `${js}\nconst KINDS = ${kinds};`,
  });
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, html);
  return { file, timing: tm };
}

async function open(t, file) {
  try { return await openComposition(file, { channel: cfg.engine.chromeChannel, ...SIZE }); } catch (err) {
    if (/Composition/.test(err.message)) throw err;
    t.skip(`Chrome is not available: ${err.message}`);
    return null;
  }
}

const hist = (r) => r.findings.filter((f) => f.level === 'error' && f.msg.startsWith('played and jumped differ'));

test('the play-through check catches classes, canvas pixels and video time a backward seek leaves behind', { timeout: 180000 }, async (t) => {
  const dir = folder(t);
  // afterSeek changes state only going forward, as a broken renderer would.
  const { file } = write(dir, 'stale', {
    scenes: ['a'],
    body: '<div class="sc fill" id="g-a"><div class="t" style="left:200px;top:200px"><span id="a-w">Word</span></div><canvas id="a-gl" data-gl width="64" height="64" style="position:absolute;left:600px;top:200px"></canvas><video id="a-v" muted style="position:absolute;left:900px;top:200px;width:64px;height:64px"></video></div>',
    // afterSeek is declared after the renderer's code, so the scene builder sets it.
    js: `const cv2 = $('a-gl').getContext('2d');`,
    kinds: `{ x: () => { afterSeek = (t) => { if (t > 1) { $('a-w').classList.add('on'); cv2.fillStyle = '#ff0000'; cv2.fillRect(0, 0, 64, 64); $('a-v').currentTime = t; } return t; }; } }`,
  });
  const o = await open(t, file);
  if (!o) return;
  try {
    const r = await playCheck(o.page, o.info, { ...PLAY_DEFAULTS, step: 1 / 6 });
    const msgs = hist(r).map((f) => f.msg).join('\n');
    assert.match(msgs, /a-w class "on" played, "" jumped from the end|a-w class "" played, "on" jumped from the end/);
    assert.match(msgs, /gl#a-gl pixels differ by [\d.]+ played vs jumped/);
    assert.match(msgs, /video#a-v time [\d.]+ s played, [\d.]+ s jumped/);
  } finally {
    await o.browser.close();
  }
});

test('marks, a preset subtitle and leaks over two cuts 0.6 s apart play with no played/jumped difference', { timeout: 180000 }, async (t) => {
  const dir = folder(t);
  const words = (id, from, list) => list.map((w, i) => ({ scene: id, w, start: from + 0.1 + i * 0.12, end: from + 0.2 + i * 0.12 }));
  const timing = {
    duration: 5, lang: 'en',
    scenes: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 2.6 }, { id: 'c', start: 2.6, end: 5 }],
    words: [...words('a', 0, ['Save', 'more', 'now']), ...words('b', 2, ['Fast']), ...words('c', 2.6, ['Plan', 'every', 'team'])],
  };
  const { file } = write(dir, 'clean', {
    scenes: ['a', 'b', 'c'], timing, brand: { ...BRAND, leaks: true, subtitles: { style: 'highlighter', font: 'Roboto' } },
    body: ['a', 'b', 'c'].map((id, k) => `<div class="sc fill" id="g-${id}"><div class="t" style="left:200px;top:${150 + k * 10}px;width:600px">Plan [[underline:every team here]] and [[mark:more]]</div></div>`).join(''),
  });
  const o = await open(t, file);
  if (!o) return;
  try {
    const r = await playCheck(o.page, o.info, { ...PLAY_DEFAULTS, step: 1 / 12 });
    assert.deepEqual(hist(r), []);
  } finally {
    await o.browser.close();
  }
});

test('a long underline is drawn on each of its lines, after the line before it', { timeout: 120000 }, async (t) => {
  const dir = folder(t);
  const { file, timing } = write(dir, 'wrap', {
    scenes: ['a'],
    body: '<div class="sc fill" id="g-a"><div class="t" style="left:200px;top:200px;width:420px">Teams [[underline:plan every single sprint together]] now</div></div>',
  });
  const o = await open(t, file);
  if (!o) return;
  try {
    const at = (x) => o.page.evaluate((v) => window.seek(v), x);
    await at(timing.scenes[0].end - 0.05);
    const parts = await o.page.evaluate(() => [...document.querySelectorAll('#g-a .mk-underline')].map((m) => ({
      text: m.querySelector('.mkt').textContent, top: Math.round(m.getBoundingClientRect().top), w: m.offsetWidth,
      d: m.querySelector('path').getAttribute('d'), cont: m.classList.contains('mkc'),
      drawn: (() => { const p = m.querySelector('path'), a = getComputedStyle(p).strokeDasharray; return a === 'none' ? 1 : parseFloat(a) / p.getTotalLength(); })(),
    })));
    assert.ok(parts.length >= 2, JSON.stringify(parts));
    assert.equal(parts.map((p) => p.text).join(' '), 'plan every single sprint together');
    assert.ok(parts.every((p) => p.w <= 420 && /^M\d/.test(p.d) && p.drawn > 0.98), JSON.stringify(parts));
    assert.ok(parts.slice(1).every((p, k) => p.cont && p.top > parts[k].top), 'one mark per line, top to bottom');
  } finally {
    await o.browser.close();
  }
});

test('the corner logo is the dark-surface one on an accent scene with a dark accent colour', { timeout: 120000 }, async (t) => {
  const dir = folder(t);
  for (const f of ['l.svg', 'd.svg']) fs.writeFileSync(path.join(dir, 'assets', f), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const brand = { ...BRAND, logo: 'l.svg', logoDark: 'd.svg', logoBug: true, colors: { ...BRAND.colors, secondary: '#203040' } };
  const { file, timing } = write(dir, 'bug', {
    scenes: ['a', 'b'], brand, css: '.acc{background:var(--secondary)}',
    body: '<div class="sc fill" id="g-a"></div><div class="sc fill acc" id="g-b"></div>',
  });
  const o = await open(t, file);
  if (!o) return;
  try {
    const shown = async (x) => { await o.page.evaluate((v) => window.seek(v), x); return o.page.evaluate(() => getComputedStyle(document.getElementById('lbug-d')).visibility); };
    assert.equal(await shown(timing.scenes[0].start + 0.5), 'hidden');
    assert.equal(await shown(timing.scenes[1].start + 0.5), 'visible');
  } finally {
    await o.browser.close();
  }
});

test('a clip that cannot reach its frame fails the seek; one that settled without a new frame passes', { timeout: 120000 }, async (t) => {
  const dir = folder(t);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', path.join(dir, 'clips', 'a.mp4')], { timeoutMs: 60000 });
  const { file } = write(dir, 'clip', {
    scenes: ['a'],
    body: '<div class="sc fill" id="g-a"><video data-clip="a" data-start="0" data-end="3" src="clips/a.mp4" muted playsinline preload="auto"></video></div>',
  });
  const o = await open(t, file);
  if (!o) return;
  try {
    const seek = (x) => o.page.evaluate((v) => window.seek(v).then(() => 'ok', (e) => e.message), x);
    // No frame callback ever fires, but the seek itself completes: within half a frame, so it passes after the wait.
    await o.page.evaluate(() => { document.querySelector('video').requestVideoFrameCallback = () => 0; });
    assert.equal(await seek(1.5), 'ok');
    // The clip never moves: the seek fails naming the clip.
    await o.page.evaluate(() => { const v = document.querySelector('video'); Object.defineProperty(v, 'currentTime', { get: () => 0, set: () => {} }); });
    assert.match(await seek(2.5), /^Clip a did not reach 2\.50 s within 1\.5 s; prepare the job again$/);
  } finally {
    await o.browser.close();
  }
});

test('an exported page with a 3D model loads its modules and model from file:// and becomes ready', { timeout: 120000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const dir = folder(t);
  copyThree(dir);
  fs.writeFileSync(path.join(dir, 'assets', 'model.glb'), sampleGlb());
  // The model canvas the explainer's model scene draws; page() then writes the import map and the module.
  const script = { lang: 'en', scenes: [{ id: 'a', kind: 'x', vo: 'A short line for this scene to say.' }] };
  const timing = estimateTiming(script, TIMING, 'en');
  const html = page({ brand: BRAND, script, timing, size: SIZE, title: 'm', particles: false, scenes: [{ id: 'a', kind: 'x' }], js: 'const KINDS = {};', css: '.m3c{width:400px;height:400px}', body: `<div class="sc fill" id="g-a">${modelCanvas('model.glb', timing.scenes[0], 'turn')}</div>` });
  assert.ok(html.includes('type="importmap"'));
  const out = path.join(dir, 'video.html');
  fs.writeFileSync(out, inlinePage(html, dir));
  assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /\.\/vendor\/|src="vendor\/|data-model="assets\//);
  // Move it away from its folder: nothing may be fetched from beside it.
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-fixlone-'));
  t.after(() => fs.rmSync(lone, { recursive: true, force: true }));
  fs.copyFileSync(out, path.join(lone, 'video.html'));
  let browser;
  try { browser = await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const pg = await browser.newPage({ viewport: SIZE });
    const errors = [];
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.goto(pathToFileURL(path.join(lone, 'video.html')).href);
    await pg.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => { throw new Error(`never ready: ${errors.join(' | ')}`); });
    assert.deepEqual(errors, []);
    assert.equal(await pg.evaluate(() => typeof window.__drawModels), 'function');
  } finally {
    await browser.close();
  }
});
