// Local speech-to-text: Whisper base (int8 ONNX, from the sherpa-onnx release, MIT weights) on onnxruntime-node.
// No network: models/whisper/ holds encoder.int8.onnx, decoder.int8.onnx and tokens.txt.
// Greedy decoding with Whisper's timestamp rules gives segments; words are spread inside each segment.
import fs from 'node:fs';
import path from 'node:path';
import ort from 'onnxruntime-node';
import { ROOT, StudioError, round } from '../core.mjs';

const DIR = path.join(ROOT, 'models', 'whisper');
const FILES = { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', tokens: 'tokens.txt' };
export const SAMPLE_RATE = 16000;
const N_FFT = 400;
const HOP = 160;
const FRAME_SECONDS = HOP / SAMPLE_RATE; // 0.01 s per mel frame
const WINDOW_FRAMES = 2950; // a little under 30 s per decoding window, as the reference does
const MAX_TOKENS = 224;

export function whisperStatus() {
  const missing = Object.values(FILES).filter((f) => !fs.existsSync(path.join(DIR, f)));
  return missing.length ? { available: false, reason: `models/whisper/ is missing ${missing.join(', ')}` } : { available: true };
}

/* ---------- model metadata: ONNX custom metadata_props (ModelProto field 14), read straight from the protobuf ---------- */
export function onnxMetadata(buf) {
  const out = {};
  let i = 0;
  const varint = (b, at) => { let r = 0, s = 0, c; do { c = b[at.i++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; };
  const at = { i: 0 };
  while (at.i < buf.length) {
    const key = varint(buf, at), field = Math.floor(key / 8), wt = key % 8;
    if (wt === 0) varint(buf, at);
    else if (wt === 1) at.i += 8;
    else if (wt === 5) at.i += 4;
    else if (wt === 2) {
      const len = varint(buf, at);
      if (field === 14) {
        const e = buf.subarray(at.i, at.i + len), ea = { i: 0 };
        let k = '', v = '';
        while (ea.i < e.length) {
          const kk = varint(e, ea), l = varint(e, ea), str = e.subarray(ea.i, ea.i + l).toString('utf8');
          ea.i += l;
          if (Math.floor(kk / 8) === 1) k = str; else v = str;
        }
        out[k] = v;
      }
      at.i += len;
    } else throw new StudioError(`Unreadable ONNX model (wire type ${wt})`, 500);
    i = at.i;
  }
  return i ? out : out;
}

/* ---------- log-mel features, as Whisper computes them ---------- */
let MEL = null, COS = null, SIN = null, WIN = null;

/** Slaney-style mel filterbank (librosa default, which Whisper uses): n_mels × (n_fft / 2 + 1). */
export function melFilters(nMels = 80, sr = SAMPLE_RATE, nFft = N_FFT) {
  const fMin = 0, fMax = sr / 2, minLog = 1000, minLogMel = 15, logStep = Math.log(6.4) / 27;
  const toMel = (f) => (f < minLog ? f / (200 / 3) : minLogMel + Math.log(f / minLog) / logStep);
  const toHz = (m) => (m < minLogMel ? m * (200 / 3) : minLog * Math.exp(logStep * (m - minLogMel)));
  const bins = nFft / 2 + 1;
  const fft = Array.from({ length: bins }, (_, k) => (k * sr) / nFft);
  const lo = toMel(fMin), hi = toMel(fMax);
  const hz = Array.from({ length: nMels + 2 }, (_, i) => toHz(lo + ((hi - lo) * i) / (nMels + 1)));
  return Array.from({ length: nMels }, (_, m) => {
    const enorm = 2 / (hz[m + 2] - hz[m]);
    return Float64Array.from(fft, (f) => Math.max(0, Math.min((f - hz[m]) / (hz[m + 1] - hz[m]), (hz[m + 2] - f) / (hz[m + 2] - hz[m + 1]))) * enorm);
  });
}

/** Float32Array samples at 16 kHz → mel [80][frames] (log10, clipped 8 below the peak, scaled like Whisper). */
export function logMel(samples, nMels = 80) {
  if (!MEL || MEL.length !== nMels) {
    MEL = melFilters(nMels);
    const bins = N_FFT / 2 + 1;
    COS = new Float64Array(bins * N_FFT); SIN = new Float64Array(bins * N_FFT);
    for (let k = 0; k < bins; k++) for (let n = 0; n < N_FFT; n++) { COS[k * N_FFT + n] = Math.cos((2 * Math.PI * k * n) / N_FFT); SIN[k * N_FFT + n] = Math.sin((2 * Math.PI * k * n) / N_FFT); }
    WIN = Float64Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)); // periodic Hann
  }
  // centre=True with reflect padding, and the last frame dropped: floor(len / hop) frames.
  const pad = N_FFT / 2, n = samples.length;
  const at = (i) => { let j = i - pad; if (j < 0) j = -j; if (j >= n) j = 2 * (n - 1) - j; return samples[Math.max(0, Math.min(n - 1, j))] || 0; };
  const frames = Math.floor(n / HOP), bins = N_FFT / 2 + 1;
  const mel = Array.from({ length: nMels }, () => new Float32Array(frames));
  const x = new Float64Array(N_FFT), p = new Float64Array(bins);
  let peak = -Infinity;
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < N_FFT; i++) x[i] = at(t * HOP + i) * WIN[i];
    for (let k = 0; k < bins; k++) {
      let re = 0, im = 0;
      const o = k * N_FFT;
      for (let i = 0; i < N_FFT; i++) { re += x[i] * COS[o + i]; im -= x[i] * SIN[o + i]; }
      p[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      let s = 0;
      const f = MEL[m];
      for (let k = 0; k < bins; k++) s += f[k] * p[k];
      const v = Math.log10(Math.max(1e-10, s));
      mel[m][t] = v;
      if (v > peak) peak = v;
    }
  }
  for (let m = 0; m < nMels; m++) for (let t = 0; t < frames; t++) mel[m][t] = (Math.max(mel[m][t], peak - 8) + 4) / 4;
  return mel;
}

