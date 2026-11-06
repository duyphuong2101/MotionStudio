// A scene's `camera` (engine/direction.mjs): a slow move over the scene's main picture or clip, the largest <img> or
// <video> in its group that covers at least CAM_MIN_AREA of the frame (a render's clip frames are <img class=
// "clipframe">, swapped in before build). drawCam(t), which seek(t) calls, sets the CSS `scale` and `translate`
// properties from the time alone: they compose with the `transform` the renderer's own tweens write (a Ken Burns,
// an entrance), so the two never fight. A page where no scene sets a camera gets none of this code.
import { cameraOf } from '../engine/direction.mjs';

export const CAM_MIN_AREA = 0.3;

/** Page data: { <scene id>: [zoom, x, y from, zoom, x, y to] } for the page's scenes with a camera, or null. */
export function cameraData(script, scenes) {
  const byId = new Map((script?.scenes || []).map((sc) => [sc.id, sc]));
  const out = {};
  for (const sc of scenes) {
    const c = cameraOf(byId.get(sc.id)?.camera);
    if (c) out[sc.id] = c;
  }
  return Object.keys(out).length ? out : null;
}

/** camFind() (build() calls it) and drawCam(t). A scene with no picture big enough is listed in window.__camMissing. */
export const CAM_JS = String.raw`
const CAM = [];
window.__camMissing = [];
function camFind() {
  for (const sc of D.scenes) {
    const c = D.cams[sc.id], g = c && $('g-' + sc.id);
    if (!g) continue;
    let best = null, area = ${CAM_MIN_AREA} * D.W * D.H;
    for (const el of g.querySelectorAll('img, video')) {
      const a = el.offsetWidth * el.offsetHeight;
      if (a >= area) { area = a; best = el; }
    }
    if (best) CAM.push({ el: best, w: best.offsetWidth, h: best.offsetHeight, s: sc.start, e: sc.end, c });
    else window.__camMissing.push(sc.id);
  }
}
// Even speed from the scene's start to its end, like a dolly; the point stays framed: the shift is at most the zoom's
// overhang on each side.
function drawCam(t) {
  for (const { el, w, h, s, e, c } of CAM) {
    const p = Math.min(1, Math.max(0, (t - s) / Math.max(0.01, e - s)));
    const z = c[0] + (c[3] - c[0]) * p, x = c[1] + (c[4] - c[1]) * p, y = c[2] + (c[5] - c[2]) * p, k = z - 1;
    el.style.scale = z.toFixed(4);
    el.style.translate = (Math.round((0.5 - x) * w * k * 100) / 100) + 'px ' + (Math.round((0.5 - y) * h * k * 100) / 100) + 'px';
  }
}`;
