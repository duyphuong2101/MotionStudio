// Shared page shell for the newer renderers: brand tokens, size-aware units, background, voice-synced
// subtitles, scene show/hide, and the seek(t) / __studio / __ready contract the engine renders against.
import { escapeHtml as h, jsonForScript, StudioError } from '../engine/core.mjs';
import { paletteCss } from './shared.mjs';
import { SUBTITLE_STYLES, SUBTITLE_FONTS, motionProfile } from '../engine/brand.mjs';
import { marksToHtml } from '../engine/marks.mjs';
import { glLayers, glBackdropHtml, glWipeHtml, glCss, glData, glJs, cutWindows } from './gl.mjs';
import { hasModels, MODEL_HEAD, MODEL_WAIT, MODEL_JS } from './model3d.mjs';
import { hasLotties, LOTTIE_WAIT, LOTTIE_JS } from './lottie.mjs';

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ]{1,40}$/;
const GF = /^[A-Za-z0-9:;@.,+=&]{0,300}$/;
const FONT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}.(woff2?|ttf|otf)$/i;
const FONT_FORMAT = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
const IMG_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}.(png|jpe?g|webp|svg)$/i;
// A colour whose luminance (0-255) is above this reads as a light surface.
const LIGHT_LUM = 150;

export { h };
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

export function checkBrand(brand) {
  const c = brand.colors || {};
  for (const k of ['primary', 'primary2', 'secondary', 'bg', 'ink', 'muted', 'onPrimary']) {
    if (!HEX.test(c[k] || '')) throw new StudioError(`brand.colors.${k} must be a #rrggbb color`, 400);
  }
  const f = brand.fonts || {};
  if (!FONT.test(f.display || '') || !FONT.test(f.body || '')) throw new StudioError('brand fonts must be plain names', 400);
  if (f.googleFonts && !GF.test(f.googleFonts)) throw new StudioError('brand.fonts.googleFonts has unexpected characters', 400);
  for (const x of f.files || []) {
    if (!FONT.test(x?.family || '') || !FONT_FILE.test(x?.file || '') || !/^[1-9]00$/.test(String(x?.weight ?? 400))) throw new StudioError('brand.fonts.files holds an unusable entry', 400);
  }
  const bs = brand.subtitles;
  if (bs?.style != null) {
    if (!SUBTITLE_STYLES.includes(bs.style) || (bs.font != null && bs.font !== 'brand' && !SUBTITLE_FONTS[bs.font])
      || (bs.size != null && !(bs.size >= 36 && bs.size <= 80)) || (bs.marker != null && !HEX.test(bs.marker))) {
      throw new StudioError('brand.subtitles holds an unknown style, font, size or marker color', 400);
    }
  } else if (bs && (!HEX.test(bs.color || '') || (bs.bg != null && !HEX.test(bs.bg)) || !(bs.size >= 20 && bs.size <= 80) || !/^[1-9]00$/.test(String(bs.weight ?? 400)) || (bs.bgOpacity != null && !(bs.bgOpacity >= 0.1 && bs.bgOpacity <= 1)))) {
    throw new StudioError('brand.subtitles must hold a size, a weight and #rrggbb colors', 400);
  }
  for (const k of ['logo', 'logoDark']) if (brand[k] && !IMG_FILE.test(brand[k])) throw new StudioError(`brand.${k} must be an image asset name`, 400);
  return { c, f };
}

/** @font-face rules for the brand's own font files (licensed fonts that Google Fonts does not serve). */
function fontFaces(f) {
  return (f.files || []).map((x) => {
    const ext = x.file.split('.').pop().toLowerCase();
    return `@font-face{font-family:"${x.family}";src:url("${asset(x.file)}") format("${FONT_FORMAT[ext]}");font-weight:${x.weight ?? 400};font-style:${x.style === 'italic' ? 'italic' : 'normal'};font-display:block}`;
  }).join('\n');
}

/**
 * The brand's fixed corner logo: the light-surface logo and the dark-surface one stacked top-left, one shown
 * per scene. Null without a logo file, on a transparent overlay, or when the brand does not ask for it.
 */
function logoBug(brand, transparent) {
  if (!brand.logoBug || transparent) return null;
  const light = brand.logo || brand.logoDark, dark = brand.logoDark || brand.logo;
  if (!light) return null;
  const img = (id, file) => `<img class="lbug" id="${id}" src="${asset(file)}" alt="${h(brand.name)}">`;
  return `<div id="lbug" aria-hidden="true">${img('lbug-l', light)}${img('lbug-d', dark)}</div>`;
}

/** True when page() draws the corner logo: a scene then leaves out its own logo, so a frame shows the logo once. */
export const hasLogoBug = (brand) => !!logoBug(brand, false);

// The first free line under the corner logo (1080 units): a top-anchored title starts here when the bug shows.
export const UNDER_BUG = 140;

// The content area's bottom over a preset's band is never less than these (the layouts were drawn against them).
const PRESET_AREA = { port: 480, other: 230 };

/**
 * Content area in 1080 units: below the corner logo and above a two-line subtitle band, or above a preset's band
 * (its one caption line at the preset's size in this frame, plus a gap; presetBand).
 */
export const contentArea = (brand, g) => ({
  top: hasLogoBug(brand) ? UNDER_BUG : 100,
  bottom: brand.subtitles?.style ? Math.max(g.port ? PRESET_AREA.port : PRESET_AREA.other, presetBand(brand.subtitles, g).top + BAND_GAP) : g.port ? 300 : 210,
});

/** Optional scene theme: dark (brand primary, the scene is marked dark) or accent (brand secondary, ink text). */
export const themeClass = (sc) => (sc.theme === 'dark' ? ' dark' : sc.theme === 'accent' ? ' acc' : '');
export const ACCENT_CSS = '\n.acc{background:var(--secondary);color:var(--ink)}.acc .kick{color:var(--ink)}';

const LAND_AT = 1.2;
// 4:5 (1.25) stays below this and draws the square layout: same width as 1:1, more height, so it always fits.
const PORT_AT = 1.3;
// A portrait below this (2:3) is shorter than the 9:16 design: `short` shrinks stacked visuals.
const SHORT_BELOW = 1.7;
// A landscape above this (21:9) keeps its content in a centred 16:9 area: `padX` adds the side gutter.
const WIDE_AT = 2;

/** Size helpers: designs are drawn on a 1080 short side and scaled; `land`/`port`/`square` pick layouts. */
export function geometry(size = { width: 1920, height: 1080 }) {
  const W = size.width, H = size.height;
  const U = Math.min(W, H) / 1080;
  const land = W > H * LAND_AT, port = H > W * PORT_AT, wide = W > H * WIDE_AT;
  const gx = wide ? (W - (H * 16) / 9) / 2 : 0;
  return {
    W, H, U, land, port, square: !land && !port, short: port && H < W * SHORT_BELOW,
    px: (n) => `${Math.round(n * U)}px`,
    padX: (n) => `${Math.round(n * U + gx)}px`,
  };
}

export const asset = (name) => `assets/${encodeURIComponent(name)}`;

/** Camera that frames `focus` ({x,y,w,h} in image px) in an image-sized view, clamped so no blank edge shows. */
export function camera(focus, img = { width: 1920, height: 1080 }, maxZoom = 2.4) {
  if (!focus) return { x: 0, y: 0, z: 1 };
  const pad = 1.12;
  const z = Math.min(maxZoom, Math.max(1, Math.min(img.width / (focus.w * pad), img.height / (focus.h * pad))));
  const vw = img.width / z;
  const vh = img.height / z;
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;
  const vx = Math.min(Math.max(cx - vw / 2, 0), img.width - vw);
  const vy = Math.min(Math.max(cy - vh / 2, 0), img.height - vh);
  return { x: Math.round(-vx * z), y: Math.round(-vy * z), z: Math.round(z * 1000) / 1000 };
}
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

// Entrance helpers of the simple shape, one row per motion profile `entrance` (engine/brand.mjs). Eases are JS source.
const ENTRANCE = {
  std: { dy: 40, d: 0.6, ease: 'X', popFrom: 0.6, popEase: "'back.out(1.7)'", popD: 0.55, countEase: "'power2.out'", countK: 1 },
  // Short, sharp moves with no overshoot and no blur.
  clean: { dy: 24, d: 0.35, ease: "'power2.out'", popFrom: 0.96, popEase: "'power2.out'", popD: 0.3, countEase: "'power2.out'", countK: 1 },
  // Big, fast, overshooting moves; numbers race to their value.
  kinetic: { dy: 60, d: 0.45, ease: "'back.out(1.8)'", popFrom: 0.4, popEase: "'back.out(2.2)'", popD: 0.45, countEase: "'expo.out'", countK: 0.6 },
  // Long, soft settles on an expo ease, so the drift of the layers reads.
  parallax: { dy: 30, d: 1.1, ease: "'expo.out'", popFrom: 0.94, popEase: "'expo.out'", popD: 1.0, countEase: "'expo.out'", countK: 1.2 },
};
const entranceJs = (p) => `const fadeUp = (el, at, o = {}) => { if (!el) return; tl.fromTo(el, { y: (o.y ?? ${p.dy}) * U, opacity: 0 }, { y: 0, opacity: 1, duration: o.d ?? ${p.d}, ease: o.ease || ${p.ease}, immediateRender: false }, at); };
const pop = (el, at, o = {}) => { if (!el) return; tl.fromTo(el, { scale: o.from ?? ${p.popFrom}, opacity: 0 }, { scale: 1, opacity: 1, duration: o.d ?? ${p.popD}, ease: ${p.popEase}, immediateRender: false }, at); };
const countUp = (el, at, dur, from = 0) => {
  if (!el) return;
  const to = +el.dataset.count, f = el.dataset.format, dec = el.dataset.dec === undefined ? undefined : +el.dataset.dec, o = { v: from };
  el.textContent = fmt(from, f, dec);
  tl.to(o, { v: to, duration: ${p.countK === 1 ? 'dur' : `dur * ${p.countK}`}, ease: ${p.countEase}, onUpdate: () => { el.textContent = fmt(o.v, f, dec); } }, at);
};`;

