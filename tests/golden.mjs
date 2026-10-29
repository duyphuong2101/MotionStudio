// Golden frames: every built-in template's sample (sampleScript from engine/template-preview.mjs, estimated timing, no
// voice) in one fixed test brand, three frames each in 16:9 and 9:16, kept as small grey PNGs in tests/golden/ and
// compared by ffmpeg's ssim filter in tests/golden.test.mjs.
//
//   node tests/golden.mjs --update                    rewrite every reference (stale ones are removed)
//   node tests/golden.mjs --update explainer promo    rewrite these templates only
//
// Each frame is a full-size screenshot of the page (the layout is the real one), scaled by ffmpeg to LONG_SIDE px on
// its long side and turned grey: the suite looks for layout and type drift, and luma alone shows it at a fraction of
// the size. The brand uses Arial with no Google Fonts, so no frame depends on the network; a WebGL page draws on
// SwiftShader (openComposition) and clips are cut into frames as a render does (cutClipFrames).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { listTemplates, loadTemplate, cutSlug } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { ffmpeg, ffmpegReport, openComposition } from '../engine/media.mjs';
import { cutClipFrames } from '../engine/frames.mjs';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

export const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url));
export const FORMATS = ['16:9', '9:16'];
export const FRAMES = 3;
export const LONG_SIDE = 480;
// Two runs of the same page on one machine give 1.0000 for every template (measured 2026-10-29), and another
// template's frame in place of a reference still scored 0.947 (mostly the same pale background), so 0.97 let real
// drift through. The small margin left is for antialiasing and SwiftShader rounding on single edge pixels.
// The test prints its lowest score per template (t.diagnostic).
export const THRESHOLD = 0.99;
// "Just after the first cut": far enough in that the new scene has started to come in.
const CUT_AFTER = 0.25;
const FFMPEG_MS = 30000;

export const BRAND = {
  name: 'Golden Co', logo: null, logoDark: null, logoText: 'Golden', site: '',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Arial', body: 'Arial', googleFonts: '' },
  voice: { tts: 'none', voice: '', speed: 1, lang: 'en' }, music: { file: null, gainDb: -18 }, sources: { allowedHosts: [] },
};
// Fixed rather than config/studio.json → timing, so a config change does not move every frame.
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };

/** Every { template, format } the suite covers, in id order; `only` limits it to those template ids. */
export function goldenCases(only = []) {
  const ids = listTemplates().map((b) => b.id).sort();
  const unknown = only.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`Unknown template: ${unknown.join(', ')}`);
  return ids.filter((id) => !only.length || only.includes(id)).flatMap((template) => {
    const { beats } = loadTemplate(template);
    return FORMATS.filter((f) => beats.formats.includes(f)).map((format) => ({ template, format }));
  });
}

export const goldenName = (c, n) => `${c.template}-${cutSlug(c.format)}-${n}.png`;

/** The middle of the first two scenes and just after the first cut, in time order (a quarter, half and three quarters of a one-scene video). */
export function frameTimes(timing) {
  const [a, b] = timing.scenes;
  const mid = (s) => (s.start + s.end) / 2;
  const times = b ? [mid(a), Math.min(b.start + CUT_AFTER, mid(b)), mid(b)] : [0.25, 0.5, 0.75].map((k) => k * timing.duration);
  return times.map((t) => Math.round(t * 1000) / 1000).sort((x, y) => x - y);
}

/** Writes one case's page into the Chrome folder and cuts its clips into frames. Returns what openComposition needs. */
export async function prepareCase(folder, c) {
  const { dir: tplDir, beats } = loadTemplate(c.template);
  const script = sampleScript(beats);
  const timing = estimateTiming(script, TIMING, 'en', beats.pace || null);
  const size = sizeFor(beats, c.format);
  const { build } = await import(pathToFileURL(path.join(tplDir, 'template.mjs')).href);
  // Only this page's clips: cutClipFrames cuts every clip in clips/.
  fs.rmSync(path.join(folder.dir, 'clips'), { recursive: true, force: true });
  fs.mkdirSync(path.join(folder.dir, 'clips'));
  const file = folder.write('index.html', build({ brief: { format: c.format }, brand: BRAND, script, timing, size, icons: {} }));
  return { file, size, inject: await cutClipFrames(folder.dir, timing.duration), times: frameTimes(timing) };
}

