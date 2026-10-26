// A recorded voice-over: one take that reads every voice line in order. Local speech-to-text hears its words,
// a global alignment matches them to the script's lines, each scene's stretch is cut out, and speakScript places
// the cuts where it would place TTS clips. Captions keep the script's own words, timed on the take.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, within, round } from './core.mjs';
import { assetPath, VOICE_TAKE_RE } from './jobs.mjs';
import { ffmpeg, probeMedia } from './media.mjs';
import { clipWords, decode, sttStatus, MAX_TRANSCRIBE_SECONDS } from './stt.mjs';
import { SAMPLE_RATE } from './stt/whisper.mjs';
import { measureLoudness } from './loudness.mjs';
import { wordsOf } from './script.mjs';

// minMatch: share of a line's words the take must say. maxMisses: unheard words any line may have, as long as one
// word was heard, so one misheard word does not fail a 2-3 word line (one miss already passes from 4 words).
export const TAKE_DEFAULTS = { minMatch: 0.7, maxMisses: 1, padding: 0.12, maxExtend: 0.5, targetLufs: -22, maxGainDb: 12 };
const MATCH = 2, CLOSE = 1, MISS = -1, GAP = 1, FUSED = MATCH + CLOSE;
const DIAG = 1, LEFT = 2, UP = 3, FUSE_S = 4, FUSE_H = 5;
const MAX_CELLS = 25e6;
const QUOTE_WORDS = 14;
const SECONDS_PER_WORD = 0.3;
const FRAME = 0.01;
const FADE = 0.01;
const CUT_TIMEOUT_MS = 120000;
const PEAK_CEILING = -1;

/* ---------- words as heard ---------- */
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const under100 = (n) => (n < 20 ? [ONES[n]] : [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])]);
const under1000 = (n) => (n < 100 ? under100(n) : [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? under100(n % 100) : [])]);
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const ordinal = (w) => ORDINAL[w] || (w.endsWith('y') ? `${w.slice(0, -1)}ieth` : `${w}th`);
const SYMBOLS = { '%': 'percent', $: 'dollars', '€': 'euros', '£': 'pounds' };

