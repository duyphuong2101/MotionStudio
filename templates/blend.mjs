// brand.blend: a two-scene transition at every cut. Over a short window around the cut both scene groups are on
// screen and are mixed with CSS transforms, opacity and SVG filters, all set from the time alone by drawBlend(t),
// which seek(t) calls. The scenes are never captured into a texture: what shows is the live DOM, with its own fonts and
// clips. Each scene group sits in a wrapper (.blw) that only drawBlend styles, so a blend never fights the scene's own
// tweens (a camera push, a renderer's moves). A page without brand.blend gets none of this code.
import { BLENDS, WIPES } from '../engine/brand.mjs';
import { CUT_KINDS } from '../engine/direction.mjs';
import { cutWindows } from './gl.mjs';

// Seconds before and after each cut that both scenes show; cutWindows shortens them between close cuts.
export const BLEND_BEFORE = 0.25, BLEND_AFTER = 0.25;

/** The page's blend, or null: none on a transparent overlay or a page with one scene. */
export const blendOf = (brand, transparent, sceneCount) => (!transparent && sceneCount > 1 && BLENDS.includes(brand.blend) ? brand.blend : null);

/** Page data: the blend and each cut's window as [cut, before, after] (`cuts` are the scene starts after the first). */
export const blendData = (type, cuts) => ({ type, cuts: cutWindows(cuts, BLEND_BEFORE, BLEND_AFTER) });

// One filter per role, the outgoing scene (o) and the incoming one (i): only one cut is ever mixing at a time.
// sRGB keeps a filter at rest from shifting colours; drawBlend drops the filter once its strength is near zero.
const FILTER = {
  // Horizontal motion blur.
  whip: (r) => `<filter id="blf-${r}" color-interpolation-filters="sRGB"><feGaussianBlur id="blf-${r}-b" stdDeviation="0 0"/></filter>`,
  // One fixed noise field (fixed seed and frequency, about four waves across a 1080 frame) pushes the pixels about;
  // drawBlend slides the field and sets the push, the opposite way on the incoming scene.
  warp: (r, U) => `<filter id="blf-${r}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(0.0035 / U).toFixed(5)}" numOctaves="2" seed="7" result="n"/><feOffset id="blf-${r}-n" in="n" dx="0" dy="0" result="m"/><feDisplacementMap id="blf-${r}-d" in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  // Red, green and blue apart: each channel at a third of the alpha, red and blue shifted, added back together and
  // brought up to full strength, so where the three meet the picture is exactly the source.
  split: (r) => `<filter id="blf-${r}" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .3334 0" result="r"/><feOffset id="blf-${r}-r" in="r" dx="0" dy="0" result="ro"/><feColorMatrix in="SourceGraphic" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 .3333 0" result="g"/><feColorMatrix in="SourceGraphic" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 .3333 0" result="b"/><feOffset id="blf-${r}-b" in="b" dx="0" dy="0" result="bo"/><feComposite in="ro" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/><feComposite in="rg" in2="bo" operator="arithmetic" k2="1" k3="1" result="rgb"/><feComponentTransfer in="rgb"><feFuncR type="linear" slope="3"/><feFuncG type="linear" slope="3"/><feFuncB type="linear" slope="3"/></feComponentTransfer></filter>`,
};

/** The SVG that holds the blend's filters (a zoom uses a CSS blur and needs none). */
export const blendHtml = (type, U) => (FILTER[type] ? `\n  <svg class="blsvg" width="0" height="0" aria-hidden="true"><defs>${FILTER[type]('o', U)}${FILTER[type]('i', U)}</defs></svg>` : '');

export const BLEND_CSS = `
.blw{position:absolute;inset:0}.blsvg{position:absolute;left:0;top:0;width:0;height:0;overflow:hidden}`;

/**
 * The scene show/hide block of build() under a blend, in place of the motion profile's cut (written per scene with s,
 * e, g, i, first, last). A profile whose camera push lives in its cut (cinematic) keeps the push.
 */