// brand.motion "cinematic": the same helper names, so every renderer gets it. Things come into focus (blur to
// sharp) on a long expo ease with no overshoot, and a short heading reveals word by word.
const CINE_HELPERS = `const EXO = 'expo.out';
const cineWords = (el) => {
  const text = el.textContent.trim();
  if (el.children.length || text.length > 120 || !/\\S\\s+\\S/.test(text)) return null;
  el.textContent = '';
  text.split(/\\s+/).forEach((w, i) => { if (i) el.appendChild(document.createTextNode(' ')); const s = document.createElement('span'); s.className = 'cw'; s.textContent = w; el.appendChild(s); });
  return [...el.children];
};
const fadeUp = (el, at, o = {}) => {
  if (!el) return;
  const dy = (o.y ?? 40) * 0.8 * U, ws = el.classList.contains('hd') ? cineWords(el) : null;
  if (ws) {
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: 'none', immediateRender: false }, at);
    tl.fromTo(ws, { y: dy, opacity: 0, filter: 'blur(12px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 1, ease: EXO, stagger: Math.min(0.08, 0.5 / ws.length), immediateRender: false }, at);
  } else tl.fromTo(el, { y: dy, opacity: 0, filter: 'blur(10px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: (o.d ?? 0.6) + 0.3, ease: EXO, immediateRender: false }, at);
};
const pop = (el, at, o = {}) => { if (!el) return; tl.fromTo(el, { scale: Math.max(o.from ?? 0.6, 0.9), opacity: 0, filter: 'blur(10px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.9, ease: EXO, immediateRender: false }, at); };
const countUp = (el, at, dur, from = 0) => {
  if (!el) return;
  const to = +el.dataset.count, f = el.dataset.format, dec = el.dataset.dec === undefined ? undefined : +el.dataset.dec, o = { v: from };
  el.textContent = fmt(from, f, dec);
  tl.to(o, { v: to, duration: dur * 1.15, ease: EXO, onUpdate: () => { el.textContent = fmt(o.v, f, dec); } }, at);
};`;
// brand.motion "editorial": a heading's words rise out of a mask, line after line; everything else wipes in from the
// left. A wipe ends on clip-path none, so a shadow outside the box shows again.
const EDITORIAL_HELPERS = `const maskWords = (el) => {
  const text = el.textContent.trim();
  if (el.children.length || el.dataset.count !== undefined || text.length > 120 || !/\\S\\s+\\S/.test(text)) return null;
  el.textContent = '';
  text.split(/\\s+/).forEach((w, i) => { if (i) el.appendChild(document.createTextNode(' ')); const m = document.createElement('span'), s = document.createElement('span'); m.className = 'mw'; s.textContent = w; m.appendChild(s); el.appendChild(m); });
  return [...el.children].map((m) => m.firstChild);
};
const wipe = (el, at, d) => {
  tl.fromTo(el, { opacity: 0, clipPath: 'inset(0% 100% 0% 0%)' }, { opacity: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: 'power3.inOut', immediateRender: false }, at);
  tl.set(el, { clipPath: 'none' }, at + d);
};
const fadeUp = (el, at, o = {}) => {
  if (!el) return;
  const ws = el.classList.contains('hd') ? maskWords(el) : null;
  if (ws) {
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: 'none', immediateRender: false }, at);
    tl.fromTo(ws, { yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'power4.out', stagger: 0.04, immediateRender: false }, at);
  } else wipe(el, at, o.d ?? 0.5);
};
const pop = (el, at, o = {}) => { if (!el) return; wipe(el, at, o.d ?? 0.45); };
const countUp = (el, at, dur, from = 0) => {
  if (!el) return;
  const to = +el.dataset.count, f = el.dataset.format, dec = el.dataset.dec === undefined ? undefined : +el.dataset.dec, o = { v: from };
  el.textContent = fmt(from, f, dec);
  tl.to(o, { v: to, duration: dur, ease: 'power3.out', onUpdate: () => { el.textContent = fmt(o.v, f, dec); } }, at);
};`;
// Masked words keep their descenders: the padding is taken back by a negative margin, so the line height stays.
const EDITORIAL_CSS = `
.mw{display:inline-block;overflow:hidden;vertical-align:top;padding:.06em 0 .16em;margin:-.06em 0 -.16em}.mw>span{display:inline-block}`;

// The editorial panel: a brand-coloured sheet sweeps in to cover the frame by each cut and on out past it (the
// secondary colour before a dark scene, which is drawn on the primary). D.cutPanel: [cut, before, after, dark]. Its id
// and classes are kit-only names: ui-story already has a #panel.
const PANEL_BEFORE = 0.25, PANEL_AFTER = 0.25;
const PANEL_JS = `
function panelCuts() {
  const P = $('cutpanel');
  tl.set(P, { xPercent: -100 }, 0);
  D.cutPanel.forEach(([c, a, b, dk]) => {
    tl.set(P, { attr: { class: dk ? 'cpd' : 'cp' } }, c - a);
    tl.fromTo(P, { xPercent: -100 }, { xPercent: 0, duration: a, ease: 'power3.in', immediateRender: false }, c - a);
    tl.fromTo(P, { xPercent: 0 }, { xPercent: 100, duration: b, ease: 'power3.out', immediateRender: false }, c);
  });
}`;

// A blur cut swaps two scenes in one frame, which flashes where they differ in colour or either is a full-frame picture.
// There a veil in the incoming scene's colour covers the frame by the cut and lifts as the new scene comes into focus,
// so the frame turns from one colour to the other and no two scenes show at once. A transparent scene counts as the page.
const VEIL_IN = 0.25, VEIL_OUT = 0.35;
const VEIL_JS = `
function veilCuts() {
  const V = $('cutveil'), page = getComputedStyle(document.body).backgroundColor;
  const solid = (c) => { const m = /^rgba\\((?:[\\d.]+, ){3}([\\d.]+)\\)$/.exec(c); return !m || +m[1] >= 0.5; };
  const big = (m) => m.offsetWidth * m.offsetHeight >= 0.8 * D.W * D.H;
  const look = D.scenes.map((sc) => {
    const g = $('g-' + sc.id);
    if (!g) return null;
    const bg = getComputedStyle(g).backgroundColor;
    return { bg: solid(bg) ? bg : page, media: [...g.querySelectorAll('video, img')].some(big) };
  });
  look.forEach((b, k) => {
    const a = look[k - 1];
    if (!a || !b || (a.bg === b.bg && !a.media && !b.media)) return;
    const prev = D.scenes[k - 1], sc = D.scenes[k];
    const din = Math.min(${VEIL_IN}, prev.end - prev.start), dout = Math.min(${VEIL_OUT}, sc.end - sc.start);
    tl.set(V, { backgroundColor: b.bg }, sc.start - din);
    tl.fromTo(V, { opacity: 0 }, { opacity: 1, duration: din, ease: 'power2.in', immediateRender: false }, sc.start - din);
    tl.fromTo(V, { opacity: 1 }, { opacity: 0, duration: dout, ease: 'power2.out', immediateRender: false }, sc.start);
  });
}`;

// The carrier (brand.carry): one accent bar under each scene's anchor (a [data-anchor], else its kicker, else its
// heading) that glides to the next scene's anchor over the cut, so one object carries the eye across. Anchors are
// measured in their plain layout before build() adds any tween: where entrances land. Seeking the timeline to measure
// rendered shared elements out of order (a step icon showed in every scene). A full-frame picture has no anchor: the bar fades out there and
// back in on the next scene that has one. On an accent scene it takes the ink colour.
const CARRY_JS = `
function carryCuts() {
  const C = $('carrier'), st = $('stage').getBoundingClientRect(), accent = getComputedStyle(C).backgroundColor;
  const big = (m) => m.offsetWidth * m.offsetHeight >= 0.8 * D.W * D.H;
  const box = D.scenes.map((sc) => {
    const g = $('g-' + sc.id);
    if (!g || [...g.querySelectorAll('video, img')].some(big)) return null;
    const a = g.querySelector('[data-anchor]') || g.querySelector('.kick') || g.querySelector('.hd');
    if (!a) return null;
    // The text's own box: a heading is a block as wide as its column.
    const rg = document.createRange();
    rg.selectNodeContents(a);
    const r = rg.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    const w = Math.min(r.width, 180 * U), mid = Math.abs(r.left + r.width / 2 - st.left - D.W / 2) < 0.05 * D.W;
    return { x: (mid ? r.left + (r.width - w) / 2 : r.left) - st.left, y: r.bottom - st.top + 10 * U, width: w, backgroundColor: getComputedStyle(g).backgroundColor === accent ? D.ink : accent };
  });
  tl.set(C, { opacity: 0 }, 0);
  box.forEach((b, i) => {
    const a = box[i - 1], sc = D.scenes[i], prev = D.scenes[i - 1];
    const din = prev ? Math.min(${VEIL_IN}, (prev.end - prev.start) / 2) : 0, dout = Math.min(${VEIL_OUT}, (sc.end - sc.start) / 2);
    if (!b) { if (a) tl.to(C, { opacity: 0, duration: din, ease: 'power2.in' }, sc.start - din); return; }
    if (!a) {
      tl.set(C, { ...b }, sc.start);
      tl.fromTo(C, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.5, ease: 'power3.out', immediateRender: false }, sc.start + 0.3);
      return;
    }
    tl.fromTo(C, { ...a }, { ...b, duration: din + dout, ease: 'power3.inOut', immediateRender: false }, sc.start - din);
  });
  if (box.at(-1)) tl.to(C, { opacity: 0, duration: 0.3, ease: 'power2.in' }, D.duration - 0.3);
}`;

