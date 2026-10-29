// A Lottie animation as a brand asset (a .json export from After Effects' Bodymovin or LottieFiles): the upload check,
// and a small sample animation written from code for the Templates tab and the tests, so neither needs a file.
import { StudioError } from './core.mjs';

const MAX_LOTTIE_BYTES = 8 * 1024 * 1024;

/** True when `buf` holds a Lottie animation: a JSON object with a version, a frame rate and layers. */
export function isLottie(buf) {
  if (!buf || buf.length > MAX_LOTTIE_BYTES) return false;
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch { return false; }
  return !!j && typeof j === 'object' && !Array.isArray(j) && typeof j.v === 'string' && Number.isFinite(j.fr) && j.fr > 0
    && Number.isFinite(j.op) && j.op > (j.ip || 0) && Array.isArray(j.layers) && j.layers.length > 0;
}

// lottie-web runs an After Effects expression with eval(): the source is a string `x` on a property object (one
// that carries `k`). Keyframe easing also uses `x`, but as an array of numbers inside `i`/`o`, never a string.
const hasExpression = (node) => {
  if (Array.isArray(node)) return node.some(hasExpression);
  if (!node || typeof node !== 'object') return false;
  if (typeof node.x === 'string' && node.x.trim() && Object.hasOwn(node, 'k')) return true;
  return Object.values(node).some(hasExpression);
};

/** Refuses a Lottie file that would run script (an expression) or load a picture from outside the file. */
export function assertSafeLottie(name, buf) {
  const j = JSON.parse(buf.toString('utf8'));
  if (hasExpression(j.layers) || hasExpression(j.assets)) {
    throw new StudioError(`${name} uses After Effects expressions. Bake them to keyframes before export (Bodymovin: Settings > Expressions off, or "Convert expression to keyframes" in After Effects).`, 400);
  }
  const external = (j.assets || []).find((a) => a && typeof a.p === 'string' && !(a.e === 1 && /^data:/i.test(a.p)));
  if (external) throw new StudioError(`${name} links the picture ${String(external.p).slice(0, 60)} outside the file. Export with images embedded (Bodymovin: Assets > Include in json).`, 400);
}

/** Seconds a Lottie file plays, from its in and out points and frame rate. */
export const lottieSeconds = (j) => ((j.op || 0) - (j.ip || 0)) / (j.fr || 30);

/**
 * The sample animation as a Buffer: a 2 s loop at 30 fps where a rounded square turns a full circle while a dot
 * orbits it, in two greys (the page tints nothing; a brand's own file carries its colours).
 */
export function sampleLottie() {
  const shape = (name, items, ks) => ({ ddd: 0, ind: 1, ty: 4, nm: name, sr: 1, ks, ao: 0, shapes: items, ip: 0, op: 60, st: 0, bm: 0 });
  const rotate = { a: 1, k: [{ t: 0, s: [0], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } }, { t: 60, s: [360] }] };
  const square = shape('square', [{ ty: 'gr', nm: 'g', it: [
    { ty: 'rc', d: 1, s: { a: 0, k: [160, 160] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 28 }, nm: 'r' },
    { ty: 'fl', c: { a: 0, k: [0.33, 0.37, 0.45, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'f' },
    { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
  ] }], { o: { a: 0, k: 100 }, r: rotate, p: { a: 0, k: [250, 250, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } });
  const dot = shape('dot', [{ ty: 'gr', nm: 'g', it: [
    { ty: 'el', d: 1, s: { a: 0, k: [36, 36] }, p: { a: 0, k: [150, 0] }, nm: 'e' },
    { ty: 'fl', c: { a: 0, k: [0.96, 0.62, 0.04, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'f' },
    { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
  ] }], { o: { a: 0, k: 100 }, r: { a: 1, k: [{ t: 0, s: [0], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } }, { t: 60, s: [-360] }] }, p: { a: 0, k: [250, 250, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } });
  dot.ind = 2;
  return Buffer.from(JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op: 60, w: 500, h: 500, nm: 'sample', ddd: 0, assets: [], layers: [square, dot] }), 'utf8');
}
