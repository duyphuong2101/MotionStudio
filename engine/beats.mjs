// Beat grid of a music track, so scene cuts can land on the beat. Built-in tracks know their own
// tempo; an uploaded track is analysed once per prepare: onset envelope → tempo by autocorrelation → phase.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { round } from './core.mjs';
import { ffmpeg } from './media.mjs';

const RATE = 11025;
const HOP = 256;
const WIN = 512;
const BPM_RANGE = [60, 180];
const MAX_SECONDS = 180;

/** Onset strength per hop: rise of log energy, half-wave rectified. Pure, for tests. */
export function onsetEnvelope(samples, { hop = HOP, win = WIN } = {}) {
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop; j < i * hop + win; j++) e += samples[j] * samples[j];
    const loge = Math.log(1e-9 + e);
    env[i] = i ? Math.max(0, loge - prev) : 0;
    prev = loge;
  }
  return env;
}

/**
 * Tempo and phase from an onset envelope sampled every `dt` seconds (`center`: where in a hop its sound sits). Returns { period, offset, bpm, confidence }
 * or null when no lag stands out. A mild preference for 90-130 BPM breaks ties between a tempo and its double.
 */
export function beatGrid(env, dt, center = 0) {
  const lagOf = (bpm) => 60 / bpm / dt;
  const [lo, hi] = [lagOf(BPM_RANGE[1]), lagOf(BPM_RANGE[0])];
  // A light blur, so a beat that falls between two hops still lines up with its neighbours.
  const K = [0.25, 0.5, 1, 0.5, 0.25];
  const sm = Array.from(env, (_, i) => K.reduce((a, k, j) => a + k * (env[i + j - 2] || 0), 0));
  const mean = sm.reduce((a, b) => a + b, 0) / (sm.length || 1);
  const x = sm.map((v) => v - mean);
  const at = (f) => { const i = Math.floor(f), w = f - i; return (x[i] || 0) * (1 - w) + (x[i + 1] || 0) * w; };
  let best = null, sum = 0, count = 0;
  // Fractional lags: a beat period is rarely a whole number of hops, and rounding it lets the peaks drift apart.
  for (let lag = lo; lag <= hi && lag < x.length / 2; lag += 0.25) {
    let r = 0;
    for (let i = 0; i + lag < x.length - 1; i++) r += x[i] * at(i + lag);
    r /= x.length - lag;
    const bpm = 60 / (lag * dt);
    const score = r * Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    sum += Math.max(0, score); count++;
    if (!best || score > best.score) best = { lag, score };
  }
  if (!best || best.score <= 0) return null;
  const confidence = best.score / (sum / count || 1e-9);
  if (confidence < 1.5) return null;
  let phase = 0, phaseScore = -Infinity;
  for (let p = 0; p < best.lag; p += 0.5) {
    let s = 0;
    for (let f = p; f < sm.length; f += best.lag) s += sm[Math.round(f)] || 0;
    if (s > phaseScore) { phaseScore = s; phase = p; }
  }
  // Refine: find the real onset near each expected beat, then fit beat number → time with a straight line.
  // Autocorrelation alone is flat around its peak, and a 1 % period error drifts a whole beat over a long track.
  let P = best.lag, A = phase;
  // Only clear onsets steer the fit: in a quiet intro or a pad without beats the strongest point near an expected
  // beat is noise, and fitting to it bends the tempo (a 30 s pad before a 120 BPM drop read as 118).
  const floor = 0.2 * Math.max(...env);
  // Start at the first clear onset and widen the fit in steps (8 beats, 32, then the whole track), so a small period
  // error is corrected before it drifts outside the search window.
  const i0 = env.findIndex((v) => v > floor);
  if (i0 > A) A += Math.round((i0 - A) / P) * P;
  for (const horizon of [8, 32, Infinity, Infinity]) {
    const pts = [];
    for (let k = 0; k <= horizon && A + k * P < env.length; k++) {
      const e = A + k * P, from = Math.max(0, Math.round(e - P / 4)), to = Math.min(env.length - 1, Math.round(e + P / 4));
      let m = from;
      for (let i = from; i <= to; i++) if (env[i] > env[m]) m = i;
      if (env[m] > floor) pts.push([k, m]);
    }
    if (pts.length < 4) continue;
    const n = pts.length, sk = pts.reduce((a, p) => a + p[0], 0), si = pts.reduce((a, p) => a + p[1], 0);
    const skk = pts.reduce((a, p) => a + p[0] * p[0], 0), ski = pts.reduce((a, p) => a + p[0] * p[1], 0);
    const b = (n * ski - sk * si) / (n * skk - sk * sk);
    if (!(b > 0)) break;
    P = b;
    A = (si - b * sk) / n;
  }
  const period = P * dt;
  const offset = (((A * dt + center) % period) + period) % period;
  return { period: round(period, 4), offset: round(offset, 4), bpm: round(60 / period, 1), confidence: round(confidence, 2) };
}