// Helper sets that are their own string; every other profile entrance comes from ENTRANCE.
const HELPERS = { cine: CINE_HELPERS, editorial: EDITORIAL_HELPERS };
const helpersFor = (M) => HELPERS[M.entrance] ?? entranceJs(ENTRANCE[M.entrance]);

// The scene show/hide block of build(), one entry per motion profile `cut`, written per scene with s, e, g, first, last.
const CUTS = {
  fade: (M) => `    if (g) {
      // Scenes never overlap: the old one fades out and is gone at its end, the new one fades in from its start.
      tl.set(g, { visibility: 'visible' }, s);
      if (!first) tl.fromTo(g, { opacity: 0 }, { opacity: 1, duration: ${M.cutD}, immediateRender: false }, s);
      if (!last) tl.to(g, { opacity: 0, duration: ${M.cutD}, ease: XI }, e - ${M.cutD}).set(g, { visibility: 'hidden' }, e);
    }`,
  blur: (M) => `    if (g) {
      // A blur cut: the old scene stays fully opaque and slips out of focus over its last quarter second, then is
      // gone at its end; the new one is there at once and comes into focus. Two scenes never show together, so
      // their text never stacks (a crossfade did, for about 0.2 s at every cut). The camera keeps pushing in.
      tl.set(g, { visibility: 'visible' }, s);
      tl.fromTo(g, { filter: 'blur(18px)' }, { filter: 'blur(0px)', duration: 0.45, ease: 'power3.out', immediateRender: false }, s);
      tl.fromTo(g, { scale: 1 }, { scale: ${M.push}, duration: Math.max(0.1, e - s), ease: 'none', immediateRender: false }, s);
      if (!last) tl.to(g, { filter: 'blur(8px)', duration: 0.25, ease: 'power2.in' }, e - 0.25).set(g, { visibility: 'hidden' }, e);
    }`,
  panel: () => `    if (g) {
      // A panel cut: the old scene is gone and the new one there at the cut, while the panel (or a brand wipe) covers the frame.
      tl.set(g, { visibility: 'visible' }, s);
      if (!last) tl.set(g, { visibility: 'hidden' }, e);
    }`,
  zoom: () => `    if (g) {
      // A zoom cut, by cut number (scene i opens cut i): on an even cut the old scene punches in and is gone and the new
      // one lands from slightly small; on an odd cut the old one slips left and the new one slides in from the right.
      // The old scene is hidden at its end, so two scenes never show at once.
      tl.set(g, { visibility: 'visible' }, s);
      if (!first) {
        if (i % 2 === 0) tl.fromTo(g, { scale: 0.9 }, { scale: 1, duration: 0.22, ease: 'back.out(1.4)', immediateRender: false }, s);
        else tl.fromTo(g, { xPercent: 8 }, { xPercent: 0, duration: 0.22, ease: 'power4.out', immediateRender: false }, s);
      }
      if (!last) {
        tl.to(g, (i + 1) % 2 === 0 ? { scale: 1.1, opacity: 0, duration: 0.12, ease: 'power2.in' } : { xPercent: -8, opacity: 0, duration: 0.12, ease: 'power2.in' }, e - 0.12);
        tl.set(g, { visibility: 'hidden' }, e);
      }
    }`,
};

// The parallax camera (profile `layers`): each scene drifts across and pushes in slowly, alternating direction, so the
// far layer (the particles) moves on without a jump at the cut.
const CAMERA = (M, particles) => `
    if (g) {
      const dir = i % 2 ? -1 : 1, len = Math.max(0.1, e - s);
      tl.fromTo(g, { scale: 1.02, x: dir * 10 * U, y: dir * 6 * U }, { scale: ${M.push}, x: -dir * 10 * U, y: -dir * 6 * U, duration: len, ease: 'none', immediateRender: false }, s);${particles ? `
      tl.fromTo('#bgc', { x: dir * 24 * U }, { x: -dir * 24 * U, duration: len, ease: 'none', immediateRender: false }, s);` : ''}
    }`;
// Parallax layers: headings and kickers drift one way, pictures the other, against the camera, over the whole scene.
// GSAP folds a CSS translate into its own transform, so each layer is an x tween; an element the scene already moves on
// x keeps its own motion, a layer inside another drifts with it, and full-width media would show its edge.
const LAYER_JS = `
const LAYERS = [['.hd, .kick', 6], ['img, video', -14]];
function layerDrift(g, s, e) {
  const moved = new Set();
  tl.getChildren(false, true, false).forEach((tw) => {
    if (seen.has(tw)) return;
    const v = { ...tw.vars, ...(tw.vars.startAt || {}) };
    if ('x' in v || 'xPercent' in v) tw.targets().forEach((el) => { if (el instanceof Element && el !== g) moved.add(el); });
  });
  for (const [sel, d] of LAYERS) g.querySelectorAll(sel).forEach((el) => {
    const up = el.parentElement.closest(sel);
    if (moved.has(el) || (up && g.contains(up)) || el.offsetWidth >= D.W * 0.9) return;
    tl.fromTo(el, { x: -d * U }, { x: d * U, duration: Math.max(0.1, e - s), ease: 'none', immediateRender: false }, s);
  });
}`;

// Film grain: one seeded noise tile, shifted every 1/24 s, so each frame is the same on every render.
const GRAIN_JS = `
const grain = $('grain'), gx = grain.getContext('2d');
const GT = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const x = c.getContext('2d'), im = x.createImageData(160, 160);
  let s = 20261022;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < im.data.length; i += 4) { const v = r() < 0.5 ? 0 : 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = Math.round(r() * 255); }
  x.putImageData(im, 0, 0); return c;
})();
const GP = gx.createPattern(GT, 'repeat');
function drawGrain(t) {
  const f = Math.floor(t * 24), ox = (f * 73) % 160, oy = (f * 151) % 160;
  gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, grain.width, grain.height);
  gx.setTransform(1, 0, 0, 1, -ox, -oy); gx.fillStyle = GP; gx.fillRect(ox, oy, grain.width, grain.height);
}`;

// When a scene's element is in: the end of the first short tween on it or an ancestor inside the scene group.
const SHOWN_JS = String.raw`
function shownBy(el, g, s, e) {
  let t = s;
  for (let n = el; n && n !== g; n = n.parentElement) {
    const tw = tl.getTweensOf(n).filter((x) => x.startTime() >= s - 0.5 && x.startTime() < e && x.duration() < 2).sort((a, b) => a.startTime() - b.startTime())[0];
    if (tw) t = Math.max(t, tw.startTime() + tw.duration());
  }
  return t;
}`;

