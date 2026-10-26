// Hero banner export: one standalone HTML page, a full-bleed WebGL backdrop from templates/gl.mjs in the brand colours
// with an optional centred headline, subline and button, for a website hero. A web page, not a render: a
// requestAnimationFrame clock moves it (the shaders' noise is a fixed hash, the 3D shapes are seeded). Written to
// out/<project>/_banner/; "_banner" can never be a job or sequence id (ID_RE starts with a-z or 0-9). No model, no
// network, no child process.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, StudioError, assertId, within, exists, round, escapeHtml as h, jsonForScript } from './core.mjs';
import { BACKDROPS } from './brand.mjs';
import { loadBrand, profileDir } from './jobs.mjs';
import { checkBrand, geometry } from '../templates/kit.mjs';
import { glData, glJs, SCALE } from '../templates/gl.mjs';

export const BANNER_BACKDROPS = BACKDROPS;
export const BANNER_SIZES = ['1920x600', '1920x1080', '1440x480', '1080x1080'];
export const BANNER_LIMITS = { headline: 60, subline: 120, button: 24 };
const LABELS = { headline: 'Headline', subline: 'Subline', button: 'Button text' };
const BANNER_DIR = '_banner';
const BANNER_FILE = new RegExp(`^(${BACKDROPS.join('|')})-\\d{3,4}x\\d{3,4}\\.html$`);

// Type on the 1080 short side of the chosen size, scaled with the banner's width; never below the floor in px.
const TYPE = { headline: 96, subline: 36, button: 30, gap: 28 };
const FLOOR_PX = { headline: 28, subline: 15, button: 14 };
// With text, a banner keeps this height however narrow it gets (a 1920x600 banner on a phone is 117 px tall).
const TEXT_MIN_HEIGHT = 320;
const TEXT_WIDTH = { headline: '72%', subline: '60%', narrow: '90%' };
// Clock start (s), DPR cap, longest step after a hidden tab (s), parallax travel (px), pointer ease per frame, text drift.
const CLOCK = { start: 6, maxDpr: 2, maxStep: 0.1 };
const PARALLAX = { shift: 16, ease: 0.06, text: 0.35 };

/** "1920x600" → { width, height }; any other shape is a 400. */
export function parseBannerSize(value) {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(String(value ?? ''));
  if (!m) throw new StudioError(`Size must be one of ${BANNER_SIZES.join(', ')}`, 400);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function textLine(value, key) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new StudioError(`${LABELS[key]} must be text`, 400);
  const s = value.replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  if (n > BANNER_LIMITS[key]) throw new StudioError(`${LABELS[key]} holds at most ${BANNER_LIMITS[key]} characters (${n} given)`, 400);
  return s;
}

/** The checked options: backdrop (the brand's, else mesh), a listed size, trimmed text within its cap, parallax. */
function bannerOptions(brand, opts) {
  const backdrop = opts.backdrop || (BACKDROPS.includes(brand.backdrop) ? brand.backdrop : 'mesh');
  if (!BACKDROPS.includes(backdrop)) throw new StudioError(`Backdrop must be one of ${BACKDROPS.join(', ')}`, 400);
  const { width, height } = opts.width == null && opts.height == null ? parseBannerSize(BANNER_SIZES[0]) : opts;
  if (!BANNER_SIZES.includes(`${width}x${height}`)) throw new StudioError(`Size must be one of ${BANNER_SIZES.join(', ')}`, 400);
  if (opts.parallax != null && typeof opts.parallax !== 'boolean') throw new StudioError('Parallax must be true or false', 400);
  return {
    backdrop, width, height, parallax: opts.parallax === true,
    headline: textLine(opts.headline, 'headline'), subline: textLine(opts.subline, 'subline'), button: textLine(opts.button, 'button'),
  };
}

