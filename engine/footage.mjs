// Footage tools for long brand videos: shots (ffmpeg scene cuts) with one thumbnail each, letterbox bars,
// transcript search, and clips cut from the video into new brand assets with a provenance sidecar.
// ffmpeg and the stored local transcript only; no model is called here.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, StudioError, assertId, assertFileName, within, readJson, writeJson, exists, round, nowIso, loadStudioConfig } from './core.mjs';
import { profileDir, assetPath } from './jobs.mjs';
import { VIDEO_EXT, cleanAssetName, saveAsset } from './assets.mjs';
import { ffmpeg, ffmpegReport, probeMedia, BT709_TAGS } from './media.mjs';
import { loadTranscript, stamp } from './stt.mjs';

const FILLS = ['cover', 'blur-fill'];
const GAIN_DB = [-24, 12];
// Playback speed of a clip: 2 plays the source twice as fast, so an 11 s span becomes a 5.5 s clip.
const SPEED = [0.25, 4];
// A slower clip needs frames between the source's: `blend` mixes neighbours (about as fast as repeating them: 3.1 s
// against 2.8 s for a 6 s 1080p clip), `motion` follows the movement (78.7 s for the same clip, so it is capped at
// MOTION_MAX_SECONDS out), `none` repeats frames, which stutters.
const SMOOTH = { blend: 'minterpolate=fps=30:mi_mode=blend', motion: 'minterpolate=fps=30:mi_mode=mci', none: '' };
const MOTION_MAX_SECONDS = 20;
const MAX_REGIONS = 8;
const MAX_BAND = 45;
const MIN_CLIP_SECONDS = 0.2;
const MIN_BOX = 8;
const FEATHER = 30; // px of soft inner edge on a blurred rectangle
const KEEP_EDGE = [0.92, 0.12]; // the kept ellipse is sharp to 92 % of its radii and fully blurred at 104 %
const BLUR_RADIUS = 24;
const FILL_BG = 'gblur=sigma=45,eq=brightness=-0.2:saturation=0.85';
const ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '15'];
const AUDIO = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];
const IMAGE_RE = /^(\d{1,4}|preview)\.jpg$/;

const caps = () => loadStudioConfig().footage;
const isVideo = (name) => VIDEO_EXT.includes(path.extname(name).slice(1).toLowerCase());

export const footageDir = (project, asset) => within(DIRS.out, '_footage', assertId(project, 'project'), assertFileName(asset, 'asset'));
export const clipSidecar = (project, name) => within(profileDir(project), 'clips', `${assertFileName(name, 'clip')}.clip.json`);

/** A shot thumbnail (`<n>.jpg`) or the last preview frame (`preview.jpg`); any other name is refused. */
export function footageImage(project, asset, name) {
  if (!IMAGE_RE.test(String(name))) throw new StudioError('Invalid image name', 400);
  const dir = footageDir(project, asset);
  return name === 'preview.jpg' ? within(dir, name) : within(dir, 'thumbs', name);
}

function videoAsset(project, asset) {
  assertFileName(asset, 'asset');
  if (!isVideo(asset)) throw new StudioError(`${asset} is not a video file`, 400);
  return assetPath(project, asset);
}

/* ---------- shots and bars (pure parts tested) ---------- */

/** Cut times printed by a `select='gt(scene,…)',showinfo` pass. */
export const cutTimes = (log) => [...String(log).matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);

/** Shots between cuts. A cut less than `minShot` after the kept one before it, or before the end, is ignored. */
export function shotsFromCuts(cuts, duration, minShot) {
  const edges = [0];
  for (const t of [...cuts].sort((a, b) => a - b)) if (t - edges.at(-1) >= minShot && duration - t >= minShot) edges.push(t);
  edges.push(duration);
  return edges.slice(0, -1).map((start, i) => ({ n: i + 1, start: round(start, 3), end: round(edges[i + 1], 3), mid: round((start + edges[i + 1]) / 2, 3) }));
}