export const blendCut = (M) => `    if (g) {
      // A blend: the scene shows from the window before its cut until the window after its end, so both scenes of a cut
      // are on screen together and drawBlend mixes them. This deliberately breaks the one-scene-at-a-time rule of the
      // cinematic, clean, editorial, kinetic and parallax cuts: the person chose a blend for this brand.
      tl.set(g, { visibility: 'visible' }, s - blendPre(i));
      if (!last) tl.set(g, { visibility: 'hidden' }, e + D.blend.cuts[i][2]);${M.push !== 1 && !M.layers ? `
      tl.fromTo(g, { scale: 1 }, { scale: ${M.push}, duration: Math.max(0.1, e - s), ease: 'none', immediateRender: false }, s);` : ''}
    }`;

// Each blend's styling of the outgoing wrapper (o) and the incoming one (n) at time t. In scope: k (the cut), c, a, b
// (its window), u (-1 at the window start, 0 at the cut, 1 at its end), p (0 to 1 over the window), s (strength: 1 at
// the cut, easing to 0 at both ends), fin and fout (the crossfade), r2 (rounding). Every value reaches its resting
// state at the window's edges, so the first and last mixed frames match the plain ones.
const DRAW = {
  // Both scenes slide the same way, the old one out and the new one in, alternating direction cut by cut; the blur
  // follows the slide's speed (about 40 % of how far the frame moves in one 30 fps frame).
  whip: `
    const dir = k % 2 ? -1 : 1, off = (1 - Math.cos(Math.PI * p)) / 2;
    const bx = r2(Math.min(140 * U, (((Math.PI / 2) * Math.sin(Math.PI * p) * D.W) / (a + b) / 30) * 0.4));
    blendAttr('blf-o-b', 'stdDeviation', bx + ' 0'); blendAttr('blf-i-b', 'stdDeviation', bx + ' 0');
    blendSet(o, 'translateX(' + r2(-dir * off * D.W) + 'px)', '', bx > 0.3 ? 'url(#blf-o)' : '');
    blendSet(n, 'translateX(' + r2(dir * (1 - off) * D.W) + 'px)', '', bx > 0.3 ? 'url(#blf-i)' : '');`,
  // The old scene pushes in and blurs; the new one arrives still pushed in and settles; they cross at the cut.
  zoom: `
    const bl = r2(22 * U * s), f = bl > 0.3 ? 'blur(' + bl + 'px)' : '';
    blendSet(o, 'scale(' + (1 + 0.6 * p * p).toFixed(4) + ')', fout.toFixed(3), f);
    blendSet(n, 'scale(' + (1 + 0.35 * (1 - p) * (1 - p)).toFixed(4) + ')', fin.toFixed(3), f);`,
  // Both scenes bend through one noise field, the new one the opposite way, the push peaking at the cut. Each scene
  // swells by the push, so the edges it pulls in from beyond its box stay outside the frame.
  warp: `
    const d = r2(150 * U * s), dx = r2(0.08 * D.W * u), tf = d > 0.3 ? 'scale(' + (1 + (0.8 * d) / D.H).toFixed(4) + ')' : '';
    blendAttr('blf-o-d', 'scale', d); blendAttr('blf-i-d', 'scale', -d);
    blendAttr('blf-o-n', 'dx', dx); blendAttr('blf-i-n', 'dx', dx);
    blendSet(o, tf, fout.toFixed(3), d > 0.3 ? 'url(#blf-o)' : '');
    blendSet(n, tf, fin.toFixed(3), d > 0.3 ? 'url(#blf-i)' : '');`,
  // Red and blue pull apart on the old scene as the cut nears and close again on the new one; each scene swells by the
  // shift, so the side strips where a channel is missing stay outside the frame.
  split: `
    const d = r2(30 * U * s), tf = d > 0.3 ? 'scale(' + (1 + (2.4 * d) / D.W).toFixed(4) + ')' : '';
    blendAttr('blf-o-r', 'dx', d); blendAttr('blf-o-b', 'dx', -d);
    blendAttr('blf-i-r', 'dx', -d); blendAttr('blf-i-b', 'dx', d);
    blendSet(o, tf, fout.toFixed(3), d > 0.3 ? 'url(#blf-o)' : '');
    blendSet(n, tf, fin.toFixed(3), d > 0.3 ? 'url(#blf-i)' : '');`,
};

/** The page script: blendWrap() (build() calls it first), blendPre(i) and drawBlend(t), which seek(t) calls. */
export const blendJs = (type) => blendScript(DRAW[type]);

