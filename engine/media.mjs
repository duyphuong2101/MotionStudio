import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { StudioError, keyFreeEnv, loadStudioConfig } from './core.mjs';

const STDERR_CAP = 64 * 1024;
const TASKKILL_TIMEOUT_MS = 10000;
// Full path: a bare name could resolve to a taskkill.exe in the working folder first.
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
// ffmpeg work on media `s` seconds long gets MEDIA_TIMEOUT.perSecond × s, at least `floor`, at most the engine's run timeout.
// config/studio.json → engine.ffmpegMinSeconds / engine.ffmpegSecondsPerMediaSecond override the defaults.
// The floor catches a hung ffmpeg, not a slow one: a machine busy building previews took over 60 s on a short clip.
const MEDIA_TIMEOUT = { floor: 180, perSecond: 10 };
const runCeilingMs = (engine) => (Number(engine?.runTimeoutMinutes) || 15) * 60000;

// Players read HD video as BT.709, but ffmpeg turns screenshots (RGB, JPEG) and lavfi colour sources into YUV with
// BT.601 unless told: brand colours came out shifted (#22a35a played back as 25 146 89). BT709_VF converts those;
// a YUV clip only gets BT709_TAGS, since scale reads an untagged clip as BT.601 and would shift it instead.
export const BT709_VF = 'scale=out_color_matrix=bt709:out_range=tv';
export const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

/** A timeout (ms) for ffmpeg work on `seconds` of media, scaled with its length and capped by the engine's run timeout. */
export function mediaTimeoutMs(seconds, engine = loadStudioConfig().engine) {
  const floor = (Number(engine?.ffmpegMinSeconds) || MEDIA_TIMEOUT.floor) * 1000;
  const per = (Number(engine?.ffmpegSecondsPerMediaSecond) || MEDIA_TIMEOUT.perSecond) * 1000;
  const scaled = Math.max(floor, Math.ceil((Number(seconds) || 0) * per));
  return Math.min(scaled, Math.max(floor, runCeilingMs(engine)));
}

/** Stops a child and everything it started: on Windows `proc.kill()` leaves grandchildren running, so taskkill /T /F. */
export function killTree(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform !== 'win32' || !proc.pid) { proc.kill('SIGKILL'); return; }
  const tk = spawn(TASKKILL, ['/PID', String(proc.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore', timeout: TASKKILL_TIMEOUT_MS, env: keyFreeEnv() });
  tk.on('error', () => proc.kill());
}

/**
 * Runs ffmpeg with an argument array (never a shell string). Optional stdin stream writer and kill timer; without
 * `timeoutMs` the engine's run timeout applies, so no ffmpeg runs unbounded.
 */
export function ffmpeg(args, { onStdin, timeoutMs } = {}) {
  const limit = timeoutMs || runCeilingMs(loadStudioConfig().engine);
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { shell: false, windowsHide: true, env: keyFreeEnv() });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(proc); }, limit);
    proc.stderr.on('data', (d) => { if (stderr.length < STDERR_CAP) stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new StudioError(`ffmpeg timed out after ${Math.round(limit / 1000)} s`));
      return code === 0 ? resolve() : reject(new StudioError(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 2000)}`));
    });
    // ffmpeg ending early (an error, a timeout) breaks the pipe: an EPIPE with no listener would end the whole process
    // before the caller sets the job to error. The exit code reports the failure instead.
    proc.stdin.on('error', () => {});
    if (onStdin) onStdin(proc.stdin).catch((err) => { killTree(proc); reject(err); });
  });
}

const REPORT_CAP = 512 * 1024;

/** Runs an analysis pass (`-f null -`) and returns ffmpeg's info log. Keeps the tail, where filters print their summary. */
export function ffmpegReport(args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-loglevel', 'info', ...args], { shell: false, windowsHide: true, env: keyFreeEnv() });
    let log = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(proc); }, timeoutMs);
    proc.stderr.on('data', (d) => { log += d.toString(); if (log.length > REPORT_CAP) log = log.slice(-REPORT_CAP); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new StudioError(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)} s`));
      return code === 0 ? resolve(log) : reject(new StudioError(`ffmpeg exited ${code}: ${log.trim().slice(-2000)}`));
    });
  });
}