/** The last `crop=w:h:x:y` cropdetect printed (with reset=0 it covers every frame it saw), or null. */
export function lastCrop(log) {
  const m = [...String(log).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
  return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
}

/** Letterbox bars: the black or white detection that removes more, when it removes at least 2 % and keeps at least 40 %. */
export function barsFrom(black, white, width, height) {
  const full = width * height;
  const area = (c) => c.w * c.h;
  const ok = (c) => c && c.w > 0 && c.h > 0 && c.x + c.w <= width && c.y + c.h <= height && area(c) <= full * 0.98 && area(c) >= full * 0.4;
  const [pick] = [['black', black], ['white', white]].filter(([, c]) => ok(c)).sort((a, b) => area(a[1]) - area(b[1]));
  if (!pick) return null;
  const [color, c] = pick;
  return { color, crop: c, top: c.y, bottom: height - c.y - c.h, left: c.x, right: width - c.x - c.w };
}

/** Shots, thumbnails and bars of a video asset, kept in out/_footage/<project>/<asset>/ until the file changes. */
export async function analyseFootage(project, asset, { force = false } = {}) {
  const file = videoAsset(project, asset);
  const c = caps();
  const dir = footageDir(project, asset);
  const out = within(dir, 'shots.json');
  const st = stamp(file);
  const old = readJson(out, null);
  if (!force && old?.stamp === st && old.shots.every((s) => exists(within(dir, 'thumbs', s.thumb)))) return old;
  const info = await probeMedia(file);
  if (!info.hasVideo || !info.width) throw new StudioError(`${asset} has no picture to analyse`, 400);
  const timeoutMs = c.analyseTimeoutMinutes * 60000;
  const log = await ffmpegReport(['-i', file, '-an', '-sn', '-vf', `select='gt(scene,${c.sceneThreshold})',showinfo`, '-f', 'null', '-'], { timeoutMs });
  const all = shotsFromCuts(cutTimes(log), info.duration, c.minShotSeconds);
  const shots = all.slice(0, c.maxShots);
  const win = Math.min(c.barsSampleSeconds, info.duration);
  const from = round(Math.max(0, info.duration / 2 - win / 2), 3);
  const detect = (pre) => ffmpegReport(['-ss', String(from), '-t', String(win), '-i', file, '-an', '-sn', '-vf', `${pre}cropdetect=limit=24:round=2:reset=0`, '-f', 'null', '-'], { timeoutMs });
  const bars = barsFrom(lastCrop(await detect('')), lastCrop(await detect('negate,')), info.width, info.height);
  const thumbs = within(dir, 'thumbs');
  fs.rmSync(thumbs, { recursive: true, force: true });
  fs.mkdirSync(thumbs, { recursive: true });
  for (const s of shots) {
    s.thumb = `${s.n}.jpg`;
    await ffmpeg(['-y', '-ss', String(s.mid), '-i', file, '-frames:v', '1', '-vf', `scale=-2:${c.thumbHeight}`, '-q:v', '4', within(thumbs, s.thumb)], { timeoutMs: 60000 });
  }
  const doc = {
    asset, stamp: st, duration: round(info.duration, 3), width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio,
    bars, threshold: c.sceneThreshold, minShot: c.minShotSeconds, truncated: all.length > shots.length, shots, madeAt: nowIso(),
  };
  writeJson(out, doc);
  return doc;
}

/**
 * The cut rhythm of an analysed video: shot count, average and median shot length (s) and cuts per minute. A capped
 * analysis counts only the shots it kept, over the time they cover. Null without at least two shots.
 */
export function rhythmOf(doc) {
  const lens = (doc?.shots || []).map((s) => s.end - s.start).filter((x) => x > 0);
  if (lens.length < 2) return null;
  const span = doc.shots.at(-1).end - doc.shots[0].start;
  const sorted = [...lens].sort((a, b) => a - b), mid = sorted.length >> 1;
  return {
    shots: lens.length,
    averageShot: round(span / lens.length, 2),
    medianShot: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 2),
    cutsPerMinute: round(((lens.length - 1) / span) * 60, 1),
  };
}

/** The stored analysis (with `stale` when the file changed since, and its rhythm) and whether a transcript exists, for the UI. */
export function loadShots(project, asset) {
  const file = videoAsset(project, asset);
  const doc = readJson(within(footageDir(project, asset), 'shots.json'), null);
  const t = loadTranscript(project, asset);
  return { shots: doc && { ...doc, stale: doc.stamp !== stamp(file), rhythm: rhythmOf(doc) }, transcript: t ? { lang: t.lang, stale: Boolean(t.stale) } : null };
}