// Text marks (engine/marks.mjs): each path is scaled to its text once the page is laid out, then drawn when the
// voice says the marked word, or just after the text is in when no spoken word matches.
const MARK_JS = String.raw`
const MARK_BOX = { circle: [-0.13, -0.32, 1.13, 1.3], underline: [-0.02, 0.86, 1.02, 1.1], strike: [-0.02, 0.46, 1.02, 0.62] };
const markKey = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}%$€£]/gu, '');
// An underline or strike flows with its text; one that wraps becomes one single-line mark per line (the words of that
// line), so each line gets its own stroke. A continuation line (mkc) is drawn after the line before it.
function splitMark(m) {
  const t = m.querySelector('.mkt'), n = t.firstChild, half = parseFloat(getComputedStyle(m).fontSize) / 2, lines = [];
  let top = -Infinity;
  for (const x of t.textContent.matchAll(/\S+/g)) {
    const r = document.createRange();
    r.setStart(n, x.index); r.setEnd(n, x.index + x[0].length);
    const y = r.getClientRects()[0]?.top ?? top;
    if (y > top + half) { lines.push([]); top = y; }
    lines[lines.length - 1].push(x[0]);
  }
  m.classList.add('mkl');
  if (lines.length < 2) return;
  t.textContent = lines[0].join(' ');
  let at = m;
  for (const ln of lines.slice(1)) {
    const c = m.cloneNode(true);
    c.classList.add('mkc'); c.querySelector('.mkt').textContent = ln.join(' ');
    at.after(document.createTextNode(' '), c); at = c;
  }
}
function drawMarks(sc, g, s, e) {
  const ws = words(sc.id), used = new Set();
  g.querySelectorAll('.mk-underline,.mk-strike').forEach(splitMark);
  let chain = -Infinity;
  g.querySelectorAll('.mk').forEach((m) => {
    const style = ['mark', 'circle', 'strike', 'underline'].find((x) => m.classList.contains('mk-' + x));
    const key = markKey(m.textContent.trim().split(/\s+/)[0]);
    const hit = key ? ws.findIndex((w, k) => !used.has(k) && markKey(w.w) === key) : -1;
    if (hit >= 0) used.add(hit);
    const shown = shownBy(m, g, s, e);
    let at = Math.min(Math.max(shown + 0.15, hit >= 0 ? ws[hit].start : shown + 0.45), Math.max(s + 0.2, e - 0.9));
    if (m.classList.contains('mkc')) at = Math.max(at, chain);
    chain = at + 0.4;
    if (style === 'mark') {
      tl.fromTo(m, { backgroundSize: '0% 86%' }, { backgroundSize: '100% 86%', duration: 0.45, ease: 'power2.out', immediateRender: false }, at);
      tl.set(m, { attr: { class: 'mk mk-mark on' } }, at + 0.12);
      return;
    }
    const w = m.offsetWidth, h = m.offsetHeight, b = MARK_BOX[style], bw = (b[2] - b[0]) * w, bh = (b[3] - b[1]) * h;
    const svg = m.querySelector('.mks'), p = svg.querySelector('path');
    let k = 0;
    p.setAttribute('d', p.getAttribute('d').replace(/-?\d*\.?\d+/g, (v) => (k++ % 2 ? +v * bh : +v * bw).toFixed(1)));
    svg.setAttribute('viewBox', '0 0 ' + bw.toFixed(1) + ' ' + bh.toFixed(1));
    Object.assign(svg.style, { left: (b[0] * w).toFixed(1) + 'px', top: (b[1] * h).toFixed(1) + 'px', width: bw.toFixed(1) + 'px', height: bh.toFixed(1) + 'px' });
    p.style.strokeWidth = Math.max(3, parseFloat(getComputedStyle(m).fontSize) * (style === 'circle' ? 0.06 : 0.075)).toFixed(1) + 'px';
    tl.fromTo(p, { drawSVG: '0%' }, { drawSVG: '100%', duration: style === 'circle' ? 0.7 : 0.4, ease: 'power2.inOut', immediateRender: false }, at);
    if (style === 'strike') tl.fromTo(m.querySelector('.mkt'), { opacity: 1 }, { opacity: 0.5, duration: 0.3, immediateRender: false }, at + 0.2);
  });
}`;

// Strokes in the brand accent. The highlighter is the accent with ink text, the pair the brand's button already
// uses, so it reads on a light or a dark scene; on an accent scene it turns ink with accent text.
const MARK_CSS = `
.mk{position:relative;display:inline-block;white-space:nowrap}
.mk-underline,.mk-strike{display:inline;white-space:normal}.mk.mkl{display:inline-block;white-space:nowrap}
.mk-mark{display:inline;white-space:normal;border-radius:.12em;padding:0 .08em;margin:0 -.08em;background:linear-gradient(var(--secondary),var(--secondary)) no-repeat 0 55%/0% 86%;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.mk-mark.on{color:var(--ink)}
.mks{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none}
.mks path{fill:none;stroke:var(--secondary);stroke-linecap:round;stroke-linejoin:round}
.acc .mks path{stroke:var(--ink)}.acc .mk-mark{background-image:linear-gradient(var(--ink),var(--ink))}.acc .mk-mark.on{color:var(--secondary)}`;

const SHINE_CSS = `
.shw{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}
.shn{position:absolute;top:-10%;bottom:-10%;left:0;mix-blend-mode:overlay;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.9),rgba(255,255,255,0))}`;

// brand.shine: a soft light band sweeps across each button once it is in, and again near the end of a long scene.
const SHINE_JS = String.raw`
function shine(g, s, e) {
  g.querySelectorAll('.btn').forEach((b) => {
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    const box = document.createElement('i'), band = document.createElement('i');
    box.className = 'shw'; band.className = 'shn'; box.appendChild(band); b.appendChild(box);
    const w = b.offsetWidth, bw = Math.max(40, w * 0.35), at = Math.min(shownBy(b, g, s, e) + 0.25, e - 0.9);
    band.style.width = bw.toFixed(1) + 'px';
    for (const t of e - at > 3.4 ? [at, e - 1.4] : [at]) tl.fromTo(band, { x: -bw * 1.3, skewX: -20 }, { x: w + bw * 0.3, skewX: -20, duration: 0.8, ease: 'power2.inOut', immediateRender: false }, t);
  });
}`;

// brand.leaks: at every cut a warm glow (and one in the brand accent) flares across the frame, peaks on the cut
// and fades. Directions and drift come from the cut's index, so every render is the same. D.leaks holds each cut's
// window (cutWindows): two cuts less than a second apart split the time between them, so no two flares' tweens
// overlap on one element (a backward seek would otherwise land on the other one's values).
const LEAK_BEFORE = 0.25, LEAK_AFTER = 0.75;
const LEAK_JS = String.raw`
function lightLeaks() {
  const L = $('leak'), [a, b] = L.children;
  D.leaks.forEach(([c, pre, post], k) => {
    const i = k + 1, dir = i % 2 ? 1 : -1, rise = Math.min(0.22, pre), at = Math.max(0, c - pre), len = pre + post;
    const r = (n) => { const x = Math.sin(i * 91.7 + n * 47.3) * 43758.5453; return x - Math.floor(x); };
    tl.fromTo(L, { opacity: 0 }, { opacity: 1, duration: rise, ease: 'power1.in', immediateRender: false }, Math.max(0, c - rise));
    tl.fromTo(L, { opacity: 1 }, { opacity: 0, duration: post, ease: 'power2.out', immediateRender: false }, c);
    tl.fromTo(a, { x: -dir * (0.3 + r(1) * 0.1) * D.W, y: (r(2) - 0.5) * 0.5 * D.H, scale: 0.8 }, { x: dir * (0.2 + r(3) * 0.1) * D.W, y: (r(4) - 0.5) * 0.5 * D.H, scale: 1.2, duration: len, ease: 'none', immediateRender: false }, at);
    tl.fromTo(b, { x: dir * (0.3 + r(5) * 0.1) * D.W, y: (r(6) - 0.5) * 0.6 * D.H, scale: 1.1 }, { x: -dir * (0.1 + r(7) * 0.1) * D.W, y: (r(8) - 0.5) * 0.6 * D.H, scale: 0.85, duration: len, ease: 'none', immediateRender: false }, at);
  });
}`;

// The corner logo follows the scene's surface: an opaque scene background decides by its luminance (an accent scene
// on a dark accent colour takes the dark-surface logo); a transparent one by the scene's dark flag or class.
const SURFACE_JS = String.raw`
const surfaceDark = (sc, g) => {
  const m = g && /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(getComputedStyle(g).backgroundColor);
  if (m && (m[4] === undefined || +m[4] >= 0.5)) return 0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3] <= ${LIGHT_LUM};
  return !!(sc.dark || (g && g.classList.contains('dark')));
};`;

