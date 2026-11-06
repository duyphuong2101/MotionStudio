// Per-scene direction (plan .ai/plans/art-direction.md E2), fields every scene may set:
//   cut     its entrance: a blend (whip, zoom, warp, split), a crossfade (fade) or a hard cut (cut)
//   camera  a move over the scene's main picture or clip: a preset name or { from, to } framings
//   grade   that scene's pictures and clips: none, or a preset from engine/grade.mjs
//   drop    true: the music's drop lands on this scene's start (one scene per video)
//   cutout  true: the subject of the scene's main picture is cut out and drawn over the scene's text
// Shared by the script check, the kit page and prepare.
import { BLENDS } from './brand.mjs';
import { GRADES } from './grade.mjs';

export const CUT_KINDS = [...BLENDS, 'fade', 'cut'];
export const SCENE_GRADES = ['none', ...Object.keys(GRADES)];

// A framing: zoom 1-1.6 and the point of the picture (0-1 across and down) the view centres on. At zoom 1 the point
// does nothing; at a higher zoom the view never shows past the picture's edge.
export const CAMERA_RANGE = { zoom: [1, 1.6], x: [0, 1], y: [0, 1] };
const REST = { zoom: 1, x: 0.5, y: 0.5 };
export const CAMERA_MOVES = {
  'push-in': { from: { zoom: 1 }, to: { zoom: 1.18 } },
  'pull-out': { from: { zoom: 1.18 }, to: { zoom: 1 } },
  'pan-left': { from: { zoom: 1.15, x: 0.75 }, to: { zoom: 1.15, x: 0.25 } },
  'pan-right': { from: { zoom: 1.15, x: 0.25 }, to: { zoom: 1.15, x: 0.75 } },
  rise: { from: { zoom: 1.15, y: 0.75 }, to: { zoom: 1.15, y: 0.25 } },
  fall: { from: { zoom: 1.15, y: 0.25 }, to: { zoom: 1.15, y: 0.75 } },
};
export const CAMERA_NAMES = { 'push-in': 'Push in', 'pull-out': 'Pull out', 'pan-left': 'Pan left', 'pan-right': 'Pan right', rise: 'Rise', fall: 'Fall' };

const frameOf = (f) => ({ ...REST, ...f });
const inRange = (v, [a, b]) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;

/** What is wrong with a camera value, or null. */
export function cameraProblem(v) {
  if (typeof v === 'string') return Object.hasOwn(CAMERA_MOVES, v) ? null : `camera must be one of ${Object.keys(CAMERA_MOVES).join(', ')} or { from, to }`;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !v.to) return 'camera must be a move name or { from?, to } with zoom, x and y';
  for (const end of ['from', 'to']) {
    const f = v[end];
    if (f === undefined) continue;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return `camera.${end} must be { zoom, x, y }`;
    for (const k of Object.keys(f)) {
      if (!CAMERA_RANGE[k]) return `camera.${end}.${k} is not a camera field (zoom, x, y)`;
      if (!inRange(f[k], CAMERA_RANGE[k])) return `camera.${end}.${k} must be ${CAMERA_RANGE[k][0]} to ${CAMERA_RANGE[k][1]}`;
    }
  }
  for (const k of Object.keys(v)) if (k !== 'from' && k !== 'to') return `camera.${k} is not a camera field (from, to)`;
  return null;
}

/** A valid camera as the page's six numbers [zoom, x, y] from and to, or null. */
export function cameraOf(v) {
  if (v == null || cameraProblem(v)) return null;
  const m = typeof v === 'string' ? CAMERA_MOVES[v] : v;
  const a = frameOf(m.from), b = frameOf(m.to);
  return [a.zoom, a.x, a.y, b.zoom, b.x, b.y];
}

const MEDIA_RE = /\.(mp4|webm|mov|wav|mp3|m4a)$/i;
const PICTURE_RE = /\.(png|jpe?g|webp)$/i;