/** Rhythm of every video asset with a current analysis, for the Director: [{ asset, ...rhythmOf }]. */
export function assetRhythms(project, assets) {
  const out = [];
  for (const asset of assets) {
    if (!isVideo(asset)) continue;
    const doc = readJson(within(footageDir(project, asset), 'shots.json'), null);
    const r = doc && doc.stamp === stamp(videoAsset(project, asset)) ? rhythmOf(doc) : null;
    if (r) out.push({ asset, ...r });
  }
  return out;
}

/* ---------- transcript search ---------- */

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Where a phrase is said: consecutive words, accents and punctuation ignored, the last word may be a prefix. */
export function searchWords(doc, query, max) {
  const q = String(query || '').slice(0, 200).split(/\s+/).map(norm).filter(Boolean);
  if (!q.length) throw new StudioError('Type a word or phrase to find', 400);
  const ws = doc.words.map((w) => ({ ...w, n: norm(w.w) })).filter((w) => w.n);
  const hits = [];
  let total = 0;
  for (let i = 0; i + q.length <= ws.length; i++) {
    if (!q.every((t, j) => (j === q.length - 1 ? ws[i + j].n.startsWith(t) : ws[i + j].n === t))) continue;
    total++;
    if (hits.length >= max) continue;
    const a = ws[i], b = ws[i + q.length - 1];
    const seg = doc.segments.find((s) => a.start >= s.start - 0.05 && a.start <= s.end);
    hits.push({
      start: a.start, end: b.end, text: ws.slice(Math.max(0, i - 5), i + q.length + 5).map((w) => w.w.trim()).join(' '),
      segment: seg ? { start: seg.start, end: seg.end } : null,
    });
  }
  return { hits, total };
}

export function findWords(project, asset, query) {
  assertFileName(asset, 'asset');
  const doc = loadTranscript(project, asset);
  if (!doc) throw new StudioError(`${asset} has no transcript yet. Click Transcribe on it in the Brand tab, or run node engine/cli.mjs transcribe ${project} ${asset}`, 404);
  return { asset, query: String(query || ''), stale: Boolean(doc.stale), ...searchWords(doc, query, caps().maxHits) };
}

/* ---------- clips ---------- */

const num = (v, what) => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (v === null || v === undefined || typeof v === 'boolean' || !Number.isFinite(n)) throw new StudioError(`${what} must be a number`, 400);
  return n;
};

function box(r, W, H, what) {
  const o = { x: Math.round(num(r?.x, `${what} x`)), y: Math.round(num(r?.y, `${what} y`)), w: Math.round(num(r?.w, `${what} w`)), h: Math.round(num(r?.h, `${what} h`)) };
  if (o.w < MIN_BOX || o.h < MIN_BOX || o.x < 0 || o.y < 0 || o.x + o.w > W || o.y + o.h > H) {
    throw new StudioError(`${what} must lie inside the ${W}x${H} frame and be at least ${MIN_BOX} px`, 400);
  }
  return o;
}

function ellipse(e, W, H) {
  const o = { cx: Math.round(num(e?.cx, 'keep cx')), cy: Math.round(num(e?.cy, 'keep cy')), rx: Math.round(num(e?.rx, 'keep rx')), ry: Math.round(num(e?.ry, 'keep ry')) };
  if (o.cx < 0 || o.cx > W || o.cy < 0 || o.cy > H || o.rx < MIN_BOX || o.ry < MIN_BOX || o.rx > W || o.ry > H) {
    throw new StudioError(`The kept ellipse must be centred inside the ${W}x${H} frame, radii ${MIN_BOX} px up to the frame size`, 400);
  }
  return o;
}

function evenSize(v, fallback, what) {
  const n = v === undefined || v === null || v === '' ? fallback : num(v, what);
  if (!Number.isInteger(n) || n % 2 || n < 160 || n > 3840) throw new StudioError(`${what} must be an even number of pixels from 160 to 3840`, 400);
  return n;
}