// Longest caption line in characters: one line at 40 px across a landscape frame, fewer in portrait.
export const CAP_LAND = 42;
export const CAP_PORT = 26;
const CAP_PAUSE = /[,.;:!?—]$/;
// A caption line should not end on one of these: the reader is left hanging mid-phrase.
const CAP_WEAK = /^(a|an|the|to|of|in|on|at|for|by|with|and|or|but|every|my|our|your|its|from|into|than|that|is|are|was|were)$/i;
// A spoken number ("twelve point two six million dollars") is read as one unit: no break inside it.
const CAP_NUM = /^(\d[\d.,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point)$/i;
const CAP_NUM_TAIL = /^(point|hundred|thousand|million|billion|percent|dollars?)$/i;
const isNum = (w) => !!w && CAP_NUM.test(w.replace(/[^\w.,']/g, ''));
// "six hundred and eight" counts as one number too.
const numBreak = (end, next, after) => !!next && !CAP_PAUSE.test(end) && isNum(end)
  && (CAP_NUM_TAIL.test(next.replace(/[^\w]/g, '')) || isNum(next) || (/^and$/i.test(next) && /hundred|thousand|million/i.test(end) && isNum(after)));

/**
 * Splits a scene's spoken words into caption lines of at most `max` characters, as [first, last] word indexes.
 * Picks the breaks that keep lines even (squared slack), preferring a break at punctuation, never ending a line
 * on a weak word, and never leaving a very short last line. A single word longer than `max` is a line of its own.
 */
export function captionLines(words, max = CAP_LAND) {
  const n = words.length;
  if (!n) return [];
  const best = new Array(n + 1).fill(Infinity), from = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    let L = -1;
    for (let i = j - 1; i >= 0; i--) {
      L += words[i].w.length + 1;
      if (L > max && i < j - 1) break;
      const end = words[j - 1].w, lastLine = j === n;
      let cost = lastLine ? (L < 12 && i > 0 ? 500 : 0) : (max - L) ** 2;
      if (!lastLine && CAP_PAUSE.test(end)) cost -= /[.!?]$/.test(end) ? 600 : 300;
      // A sentence that ends inside a line makes the reader stop mid-line.
      for (let k = i; k < j - 1; k++) if (/[.!?]$/.test(words[k].w)) cost += 700;
      if (!lastLine && CAP_WEAK.test(end.replace(/[^\w']/g, ''))) cost += 600;
      if (!lastLine && numBreak(end, words[j].w, words[j + 1]?.w)) cost += 900;
      if (best[i] + cost < best[j]) { best[j] = best[i] + cost; from[j] = i; }
    }
  }
  const lines = [];
  for (let j = n; j > 0; j = from[j]) lines.unshift([from[j], j - 1]);
  return lines;
}

/** The brand's custom subtitle box: its plain hex at full opacity, rgba below it. */
const boxBg = (bs) => (bs.bgOpacity != null && bs.bgOpacity < 1 ? `rgba(${rgb(bs.bg)},${bs.bgOpacity})` : bs.bg);

const SUB_COLOR =/^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]+\))$/;
const SUB_DEFAULTS = { size: 36, weight: 700, lineHeight: 1.3, side: 70, bottom: 70, pill: true, color: 'rgba(255,255,255,.55)', lit: '#ffffff', darkColor: 'rgba(255,255,255,.55)', darkLit: '#ffffff' };

/** A lead template's subtitle style: sizes in 1080-short-side units, colors as hex or rgb(a). */
function subStyle(subs) {
  const s = { ...SUB_DEFAULTS, ...subs };
  for (const k of ['size', 'weight', 'lineHeight', 'side', 'bottom']) {
    if (!Number.isFinite(s[k])) throw new StudioError(`Subtitle style ${k} must be a number`, 500);
  }
  for (const k of ['color', 'lit', 'darkColor', 'darkLit']) {
    if (!SUB_COLOR.test(s[k])) throw new StudioError(`Subtitle style ${k} must be a hex or rgb color`, 500);
  }
  return { ...s, pill: !!s.pill };
}

// Brand subtitle presets (brand.subtitles.style): sizes in 1080 units for landscape; portrait is 1.25x for a phone.
const SUB_PRESETS = { classic: { size: 46, weight: 500 }, highlighter: { size: 48, weight: 700 }, minimal: { size: 46, weight: 500 }, pill: { size: 48, weight: 700 }, pop: { size: 54, weight: 700 } };
// A preset shows a few words at a time, never a block of text.
export const PRESET_CAP_LAND = 32;
export const PRESET_CAP_PORT = 20;
// Average advance of a bold character, spaces included, in em per preset face; a brand face counts as wide.
const PRESET_EM = { Roboto: 0.58, Inter: 0.62, Montserrat: 0.68, brand: 0.68 };
// A preset's box: padding left and right together, and top and bottom together (1080 units); see presetCss.
const BOX_PAD_X = 44, BOX_PAD_Y = 18;
const PRESET_LINE = 1.22;
// Room between scene content and the top of a preset's caption line.
const BAND_GAP = 30;
const lum = (hex) => { const [r, g, b] = rgb(hex).split(',').map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const boxed = (style) => style !== 'minimal' && style !== 'pop';

/**
 * Where a brand preset's caption sits, in 1080 units: type size, side insets, bottom edge, the longest line in
 * characters that still fits on one line in that face, and the line's top edge. The band sits above a player's
 * progress bar and, in portrait, above a social app's caption area and left of its icon rail.
 */
export function presetBand(bs, g) {
  const p = SUB_PRESETS[bs.style] || SUB_PRESETS.classic, face = bs.font ?? 'Roboto';
  const size = Math.round((bs.size ?? p.size) * (g.port ? 1.25 : 1));
  const at = g.port ? { bottom: 360, left: 80, right: 170 } : g.land ? { bottom: 96, left: 120, right: 120 } : { bottom: 110, left: 90, right: 90 };
  const width = (g.land ? Math.min(g.W, (g.H * 16) / 9) : g.W) / g.U - at.left - at.right - (boxed(bs.style) ? BOX_PAD_X : 0);
  const fits = Math.floor(width / (size * (PRESET_EM[face] ?? PRESET_EM.brand)));
  return { ...at, size, chars: Math.min(g.port ? PRESET_CAP_PORT : PRESET_CAP_LAND, fits), top: Math.ceil(at.bottom + size * PRESET_LINE + (boxed(bs.style) ? BOX_PAD_Y : 0)) };
}

/** A brand preset's look and band (presetBand). A preset without a font uses Roboto, as validateBrand fills it in. */
function subPreset(bs, g, c) {
  const p = SUB_PRESETS[bs.style], face = bs.font ?? 'Roboto';
  const marker = bs.marker || c.secondary;
  const { size, chars, bottom, left, right } = presetBand(bs, g);
  return {
    style: bs.style, weight: p.weight, size, chars,
    font: face !== 'brand' ? `"${face}",Helvetica,Arial,sans-serif` : 'var(--body)',
    gf: SUBTITLE_FONTS[face] ? `family=${SUBTITLE_FONTS[face]}` : '',
    marker, markInk: lum(marker) > LIGHT_LUM ? '#111111' : '#ffffff',
    bottom, left, right,
  };
}

// A light tint (20%) does not hold the letters on a bright scene alone: blur what is behind it and shade the letters.
const glassCss = (px) => `-webkit-backdrop-filter:blur(${px(10)});backdrop-filter:blur(${px(10)});text-shadow:0 0 ${px(3)} rgba(0,0,0,.55),0 ${px(2)} ${px(6)} rgba(0,0,0,.5)`;

function presetCss(P, px, padX) {
  const box = `background:rgba(12,12,14,.2);${glassCss(px)};border-radius:${px(10)};padding:${px(8)} ${px(22)} ${px(10)}`;
  // No box: a crisp dark outline (eight offsets) holds the letters on a bright scene, a soft glow under it on a busy one.
  const o = px(2), ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => `${x ? (x < 0 ? '-' : '') + o : 0} ${y ? (y < 0 ? '-' : '') + o : 0} 0 rgba(0,0,0,.72)`).join(',');
  const halo = `background:none;border-radius:0;padding:0;text-shadow:${ring},0 ${px(3)} ${px(6)} rgba(0,0,0,.6),0 0 ${px(18)} rgba(0,0,0,.45)`;
  return `
.subt{left:${padX(P.left)};right:${padX(P.right)};bottom:${px(P.bottom)}}
.sw{font-family:${P.font};font-size:${px(P.size)};line-height:1.22;font-weight:${P.weight};font-style:normal;letter-spacing:.005em;color:#ffffff;text-wrap:balance;${P.style === 'minimal' || P.style === 'pop' ? halo : box}}${P.style === 'highlighter' ? `
.sw span{border-radius:${px(6)};padding:0 ${px(5)};margin:0 ${px(-5)};background:linear-gradient(${P.marker},${P.marker}) no-repeat 0 60%/0% 88%}
.sw span.on{color:${P.markInk};text-shadow:none}` : P.style === 'pill' ? `
.sw{position:relative}.sw span{position:relative;z-index:1}
.sw .pl{position:absolute;left:0;top:0;width:0;height:0;opacity:0;border-radius:${px(10)};background:${P.marker}}
.sw span.on{color:${P.markInk};text-shadow:none}` : P.style === 'pop' ? `
.sw span{display:inline-block;opacity:0;transform-origin:50% 85%}
.sw span.on{color:${P.marker}}` : ''}`;
}

/**
 * Builds the HTML page. A renderer supplies its own CSS, scene markup, per-scene data and a
 * `KINDS` object of timeline builders: KINDS[kind](sc, s, e, ctx) adds tweens for one scene.
 * A scene with `tpl` (a mixed page) is built by KINDS['<tpl>.<kind>'] and reported with that kind.
 * `particles: false` leaves the background canvas empty. `corner: false` drops the brand's corner logo (a logo sting shows its own).
 * `subs` (the lead template's subtitle style) replaces the default pill; see subStyle. A scene that its own
 * renderer's parts() marks `dark: true` (a dark frame) gets the style's dark colours, whichever template leads.
 * `stills` ([{ id, t }]) replaces the one review still per scene (a renderer with several shots per scene).
 * `layers: false` keeps a renderer's elements out of the parallax layer drift (its camera still moves).
 */
export function page({ brand, script, timing, size, title, css = '', body = '', scenes, js, subtitles = true, extra = {}, particles = true, subs = null, transparent = false, corner = true, stills: ownStills = null, layers = true }) {
  const { c, f } = checkBrand(brand);
  const M = motionProfile(brand);
  const mk = marksToHtml(body);
  body = mk.html;
  const marks = mk.count > 0, shines = !!brand.shine && /class="btn[" ]/.test(body);
  const leaks = !!brand.leaks && !transparent && scenes.length > 1;
  // A WebGL backdrop replaces the floating particles; see templates/gl.mjs.
  const GLL = glLayers(brand, transparent, scenes.length);
  if (GLL?.backdrop) particles = false;
  // A 3D model scene loads three.js as a module; build() waits for every model (templates/model3d.mjs).
  const models = hasModels(body);
  // A Lottie scene loads lottie-web and seeks every animation with the page clock (templates/lottie.mjs).
  const lotties = hasLotties(body);
  // A profile without particles draws film grain and a vignette (bg 'grain'; brand.film: false keeps the frame clean) or nothing.
  if (M.bg !== 'particles') particles = false;
  const film = M.bg === 'grain' && !transparent && brand.film !== false;
  // The editorial panel sweeps over every cut, unless a brand wipe already does.
  const panel = M.cut === 'panel' && !transparent && !GLL?.wipe && scenes.length > 1;
  const veil = M.cut === 'blur' && !transparent && !GLL?.wipe && scenes.length > 1;
  const carry = !!M.carrier && brand.carry === true && !transparent && scenes.length > 1;
  // Parallax layer drift; a renderer whose scenes are one drawn surface (ui-story's app window) passes layers: false.
  const drift = !!M.layers && layers;
  const g = geometry(size);
  const BS = brand.subtitles || null;
  // A brand preset replaces every other subtitle look, so each clip of the brand reads the same.
  const P = BS?.style ? subPreset(BS, g, c) : null;
  // A brand subtitle style replaces the lead template's: every word shows in one color, no karaoke dimming.
  const S = P ? null : BS ? subStyle({ ...subs, size: BS.size, weight: BS.weight ?? 400, color: BS.color, lit: BS.color, darkColor: BS.color, darkLit: BS.color, pill: !!BS.bg })
    : subs && subStyle(subs);
  const bug = corner ? logoBug(brand, transparent) : null;
  // Mix-aware lookups are written only into a mixed page, so a single-template page stays byte for byte the same.
  const mixed = scenes.some((s) => s.tpl);
  const kindKey = mixed ? `sc.tpl ? sc.tpl + '.' + sc.kind : sc.kind` : 'sc.kind';
  const studioScenes = mixed
    ? `D.scenes.map((sc) => ({ id: sc.id, kind: ${kindKey}, start: sc.start, end: sc.end }))`
    : 'D.scenes.map(({ id, kind, start, end }) => ({ id, kind, start, end }))';
  const { W, H, px, padX } = g;
  // A translucent custom box with light text is drawn like a preset's box.
  const glass = BS?.bg && !P && BS.bgOpacity != null && BS.bgOpacity < 1 && lum(BS.color) > 150 ? `;${glassCss(px)}` : '';
  const tById = Object.fromEntries(timing.scenes.map((s) => [s.id, s]));
  // `dark` reaches the page only with a subtitle style or a logo bug, the things that read it.
  const sceneData = scenes.map((s) => {
    const { dark, ...light } = s;
    return { ...(S || bug ? s : light), start: tById[s.id].start, end: tById[s.id].end };
  });
  const stills = ownStills || sceneData.map((s) => ({ id: s.id, t: Math.round(Math.max(s.start + 0.8, s.end - 0.45) * 100) / 100 }));
  const cuts = sceneData.slice(1).map((s) => s.start);
  const dark = new Set(S ? scenes.filter((s) => s.dark).map((s) => s.id) : []);
  // Cinematic captions read like broadcast subtitles: one short line at a time, broken at a pause. A preset does the
  // same with fewer words per line.
  const capMax = P ? P.chars : g.port ? CAP_PORT : CAP_LAND;
  const caps = (M.caps === 'lines' || P) && subtitles ? Object.fromEntries(script.scenes.map((s) => [s.id, captionLines(timing.words.filter((w) => w.scene === s.id), capMax)])) : null;
  const subHtml = subtitles ? script.scenes.map((s) => {
    const ws = timing.words.filter((w) => w.scene === s.id);
    // Lines toggle a word's class; GSAP cannot revert a set to an empty or missing class, so a word rests on "w".
    const span = (w, i) => `<span id="w-${s.id}-${i}"${caps ? ' class="w"' : ''}>${h(w.w)}</span>`;
    if (caps) return caps[s.id].map(([a, b], k) => `<div class="subt${dark.has(s.id) ? ' subdark' : ''}" id="sub-${s.id}-${k}" data-lint><div class="sw">${P?.style === 'pill' ? '<i class="pl"></i>' : ''}${ws.slice(a, b + 1).map((w, i) => span(w, a + i)).join(' ')}</div></div>`).join('');
    return ws.length ? `<div class="subt${dark.has(s.id) ? ' subdark' : ''}" id="sub-${s.id}" data-lint><div class="sw">${ws.map(span).join(' ')}</div></div>` : '';
  }).join('') : '';
  const data = { duration: timing.duration, W, H, U: g.U, land: g.land, port: g.port, scenes: sceneData, words: timing.words, stills, ink: c.ink, particle: rgb(c.primary2), ...(S ? { subs: { lit: S.lit, darkLit: S.darkLit } } : {}), ...(caps ? { caps } : {}), ...(GLL ? { gl: glData(GLL, c, cuts) } : {}), ...(leaks ? { leaks: cutWindows(cuts, LEAK_BEFORE, LEAK_AFTER) } : {}), ...(panel ? { cutPanel: cutWindows(cuts, PANEL_BEFORE, PANEL_AFTER).map((w, k) => [...w, scenes[k + 1].dark ? 1 : 0]) } : {}), ...extra };
  // Pages with <video data-clip data-start data-end> (footage inside a motion scene) seek each clip with the page clock.
  // Written only when such a clip exists, so every other page stays byte for byte the same.
  const clipJs = /<video[^>]* data-clip/.test(body) ? `
const CLIPV = [...document.querySelectorAll('video[data-clip]')];
const clipsLoaded = CLIPV.map((v) => new Promise((ok, no) => { if (v.readyState >= 2) return ok(); v.addEventListener('loadeddata', ok, { once: true }); v.addEventListener('error', () => no(new Error('clip ' + v.dataset.clip + ' could not be loaded')), { once: true }); }));
// When no new frame shows within the wait (a seek inside the frame already shown paints none), the clip must have
// settled within half a frame (30 fps) of the target; otherwise the seek fails and the render reports it, rather
// than recording a stale frame.
const seekClip = (v, to) => new Promise((ok, no) => {
  if (Math.abs(v.currentTime - to) < 0.004) return ok();
  const timer = setTimeout(() => (!v.seeking && Math.abs(v.currentTime - to) <= 1 / 60 ? ok()
    : no(new Error('Clip ' + v.dataset.clip + ' did not reach ' + to.toFixed(2) + ' s within 1.5 s; prepare the job again'))), 1500);
  const done = () => { clearTimeout(timer); ok(); };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => done()); else v.addEventListener('seeked', done, { once: true });
  v.currentTime = to;
});
// A clip plays from its scene's start and holds its last frame if the scene runs longer.
const seekClips = (t) => Promise.all(CLIPV.filter((v) => t >= +v.dataset.start - 0.4 && t <= +v.dataset.end + 0.4).map((v) => {
  const len = Number.isFinite(v.duration) ? v.duration : +v.dataset.end - +v.dataset.start;
  return seekClip(v, Math.min(Math.max(t - +v.dataset.start, 0), Math.max(0, len - 0.04)) + 0.001);
}));` : '';
  const fontQuery = [f.googleFonts, P?.gf].filter(Boolean).join('&');
  const fontsLink = fontQuery ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fontQuery}&display=block">` : '';
  const faces = fontFaces(f);
  return `<!doctype html>
<html lang="${h(timing.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}">
<title>${h(brand.name)} · ${h(title)}</title>
${fontsLink}${models ? '\n' + MODEL_HEAD : ''}
<style>
${faces ? faces + '\n' : ''}:root{--primary:${c.primary};--primary2:${c.primary2};--secondary:${c.secondary};--bg:${c.bg};--ink:${c.ink};--muted:${c.muted};--on:${c.onPrimary};
  --display:"${f.display}",system-ui,sans-serif;--body:"${f.body}",system-ui,sans-serif;${paletteCss(brand)}}
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(${px(1400)} ${px(1000)} at 50% 38%,#ffffff,var(--bg));font-family:var(--body);color:var(--ink)}
#bgc{position:absolute;inset:0;width:${W}px;height:${H}px}
.sc{position:absolute;inset:0;visibility:hidden}
.fill{position:absolute;inset:0}
.dark{background:var(--primary);color:var(--on)}
.kick{font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--primary2);font-size:${px(30)}}
.dark .kick{color:var(--secondary)}
.hd{font-family:var(--display);font-weight:800;letter-spacing:-.02em;line-height:1.04}
.btn{display:inline-flex;align-items:center;justify-content:center;background:var(--secondary);color:var(--ink);font-weight:800;border-radius:999px;font-size:${px(46)};padding:${px(26)} ${px(56)}}
.brandlogo{display:block;object-fit:contain;object-position:left center}
.subt{position:absolute;left:${padX(70)};right:${padX(70)};bottom:${px(70)};text-align:center;opacity:0;z-index:30}
.sw{display:inline-block;font-size:${px(g.port ? 50 : 40)};line-height:1.3;font-weight:700;color:rgba(255,255,255,.7);background:rgba(15,23,42,.72);border-radius:${px(14)};padding:${px(10)} ${px(22)};max-width:100%;text-shadow:0 1px 2px rgba(0,0,0,.35)}${S ? `
.subt{left:${padX(S.side)};right:${padX(S.side)};bottom:${px(S.bottom)}}
.sw{font-size:${px(S.size)};line-height:${S.lineHeight};font-weight:${S.weight};color:${S.color}${S.pill ? '' : ';background:none;border-radius:0;padding:0'}}
.subdark .sw{color:${S.darkColor}}` : ''}${P ? presetCss(P, px, padX) : ''}${BS && !P ? `
.sw{font-family:var(--body)${BS.bg ? `;background:${boxBg(BS)};border-radius:${px(6)};padding:${px(8)} ${px(22)}${glass}` : ''}}` : ''}${bug ? `
#lbug{position:absolute;left:${padX(60)};top:${px(48)};z-index:40;height:${px(46)}}
.lbug{position:absolute;left:0;top:0;height:${px(46)};width:auto;max-width:${px(320)};object-fit:contain;object-position:left top;visibility:hidden}` : ''}
${css}${transparent ? '\nhtml,body,#stage{background:transparent!important}#bgc{display:none}' : ''}${M.entrance === 'cine' ? `
.cw{display:inline-block}` : ''}${M.entrance === 'editorial' ? EDITORIAL_CSS : ''}${panel ? `
#cutpanel{position:absolute;inset:0;z-index:21;pointer-events:none;background:var(--primary)}#cutpanel.cpd{background:var(--secondary)}` : ''}${veil ? `
#cutveil{position:absolute;inset:0;z-index:19;pointer-events:none;opacity:0}` : ''}${carry ? `
#carrier{position:absolute;left:0;top:0;width:0;height:${px(6)};border-radius:${px(3)};z-index:23;pointer-events:none;opacity:0;background:var(--secondary);transform-origin:0 50%}` : ''}${film ? `
#vig{position:absolute;inset:0;z-index:24;pointer-events:none;background:radial-gradient(ellipse 75% 70% at 50% 46%,rgba(0,0,0,0) 58%,rgba(0,0,0,.13) 100%)}
#grain{position:absolute;inset:0;width:${W}px;height:${H}px;z-index:25;pointer-events:none;opacity:.07}` : ''}${M.caps === 'lines' && BS?.bg && !P ? `
.subt{bottom:${px(64)}}
.sw{line-height:1.25;letter-spacing:.005em;border-radius:${px(8)};padding:${px(9)} ${px(24)} ${px(11)};box-shadow:0 ${px(4)} ${px(18)} rgba(0,0,0,.16)}
.sw span{opacity:.5}.sw span.hl{background:linear-gradient(transparent 62%,var(--secondary) 62%,var(--secondary) 94%,transparent 94%)}` : ''}${M.caps === 'lines' && !BS && S ? `
.subt{left:${padX(70)};right:${padX(70)};bottom:${px(70)}}
.sw,.subdark .sw{font-size:${px(g.port ? 50 : 40)};font-weight:700;color:rgba(255,255,255,.7);background:rgba(15,23,42,.72)}` : ''}${M.caps === 'lines' && !BS ? `
.sw{line-height:1.25;border-radius:${px(10)};padding:${px(8)} ${px(24)} ${px(10)}}
.sw span{color:#ffffff;opacity:.7}.sw span.hl{color:var(--secondary)}` : ''}${marks ? MARK_CSS : ''}${shines ? SHINE_CSS : ''}${leaks ? `
#leak{position:absolute;inset:0;z-index:20;pointer-events:none;opacity:0;overflow:hidden}
#leak i{position:absolute;left:50%;top:50%;width:${px(1500)};height:${px(1500)};margin:${px(-750)} 0 0 ${px(-750)};border-radius:50%}
#leak i:first-child{background:radial-gradient(circle,rgba(255,170,90,.62) 0%,rgba(255,122,60,.3) 34%,rgba(255,96,64,0) 68%)}
#leak i:last-child{background:radial-gradient(circle,rgba(${rgb(c.secondary)},.48) 0%,rgba(${rgb(c.secondary)},.18) 38%,rgba(${rgb(c.secondary)},0) 66%)}` : ''}${GLL ? glCss(GLL, W, H) : ''}
</style>
</head>
<body>
<div id="stage">
  <canvas id="bgc" width="${W}" height="${H}"></canvas>${GLL ? glBackdropHtml(GLL, W, H) : ''}
  ${body}${leaks ? '\n  <div id="leak" aria-hidden="true"><i></i><i></i></div>' : ''}${panel ? '\n  <div id="cutpanel" class="cp" aria-hidden="true"></div>' : ''}${veil ? '\n  <div id="cutveil" aria-hidden="true"></div>' : ''}${carry ? '\n  <div id="carrier" aria-hidden="true"></div>' : ''}${GLL ? glWipeHtml(GLL, W, H) : ''}${film ? `\n  <div id="vig"></div><canvas id="grain" width="${Math.round(W / 2)}" height="${Math.round(H / 2)}"></canvas>` : ''}
  ${subHtml}${bug ? '\n  ' + bug : ''}
</div>
<script src="vendor/gsap.min.js"></script>
<script src="vendor/DrawSVGPlugin.min.js"></script>
<script src="vendor/MorphSVGPlugin.min.js"></script>
<script src="vendor/TextPlugin.min.js"></script>
<script>
const D = ${jsonForScript(data)};
gsap.registerPlugin(DrawSVGPlugin, MorphSVGPlugin, TextPlugin);
const $ = (id) => document.getElementById(id);
const U = D.U;
const X = 'power3.out', XI = 'power2.in', XIO = 'power2.inOut';
const tl = gsap.timeline({ paused: true, defaults: { ease: X } });
const fmt = (v, f, dec) => f === 'money' ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 })
  : f === 'pct' ? v.toFixed(dec ?? 1) + '%' : f === 'dec' ? v.toFixed(dec ?? 1) : Math.round(v).toLocaleString('en-US');
const words = (id) => D.words.filter((w) => w.scene === id);
const cue = (sc, frac) => { const ws = words(sc.id); if (!ws.length) return sc.start + 0.3 + frac * Math.max(0, sc.end - sc.start - 1); return ws[Math.min(ws.length - 1, Math.floor(frac * ws.length))].start; };
${helpersFor(M)}
const typeText = (el, at, dur) => { if (!el) return; el.textContent = ''; tl.to(el, { text: el.dataset.text, duration: dur, ease: 'none' }, at); };
const draw = (els, at, dur = 1, o = {}) => { if (!els || (els.length === 0)) return; tl.fromTo(els, { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, stagger: o.stagger ?? 0, ease: o.ease || 'power2.inOut', immediateRender: false }, at); };${marks || shines ? SHOWN_JS : ''}${marks ? MARK_JS : ''}${shines ? SHINE_JS : ''}${leaks ? LEAK_JS : ''}${panel ? PANEL_JS : ''}${veil ? VEIL_JS : ''}${carry ? CARRY_JS : ''}${drift ? LAYER_JS : ''}${bug ? SURFACE_JS : ''}${GLL ? glJs(GLL) : ''}

${js}

// Not element properties: the keys of a tween's vars that do not count as touching a target.
const CONTROL = new Set(['duration', 'ease', 'immediateRender', 'stagger', 'repeat', 'yoyo', 'delay', 'repeatDelay', 'overwrite', 'lazy', 'data', 'parent', 'startAt', 'runBackwards', 'paused', 'id', 'onUpdate', 'onComplete', 'onStart', 'onRepeat', 'onReverseComplete', 'callbackScope', 'onUpdateParams', 'onCompleteParams', 'onStartParams', 'inherit', 'keyframes']);
const seen = new Set();
// A scene's own elements start in their entrance state at the scene start. Without this, an element whose fromTo
// begins later in the scene sits fully visible (its plain CSS) until that tween starts, then jumps to its from values.
// Only the first tween of the scene that touches an element property decides, so a second animation of the same
// element never hides what the first one showed. Shared elements outside the scene group keep their carried state.
function preset(g, s) {
  const fresh = tl.getChildren(false, true, false).filter((tw) => !seen.has(tw));
  fresh.forEach((tw) => seen.add(tw));
  const touched = new Map();
  const sets = new Map();
  fresh.sort((a, b) => a.startTime() - b.startTime()).forEach((tw) => {
    const from = tw.vars.startAt, late = tw.startTime() > s + 0.001;
    const keys = Object.keys(tw.vars).filter((k) => !CONTROL.has(k));
    tw.targets().forEach((el) => {
      if (!(el instanceof Element) || !g.contains(el)) return;
      let done = touched.get(el);
      if (!done) touched.set(el, (done = new Set()));
      if (from && late) {
        for (const k of Object.keys(from)) {
          if (done.has(k)) continue;
          if (!sets.has(el)) sets.set(el, {});
          sets.get(el)[k] = from[k];
        }
      }
      keys.forEach((k) => done.add(k));
      if (from) Object.keys(from).forEach((k) => done.add(k));
    });
  });
  sets.forEach((vars, el) => tl.set(el, vars, s));
}

// A renderer may start a tween before the first scene (a pre-roll at s - 0.35 when s is 0). GSAP would then shift
// every child later so none starts below zero, and the whole video would run late against the voice. A position
// below zero becomes zero instead: the pre-roll simply starts at t = 0.
for (const m of ['to', 'from', 'fromTo', 'set']) {
  const orig = tl[m], at = m === 'fromTo' ? 3 : 2;
  tl[m] = (...a) => { if (typeof a[at] === 'number' && a[at] < 0) a[at] = 0; return orig.apply(tl, a); };
}

function build() {${carry ? '\n  carryCuts();' : ''}
  D.scenes.forEach((sc, i) => {
    const s = sc.start, e = sc.end, last = i === D.scenes.length - 1, first = i === 0;
    const g = $('g-' + sc.id);
${CUTS[M.cut](M)}${M.layers ? CAMERA(M, particles) : ''}
${caps ? `    // One caption line at a time: each slides in as its first word is spoken and is gone when the next starts.
    // An entrance always ends before its line is hidden, so a running tween never paints a line back.
    (D.caps[sc.id] || []).forEach(([a], k, lines) => {
      const el = $('sub-' + sc.id + '-' + k), ws = words(sc.id);
      const t0 = Math.max(s + 0.02, ws[a].start - 0.08);
      const t1 = lines[k + 1] ? Math.max(t0 + 0.1, ws[lines[k + 1][0]].start - 0.08) : last ? D.duration : e - 0.12;
${P?.style === 'minimal' ? `      // A soft fade in, and a soft fade out after the last word, done before the next line starts.
      const fd = Math.min(0.3, (t1 - t0) / 3), out = Math.max(t0 + fd, Math.min(ws[lines[k][1]].end ?? t1, t1 - 0.08));
      tl.fromTo(el, { opacity: 0, y: 6 * U }, { opacity: 1, y: 0, duration: fd, ease: 'power1.out', immediateRender: false }, t0);
      if (t1 < D.duration) tl.to(el, { opacity: 0, duration: Math.max(0.05, Math.min(fd, t1 - out)), ease: 'power1.in' }, out).set(el, { opacity: 0 }, t1);` : P ? `      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: Math.max(0, Math.min(0.12, t1 - t0 - 0.03)), ease: 'power1.out', immediateRender: false }, t0);
      if (t1 < D.duration) tl.set(el, { opacity: 0 }, t1);` : `      tl.fromTo(el, { opacity: 0, y: 8 * U }, { opacity: 1, y: 0, duration: Math.max(0, Math.min(0.16, t1 - t0 - 0.03)), ease: 'power2.out', immediateRender: false }, t0);
      if (t1 < D.duration) tl.set(el, { opacity: 0 }, t1);`}${P?.style === 'highlighter' ? `
      // A marker sweeps across each word as it is spoken and is gone when the next word starts.
      for (let i = a; i <= lines[k][1]; i++) {
        const wd = $('w-' + sc.id + '-' + i), next = i < lines[k][1] ? ws[i + 1].start : t1, off = Math.max(ws[i].start + 0.05, next);
        tl.set(wd, { attr: { class: 'on' } }, ws[i].start);
        tl.fromTo(wd, { backgroundSize: '0% 88%' }, { backgroundSize: '100% 88%', duration: Math.min(0.18, Math.max(0.03, off - ws[i].start - 0.01)), ease: 'power2.out', immediateRender: false }, ws[i].start);
        if (next < D.duration) tl.set(wd, { backgroundSize: '0% 88%', attr: { class: 'w' } }, off);
      }` : P?.style === 'pill' ? `
      // A pill slides from word to word as each is spoken; the spoken word takes the pill's ink.
      const pl = el.querySelector('.pl'), pad = 7 * U;
      const box = (wd) => ({ x: wd.offsetLeft - pad, y: wd.offsetTop, width: wd.offsetWidth + 2 * pad, height: wd.offsetHeight });
      for (let i = a; i <= lines[k][1]; i++) {
        const wd = $('w-' + sc.id + '-' + i), next = i < lines[k][1] ? ws[i + 1].start : t1, off = Math.max(ws[i].start + 0.05, next);
        if (i === a) tl.set(pl, { ...box(wd), opacity: 1 }, ws[i].start);
        else tl.fromTo(pl, box($('w-' + sc.id + '-' + (i - 1))), { ...box(wd), duration: Math.min(0.14, Math.max(0.03, ws[i].start - ws[i - 1].start - 0.01)), ease: 'power2.out', immediateRender: false }, ws[i].start);
        tl.set(wd, { attr: { class: 'on' } }, ws[i].start);
        if (next < D.duration) tl.set(wd, { attr: { class: 'w' } }, off);
      }` : P?.style === 'pop' ? `
      // Each word pops in as it is spoken and stays; the word being said carries the marker colour.
      for (let i = a; i <= lines[k][1]; i++) {
        const wd = $('w-' + sc.id + '-' + i), next = i < lines[k][1] ? ws[i + 1].start : t1, off = Math.max(ws[i].start + 0.05, next);
        tl.fromTo(wd, { opacity: 0, scale: 0.55, y: 10 * U }, { opacity: 1, scale: 1, y: 0, duration: Math.min(0.18, Math.max(0.03, off - ws[i].start - 0.01)), ease: 'back.out(2.2)', immediateRender: false }, ws[i].start);
        tl.set(wd, { attr: { class: 'on' } }, ws[i].start);
        if (next < D.duration) tl.set(wd, { attr: { class: 'w' } }, off);
      }` : P ? '' : `
      // Inside the line, each word turns solid as it is spoken and carries the brand marker while it is the one being said.
      for (let i = a; i <= lines[k][1]; i++) {
        const wd = $('w-' + sc.id + '-' + i), next = i < lines[k][1] ? ws[i + 1].start : t1;
        tl.set(wd, { opacity: 1, attr: { class: 'hl' } }, ws[i].start);
        if (next < D.duration) tl.set(wd, { attr: { class: 'w' } }, Math.max(ws[i].start + 0.05, next));
      }`}
    });
` : ''}    const sub = $('sub-' + sc.id);
    if (sub) {
      tl.fromTo(sub, { opacity: 0 }, { opacity: 1, duration: 0.25, immediateRender: false }, s + 0.05);
      if (!last) tl.to(sub, { opacity: 0, duration: 0.2 }, e - 0.2);
      words(sc.id).forEach((w, k) => tl.to('#w-' + sc.id + '-' + k, { color: ${S ? 'sc.dark ? D.subs.darkLit : D.subs.lit' : "'#ffffff'"}, duration: 0.1, ease: 'none' }, w.start));
    }
${bug ? `    // Corner logo: the dark-surface logo on a dark scene, the light-surface one elsewhere.
    const dk = surfaceDark(sc, g);
    tl.set('#lbug-d', { visibility: dk ? 'visible' : 'hidden' }, s).set('#lbug-l', { visibility: dk ? 'hidden' : 'visible' }, s);
` : ''}    const fn = KINDS[${kindKey}];
    if (fn) fn(sc, s, e, { last, first, i, g });${marks ? `
    if (g) drawMarks(sc, g, s, e);` : ''}${shines ? `
    if (g) shine(g, s, e);` : ''}${drift ? `
    if (g) layerDrift(g, s, e);` : ''}
    if (g) preset(g, s);
  });${leaks ? '\n  lightLeaks();' : ''}${panel ? '\n  panelCuts();' : ''}${veil ? '\n  veilCuts();' : ''}
  tl.set({}, {}, D.duration);
}

