// Parallel frame capture: N copies of the composition, each in its own headless Chrome (tabs of one Chrome take
// screenshots one at a time), seek and screenshot one contiguous run of frames into their own ffmpeg segment;
// the segments are joined without re-encoding. Safe because a template is a pure function of seek(t)
// (playcheck's jump check holds every template to that).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError, jsonForScript } from './core.mjs';
import { ffmpeg, writeAsync, openComposition, mediaTimeoutMs } from './media.mjs';

export const MAX_WORKERS = 8;
// Prepare cuts every clip to this rate, so frame k of clips/<clip>.mp4 starts at k / CLIP_FPS.
export const CLIP_FPS = 30;
export const CLIP_FRAMES_DIR = 'frames';
const CLIP_RE = /^([a-z0-9-]+)\.mp4$/;
// Clips are BT.709 TV range; a JPEG is read by Chrome as BT.601 full range (JFIF). Without this the frames come out
// greener and lighter than the same clip played as <video> (#22a35a measured as #2bb358).
export const JPEG_FROM_BT709_VF = 'scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc';

// Injected into a page at render time, after its markup and before its scripts (the page file is never changed).
// Each clips/<clip>.mp4 <video> becomes an <img class="clipframe"> with the same id, classes and data that answers
// the video calls the templates make; every CSS rule for `video` is copied to it. A clip the kit seeks by
// data-start/data-end (it looks for video[data-clip], which no longer matches) is seeked here after each seek(t),
// with the kit's rule. `CF` is { fps, clips: { <clip>: <frame count> } }.
const CLIP_FRAMES_JS = `
window.__frameErrors = [];
((CF) => {
  const OWN = [];
  for (const v of document.querySelectorAll('video[src^="clips/"]')) {
    const id = decodeURIComponent(v.getAttribute('src').slice(6, -4)), n = CF.clips[id];
    if (!n) continue;
    const im = document.createElement('img');
    for (const a of v.attributes) if (!['src', 'muted', 'playsinline', 'preload'].includes(a.name)) im.setAttribute(a.name, a.value);
    im.classList.add('clipframe');
    im.alt = '';
    let at = 0, shown = -1, ready = null;
    const show = (k) => {
      if (k === shown) return;
      shown = k;
      im.src = 'frames/' + encodeURIComponent(id) + '/' + String(k + 1).padStart(5, '0') + '.jpg';
      ready = im.decode().catch(() => { if (shown === k) window.__frameErrors.push('clip ' + id + ' frame ' + (k + 1) + ' could not be shown'); });
    };
    Object.defineProperties(im, {
      duration: { value: n / CF.fps }, readyState: { value: 4 }, seeking: { value: false },
      // A video shows the last frame that starts at or before currentTime.
      currentTime: { get: () => at, set: (x) => { at = Math.max(0, +x || 0); show(Math.min(n - 1, Math.floor(at * CF.fps + 1e-6))); } },
      // Read after the caller's currentTime write in the same task, so it waits for the new frame.
      requestVideoFrameCallback: { value: (cb) => { Promise.resolve().then(() => ready).then(() => cb(performance.now(), {})); return 0; } },
      __shown: { value: () => ready },
    });
    show(0);
    v.replaceWith(im);
    if (im.dataset.clip) OWN.push(im);
  }
  const VIDEO = /(^|[\\s>+~,(])video\\b/g, css = ['img.clipframe{object-fit:contain}'];
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = [...sh.cssRules]; } catch { continue; }
    for (const r of rules) {
      const sel = r.selectorText ? r.selectorText.replace(VIDEO, '$1img.clipframe') : null;
      if (sel && sel !== r.selectorText) css.push(sel + '{' + r.style.cssText + '}');
    }
  }
  const st = document.createElement('style');
  st.textContent = css.join('\\n');
  document.head.appendChild(st);
  if (!OWN.length) return;
  // The kit's clip rule: a clip plays from its scene start and holds its last frame if the scene runs longer.
  const own = (t) => Promise.all(OWN.filter((im) => t >= +im.dataset.start - 0.4 && t <= +im.dataset.end + 0.4).map((im) => {
    im.currentTime = Math.min(Math.max(t - +im.dataset.start, 0), Math.max(0, im.duration - 0.04)) + 0.001;
    return im.__shown();
  }));
  let inner = null;
  const seek = (t) => {
    const d = window.__studio ? window.__studio.duration : Infinity, x = Math.min(Math.max(+t || 0, 0), d);
    return Promise.resolve(inner(t)).then((r) => own(x).then(() => r));
  };
  Object.defineProperty(window, 'seek', { configurable: true, get: () => inner && seek, set: (fn) => { inner = fn; } });
})`;