/** Checks clip options against the source (`duration`, `width`, `height`) and returns them in their stored form. */
export function validateClipOptions(raw, info, maxSeconds) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const W = info.width, H = info.height;
  const start = round(num(o.in, 'in'), 3);
  let end = round(num(o.out, 'out'), 3);
  if (start < 0 || start >= info.duration) throw new StudioError(`in must be between 0 and ${round(info.duration, 2)} s`, 400);
  if (end <= start) throw new StudioError('out must come after in', 400);
  if (end > info.duration + 0.05) throw new StudioError(`out is past the end of the video (${round(info.duration, 2)} s)`, 400);
  end = Math.min(end, round(info.duration, 3));
  if (end - start < MIN_CLIP_SECONDS) throw new StudioError(`A clip must last at least ${MIN_CLIP_SECONDS} s`, 400);
  if (end - start > maxSeconds) throw new StudioError(`A clip can last at most ${maxSeconds} s`, 400);
  const fill = o.fill ?? 'cover';
  if (!FILLS.includes(fill)) throw new StudioError(`fill must be ${FILLS.join(' or ')}`, 400);
  let band = null;
  if (o.band) {
    const pct = (v) => (v === undefined || v === null || v === '' ? 0 : num(v, 'band'));
    band = { top: round(pct(o.band.top), 2), bottom: round(pct(o.band.bottom), 2) };
    if ([band.top, band.bottom].some((p) => p < 0 || p > MAX_BAND)) throw new StudioError(`Crop top and bottom are percentages from 0 to ${MAX_BAND}`, 400);
    if (!band.top && !band.bottom) band = null;
  }
  const regions = o.blurRegions ?? [];
  if (!Array.isArray(regions)) throw new StudioError('blurRegions must be a list of rectangles', 400);
  if (regions.length > MAX_REGIONS) throw new StudioError(`At most ${MAX_REGIONS} blur regions`, 400);
  const gainDb = o.gainDb === undefined || o.gainDb === null || o.gainDb === '' ? 0 : round(num(o.gainDb, 'gainDb'), 1);
  if (gainDb < GAIN_DB[0] || gainDb > GAIN_DB[1]) throw new StudioError(`Gain must be from ${GAIN_DB[0]} to +${GAIN_DB[1]} dB`, 400);
  const speed = o.speed === undefined || o.speed === null || o.speed === '' ? 1 : round(num(o.speed, 'speed'), 2);
  if (speed < SPEED[0] || speed > SPEED[1]) throw new StudioError(`Speed must be from ${SPEED[0]} to ${SPEED[1]}`, 400);
  // Only a slower clip has a smoothing choice; a clip at speed 1 or faster keeps its stored shape.
  const smooth = speed < 1 ? (o.smooth === undefined || o.smooth === null || o.smooth === '' ? 'blend' : o.smooth) : null;
  if (smooth !== null && !(smooth in SMOOTH)) throw new StudioError(`smooth must be ${Object.keys(SMOOTH).join(', ')}`, 400);
  if (smooth === 'motion' && (end - start) / speed > MOTION_MAX_SECONDS) {
    throw new StudioError(`Smooth motion is slow to make: it takes clips up to ${MOTION_MAX_SECONDS} s after the speed change. Use blend for a longer one.`, 400);
  }
  return {
    in: start, out: end,
    crop: o.crop ? box(o.crop, W, H, 'crop') : null,
    band, fill,
    blurRegions: regions.map((r, i) => box(r, W, H, `blur region ${i + 1}`)),
    keep: o.keep ? ellipse(o.keep, W, H) : null,
    gainDb, mute: Boolean(o.mute), speed, ...(smooth ? { smooth } : {}),
    width: evenSize(o.width, 1920, 'width'), height: evenSize(o.height, 1080, 'height'),
  };
}

const nest = (fn, xs) => xs.reduce((a, b) => `${fn}(${a}\\,${b})`);

/**
 * The blur mask's frame: the crop rect when there is one, so the blur never samples cropped-off bars, with the
 * rectangles and the ellipse (given in source pixels) moved into it. Null when nothing is blurred.
 */