/* ---------- model ---------- */
let model = null;

async function load() {
  if (model) return model;
  const st = whisperStatus();
  if (!st.available) throw new StudioError(`Speech-to-text: ${st.reason}`, 400);
  const opts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 4 };
  const meta = onnxMetadata(fs.readFileSync(path.join(DIR, FILES.encoder)));
  const num = (k) => Number(meta[k]);
  const tokens = new Map();
  for (const line of fs.readFileSync(path.join(DIR, FILES.tokens), 'utf8').split(/\r?\n/)) {
    const [b64, id] = line.trim().split(/\s+/);
    if (b64 && id) tokens.set(Number(id), Buffer.from(b64, 'base64'));
  }
  const codes = meta.all_language_codes.split(','), ids = meta.all_language_tokens.split(',').map(Number);
  model = {
    encoder: await ort.InferenceSession.create(path.join(DIR, FILES.encoder), opts),
    decoder: await ort.InferenceSession.create(path.join(DIR, FILES.decoder), opts),
    nMels: num('n_mels'), nLayer: num('n_text_layer'), nCtx: num('n_text_ctx'), nState: num('n_text_state'), nVocab: num('n_vocab'),
    sot: num('sot'), eot: num('eot'), transcribe: num('transcribe'), translate: num('translate'), noTimestamps: num('no_timestamps'),
    noSpeech: num('no_speech'), blank: num('blank_id'), sotPrev: num('sot_prev'), sotLm: num('sot_lm'),
    langId: new Map(codes.map((c, i) => [c, ids[i]])), langCode: new Map(ids.map((id, i) => [id, codes[i]])),
    nonSpeech: (meta.non_speech_tokens || '').split(',').filter(Boolean).map(Number),
    tokens,
  };
  model.tsBegin = model.noTimestamps + 1;
  return model;
}

const f32 = (data, dims) => new ort.Tensor('float32', data, dims);
const i64 = (arr, dims) => new ort.Tensor('int64', BigInt64Array.from(arr.map(BigInt)), dims);

