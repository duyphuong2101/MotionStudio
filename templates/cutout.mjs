// A scene's `cutout` (engine/direction.mjs, plan E5): the subject of its main picture, cut out by prepare
// (engine/matte.mjs) into assets/cut-<scene>.png, drawn over everything else in the scene group, so the heading sits
// behind the person. The main picture is found as the camera finds it (the largest <img> covering CAM_MIN_AREA of
// the frame). drawCutout(t), which seek(t) calls after the camera and the pulse, puts the cut-out exactly over the
// picture's box as it is on screen (its own tweens, a camera move, a blend), in the group's own units, so every
// move of the picture carries the subject with it. A page with no cut-out gets none of this code.
import { CAM_MIN_AREA } from './camera.mjs';

const asset = (name) => `assets/${encodeURIComponent(name)}`;

/** Page data: { <scene id>: <cut-out url> } for the scenes prepare cut out (pageScript's `cutoutFile`), or null. */
export function cutoutData(script, scenes) {
  const byId = new Map((script?.scenes || []).map((sc) => [sc.id, sc]));
  const out = {};
  for (const sc of scenes) {
    const f = byId.get(sc.id)?.cutoutFile;
    if (typeof f === 'string' && f) out[sc.id] = asset(f);
  }
  return Object.keys(out).length ? out : null;
}

export const CUTOUT_CSS = '\n.cutout{position:absolute;left:0;top:0;z-index:40;pointer-events:none;max-width:none}';

export const CUTOUT_JS = String.raw`
const CUT = [];
window.__cutMissing = [];
function cutFind() {
  for (const sc of D.scenes) {
    const src = D.cutouts[sc.id], g = src && $('g-' + sc.id);
    if (!g) continue;
    let best = null, area = ${CAM_MIN_AREA} * D.W * D.H;
    for (const el of g.querySelectorAll('img, video')) {
      const a = el.offsetWidth * el.offsetHeight;
      if (a >= area) { area = a; best = el; }
    }
    if (!best) { window.__cutMissing.push(sc.id); continue; }
    const im = document.createElement('img'), cs = getComputedStyle(best);
    im.className = 'cutout';
    im.alt = '';
    im.src = src;
    im.style.objectFit = cs.objectFit;
    im.style.objectPosition = cs.objectPosition;
    g.appendChild(im);
    CUT.push({ el: im, src: best, g });
  }
}
function drawCutout() {
  for (const c of CUT) {
    const gr = c.g.getBoundingClientRect(), r = c.src.getBoundingClientRect(), k = gr.width / (c.g.offsetWidth || 1);
    let op = 1;
    for (let n = c.src; n && n !== c.g; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    if (!r.width || !k) { c.el.style.opacity = '0'; continue; }
    const s = c.el.style, r2 = (x) => Math.round(x * 100) / 100;
    s.left = r2((r.left - gr.left) / k) + 'px'; s.top = r2((r.top - gr.top) / k) + 'px';
    s.width = r2(r.width / k) + 'px'; s.height = r2(r.height / k) + 'px';
    s.opacity = op.toFixed(3);
    // The box already holds every move of the picture; the cut-out itself never moves on its own.
    s.transform = 'none'; s.translate = 'none'; s.scale = 'none';
  }
}`;