const ctx = $('bgc').getContext('2d');
const PARTS = Array.from({ length: 34 }, (_, i) => {
  const r = (n) => { const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  return { x: r(1) * D.W, y: r(2) * D.H, s: (18 + r(3) * 70) * U, sp: (12 + r(4) * 30) * U, ph: r(5) * 6.283, a: 0.04 + r(6) * 0.08 };
});
function drawBg(t) {
  ctx.clearRect(0, 0, D.W, D.H);
  for (const p of PARTS) {
    const y = (((p.y - t * p.sp) % D.H) + D.H) % D.H;
    const x = p.x + Math.sin(t * 0.5 + p.ph) * 30 * U;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, p.s);
    gr.addColorStop(0, 'rgba(' + D.particle + ',' + p.a + ')');
    gr.addColorStop(1, 'rgba(' + D.particle + ',0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, p.s, 0, 6.283); ctx.fill();
  }
}
let afterSeek = null;${clipJs}${models ? MODEL_WAIT : ''}${lotties ? LOTTIE_WAIT : ''}${film ? GRAIN_JS : ''}
// GSAP skips a seek to the time it already sits at, so the first frame (t = 0, where the timeline starts) is forced.
window.seek = (t) => { t = Math.min(Math.max(+t || 0, 0), D.duration); if (t === 0) tl.render(0, false, true); else tl.seek(t, false);${particles ? ' drawBg(t);' : ''}${film ? ' drawGrain(t);' : ''}${GLL ? ' GL.draw(t);' : ''}${models ? ' if (window.__drawModels) window.__drawModels(t);' : ''}${lotties ? ' if (window.__drawLotties) window.__drawLotties(t);' : ''} ${clipJs ? 'const r = afterSeek ? afterSeek(t) : t; return Promise.resolve(r).then(() => seekClips(t)).then(() => r);' : 'return afterSeek ? afterSeek(t) : t;'} };
window.__studio = { duration: D.duration, width: D.W, height: D.H, scenes: ${studioScenes}, stills: D.stills };
const imgs = [...document.images].map((im) => (im.decode ? im.decode().catch(() => {}) : null));
Promise.all([document.fonts.ready, ...imgs${clipJs ? ', ...clipsLoaded' : ''}${models ? ', modelsLoaded' : ''}${lotties ? ', lottiesLoaded' : ''}]).then(async () => { build(); if (window.__prepare) await window.__prepare(); await window.seek(0); window.__ready = true; });
</script>${models ? MODEL_JS : ''}${lotties ? LOTTIE_JS : ''}
</body>
</html>
`;
}
