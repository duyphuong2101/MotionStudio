// Subject cut-out (plan .ai/plans/art-direction.md E5): a local segmentation model gives a matte for a still picture,
// and ffmpeg writes the picture's subject alone as an RGBA PNG. No network: the person puts the model file in
// models/matte/ (config/studio.json → matte). The default contract is the U²-Net family as rembg exports it
// (u2net_human_seg.onnx or u2netp.onnx, Apache-2.0): one float input [1, 3, S, S] with ImageNet normalisation, the
// first output a [1, 1, S, S] map of how much each pixel is subject. Without the file a cut-out is skipped with a
// warning, never an error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, StudioError, loadStudioConfig } from './core.mjs';
import { ffmpeg } from './media.mjs';

export const MATTE_DEFAULTS = { model: 'models/matte/matte.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], maxPerJob: 12 };
const TIMEOUT_MS = 60000;
// Reframe (plan .ai/plans/publish-kit.md): frames read per clip, as shares of its span, and the least subject that counts.
const FOCUS_SAMPLES = [0.2, 0.5, 0.8];
const MIN_SUBJECT = 0.01;

export function matteConfig(cfg = loadStudioConfig()) {
  return { ...MATTE_DEFAULTS, ...(cfg.matte || {}) };
}

/** Whether a cut-out can be made, and why not. The model path stays inside the repo. */
export function matteStatus(opts = matteConfig()) {
  const file = path.resolve(ROOT, opts.model);
  if (!file.startsWith(ROOT + path.sep)) return { available: false, reason: 'matte.model must be a file inside the project folder' };
  if (!fs.existsSync(file)) return { available: false, reason: `${opts.model} is missing (a U²-Net segmentation model, e.g. u2net_human_seg.onnx, saved under that name)` };
  return { available: true, file };
}

/** RGB bytes (S × S × 3) → the model's input: planar float32, normalised per channel. Pure, for tests. */
export function toTensorData(rgb, size, mean = MATTE_DEFAULTS.mean, std = MATTE_DEFAULTS.std) {
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c];
  return out;
}

/**
 * The model's output map → 8-bit alpha. A map outside 0-1 is passed through a sigmoid first (a raw logit output);
 * then it is stretched min to max, as rembg does, so a faint subject still cuts out cleanly. Pure, for tests.
 */
export function toAlpha(map) {
  let lo = Infinity, hi = -Infinity;
  for (const v of map) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const logits = lo < -0.01 || hi > 1.01;
  const p = logits ? Float32Array.from(map, (v) => 1 / (1 + Math.exp(-v))) : map;
  if (logits) { lo = Infinity; hi = -Infinity; for (const v of p) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  const span = hi - lo || 1;
  return Uint8Array.from(p, (v) => Math.round(Math.max(0, Math.min(1, (v - lo) / span)) * 255));
}

/** ffmpeg arguments that write `out` (PNG): `src` with the S × S gray matte in `matteRaw` scaled up as its alpha. */
export const applyMatteArgs = (src, matteRaw, size, out) => ['-y', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${size}x${size}`, '-i', matteRaw,
  '-filter_complex', '[1:v][0:v]scale2ref=flags=bicubic[m][c];[c]format=rgba[cc];[cc][m]alphamerge', '-frames:v', '1', out];

let session = null, sessionFile = null;
async function load(file) {
  if (session && sessionFile === file) return session;
  const ort = (await import('onnxruntime-node')).default;
  session = await ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
  sessionFile = file;
  return session;
}

/** The S × S subject map of the RGB bytes `rgb`: `segment(rgb, size)` when given (tests), else the model. */
async function segmentRgb(rgb, opts, segment) {
  const S = opts.size;
  if (segment) return segment(rgb, S);
  const st = matteStatus(opts);
  if (!st.available) throw new StudioError(`A cut-out needs a segmentation model: ${st.reason}`, 400);
  const ort = (await import('onnxruntime-node')).default;
  const s = await load(st.file);
  const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', toTensorData(rgb, S, opts.mean, opts.std), [1, 3, S, S]) });
  const map = res[s.outputNames[0]].data;
  if (map.length !== S * S) throw new StudioError(`${opts.model} gave a ${map.length}-value map, not ${S}×${S}: set matte.size to the model's input size`, 400);
  return map;
}

/**
 * Where the subject of a matte sits: the centre of the pixels at least half subject, as 0-1 of the width and height,
 * and their share of the picture. Null when under MIN_SUBJECT of the picture is subject. Pure, for tests.
 */
export function subjectFocus(alpha, size) {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < 128) continue;
    n++; sx += i % size; sy += Math.floor(i / size);
  }
  const share = n / (size * size);
  if (share < MIN_SUBJECT) return null;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { x: r3((sx / n + 0.5) / size), y: r3((sy / n + 0.5) / size), share: r3(share) };
}

/**
 * One focus point for a span of a video: the subject's centre in FOCUS_SAMPLES frames, weighted by how much of each
 * frame is subject. Null when no frame shows a subject. `segment` as in makeCutout.
 */
export async function clipFocus(file, from, seconds, { opts = matteConfig(), segment = null } = {}) {
  const S = opts.size;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-focus-'));
  try {
    let w = 0, x = 0, y = 0;
    for (const [k, at] of FOCUS_SAMPLES.entries()) {
      const raw = path.join(tmp, `f${k}.rgb`);
      await ffmpeg(['-y', '-ss', String(Math.max(0, from + seconds * at)), '-i', file, '-frames:v', '1', '-vf', `scale=${S}:${S}:flags=bicubic,format=rgb24`, '-f', 'rawvideo', raw], { timeoutMs: TIMEOUT_MS });
      const rgb = fs.readFileSync(raw);
      if (rgb.length !== S * S * 3) continue;
      const f = subjectFocus(toAlpha(await segmentRgb(rgb, opts, segment)), S);
      if (!f) continue;
      w += f.share; x += f.x * f.share; y += f.y * f.share;
    }
    if (!w) return null;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return { x: r3(x / w), y: r3(y / w) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Writes `out`, the subject of picture `src` on a transparent ground. `segment(rgb, size)` (tests pass their own)
 * returns the S × S map; by default the model in models/matte/ runs.
 */
export async function makeCutout(src, out, { opts = matteConfig(), segment = null } = {}) {
  const S = opts.size;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-matte-'));
  try {
    const raw = path.join(tmp, 'in.rgb');
    await ffmpeg(['-y', '-i', src, '-vf', `scale=${S}:${S}:flags=bicubic,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', raw], { timeoutMs: TIMEOUT_MS });
    const rgb = fs.readFileSync(raw);
    if (rgb.length !== S * S * 3) throw new StudioError(`Could not read ${path.basename(src)} for a cut-out`, 400);
    const map = await segmentRgb(rgb, opts, segment);
    const matte = path.join(tmp, 'matte.gray');
    fs.writeFileSync(matte, toAlpha(map));
    await ffmpeg(applyMatteArgs(src, matte, S, out), { timeoutMs: TIMEOUT_MS });
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