export function writeAsync(stream, buf) {
  return new Promise((resolve, reject) => {
    if (stream.write(buf)) return resolve();
    const onDrain = () => { stream.off('error', onError); resolve(); };
    const onError = (err) => { stream.off('drain', onDrain); reject(err); };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.mp4': 'video/mp4', '.glb': 'model/gltf-binary',
};

/** Frame size (as decoded: a 90° rotation tag swaps it) and frame rate of the first video stream, or nulls. */
export function videoInfo(report) {
  const line = /Stream #[^\n]*Video:[^\n]*/.exec(report)?.[0] || '';
  const size = /[\s,](\d{2,5})x(\d{2,5})[\s,[]/.exec(line);
  const fps = /(\d+(?:\.\d+)?) fps/.exec(line);
  const turned = /rotation of -?(90|270)\.00 degrees|rotate\s*:\s*-?(90|270)\b/.test(report);
  const [w, h] = size ? [+size[1], +size[2]] : [null, null];
  return { width: turned ? h : w, height: turned ? w : h, fps: fps ? +fps[1] : null };
}

/** Duration and whether an audio stream exists, read from ffmpeg's own report (ffmpeg-static ships no ffprobe). */
export function probeMedia(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', file], { shell: false, windowsHide: true, env: keyFreeEnv() });
    let stderr = '';
    const timer = setTimeout(() => killTree(proc), 20000);
    proc.stderr.on('data', (d) => { if (stderr.length < STDERR_CAP) stderr += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', () => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!m) return reject(new StudioError(`Could not read the length of ${path.basename(file)}`, 400));
      resolve({ duration: +m[1] * 3600 + +m[2] * 60 + +m[3], hasAudio: /Stream #[^\n]*Audio:/.test(stderr), hasVideo: /Stream #[^\n]*Video:/.test(stderr), ...videoInfo(stderr) });
    });
  });
}

// A script injected at render time goes right before the page's first library script, after all of its markup.
const INJECT_BEFORE = '<script src="vendor/gsap.min.js"></script>';

/** Puts `script` into a page's HTML before its scripts; null when the page has no place for it. */
export function injectScript(html, script) {
  const at = html.indexOf(INJECT_BEFORE);
  return at < 0 ? null : `${html.slice(0, at)}<script>\n${script}\n</script>\n${html.slice(at)}`;
}

/**
 * Serves one folder on 127.0.0.1 so the page loads over http (file:// blocks CSS masks and fetches). `page`
 * ({ name, html }) answers that one file name with the given HTML instead of the file.
 */
function serveFolder(dir, page = null) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; } catch { rel = ''; }
      if (rel === 'favicon.ico') { res.writeHead(204).end(); return; }
      if (page && rel === page.name) {
        const body = Buffer.from(page.html, 'utf8');
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': body.length }).end(body);
        return;
      }
      const file = path.resolve(dir, rel);
      if (!rel || !file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const size = fs.statSync(file).size;
      // <video> seeking needs byte ranges.
      const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// A page with a WebGL layer (templates/gl.mjs marks its canvases data-gl) draws on SwiftShader, Chrome's software GPU:
// a real GPU gives other pixels on another machine. Every other page opens as before.
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const usesGl = (html) => /<canvas [^>]*data-gl/.test(html);

/** Opens a composition in headless Chrome. `inject` (a render's script, e.g. clip frames) is served inside the page; the file is never changed. */
export async function openComposition(file, { channel, width = 1080, height = 1920, inject = '' }) {
  // Read the page first: a missing page must not leave the folder server listening.
  const html = fs.readFileSync(file, 'utf8');
  const gl = usesGl(html);
  const served = inject ? injectScript(html, inject) : null;
  if (inject && served === null) throw new StudioError(`${path.basename(file)} has no place for the render script: prepare the job again`, 409);
  const server = await serveFolder(path.dirname(file), served ? { name: path.basename(file), html: served } : null);
  const browser = await chromium.launch({ channel, headless: true, env: keyFreeEnv(), ...(gl ? { args: GL_ARGS } : {}) })
    .catch((err) => { server.close(); throw err; });
  browser.on('disconnected', () => server.close());
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    // A script error fails the open at once: the page would be refused for it anyway, and waiting out the 30 s
    // readiness timeout for a page that threw (a missing 3D part, a bad module) only holds Chrome open.
    let threw;
    const thrown = new Promise((resolve) => { threw = resolve; });
    page.on('pageerror', (e) => { errors.push(e.message); threw(); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${path.basename(file)}`, { waitUntil: 'domcontentloaded' });
    const ready = page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).then(() => true, () => false);
    if (!(await Promise.race([ready, thrown.then(() => false)]))) {
      throw new StudioError(`Composition never became ready. Page errors: ${errors.join(' | ') || 'none'}`);
    }
    if (errors.length) throw new StudioError(`Composition has script errors: ${errors.join(' | ')}`);
    const info = await page.evaluate(() => window.__studio);
    return { browser, page, info, errors };
  } catch (err) {
    await browser.close();
    server.close();
    throw err;
  }
}

/** Runs in the page: every visible [data-lint] element must sit inside the safe area and not overflow. */
export function lintInPage(safe) {
  const W = window.__studio.width, H = window.__studio.height;
  const findings = [];
  const visibleOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  for (const el of document.querySelectorAll('[data-lint]')) {
    if (visibleOpacity(el) < 0.5) continue;
    const r = el.getBoundingClientRect();
    const name = el.id || el.className;
    if (r.left < safe || r.top < safe || r.right > W - safe || r.bottom > H - safe) {
      findings.push({ level: 'error', el: name, msg: `outside the ${safe}px safe area: box ${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}` });
    }
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') {
      findings.push({ level: 'error', el: name, msg: 'text is wider than its box' });
    }
  }
  return findings;
}
