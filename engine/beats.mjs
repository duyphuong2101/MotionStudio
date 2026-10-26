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
  for (let pass = 0; pass < 2; pass++) {
    const pts = [];
    for (let k = 0; A + k * P < env.length; k++) {
      const e = A + k * P, from = Math.max(0, Math.round(e - P / 4)), to = Math.min(env.length - 1, Math.round(e + P / 4));
      let m = from;
      for (let i = from; i <= to; i++) if (env[i] > env[m]) m = i;
      if (env[m] > 0) pts.push([k, m]);
    }
    if (pts.length < 4) break;
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

/** Decodes the start of a music file to mono and finds its beat grid. */
export async function detectBeats(file) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-beat-')), 'm.raw');
  try {
    await ffmpeg(['-y', '-i', file, '-t', String(MAX_SECONDS), '-ac', '1', '-ar', String(RATE), '-f', 's16le', tmp], { timeoutMs: 60000 });
    const buf = fs.readFileSync(tmp);
    const samples = new Float32Array(buf.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
    const grid = beatGrid(onsetEnvelope(samples), HOP / RATE, WIN / 2 / RATE);
    return grid && { ...grid, source: 'detected' };
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
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