/** Runs in the page after a seek: fonts, pending images and any <video> still seeking settle, then one painted frame. */
function settle() {
  const videos = [...document.querySelectorAll('video')].filter((v) => v.seeking || v.readyState < 2).map((v) => new Promise((done) => {
    v.addEventListener('seeked', done, { once: true });
    v.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 3000);
  }));
  const images = [...document.images].filter((im) => !im.complete).map((im) => im.decode().catch(() => {}));
  return Promise.all([document.fonts.ready, ...videos, ...images]).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Seeks each time and writes a LONG_SIDE grey PNG of the page per frame into `outDir`. Returns [{ n, t, file }]. */
export async function shootFrames(page, c, times, size, outDir) {
  const k = LONG_SIDE / Math.max(size.width, size.height);
  const even = (v) => Math.max(2, Math.round((v * k) / 2) * 2);
  const out = [];
  for (const [i, t] of times.entries()) {
    await page.evaluate((x) => window.seek(x), t);
    await page.evaluate(settle);
    const file = path.join(outDir, goldenName(c, i + 1));
    const full = file.replace(/\.png$/, '.full.png');
    await page.screenshot({ path: full, type: 'png' });
    try {
      await ffmpeg(['-y', '-i', full, '-vf', `scale=${even(size.width)}:${even(size.height)}:flags=area,format=gray`, '-frames:v', '1', file], { timeoutMs: FFMPEG_MS });
    } finally {
      fs.rmSync(full, { force: true });
    }
    out.push({ n: i + 1, t, file });
  }
  return out;
}

/** ffmpeg's SSIM ("All") of two images of one size: 1 when they are the same. */
export async function ssim(a, b) {
  const log = await ffmpegReport(['-i', a, '-i', b, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-'], { timeoutMs: FFMPEG_MS });
  const m = /SSIM [^\n]*All:([\d.]+)/.exec(log);
  if (!m) throw new Error(`ffmpeg printed no SSIM: ${log.slice(-300)}`);
  return Number(m[1]);
}

/** --update: writes the references of `only` (every template when empty) into tests/golden/. */
async function update(only) {
  const cfg = loadStudioConfig();
  if (!(await hasChrome(cfg.engine.chromeChannel))) throw new Error('Chrome is not available: golden frames need the configured Chrome');
  const cases = goldenCases(only);
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  if (!only.length) for (const f of fs.readdirSync(GOLDEN_DIR)) if (f.endsWith('.png')) fs.rmSync(path.join(GOLDEN_DIR, f));
  const cleanups = [];
  const folder = await chromeFolder({ after: (fn) => cleanups.push(fn) }, 'ms-golden-');
  let bytes = 0, count = 0;
  try {
    for (const c of cases) {
      const p = await prepareCase(folder, c);
      const { browser, page } = await openComposition(p.file, { channel: cfg.engine.chromeChannel, ...p.size, inject: p.inject });
      try {
        for (const f of await shootFrames(page, c, p.times, p.size, GOLDEN_DIR)) {
          const b = fs.statSync(f.file).size;
          bytes += b; count++;
          console.log(`${path.basename(f.file)}  t=${f.t} s  ${Math.round(b / 1024)} KB`);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    for (const fn of cleanups) fn();
  }
  const total = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.png')).reduce((a, f) => a + fs.statSync(path.join(GOLDEN_DIR, f)).size, 0);
  console.log(`${count} frame(s) written, ${(bytes / 1048576).toFixed(2)} MB; tests/golden/ holds ${(total / 1048576).toFixed(2)} MB`);
}

const self = fileURLToPath(import.meta.url).toLowerCase();
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self) {
  const [mode, ...only] = process.argv.slice(2);
  if (mode !== '--update') {
    console.log('Usage: node tests/golden.mjs --update [template...]');
    process.exitCode = 1;
  } else {
    update(only).catch((err) => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
  }
}