export function maskFrame(o, info) {
  if (!o.blurRegions.length && !o.keep) return null;
  const c = o.crop || { x: 0, y: 0, w: info.width, h: info.height };
  const blurRegions = o.blurRegions.map((r) => {
    const x = Math.max(0, r.x - c.x), y = Math.max(0, r.y - c.y);
    return { x, y, w: Math.min(c.w, r.x + r.w - c.x) - x, h: Math.min(c.h, r.y + r.h - c.y) - y };
  }).filter((r) => r.w > 0 && r.h > 0);
  if (o.blurRegions.length && !blurRegions.length) return null;
  return { W: c.w, H: c.h, blurRegions, keep: o.keep && { ...o.keep, cx: o.keep.cx - c.x, cy: o.keep.cy - c.y } };
}

const minus = (v, n) => (n < 0 ? `${v}+${-n}` : `${v}-${n}`);

/** geq expression of the blur mask: 255 inside the blurred rectangles, fading in over FEATHER px, 0 inside the kept ellipse. */
export function maskExpr({ W, H, blurRegions, keep }) {
  const rect = (r) => {
    const d = [r.x > 0 && `X-${r.x}`, r.x + r.w < W && `${r.x + r.w}-X`, r.y > 0 && `Y-${r.y}`, r.y + r.h < H && `${r.y + r.h}-Y`].filter(Boolean);
    return d.length ? `clip((${nest('min', d)})/${FEATHER}\\,0\\,1)` : '1';
  };
  const area = blurRegions.length ? nest('max', blurRegions.map(rect)) : '1';
  const kept = keep ? `clip((hypot((${minus('X', keep.cx)})/${keep.rx}\\,(${minus('Y', keep.cy)})/${keep.ry})-${KEEP_EDGE[0]})/${KEEP_EDGE[1]}\\,0\\,1)` : '1';
  return `255*${area}*${kept}`;
}

export const maskArgs = (m, out) => ['-y', '-f', 'lavfi', '-i', `color=black:s=${m.W}x${m.H},format=gray`, '-frames:v', '1', '-vf', `geq=lum='${maskExpr(m)}'`, out];

/** atempo filters for a speed: each one takes 0.5-2, so 4x is two steps of 2. Nothing at speed 1. */
export function tempo(speed) {
  const steps = [];
  let left = speed;
  while (left > 2) { steps.push(2); left /= 2; }
  while (left < 0.5) { steps.push(0.5); left /= 0.5; }
  if (round(left, 4) !== 1) steps.push(round(left, 4));
  return steps.map((x) => `,atempo=${x}`).join('');
}

/** The filter_complex of a clip: crop rect, optional masked blur, crop band, then cover or blur-fill to the output size. */
export function clipGraph(o, info) {
  const { width: ow, height: oh } = o;
  const g = [];
  let cur = '0:v';
  const pre = [];
  const crop = o.crop && `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y}`;
  const m = maskFrame(o, info);
  if (m) {
    const r = Math.max(2, Math.min(BLUR_RADIUS, Math.floor(Math.min(m.W, m.H) / 8)));
    g.push(`[0:v]${crop ? `${crop},` : ''}split[src][soft]`, `[soft]boxblur=${r}:3[bl]`, '[bl][1:v]alphamerge[bm]', '[src][bm]overlay=0:0:shortest=1[sharp]');
    cur = 'sharp';
  } else if (crop) pre.push(crop);
  if (o.band) pre.push(`crop=iw:ih*${round(1 - (o.band.top + o.band.bottom) / 100, 4)}:0:ih*${round(o.band.top / 100, 4)}`);
  const cover = `scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh}`;
  // A faster clip drops frames (setpts, then the 30 fps output rate); a slower one fills the gaps as `smooth` says.
  const fill = o.speed < 1 && SMOOTH[o.smooth] ? `${SMOOTH[o.smooth]},` : '';
  const tail = `${o.speed !== 1 ? `setpts=PTS/${o.speed},${fill}` : ''}setsar=1,format=yuv420p`;
  if (o.fill === 'blur-fill') {
    g.push(`[${cur}]${[...pre, 'split'].join(',')}[a][b]`, `[a]${cover},${FILL_BG}[bg]`, `[b]scale=${ow}:${oh}:force_original_aspect_ratio=decrease[fg]`, `[bg][fg]overlay=(W-w)/2:(H-h)/2,${tail}[v]`);
  } else {
    g.push(`[${cur}]${[...pre, cover, tail].join(',')}[v]`);
  }
  if (!o.mute && info.hasAudio) g.push(`[0:a:0]volume=${o.gainDb}dB${tempo(o.speed)}[a]`);
  return g.join(';');
}

