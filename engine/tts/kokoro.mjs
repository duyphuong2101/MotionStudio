import fs from 'node:fs';
import path from 'node:path';
import ort from 'onnxruntime-node';
import { Worker } from 'node:worker_threads';
import { phonemize as espeak } from 'phonemizer';
import { ROOT, StudioError } from '../core.mjs';

// Model and voices come from the kokoro-onnx GitHub release (Apache-2.0); see README → Voice.
const DIR = path.join(ROOT, 'models', 'kokoro');
const MODEL = path.join(DIR, 'kokoro-v1.0.onnx');
const CONFIG = path.join(DIR, 'config.json');
const VOICES = path.join(DIR, 'voices');
export const SAMPLE_RATE = 24000;
const MAX_TOKENS = 510;

export function kokoroStatus() {
  if (!fs.existsSync(MODEL)) return { available: false, reason: 'models/kokoro/kokoro-v1.0.onnx is missing' };
  if (!fs.existsSync(CONFIG) || !fs.existsSync(VOICES)) return { available: false, reason: 'models/kokoro/config.json or voices/ is missing' };
  return { available: true };
}

export function kokoroVoices() {
  return fs.existsSync(VOICES) ? fs.readdirSync(VOICES).filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4)).sort() : [];
}

let session = null;
let vocab = null;
const styles = new Map();

async function load() {
  if (!session) {
    session = await ort.InferenceSession.create(MODEL, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
    vocab = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).vocab;
  }
}