/** The start of a music file (MAX_SECONDS) as mono samples at RATE. */
async function decodeMusic(file) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-beat-')), 'm.raw');
  try {
    await ffmpeg(['-y', '-i', file, '-t', String(MAX_SECONDS), '-ac', '1', '-ar', String(RATE), '-f', 's16le', tmp], { timeoutMs: 60000 });
    const buf = fs.readFileSync(tmp);
    const samples = new Float32Array(buf.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
    return samples;
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

/** Decodes the start of a music file to mono and finds its beat grid. */
export async function detectBeats(file) {
  const grid = beatGrid(onsetEnvelope(await decodeMusic(file)), HOP / RATE, WIN / 2 / RATE);
  return grid && { ...grid, source: 'detected' };
}

// A drop: the music's loudness over the next DROP_WINDOW seconds is at least DROP_RISE dB above the loudness of the
// window before, and the loud side is at least as loud as the track's median. Frames of DROP_FRAME seconds.
export const DROP_FRAME = 0.1, DROP_WINDOW = 3, DROP_RISE = 5, DROP_GAP = 8, DROP_MAX = 3;

/**
 * The drops of a track as [{ at, rise }] (seconds, dB), strongest first, at most DROP_MAX, DROP_GAP apart. With a beat
 * grid each lands on the nearest beat. Pure, for tests.
 */
export function findDrops(samples, rate = RATE, grid = null) {
  const per = Math.round(rate * DROP_FRAME);
  const n = Math.floor(samples.length / per);
  const pow = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * per; j < (i + 1) * per; j++) e += samples[j] * samples[j];
    pow[i] = e / per;
  }
  const db = (p) => 10 * Math.log10(p + 1e-12);
  const median = db([...pow].sort((a, b) => a - b)[Math.floor(n / 2)] || 0);
  const w = Math.round(DROP_WINDOW / DROP_FRAME);
  const mean = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += pow[i]; return s / (b - a); };
  const found = [];
  for (let i = w; i + w <= n; i++) {
    const after = db(mean(i, i + w)), rise = after - db(mean(i - w, i));
    if (rise >= DROP_RISE && after >= median) found.push({ at: i * DROP_FRAME, rise });
  }
  const snap = (t) => {
    if (!grid) return t;
    const k = Math.round((t - grid.offset) / grid.period);
    return grid.offset + Math.max(0, k) * grid.period;
  };
  const out = [];
  for (const d of found.sort((a, b) => b.rise - a.rise)) {
    if (out.length >= DROP_MAX) break;
    if (out.some((o) => Math.abs(o.at - d.at) < DROP_GAP)) continue;
    out.push(d);
  }
  return out.map((d) => ({ at: round(snap(d.at), 3), rise: round(d.rise, 1) }));
}

/** The beat grid and drops of a music file, from one decode. */
export async function analyseMusic(file, knownGrid = null) {
  const samples = await decodeMusic(file);
  const found = knownGrid ? null : beatGrid(onsetEnvelope(samples), HOP / RATE, WIN / 2 / RATE);
  const grid = knownGrid || (found && { ...found, source: 'detected' });
  return { grid, drops: findDrops(samples, RATE, grid) };
}

// A drop earlier in the track than its scene can still land by starting the music late, by at most this much.
export const DROP_MAX_DELAY = 3;

/**
 * How far to move the music so a drop lands at `sceneStart`: the strongest drop that needs the track to play from
 * later on (shift >= 0, short of its end), else the strongest one a short late start reaches. null when none fits.
 */
export function dropShift(drops, sceneStart, musicSeconds) {
  const fits = drops.map((d) => ({ at: d.at, shift: round(d.at - sceneStart, 3) }));
  return fits.find((f) => f.shift >= 0 && f.shift < musicSeconds - 2)
    || fits.find((f) => f.shift < 0 && f.shift >= -DROP_MAX_DELAY) || null;
}

/**
 * The page's beat pulse in video time: `beats` (every `step`-th beat, at least PULSE_GAP apart, so a fast track does
 * not shake the frame) and `hits` (the drops). `shift` is how far the music is moved: positive plays it from later
 * in the track, negative starts it after the video starts.
 */
export const PULSE_GAP = 0.9;
export function pulseTimes(grid, drops, duration, shift = 0) {
  const hits = drops.map((d) => round(d.at - shift, 3)).filter((t) => t >= 0 && t < duration - 0.05).sort((a, b) => a - b);
  if (!grid) return { beats: [], hits };
  const step = Math.max(1, Math.ceil(PULSE_GAP / grid.period - 1e-9));
  const P = grid.period * step;
  const first = ((((grid.offset - shift) % P) + P) % P);
  const beats = [];
  // Before a delayed music start there is no beat to pulse on.
  for (let t = first; t < duration - 0.05; t += P) if (t >= Math.max(0.05, -shift)) beats.push(round(t, 3));
  return { beats, hits };
}

/**
 * snap(t): the first beat at or after `t`, so a scene only ever grows (its voice line is never cut);
 * a scene longer than `maxStretch` would need is left as it is.
 */
export function beatSnap({ period, offset }, maxStretch = 0.75) {
  return (t) => {
    const k = Math.ceil((t - offset - 1e-6) / period);
    const b = offset + Math.max(0, k) * period;
    return b - t <= maxStretch ? round(b, 3) : t;
  };
}