/** A digit string as English words; four digits that look like a year are read as one ("twenty twenty six"). */
export function numberWords(digits, year = true) {
  if (digits.length > 12) return [...digits].map((d) => ONES[d]);
  const n = Number(digits);
  if (year && digits.length === 4 && n >= 1100 && n < 2100 && !(n >= 2000 && n < 2010)) {
    const lo = n % 100;
    return [...under100(Math.floor(n / 100)), ...(lo === 0 ? ['hundred'] : lo < 10 ? ['oh', ONES[lo]] : under100(lo))];
  }
  if (n === 0) return ['zero'];
  const out = [];
  let r = n;
  for (const [v, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (r >= v) { out.push(...under1000(Math.floor(r / v)), name); r %= v; }
  if (r) out.push(...under1000(r));
  return out;
}

/** One written or heard word → what a listener hears: lower case, no punctuation, and (English) numbers and symbols in words. */
export function spokenTokens(word, en = true) {
  let s = String(word).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const after = [];
  if (en) {
    s = s.replace(/&/g, ' and ');
    for (const [sym, name] of Object.entries(SYMBOLS)) if (s.includes(sym)) after.push(name);
  }
  const out = [];
  // 1,200 (grouped, never a year) | 3.5 | 21st | 2026 | a word
  for (const m of s.matchAll(/(\d{1,3}(?:,\d{3})+)|(\d+)\.(\d+)|(\d+)(?:st|nd|rd|th)\b|\d+|\p{L}+/gu)) {
    if (!en || !/\d/.test(m[0])) out.push(m[1] ? m[1].replace(/,/g, '') : m[0]);
    else if (m[1]) out.push(...numberWords(m[1].replace(/,/g, ''), false));
    else if (m[2]) out.push(...numberWords(m[2]), 'point', ...[...m[3]].map((d) => ONES[d]));
    else if (m[4]) { const w = numberWords(m[4]); out.push(...w.slice(0, -1), ordinal(w.at(-1))); }
    else out.push(...numberWords(m[0]));
  }
  return out.length ? [...out, ...after] : out;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same token, a close one (a small slip in a longer word, as speech recognition makes), or a miss. */
const likeness = (a, b) => (a === b ? MATCH : Math.min(a.length, b.length) >= 4 && editDistance(a, b) / Math.max(a.length, b.length) <= 0.25 ? CLOSE : MISS);

/**
 * Needleman–Wunsch over tokens. Heard tokens before the first and after the last script token cost nothing (a
 * count-in, an extra line at the end); inside, a skipped or extra token costs GAP. Two tokens written apart and
 * heard as one ("month end" / "monthend"), or the other way round, also match. On a tie the later copy of a
 * repeated phrase wins. Returns, per script token, the indices of the heard tokens it matched (empty when none).
 */
function alignTokens(script, heard) {
  const n = script.length, m = heard.length, W = m + 1;
  if ((n + 1) * W > MAX_CELLS) throw new StudioError('The take is too long to match to this script. Record one take per video.', 400);
  // Likeness over distinct tokens only: a few hundred words each, so the edit distances stay cheap.
  const ids = (list, map) => Int32Array.from(list, (t) => { if (!map.has(t)) map.set(t, map.size); return map.get(t); });
  const sMap = new Map(), hMap = new Map();
  const sId = ids(script, sMap), hId = ids(heard, hMap);
  const hWords = [...hMap.keys()];
  const table = [...sMap.keys()].map((a) => Int8Array.from(hWords, (b) => likeness(a, b)));
  const sub = (i, j) => table[sId[i]][hId[j]];
  const fusedCache = new Map();
  const fused = (x, y, z) => {
    if (x[0] !== z[0] || Math.abs(x.length + y.length - z.length) > 2) return 0;
    const key = `${x} ${y}|${z}`;
    if (!fusedCache.has(key)) fusedCache.set(key, likeness(x + y, z) > 0 ? FUSED : 0);
    return fusedCache.get(key);
  };
  const D = new Int32Array((n + 1) * W), P = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) { D[i * W] = -i * GAP; P[i * W] = UP; }
  for (let j = 1; j <= m; j++) P[j] = LEFT;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = D[(i - 1) * W + j - 1] + sub(i - 1, j - 1), dir = DIAG;
      const left = D[i * W + j - 1] - GAP;
      if (left > best) { best = left; dir = LEFT; }
      const up = D[(i - 1) * W + j] - GAP;
      if (up > best) { best = up; dir = UP; }
      const fs = i >= 2 ? fused(script[i - 2], script[i - 1], heard[j - 1]) : 0;
      if (fs && D[(i - 2) * W + j - 1] + fs > best) { best = D[(i - 2) * W + j - 1] + fs; dir = FUSE_S; }
      const fh = j >= 2 ? fused(heard[j - 2], heard[j - 1], script[i - 1]) : 0;
      if (fh && D[(i - 1) * W + j - 2] + fh > best) { best = D[(i - 1) * W + j - 2] + fh; dir = FUSE_H; }
      D[i * W + j] = best; P[i * W + j] = dir;
    }
  }
  let j = 0;
  for (let k = 0; k <= m; k++) if (D[n * W + k] >= D[n * W + j]) j = k;
  const at = Array.from({ length: n }, () => []);
  for (let i = n; i > 0 && j > 0;) {
    const d = P[i * W + j];
    if (d === DIAG) { if (sub(i - 1, j - 1) > 0) at[i - 1].push(j - 1); i--; j--; }
    else if (d === FUSE_S) { at[i - 1].push(j - 1); at[i - 2].push(j - 1); i -= 2; j--; }
    else if (d === FUSE_H) { at[i - 1].push(j - 2, j - 1); i--; j -= 2; }
    else if (d === LEFT) j--; else i--;
  }
  return at;
}