function voiceStyle(voice) {
  if (!/^[a-z]{2}_[a-z]+$/.test(voice)) throw new StudioError(`Kokoro voice "${voice}" has an unexpected name`, 400);
  if (!styles.has(voice)) {
    const file = path.join(VOICES, `${voice}.bin`);
    if (!fs.existsSync(file)) throw new StudioError(`Kokoro voice "${voice}" not found. Available: ${kokoroVoices().join(', ')}`, 400);
    const buf = fs.readFileSync(file);
    styles.set(voice, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  }
  return styles.get(voice);
}

/* ---------- text → phonemes (same normalisation as kokoro-js, so numbers and money read naturally) ---------- */
function year(e) {
  if (e.includes('.')) return e;
  if (e.includes(':')) { const [a, t] = e.split(':').map(Number); return t === 0 ? `${a} o'clock` : t < 10 ? `${a} oh ${t}` : `${a} ${t}`; }
  const a = parseInt(e.slice(0, 4), 10);
  if (a < 1100 || a % 1000 < 10) return e;
  const t = e.slice(0, 2), r = parseInt(e.slice(2, 4), 10), s = e.endsWith('s') ? 's' : '';
  if (a % 1000 >= 100 && a % 1000 <= 999) { if (r === 0) return `${t} hundred${s}`; if (r < 10) return `${t} oh ${r}${s}`; }
  return `${t} ${r}${s}`;
}
function money(e) {
  const unit = e[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${unit}s`;
  if (!e.includes('.')) return `${e.slice(1)} ${unit}${e.slice(1) === '1' ? '' : 's'}`;
  const [t, r] = e.slice(1).split('.');
  const n = parseInt(r.padEnd(2, '0'), 10);
  return `${t} ${unit}${t === '1' ? '' : 's'} and ${n} ${e[0] === '$' ? (n === 1 ? 'cent' : 'cents') : (n === 1 ? 'penny' : 'pence')}`;
}
const decimal = (e) => { const [a, t] = e.split('.'); return `${a} point ${t.split('').join(' ')}`; };

function normalize(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\S \n]/g, ' ').replace(/  +/g, ' ')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss').replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, year)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, decimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

const PHONEME_TIMEOUT_MS = 20000;
const workers = new Map();

/**
 * espeak for one language. The package keeps the first language it was asked for, so this thread's
 * instance only ever speaks en-us and every other language gets its own worker (kept alive only while busy).
 */
function phonemesIn(lang, text) {
  if (lang === 'en-us') return espeak(text, 'en-us');
  let w = workers.get(lang);
  if (!w) {
    w = { worker: new Worker(new URL('./phoneme-worker.mjs', import.meta.url), { workerData: { lang }, execArgv: [] }), next: 0, waits: new Map() };
    w.worker.unref();
    w.worker.on('message', ({ id, out, err }) => {
      const p = w.waits.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      w.waits.delete(id);
      if (!w.waits.size) w.worker.unref();
      if (err) p.reject(new StudioError(`Phonemizer (${lang}): ${err}`)); else p.resolve(out);
    });
    w.worker.on('error', (err) => { for (const p of w.waits.values()) p.reject(err); w.waits.clear(); workers.delete(lang); });
    workers.set(lang, w);
  }
  return new Promise((resolve, reject) => {
    const id = w.next++;
    const timer = setTimeout(() => { w.waits.delete(id); reject(new StudioError(`Phonemizer (${lang}) timed out`)); }, PHONEME_TIMEOUT_MS);
    w.waits.set(id, { resolve, reject, timer });
    w.worker.ref();
    w.worker.postMessage({ id, text });
  });
}

export async function toPhonemes(text, lang = 'en-us') {
  const t = normalize(text);
  const parts = [];
  let last = 0;
  for (const m of t.matchAll(PUNCT_RE)) {
    if (last < m.index) parts.push({ punct: false, text: t.slice(last, m.index) });
    if (m[0].length) parts.push({ punct: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < t.length) parts.push({ punct: false, text: t.slice(last) });
  const out = (await Promise.all(parts.map(async (p) => (p.punct ? p.text : (await phonemesIn(lang, p.text)).join(' '))))).join('');
  return out
    .replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
    .replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
    .trim();
}

/** Speaks one line. Returns 24 kHz mono samples and the phoneme string used. */
export async function kokoroSpeak(text, voice = 'af_heart', speed = 1, lang = 'en-us') {
  await load();
  const phonemes = await toPhonemes(text, lang);
  const ids = [...phonemes].map((ch) => vocab[ch]).filter((id) => id !== undefined);
  if (ids.length > MAX_TOKENS - 2) throw new StudioError(`Line too long for one Kokoro pass (${ids.length} phoneme tokens, max ${MAX_TOKENS - 2}): split the voice line`, 400);
  const tokens = new ort.Tensor('int64', BigInt64Array.from([0, ...ids, 0].map(BigInt)), [1, ids.length + 2]);
  const all = voiceStyle(voice);
  const offset = 256 * Math.min(ids.length, 509);
  const style = new ort.Tensor('float32', all.slice(offset, offset + 256), [1, 256]);
  const sp = new ort.Tensor('float32', Float32Array.from([speed]), [1]);
  const out = await session.run({ tokens, style, speed: sp });
  return { samples: out.audio.data, phonemes };
}

export function writeWav(file, samples, rate = SAMPLE_RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/** Where speech starts and stops (seconds), so word timing ignores the model's leading/trailing silence. */
export function voicedSpan(samples, rate = SAMPLE_RATE) {
  const win = Math.round(rate * 0.02);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const thr = peak * 0.06;
  const loud = (i) => { let m = 0; for (let j = i; j < Math.min(samples.length, i + win); j++) m = Math.max(m, Math.abs(samples[j])); return m > thr; };
  let a = 0; while (a < samples.length && !loud(a)) a += win;
  let b = samples.length - win; while (b > a && !loud(b)) b -= win;
  return { start: a / rate, end: Math.min(samples.length, b + win) / rate };
}

/** The pauses inside the voiced span (seconds), each at least `min` long, on the same loudness rule as voicedSpan. */
export function voicedPauses(samples, rate = SAMPLE_RATE, min = 0.08) {
  const win = Math.round(rate * 0.02);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const thr = peak * 0.06;
  const span = voicedSpan(samples, rate);
  const out = [];
  let quiet = -1;
  const stop = Math.round(span.end * rate);
  for (let i = Math.round(span.start * rate); i < stop; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) m = Math.max(m, Math.abs(samples[j]));
    if (m <= thr) { if (quiet < 0) quiet = i; continue; }
    if (quiet >= 0 && (i - quiet) / rate >= min) out.push({ start: quiet / rate, end: i / rate });
    quiet = -1;
  }
  return out;
}