/** One self-contained HTML page: the backdrop canvas, the optional text layer and the inline script that drives both. */
export function buildBanner(brand, opts = {}) {
  const o = bannerOptions(brand, opts);
  const { c, f } = checkBrand(brand);
  const { W, U } = geometry({ width: o.width, height: o.height });
  const cq = (n) => `${round((n * U * 100) / W, 3)}cqw`;
  const size = (k) => `max(${cq(TYPE[k])},${FLOOR_PX[k]}px)`;
  const L = { backdrop: o.backdrop, wipe: null };
  const hasText = Boolean(o.headline || o.subline || o.button);
  const shift = o.parallax ? PARALLAX.shift : 0;
  const fontsLink = hasText && f.googleFonts ? `\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${h(f.googleFonts)}&amp;display=swap">` : '';
  const text = hasText ? `<div class="hb-text" id="hb-text">${o.headline ? `<h1 class="hb-h">${h(o.headline)}</h1>` : ''}${o.subline ? `<p class="hb-s">${h(o.subline)}</p>` : ''}${o.button ? `<a class="hb-b" href="#">${h(o.button)}</a>` : ''}</div>` : '';
  return `<!doctype html>
<html lang="${h(brand.voice?.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(brand.name)} hero banner</title>${fontsLink}
<style>
html,body{margin:0;height:100%;background:${c.bg}}
.hb{position:relative;overflow:hidden;width:100%;height:100%;aspect-ratio:${o.width}/${o.height};container-type:inline-size;background:${c.bg};color:${c.ink}${hasText ? `;min-height:${TEXT_MIN_HEIGHT}px` : ''}}
.hb canvas{position:absolute;left:${-shift}px;top:${-shift}px;width:calc(100% + ${2 * shift}px);height:calc(100% + ${2 * shift}px);display:block;pointer-events:none}
.hb-text{position:relative;z-index:1;box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${cq(TYPE.gap)};text-align:center}
.hb-h{margin:0;max-width:${TEXT_WIDTH.headline};font:700 ${size('headline')}/1.1 "${f.display}",system-ui,sans-serif;text-wrap:balance}
.hb-s{margin:0;max-width:${TEXT_WIDTH.subline};font:400 ${size('subline')}/1.4 "${f.body}",system-ui,sans-serif;color:${c.muted};text-wrap:balance}
.hb-b{display:inline-block;padding:.75em 1.6em;border-radius:999px;background:${c.primary};color:${c.onPrimary};font:600 ${size('button')}/1 "${f.body}",system-ui,sans-serif;text-decoration:none}
@media (max-width:600px){.hb-h,.hb-s{max-width:${TEXT_WIDTH.narrow}}}
</style>
</head>
<body>
<div class="hb" id="hb"><canvas id="glb" data-gl aria-hidden="true"></canvas>${text}</div>
<script>
(() => {
const D = { gl: ${jsonForScript(glData(L, c))} }, $ = (id) => document.getElementById(id);
const K = ${SCALE[o.backdrop]}, T0 = ${CLOCK.start}, MAX_DPR = ${CLOCK.maxDpr}, MAX_STEP = ${CLOCK.maxStep}, REBUILD = ${o.backdrop === 'shapes'};
const SHIFT = ${shift}, EASE = ${PARALLAX.ease}, TEXT_DRIFT = ${PARALLAX.text};
const box = $('hb'), words = $('hb-text'), still = matchMedia('(prefers-reduced-motion: reduce)');
function make() {${glJs(L)}
  return GL;
}
let GL = null, dead = false, t = T0, last = null, raf = 0, seen = true, px = 0, py = 0, tx = 0, ty = 0;
// The canvas draws at K of its CSS size (DPR capped) and is scaled up, as in a video.
function fit() {
  let cv = $('glb');
  const k = Math.min(window.devicePixelRatio || 1, MAX_DPR) * K, w = Math.max(1, Math.round(cv.clientWidth * k)), ht = Math.max(1, Math.round(cv.clientHeight * k));
  if (GL && cv.width === w && cv.height === ht) return;
  // The 3D shapes fix their projection to the canvas shape when built: a new shape gets a new canvas and context.
  if (GL && REBUILD) {
    const old = cv;
    cv = old.cloneNode(false);
    const lose = old.getContext('webgl')?.getExtension('WEBGL_lose_context');
    old.replaceWith(cv);
    if (lose) lose.loseContext();
    GL = null;
  }
  cv.width = w; cv.height = ht;
  if (!GL) GL = make();
}
function draw() {
  if (!GL) return;
  if (SHIFT) {
    px += (tx - px) * EASE; py += (ty - py) * EASE;
    $('glb').style.transform = 'translate(' + px * SHIFT + 'px,' + py * SHIFT + 'px)';
    if (words) words.style.transform = 'translate(' + -px * SHIFT * TEXT_DRIFT + 'px,' + -py * SHIFT * TEXT_DRIFT + 'px)';
  }
  GL.draw(t);
}
function frame(now) {
  raf = 0;
  if (dead) return;
  if (last !== null) t += Math.min((now - last) / 1000, MAX_STEP);
  last = now;
  draw();
  if (!still.matches && seen) raf = requestAnimationFrame(frame);
}
function play() { if (!raf) { last = null; raf = requestAnimationFrame(frame); } }
// Reduced motion: one still frame, redrawn only when the size changes.
function resize() {
  if (dead) return;
  try { fit(); } catch (err) { dead = true; box.dataset.gl = 'off'; console.warn('Hero banner: ' + err.message); return; }
  if (still.matches) px = py = tx = ty = 0;
  draw();
  if (!still.matches && seen) play();
}
new ResizeObserver(resize).observe(box);
new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; if (seen && !still.matches && GL) play(); }).observe(box);
still.addEventListener('change', resize);
if (SHIFT) addEventListener('pointermove', (e) => {
  if (still.matches) return;
  const r = box.getBoundingClientRect(), clamp = (v) => Math.max(-1, Math.min(1, v));
  tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1); ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
}, { passive: true });
})();
</script>
</body>
</html>
`;
}

/** The path of one banner file of a project; a name that is not "<backdrop>-<w>x<h>.html" is a 404. */
export function bannerFile(project, name) {
  if (!BANNER_FILE.test(String(name ?? ''))) throw new StudioError('No such banner file', 404);
  return within(DIRS.out, assertId(project, 'project'), BANNER_DIR, name);
}

/** Builds the project's banner and writes out/<project>/_banner/<backdrop>-<w>x<h>.html (temp file + rename); returns its path. */
export function writeBanner(project, opts = {}) {
  assertId(project, 'project');
  if (!exists(within(profileDir(project), 'brand.json'))) throw new StudioError(`Project ${project} has no brand: create the project first`, 404);
  const brand = loadBrand(project);
  const o = bannerOptions(brand, opts);
  const file = bannerFile(project, `${o.backdrop}-${o.width}x${o.height}.html`);
  const html = buildBanner(brand, o);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, html, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}