const quote = (words) => (words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(' ')}…` : words.join(' '));

/** Spreads `count` words evenly over [a, b]. */
const spread = (count, a, b) => Array.from({ length: count }, (_, k) => ({ start: a + ((b - a) * k) / count, end: a + ((b - a) * (k + 1)) / count }));

/**
 * Matches heard words ({ w, start, end }, take seconds) to the voice lines ({ id, text }, in script order).
 * Returns per line its words (the script's own spelling) timed on the take, with unmatched words placed between
 * their neighbours, and the share of its words that matched. A line under `minMatch` that also misses more than
 * `maxMisses` words (or matched none) throws, naming the scene and quoting what the take says there.
 */
export function alignTake(lines, heard, { lang = 'en', minMatch = TAKE_DEFAULTS.minMatch, maxMisses = TAKE_DEFAULTS.maxMisses } = {}) {
  const en = String(lang || 'en').toLowerCase().startsWith('en');
  const words = lines.map((l) => wordsOf(l.text));
  const sTok = [], sWord = [], hTok = [], hWord = [];
  words.forEach((ws, si) => ws.forEach((w, wi) => spokenTokens(w, en).forEach((t) => { sTok.push(t); sWord.push([si, wi]); })));
  heard.forEach((h, hi) => spokenTokens(h.w, en).forEach((t) => { hTok.push(t); hWord.push(hi); }));
  const at = alignTokens(sTok, hTok);
  const hits = words.map((ws) => ws.map(() => []));
  const counted = words.map((ws) => ws.map(() => false));
  at.forEach((js, k) => {
    const [si, wi] = sWord[k];
    counted[si][wi] = true;
    for (const j of js) if (!hits[si][wi].includes(hWord[j])) hits[si][wi].push(hWord[j]);
  });
  const heardOf = (si) => hits[si].flat();
  const tally = words.map((_, si) => ({ n: counted[si].filter(Boolean).length, hit: counted[si].filter((c, wi) => c && hits[si][wi].length).length }));
  const share = tally.map(({ n, hit }) => (n ? hit / n : 1));
  const passes = (si) => share[si] >= minMatch || (tally[si].hit > 0 && tally[si].n - tally[si].hit <= maxMisses);
  const bad = lines.map((_, si) => si).filter((si) => !passes(si));
  if (bad.length) {
    const msg = bad.map((si) => {
      const before = lines.slice(0, si).flatMap((_, k) => heardOf(k));
      const after = lines.slice(si + 1).flatMap((_, k) => heardOf(si + 1 + k));
      const lo = before.length ? Math.max(...before) + 1 : 0;
      const hi = after.length ? Math.min(...after) : heard.length;
      const said = quote(heard.slice(lo, hi).map((h) => h.w));
      return `Scene ${lines[si].id}: the take says ${said ? `'${said}'` : 'nothing here'} but the script says '${quote(words[si])}'.`;
    });
    throw new StudioError(`${msg.join(' ')} Re-record the line or edit the script.`, 400);
  }
  const out = [];
  lines.forEach((l, si) => {
    const ws = words[si];
    const t = ws.map((w, wi) => {
      const hs = hits[si][wi].sort((a, b) => a - b);
      return hs.length ? { w, start: heard[hs[0]].start, end: heard[hs.at(-1)].end } : { w };
    });
    if (!t.some((x) => x.start !== undefined)) return; // nothing to time on (no countable word)
    const floor = out.at(-1)?.end ?? 0;
    const nextHeard = lines.slice(si + 1).flatMap((_, k) => heardOf(si + 1 + k));
    const ceiling = nextHeard.length ? heard[Math.min(...nextHeard)].start : Infinity;
    for (let a = 0; a < t.length; a++) {
      if (t[a].start !== undefined) continue;
      let b = a;
      while (b < t.length && t[b].start === undefined) b++;
      const prev = t[a - 1]?.end, next = t[b]?.start, k = b - a;
      const from = prev ?? Math.max(floor, next - k * SECONDS_PER_WORD);
      const to = next ?? Math.min(ceiling, prev + k * SECONDS_PER_WORD);
      spread(k, from, Math.max(from, to)).forEach((x, i) => Object.assign(t[a + i], x));
      a = b;
    }
    const timed = t.map((x) => ({ w: x.w, start: round(x.start), end: round(Math.max(x.start, x.end)) }));
    out.push({ id: l.id, words: timed, start: timed[0].start, end: timed.at(-1).end, match: round(share[si], 2) });
  });
  return out;
}

/** 10 ms frames of the take that carry voice: above a level set by the loud frames and the noise floor; short dips bridged. */
export function voicedFrames(samples, rate) {
  const step = Math.round(rate * FRAME);
  const rms = new Float32Array(Math.floor(samples.length / step));
  for (let f = 0; f < rms.length; f++) {
    let e = 0;
    for (let i = f * step; i < (f + 1) * step; i++) e += samples[i] * samples[i];
    rms[f] = Math.sqrt(e / step);
  }
  const sorted = Float32Array.from(rms).sort();
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
  const thr = Math.max(pick(0.95) * 0.1, pick(0.1) * 2.5, 1e-4);
  const voiced = Uint8Array.from(rms, (v) => (v > thr ? 1 : 0));
  // A stop consonant is a few quiet frames inside a word: up to 40 ms of quiet between voice counts as voice.
  for (let f = 1; f < voiced.length; f++) {
    if (voiced[f] || !voiced[f - 1]) continue;
    let g = f;
    while (g < voiced.length && !voiced[g]) g++;
    if (g < voiced.length && g - f <= 4) voiced.fill(1, f, g);
    f = g;
  }
  return { voiced, step: FRAME };
}

/**
 * Where to cut each scene from the take: its words' span moved onto where the take is voiced (speech recognition
 * times words loosely), then padded, never past the midpoint to the neighbour scene.
 */
export function cutPlan(spans, voiced, step, duration, { padding = TAKE_DEFAULTS.padding, maxExtend = TAKE_DEFAULTS.maxExtend } = {}) {
  const on = (t) => voiced[Math.floor(t / step + 1e-6)] === 1;
  const wide = spans.map((s, i) => {
    const lo = Math.max(0, s.start - maxExtend, i ? spans[i - 1].end : 0);
    const hi = Math.min(duration, s.end + maxExtend, spans[i + 1]?.start ?? duration);
    let a = s.start, b = s.end;
    // Inside voice: widen to where it starts and stops. In silence (a word timed early or late): narrow onto the voice.
    if (on(a)) while (a - step >= lo && on(a - step)) a -= step;
    else while (a + step < b && !on(a)) a += step;
    if (on(b - step)) while (b + step <= hi && on(b)) b += step;
    else while (b - step > a && !on(b - step)) b -= step;
    return { a, b };
  });
  return wide.map((w, i) => {
    const from = Math.max(w.a - padding, i ? (wide[i - 1].b + w.a) / 2 : 0);
    const to = Math.min(w.b + padding, i < wide.length - 1 ? (w.b + wide[i + 1].a) / 2 : duration);
    return { from: round(Math.max(0, from)), to: round(Math.max(to, from + 0.05)) };
  });
}

/** The gain that brings the take to `targetLufs` over its voice lines, within ±maxGainDb and under a −1 dBFS peak. */
export function takeGain(level, { targetLufs = TAKE_DEFAULTS.targetLufs, maxGainDb = TAKE_DEFAULTS.maxGainDb } = {}) {
  if (level?.lufs == null) return 0;
  let g = Math.max(-maxGainDb, Math.min(maxGainDb, targetLufs - level.lufs));
  if (level.peak != null) g = Math.min(g, PEAK_CEILING - level.peak);
  return round(g, 1);
}

/**
 * Prepare's recorded voice: transcribes the take (cached in the job's stt/), aligns it to the script, and cuts one
 * WAV per voiced scene into take/. Returns what speakScript needs: per scene id { wav, seconds, words: [{ w, at }] }.
 */
export async function recordedVoice(project, dir, asset, script, { lang = 'en', opts = {} } = {}) {
  const o = { ...TAKE_DEFAULTS, ...opts };
  if (!VOICE_TAKE_RE.test(asset)) throw new StudioError(`The recorded voice ${asset} must be a .wav, .mp3 or .m4a asset`, 400);
  let file;
  try { file = assetPath(project, asset); } catch {
    throw new StudioError(`The recorded voice ${asset} is not in this brand's assets. Upload it on the Brand tab, or pick another take in the brief.`, 400);
  }
  const stt = sttStatus();
  if (!stt.available) throw new StudioError(`A recorded voice needs local speech-to-text: ${stt.reason}`, 400);
  const info = await probeMedia(file);
  if (!info.hasAudio) throw new StudioError(`The recorded voice ${asset} has no sound`, 400);
  if (info.duration > MAX_TRANSCRIBE_SECONDS) throw new StudioError(`The recorded voice ${asset} is over ${MAX_TRANSCRIBE_SECONDS / 60} min`, 400);
  const lines = script.scenes.map((sc) => ({ id: sc.id, text: String(sc.vo || '').trim() })).filter((l) => l.text);
  const heard = await clipWords(project, asset, 0, info.duration, { lang, cacheDir: path.join(dir, 'stt') });
  const scenes = alignTake(lines, heard, { lang, minMatch: o.minMatch, maxMisses: o.maxMisses });
  const { voiced, step } = voicedFrames(await decode(file), SAMPLE_RATE);
  const cuts = cutPlan(scenes, voiced, step, info.duration, o);
  const level = scenes.length ? await measureLoudness(file, { spans: cuts.map((c) => [c.from, c.to]) }) : null;
  const gainDb = takeGain(level, o);
  const out = path.join(dir, 'take');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const result = {};
  for (const [i, sc] of scenes.entries()) {
    const { from, to } = cuts[i];
    const len = round(to - from);
    const wav = within(out, `${sc.id}.wav`);
    const gain = gainDb ? `volume=${gainDb}dB,` : '';
    await ffmpeg(['-y', '-i', file, '-ss', String(from), '-t', String(len), '-vn',
      '-af', `${gain}afade=t=in:d=${FADE},afade=t=out:st=${Math.max(0, len - FADE).toFixed(3)}:d=${FADE}`,
      '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav], { timeoutMs: CUT_TIMEOUT_MS });
    result[sc.id] = { wav, seconds: len, words: sc.words.map((w) => ({ w: w.w, at: round(Math.max(0, w.start - from)) })) };
  }
  return {
    asset, lines: result,
    summary: { asset, lufs: level?.lufs ?? null, gainDb, scenes: scenes.map((sc, i) => ({ id: sc.id, from: cuts[i].from, to: cuts[i].to, match: sc.match })) },
  };
}