/**
 * Cuts each clips/<clip>.mp4 of a job folder into frames/<clip>/00001.jpg… for a render (Remotion and HyperFrames
 * do the same rather than seek a <video> per frame). Returns the script openComposition injects, '' without clips.
 * No clip runs longer than the video, so `seconds` (its length) sizes each ffmpeg timeout. The caller removes `frames/`
 * when the render ends.
 */
export async function cutClipFrames(dir, seconds, engine) {
  const clipsDir = path.join(dir, 'clips');
  const ids = fs.existsSync(clipsDir) ? fs.readdirSync(clipsDir).map((f) => CLIP_RE.exec(f)?.[1]).filter(Boolean).sort() : [];
  if (!ids.length) return '';
  const clips = {};
  for (const id of ids) {
    const out = path.join(dir, CLIP_FRAMES_DIR, id);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(clipsDir, `${id}.mp4`);
    await ffmpeg(['-y', '-i', file, '-an', '-vf', `fps=${CLIP_FPS},${JPEG_FROM_BT709_VF}`, '-q:v', '2', '-start_number', '1', path.join(out, '%05d.jpg')],
      { timeoutMs: mediaTimeoutMs(seconds, engine) });
    const n = fs.readdirSync(out).length;
    if (!n) throw new StudioError(`Clip ${id} has no frames: prepare the job again`);
    clips[id] = n;
  }
  return `${CLIP_FRAMES_JS}(${jsonForScript({ fps: CLIP_FPS, clips })});`;
}

/** Opens `count` copies of the composition, one Chrome each. Returns { pages, info, close }. */
export async function openWorkers(file, { count = 1, ...opts }) {
  const opened = await Promise.allSettled(Array.from({ length: Math.max(1, count) }, () => openComposition(file, opts)));
  const ok = opened.filter((o) => o.status === 'fulfilled').map((o) => o.value);
  const close = () => Promise.all(ok.map((o) => o.browser.close().catch(() => {})));
  const failed = opened.find((o) => o.status === 'rejected');
  if (failed) { await close(); throw failed.reason; }
  return { pages: ok.map((o) => o.page), info: ok[0].info, close };
}

/**
 * How many Chromes render one video: `concurrency` from config (default 4, 1..MAX_WORKERS), at most half the CPU
 * threads, and at least one second of video each so a short sting stays in one.
 */
export function renderWorkers(concurrency, frames, fps, cpus = os.cpus().length) {
  const asked = Number.isInteger(concurrency) ? concurrency : 4;
  return Math.max(1, Math.min(asked, MAX_WORKERS, Math.floor(cpus / 2), Math.floor(frames / fps)));
}

/** Splits frames [0, frames) into `workers` contiguous runs of near-equal length, in order. */
export function splitFrames(frames, workers) {
  const n = Math.max(1, Math.min(workers, frames));
  const out = [];
  for (let i = 0; i < n; i++) {
    const from = Math.round((i * frames) / n), to = Math.round(((i + 1) * frames) / n);
    if (to > from) out.push({ from, to });
  }
  return out;
}

/**
 * Renders `frames` frames from the open `pages` into `out`. `input` is the image2pipe codec ('mjpeg' or 'png'),
 * `encode(file)` the ffmpeg output arguments, `filterArgs` the `-vf` chain (sub-frame blur, colour). `onFrame()` runs once per frame.
 */
export async function renderFrames(pages, { frames, fps, sub = 1, shutter = 0.5, shoot, input, filterArgs = [], encode, out, timeoutMs, onFrame = () => {} }) {
  const ranges = splitFrames(frames, pages.length);
  if (!ranges.length) throw new StudioError('Nothing to render: the composition is 0 frames long');
  let stop = null;
  const one = (page, { from, to }, file) => ffmpeg(
    ['-y', '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', input, '-i', '-', ...filterArgs, ...encode(file)],
    {
      timeoutMs,
      onStdin: async (stdin) => {
        for (let f = from; f < to; f++) {
          for (let k = 0; k < sub; k++) {
            if (stop) throw stop;
            const t = sub === 1 ? f / fps : Math.max(0, (f + shutter * ((k + 0.5) / sub - 0.5)) / fps);
            await page.evaluate((x) => window.seek(x), t);
            await writeAsync(stdin, await shoot(page));
          }
          onFrame();
        }
        stdin.end();
      },
    },
  ).catch((err) => { stop ||= err; throw err; });
  if (ranges.length === 1) return one(pages[0], ranges[0], out);

  const ext = path.extname(out);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-frames-'));
  try {
    const segs = ranges.map((_, i) => `seg-${i}${ext}`);
    const settled = await Promise.allSettled(ranges.map((r, i) => one(pages[i], r, path.join(tmp, segs[i]))));
    if (stop) throw stop;
    if (settled.some((s) => s.status === 'rejected')) throw settled.find((s) => s.status === 'rejected').reason;
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, segs.map((s) => `file '${s}'\n`).join(''));
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(ext === '.mp4' ? ['-movflags', '+faststart'] : []), out], { timeoutMs });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