async function decodeStep(m, tokens, cache, cross, offset) {
  const out = await m.decoder.run({
    tokens: i64(tokens, [1, tokens.length]), in_n_layer_self_k_cache: cache.k, in_n_layer_self_v_cache: cache.v,
    n_layer_cross_k: cross.k, n_layer_cross_v: cross.v, offset: i64([offset], [1]),
  });
  const V = m.nVocab, all = out.logits.data;
  return { logits: Float32Array.from(all.subarray(all.length - V)), cache: { k: out.out_n_layer_self_k_cache, v: out.out_n_layer_self_v_cache } };
}

/**
 * Whisper's timestamp rules on one step's logits (in place): timestamps come in pairs, never go back,
 * the first token is a timestamp within the first second, and a likely timestamp beats any single word.
 */
export function applyTimestampRules(logits, sampled, { tsBegin, eot }, { first }) {
  const NEG = -Infinity, V = logits.length;
  const isTs = (t) => t >= tsBegin;
  const last = sampled.length >= 1 && isTs(sampled.at(-1));
  const penult = sampled.length < 2 || isTs(sampled.at(-2));
  if (last) {
    if (penult) for (let t = tsBegin; t < V; t++) logits[t] = NEG; // a pair just closed: text or the end
    else for (let t = 0; t < eot; t++) logits[t] = NEG; // a segment just opened... closed: another timestamp or the end
  }
  const ts = sampled.filter(isTs);
  if (ts.length) {
    const floor = last && !penult ? ts.at(-1) : ts.at(-1) + 1;
    for (let t = tsBegin; t < Math.min(V, floor); t++) logits[t] = NEG;
  }
  if (first) {
    for (let t = 0; t < tsBegin; t++) logits[t] = NEG;
    for (let t = tsBegin + 51; t < V; t++) logits[t] = NEG; // first timestamp at most 1.0 s in
  }
  // If the timestamps together outweigh the best text token, take a timestamp.
  let mx = NEG;
  for (const v of logits) if (v > mx) mx = v;
  let sumTs = 0, bestText = NEG;
  for (let t = 0; t < V; t++) {
    if (logits[t] === NEG) continue;
    if (t >= tsBegin) sumTs += Math.exp(logits[t] - mx); else if (logits[t] > bestText) bestText = logits[t];
  }
  if (sumTs > 0 && Math.log(sumTs) + mx > bestText) for (let t = 0; t < tsBegin; t++) logits[t] = NEG;
}

const SILENCE_RMS = 0.003;
const rms = (s, from, to) => { let e = 0, n = 0; for (let i = from; i < Math.min(to, s.length); i++) { e += s[i] * s[i]; n++; } return n ? Math.sqrt(e / n) : 0; };

const argmax = (a) => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

/** One window (≤ 29.5 s of mel frames) → tokens, segments relative to the window start. */
async function decodeWindow(m, mel, frames, lang) {
  // Pad with silence frames, as the reference does, so the model can see the end of speech.
  const T = Math.min(3000, frames + 1500);
  const buf = new Float32Array(m.nMels * T);
  for (let b = 0; b < m.nMels; b++) buf.set(mel[b].subarray(0, frames), b * T);
  const enc = await m.encoder.run({ mel: f32(buf, [1, m.nMels, T]) });
  const cross = { k: enc.n_layer_cross_k, v: enc.n_layer_cross_v };
  const size = m.nLayer * m.nCtx * m.nState;
  let cache = { k: f32(new Float32Array(size), [m.nLayer, 1, m.nCtx, m.nState]), v: f32(new Float32Array(size), [m.nLayer, 1, m.nCtx, m.nState]) };

  let langId = lang ? m.langId.get(lang) : null;
  if (!langId) {
    const r = await decodeStep(m, [m.sot], cache, cross, 0);
    const ids = [...m.langCode.keys()];
    langId = ids.reduce((best, id) => (r.logits[id] > r.logits[best] ? id : best), ids[0]);
    cache = { k: f32(new Float32Array(size), [m.nLayer, 1, m.nCtx, m.nState]), v: f32(new Float32Array(size), [m.nLayer, 1, m.nCtx, m.nState]) };
  }
  const prompt = [m.sot, langId, m.transcribe];
  let { logits, cache: c } = await decodeStep(m, prompt, cache, cross, 0);
  let offset = prompt.length;
  const sampled = [];
  const suppress = [m.noTimestamps, m.sot, m.noSpeech, m.translate, m.sotPrev, m.sotLm, ...m.langCode.keys(), ...m.nonSpeech];
  for (let step = 0; step < MAX_TOKENS; step++) {
    for (const t of suppress) logits[t] = -Infinity;
    if (step === 0) { logits[m.eot] = -Infinity; logits[m.blank] = -Infinity; }
    applyTimestampRules(logits, sampled, m, { first: step === 0 });
    const next = argmax(logits);
    if (next === m.eot) break;
    sampled.push(next);
    ({ logits, cache: c } = await decodeStep(m, [next], c, cross, offset));
    offset += 1;
  }
  return { lang: m.langCode.get(langId), ...segmentsOf(m, sampled) };
}