/** ffmpeg arguments for the clip, or (frame) for one JPEG at the in point. */
export function clipArgs(o, info, { src, mask = null, out, frame = false }) {
  const len = String(round(o.out - o.in, 3)), outLen = String(round((o.out - o.in) / o.speed, 3));
  const args = ['-y', '-ss', String(o.in), ...(frame ? [] : ['-t', len]), '-i', src, ...(mask ? ['-loop', '1', '-i', mask] : [])];
  args.push('-filter_complex', clipGraph(frame ? { ...o, mute: true, smooth: 'none' } : o, info), '-map', '[v]');
  if (frame) return [...args, '-frames:v', '1', '-q:v', '3', out];
  const sound = !o.mute && info.hasAudio;
  return [...args, ...(sound ? ['-map', '[a]'] : []), ...ENCODE, ...(sound ? AUDIO : ['-an']), '-t', outLen, ...BT709_TAGS, '-movflags', '+faststart', out];
}

/** The asset name of a new clip: always .mp4, a clean file name. */
export function clipName(raw) {
  const base = String(raw || '').trim();
  if (!base) throw new StudioError('Give the clip a file name', 400);
  return assertFileName(cleanAssetName(/\.mp4$/i.test(base) ? base : `${base.replace(/\.(webm|mov)$/i, '')}.mp4`), 'clip');
}

/** Runs `fn(o, info, file, mask)` in a scratch folder with the options checked and the blur mask drawn. */
async function withClip(project, asset, raw, scratch, fn) {
  const file = videoAsset(project, asset);
  const info = await probeMedia(file);
  if (!info.hasVideo || !info.width) throw new StudioError(`${asset} has no picture`, 400);
  const o = validateClipOptions(raw, info, caps().maxClipSeconds);
  const tmp = within(footageDir(project, asset), scratch);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const m = maskFrame(o, info);
    const mask = m && within(tmp, 'mask.png');
    if (m) await ffmpeg(maskArgs(m, mask), { timeoutMs: 60000 });
    return await fn(o, info, file, mask, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** One frame at the in point with these options, as out/_footage/<project>/<asset>/preview.jpg. */
export function previewFrame(project, asset, raw) {
  return withClip(project, asset, raw, 'work-frame', async (o, info, src, mask) => {
    const out = footageImage(project, asset, 'preview.jpg');
    await ffmpeg(clipArgs(o, info, { src, mask, out, frame: true }), { timeoutMs: 60000 });
    return { image: 'preview.jpg', at: o.in, width: o.width, height: o.height };
  });
}

/** Cuts a clip into a new brand asset and writes profiles/<project>/clips/<name>.clip.json (source, in/out, operations). */
export async function makeClip(project, asset, raw = {}, { by = 'cli' } = {}) {
  const name = clipName(raw.name);
  const replace = Boolean(raw.replace);
  if (name === asset) throw new StudioError('Pick another name: a clip cannot replace its own source', 409);
  if (!replace && exists(within(path.join(profileDir(project), 'assets'), name))) throw new StudioError(`${name} already exists. Tick "Replace existing" to overwrite it.`, 409);
  return withClip(project, asset, raw, 'work-clip', async (o, info, src, mask, tmp) => {
    const out = within(tmp, 'clip.mp4');
    await ffmpeg(clipArgs(o, info, { src, mask, out }), { timeoutMs: caps().clipTimeoutMinutes * 60000 });
    const saved = saveAsset(project, name, fs.readFileSync(out), { replace });
    const { in: start, out: end, ...ops } = o;
    const sidecar = { source: asset, sourceStamp: stamp(src), in: start, out: end, ...ops, sound: !o.mute && info.hasAudio, madeAt: nowIso(), by };
    writeJson(clipSidecar(project, saved.name), sidecar);
    return { ...saved, sidecar };
  });
}

/** Drops what belongs to a deleted asset: its clip sidecar and its shots folder. */
export function forgetFootage(project, asset) {
  fs.rmSync(clipSidecar(project, asset), { force: true });
  fs.rmSync(footageDir(project, asset), { recursive: true, force: true });
}