const blendScript = (draw) => String.raw`
let BLW = [];
// Each scene group goes into its own wrapper, which takes over the group's z-index so the paint order stays.
function blendWrap() {
  BLW = D.scenes.map((sc) => {
    const g = $('g-' + sc.id);
    if (!g) return null;
    const w = document.createElement('div'), z = getComputedStyle(g).zIndex;
    w.className = 'blw';
    if (z !== 'auto') w.style.zIndex = z;
    g.before(w);
    w.appendChild(g);
    return w;
  });
}
// How long before its start a scene shows.
const blendPre = (i) => (i ? D.blend.cuts[i - 1][1] : 0);
const blendStep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const blendAttr = (id, k, v) => { const el = $(id); if (el) el.setAttribute(k, v); };
function blendSet(w, tf, op, f) { if (!w) return; w.style.transform = tf; w.style.opacity = op; w.style.filter = f; }
function drawBlend(t) {
  const k = D.blend.cuts.findIndex(([c, a, b]) => t > c - a && t < c + b);
  BLW.forEach((w, i) => { if (k < 0 || (i !== k && i !== k + 1)) blendSet(w, '', '', ''); });
  if (k >= 0) {
    const [c, a, b] = D.blend.cuts[k], o = BLW[k], n = BLW[k + 1], r2 = (x) => Math.round(x * 100) / 100;
    const u = (t - c) / (t < c ? a : b), p = (t - c + a) / (a + b), s = 1 - blendStep(0, 1, Math.abs(u));
    const fin = blendStep(-0.5, 0.3, u), fout = 1 - blendStep(-0.3, 0.5, u);${draw}
  }
}`;

// Per-scene cuts (a scene's `cut`, plan .ai/plans/art-direction.md E2): the scene's entrance, one of the blends, a
// plain crossfade or a hard cut. A page where any scene sets one runs every cut through the blend machinery: each cut
// takes its scene's own, else the brand's blend, else the brand's wipe (drawn by the WebGL layer over a hard switch),
// else a crossfade. A page where no scene sets one is unchanged.

/** Each cut's kind (cut k leads into scene k + 1), or null when no scene of the page sets its own. */
export function cutPlan(brand, script, scenes, transparent) {
  if (transparent || scenes.length < 2) return null;
  const byId = new Map((script?.scenes || []).map((sc) => [sc.id, sc]));
  const own = scenes.slice(1).map((sc) => byId.get(sc.id)?.cut);
  if (!own.some((c) => CUT_KINDS.includes(c))) return null;
  const base = BLENDS.includes(brand.blend) ? brand.blend : WIPES.includes(brand.wipe) ? 'wipe' : 'fade';
  return own.map((c) => (CUT_KINDS.includes(c) ? c : base));
}

/** Page data for a plan: [cut, before, after, kind]; a hard cut and a wipe's cut have no window (both scenes never show). */
export const cutPlanData = (plan, cuts) => ({
  type: 'plan', cuts: cutWindows(cuts, BLEND_BEFORE, BLEND_AFTER).map(([c, a, b], k) => (plan[k] === 'cut' || plan[k] === 'wipe' ? [c, 0, 0, plan[k]] : [c, a, b, plan[k]])),
});

// Each kind's filters and drawing get their own ids, so two kinds on one page never share a filter.
const ownIds = (type, text) => text.replace(/blf-([oi])\b/g, `blf-${type}-$1`);
const DRAW_PLAN = { ...DRAW, fade: `
    blendSet(o, '', fout.toFixed(3), ''); blendSet(n, '', fin.toFixed(3), '');` };

/** The SVG with the filters of every kind the plan uses. */
export const cutPlanHtml = (plan, U) => {
  const defs = [...new Set(plan)].filter((t) => FILTER[t]).map((t) => FILTER[t](`${t}-o`, U) + FILTER[t](`${t}-i`, U)).join('');
  return defs ? `
  <svg class="blsvg" width="0" height="0" aria-hidden="true"><defs>${defs}</defs></svg>` : '';
};

/** The page script for a plan: drawBlend picks the drawing by the cut's kind. */
export const cutPlanJs = (plan) => blendScript(`
    const T = D.blend.cuts[k][3];
    ${[...new Set(plan)].filter((t) => DRAW_PLAN[t]).map((t) => `if (T === '${t}') {${ownIds(t, DRAW_PLAN[t])}
    }`).join(' else ')}`);