/** Timestamp-delimited tokens → [{ start, end, text }] plus where the last finished segment ends. */
export function segmentsOf(m, sampled) {
  const segs = [];
  let open = null, text = [];
  const flush = (end) => {
    const s = Buffer.concat(text.map((t) => m.tokens.get(t) || Buffer.alloc(0))).toString('utf8').trim();
    if (s && open !== null) segs.push({ start: round(open, 2), end: round(Math.max(end, open + 0.1), 2), text: s });
    text = [];
  };
  let lastDone = 0;
  for (const t of sampled) {
    if (t >= m.tsBegin) {
      const sec = (t - m.tsBegin) * 0.02;
      if (open === null) open = sec;
      else if (text.length) { flush(sec); open = null; lastDone = sec; } else open = sec;
    } else text.push(t);
  }
  const unfinished = text.length > 0;
  if (unfinished && open !== null) flush(open + 1); // text with no closing time: kept, timed loosely
  return { segments: segs, lastDone, unfinished };
}

/** Words of one segment spread over it by length, with a pause after punctuation (as Kokoro timing does). */
export function wordsOf(seg) {
  const ws = seg.text.split(/\s+/).filter(Boolean);
  const weight = (w) => w.length + 2 + (/[.!?]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0);
  const total = ws.reduce((a, w) => a + weight(w), 0) || 1;
  let acc = 0;
  return ws.map((w) => {
    const start = seg.start + ((seg.end - seg.start) * acc) / total;
    acc += weight(w);
    return { w, start: round(start, 2), end: round(seg.start + ((seg.end - seg.start) * acc) / total - 0.02, 2) };
  });
}

/**
 * Float32Array at 16 kHz → { lang, text, segments, words } with times in seconds from the start of `samples`.
 * `lang` is a code such as "en" or "es"; empty means detect it from the first window.
 */
export async function transcribe(samples, { lang = '' } = {}) {
  const m = await load();
  const code = String(lang || '').toLowerCase().split('-')[0];
  if (code && !m.langId.has(code)) throw new StudioError(`Speech-to-text does not know the language "${lang}"`, 400);
  const mel = logMel(samples, m.nMels);
  const total = mel[0].length;
  const segments = [];
  let seek = 0, detected = code || '';
  while (seek < total - 10) {
    const frames = Math.min(WINDOW_FRAMES, total - seek);
    // Whisper tends to invent words over silence: a window with almost no sound is skipped.
    if (rms(samples, seek * HOP, (seek + frames) * HOP) < SILENCE_RMS) { seek += frames; continue; }
    const win = mel.map((row) => row.subarray(seek, seek + frames));
    const r = await decodeWindow(m, win, frames, detected);
    detected ||= r.lang;
    const base = seek * FRAME_SECONDS;
    // The model can stop early (at a window edge, or before speech that ends abruptly). Whatever follows the
    // last finished segment is decoded again as a new window, so nothing is skipped and nothing is said twice.
    const doneSec = r.lastDone > 0.5 && r.lastDone < frames * FRAME_SECONDS - 1 ? r.lastDone : frames * FRAME_SECONDS;
    for (const s of r.segments) if (s.start < doneSec) segments.push({ start: round(base + s.start, 2), end: round(base + Math.min(s.end, doneSec), 2), text: s.text });
    seek += Math.max(1, Math.round(doneSec / FRAME_SECONDS));
  }
  return { lang: detected, text: segments.map((s) => s.text).join(' '), segments, words: segments.flatMap(wordsOf) };
}
