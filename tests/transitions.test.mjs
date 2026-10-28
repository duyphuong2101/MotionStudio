import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { ffmpeg, openComposition } from '../engine/media.mjs';
import { sampleScript } from '../engine/template-preview.mjs';

// Real Chrome, frames walked forward as the renderer does: a scene switch never shows two scenes at once, and an
// element that enters later in its scene is not visible before its entrance (the kit's preset).
const require = createRequire(import.meta.url);
const GSAP_DIST = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
const VENDOR = ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js'];
const BRAND = { name: 'Hash Co', logoText: 'Hash', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
const cfg = loadStudioConfig();

async function chromeOrSkip(t) {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); return true; } catch { t.skip('Chrome is not available'); return false; }
}

/** Builds a template's sample page into a temp folder and opens it; `walk(t)` seeks forward frame by frame. */
async function openSample(t, id, format) {
  const { dir, beats } = loadTemplate(id);
  // The sample without footage or a 3D model: a clip needs prepare, a model three.js; a photo is drawn here.
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((sl) => ({ ...sl, kind: sl.kind.filter((k) => k !== 'video' && k !== 'model' && k !== 'anim') })) });
  const timing = estimateTiming(script, TIMING, 'en', beats.pace || null);
  const size = sizeFor(beats, format);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-transition-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'vendor'));
  fs.mkdirSync(path.join(tmp, 'assets'));
  for (const f of VENDOR) fs.copyFileSync(path.join(GSAP_DIST, f), path.join(tmp, 'vendor', f));
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x2b5fb3:s=320x180', '-frames:v', '1', '-q:v', '5', path.join(tmp, 'assets', 'photo.jpg')], { timeoutMs: 30000 });
  fs.writeFileSync(path.join(tmp, 'index.html'), build({ brief: { format }, brand: BRAND, script, timing, size }), 'utf8');
  const { browser, page } = await openComposition(path.join(tmp, 'index.html'), { channel: cfg.engine.chromeChannel, ...size });
  t.after(() => browser.close());
  let at = 0;
  const walk = async (to) => {
    for (; at < to - 1e-6; at = Math.round((at + 1 / 30) * 1e6) / 1e6) await page.evaluate((x) => window.seek(x), at);
    await page.evaluate((x) => window.seek(x), to);
  };
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.sc')].filter((g) => getComputedStyle(g).visibility === 'visible' && +getComputedStyle(g).opacity > 0.01).map((g) => g.id));
  const opacity = (sel) => page.evaluate((s) => +getComputedStyle(document.querySelector(s)).opacity, sel);
  return { timing, walk, shown, opacity };
}

test('a scene switch never shows two scenes at once, and late elements stay hidden until they enter', { timeout: 120000 }, async (t) => {
  if (!(await chromeOrSkip(t))) return;
  const { timing, walk, shown, opacity } = await openSample(t, 'explainer', '16:9');
  const [a, b] = timing.scenes;
  await walk(0);
  assert.equal(await opacity(`#g-${a.id} .tt`), 0, 'the first title is hidden at t = 0, before its entrance');
  await walk(a.end - 0.02);
  assert.deepEqual(await shown(), [`g-${a.id}`], 'just before the switch only the old scene shows');
  await walk(b.start + 0.02);
  assert.deepEqual(await shown(), [`g-${b.id}`], 'just after the switch only the new scene shows');
  assert.equal(await opacity(`#g-${b.id} .stt`), 0, 'the step title waits for its own entrance');
  await walk(b.start + 1.2);
  assert.equal(await opacity(`#g-${b.id} .stt`), 1, 'and then it is in');
});

test('a pre-roll before the first scene does not delay the whole video', { timeout: 120000 }, async (t) => {
  if (!(await chromeOrSkip(t))) return;
  // The lifestyle photo starts its camera move 0.35 s before its scene; at t = 0 that is simply under way.
  const { timing, walk, shown } = await openSample(t, 'lifestyle', '9:16');
  const [a, b] = timing.scenes;
  await walk(0.1);
  assert.deepEqual(await shown(), [`g-${a.id}`], 'the first scene shows from the start');
  await walk(a.end - 0.02);
  assert.deepEqual(await shown(), [`g-${a.id}`]);
  await walk(b.start + 0.02);
  assert.deepEqual(await shown(), [`g-${b.id}`], 'the switch lands on the scene boundary');
});
