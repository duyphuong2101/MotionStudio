// Loudness match for clip sound: prepare gives each clip that plays its own sound a gain so its speech sits near the
// voice-over (or, with no voice-over, near the other clips' median). Measured with ffmpeg ebur128 on voiced spans only.
import { round } from './core.mjs';
import { ffmpegReport } from './media.mjs';

export const LOUDNESS_DEFAULTS = { match: true, toleranceDb: 1, maxGainDb: 12 };
const MEASURE_TIMEOUT_MS = 120000;
// Words closer than this are one span; ebur128's own gate drops the short pauses inside it.
const SPAN_GAP = 0.35;
// A raised clip's true peak stays below this, so footage.wav never clips.
const HEADROOM_DB = -1;
// ebur128's absolute gate: at or below it nothing was measured.
const SILENT_LUFS = -70;

/** Timed words (seconds) → merged [start, end] spans, clipped to 0..`limit`. */
export function voicedSpans(words, limit = Infinity) {
  const spans = [];
  for (const w of [...(words || [])].sort((a, b) => a.start - b.start)) {
    const a = Math.max(0, w.start), b = Math.min(limit, w.end);
    if (!(b > a)) continue;
    const last = spans[spans.length - 1];
    if (last && a - last[1] <= SPAN_GAP) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  return spans.map(([a, b]) => [round(a), round(b)]);
}

/** The analysis chain: mono 48 kHz as footage.wav mixes it, only the spans, then ebur128 with true peak. */
export function measureFilter(spans) {
  const keep = spans?.length ? `aselect='${spans.map(([a, b]) => `between(t,${a},${b})`).join('+')}',` : '';
  return `aformat=sample_rates=48000:channel_layouts=mono,${keep}ebur128=peak=true:framelog=verbose`;
}

const num = (s) => (s === undefined || /inf|nan/i.test(s) ? null : Number(s));

/** Integrated loudness (LUFS) and true peak (dBFS) from ebur128's summary; null when nothing was measured. */
export function parseEbur128(log) {
  const i = [...String(log).matchAll(/Integrated loudness:\s+I:\s+(\S+)\s+LUFS/g)].pop()?.[1];
  const p = [...String(log).matchAll(/True peak:\s+Peak:\s+(\S+)\s+dBFS/g)].pop()?.[1];
  const lufs = num(i);
  return { lufs: lufs === null || lufs <= SILENT_LUFS ? null : lufs, peak: num(p) };
}

/** Speech loudness of `file` (from `from` for `seconds`, or whole), over `spans` (seconds from `from`) when given. */
export async function measureLoudness(file, { from = null, seconds = null, spans = null } = {}) {
  const args = [];
  if (from !== null) args.push('-ss', String(from));
  if (seconds !== null) args.push('-t', String(seconds));
  args.push('-i', file, '-vn', '-af', measureFilter(spans), '-f', 'null', '-');
  return parseEbur128(await ffmpegReport(args, { timeoutMs: MEASURE_TIMEOUT_MS }));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Gain per clip toward the voice-over's loudness, or with none the clips' median (two clips or more). A clip within
 * `toleranceDb` stays as it is; gains are clamped to ±`maxGainDb` and a raise stops at HEADROOM_DB true peak.
 */
export function matchGains(levels, voiceLufs = null, opts = {}) {
  const o = { ...LOUDNESS_DEFAULTS, ...opts };
  const known = levels.filter((l) => l.lufs !== null).map((l) => l.lufs);
  const against = voiceLufs !== null ? 'voice' : known.length >= 2 ? 'clips' : null;
  const target = against === 'voice' ? voiceLufs : against ? round(median(known), 1) : null;
  const clips = levels.map(({ id, lufs, peak }) => {
    let gain = target === null || lufs === null ? 0 : target - lufs;
    if (Math.abs(gain) <= o.toleranceDb) gain = 0;
    gain = Math.max(-o.maxGainDb, Math.min(o.maxGainDb, gain));
    if (gain > 0 && peak !== null) gain = Math.max(0, Math.min(gain, HEADROOM_DB - peak));
    return { id, lufs, peak, gainDb: round(gain, 1) || 0 };
  });
  return { against, target, clips };
}

/**
 * Measures the clips that play their own sound ({ id, file, from, seconds, words? } with clip-relative words) and the
 * voice-over ({ file, words } on the video timeline, or null), and returns `matchGains`. Null when off or nothing to
 * match: no clip, or one clip and no voice-over.
 */
export async function clipGains(clips, voice, opts = {}) {
  const o = { ...LOUDNESS_DEFAULTS, ...opts };
  if (!o.match || !clips.length || (!voice && clips.length < 2)) return null;
  const ref = voice ? (await measureLoudness(voice.file, { spans: voicedSpans(voice.words) })).lufs : null;
  const levels = [];
  for (const c of clips) {
    levels.push({ id: c.id, ...(await measureLoudness(c.file, { from: c.from, seconds: c.seconds, spans: voicedSpans(c.words, c.seconds) })) });
  }
  return matchGains(levels, ref, o);
}