/** The still picture a scene's cut-out is made from: image, else asset, else the first photo; null when none. */
export function cutoutPicture(sc) {
  const pics = [sc.image, sc.asset, ...(Array.isArray(sc.photos) ? sc.photos.map((p) => p?.asset) : [])];
  return pics.find((a) => typeof a === 'string' && PICTURE_RE.test(a)) || null;
}

/**
 * Which asset files prepare writes into the job's assets/ and how each is graded: 'brand' (the brand's grade, if any),
 * 'none' (copied as it is) or a preset. A scene's own `grade` gets its own copy of each picture, `g-<grade>-<name>`,
 * and the page reads `pageScript`, where that scene's picture fields name the copy. Brand assets (logos), app
 * screens (ui-story shots), SVG, models and Lottie files are never graded. Footage and sound are cut elsewhere.
 */
export function pictureCopies(script, { brandOwn = new Set() } = {}) {
  const copies = new Map();
  const add = (dest, src, grade) => { if (!copies.has(dest)) copies.set(dest, { src, grade }); };
  const screens = new Set();
  for (const sc of script.scenes) for (const sh of sc.shots || []) if (sh?.asset) screens.add(sh.asset);
  for (const a of brandOwn) if (!MEDIA_RE.test(a)) add(a, a, 'none');
  let renamed = false;
  const pic = (a, own) => {
    if (typeof a !== 'string' || !a || MEDIA_RE.test(a)) return a;
    if (!PICTURE_RE.test(a) || brandOwn.has(a) || screens.has(a)) { add(a, a, 'none'); return a; }
    if (!own) { add(a, a, 'brand'); return a; }
    renamed = true;
    add(`g-${own}-${a}`, a, own);
    return `g-${own}-${a}`;
  };
  const scenes = script.scenes.map((sc) => {
    const own = SCENE_GRADES.includes(sc.grade) ? sc.grade : null;
    for (const f of ['model', 'lottie']) if (typeof sc[f] === 'string' && sc[f]) add(sc[f], sc[f], 'none');
    for (const sh of sc.shots || []) if (sh?.asset) add(sh.asset, sh.asset, 'none');
    const out = { ...sc };
    if (sc.asset) out.asset = pic(sc.asset, own);
    if (sc.image) out.image = pic(sc.image, own);
    if (Array.isArray(sc.photos)) out.photos = sc.photos.map((p) => (p?.asset ? { ...p, asset: pic(p.asset, own) } : p));
    return out;
  });
  return { pageScript: renamed ? { ...script, scenes } : script, copies };
}

/** The script check's errors for a scene's direction fields; `first` is the video's first scene (it has no cut). */
export function directionProblems(s, { first = false } = {}) {
  const errors = [], warnings = [];
  if (s.cut !== undefined && !CUT_KINDS.includes(s.cut)) errors.push(`${s.id}: cut must be one of ${CUT_KINDS.join(', ')}`);
  else if (s.cut !== undefined && first) warnings.push(`${s.id}: the first scene has no cut into it, so its cut does nothing`);
  if (s.camera !== undefined) {
    const p = cameraProblem(s.camera);
    if (p) errors.push(`${s.id}: ${p}`);
  }
  if (s.grade !== undefined && !SCENE_GRADES.includes(s.grade)) errors.push(`${s.id}: grade must be one of ${SCENE_GRADES.join(', ')}`);
  // `drop` (plan E3): the music's drop lands on this scene's start; prepare moves the music to get it there.
  if (s.drop !== undefined && s.drop !== true) errors.push(`${s.id}: drop must be true (or left out)`);
  // `cutout` (plan E5): the subject of the scene's main picture is cut out and drawn over its text.
  if (s.cutout !== undefined && s.cutout !== true) errors.push(`${s.id}: cutout must be true (or left out)`);
  else if (s.cutout === true && !cutoutPicture(s)) errors.push(`${s.id}: cutout needs a .png, .jpg or .webp picture in the scene (image, asset or photos)`);
  return { errors, warnings };
}
