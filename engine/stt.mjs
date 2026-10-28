// Transcripts of footage and sound assets, from the local Whisper model (engine/stt/whisper.mjs).
// A whole-asset transcript is kept next to the brand's assets (profiles/<project>/transcripts/<asset>.json),
// so the Director can pick clips by what is said and copy the words exactly; prepare reuses it for captions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError, assertFileName, within, readJson, writeJson, exists, round } from './core.mjs';
import { profileDir, assetPath } from './jobs.mjs';
import { ffmpeg, probeMedia } from './media.mjs';
import { transcribe, whisperStatus, SAMPLE_RATE } from './stt/whisper.mjs';

export { whisperStatus as sttStatus };
export const MAX_TRANSCRIBE_SECONDS = 40 * 60;
const MEDIA_RE = /\.(mp4|webm|mov|wav|mp3|m4a)$/i;

export const transcriptFile = (project, asset) => within(profileDir(project), 'transcripts', `${assertFileName(asset, 'asset')}.json`);

/** Decodes `seconds` of an asset from `from` to 16 kHz mono floats. */
export async function decode(file, from = 0, seconds = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-stt-'));
  try {
    const raw = path.join(tmp, 'a.raw');
    const cut = seconds ? ['-ss', String(from), '-t', String(seconds)] : from ? ['-ss', String(from)] : [];
    await ffmpeg(['-y', ...cut, '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', raw], { timeoutMs: 10 * 60000 });
    const b = fs.readFileSync(raw);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Where speech starts in decoded audio (seconds): the first 20 ms window within 15 dB of the loudest one that stays
 * loud for the next 40 ms, so a click at the cut or a music bed well under the voice does not count. 0 when silent.
 */
export function speechOnset(samples, rate = SAMPLE_RATE) {
  const win = Math.round(rate * 0.02);
  const rms = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / win));
  }
  const top = Math.max(0, ...rms);
  if (!top) return 0;
  const thr = top * 0.18;
  for (let i = 0; i + 2 < rms.length; i++) {
    if (rms[i] > thr && rms[i + 1] > thr * 0.55 && rms[i + 2] > thr * 0.55) return round((i * win) / rate, 2);
  }
  return 0;
}

/** Size and modified time of a file: a cached result made from it is current while this matches. */
export const stamp = (file) => { const s = fs.statSync(file); return `${s.size}-${Math.round(s.mtimeMs)}`; };

/** Transcribes a whole asset and stores the result; returns it. Refuses files without sound or over the cap. */
export async function transcribeAsset(project, asset, { lang = '' } = {}) {
  if (!MEDIA_RE.test(asset)) throw new StudioError(`${asset} is not a video or sound file`, 400);
  const file = assetPath(project, asset);
  const info = await probeMedia(file);
  if (!info.hasAudio) throw new StudioError(`${asset} has no sound to transcribe`, 400);
  if (info.duration > MAX_TRANSCRIBE_SECONDS) throw new StudioError(`${asset} is ${Math.round(info.duration / 60)} min; transcripts are capped at ${MAX_TRANSCRIBE_SECONDS / 60} min`, 400);
  const t0 = Date.now();
  const r = await transcribe(await decode(file), { lang });
  const doc = { asset, stamp: stamp(file), duration: round(info.duration, 2), lang: r.lang, model: 'whisper-base (int8)', madeAt: new Date().toISOString(), seconds: round((Date.now() - t0) / 1000, 1), segments: r.segments, words: r.words };
  fs.mkdirSync(path.dirname(transcriptFile(project, asset)), { recursive: true });
  writeJson(transcriptFile(project, asset), doc);
  return doc;
}

/** The stored transcript of an asset when it still matches the file, else null. */
export function loadTranscript(project, asset) {
  const f = transcriptFile(project, asset);
  const doc = readJson(f, null);
  if (!doc) return null;
  try { return doc.stamp === stamp(assetPath(project, asset)) ? doc : { ...doc, stale: true }; } catch { return null; }
}

/**
 * Words said between `from` and `from + seconds` of an asset, with times relative to `from`: from the stored
 * transcript when there is one, else by transcribing just that stretch (cached in the job's stt/ folder).
 */
export async function clipWords(project, asset, from, seconds, { lang = '', cacheDir = null } = {}) {
  const doc = loadTranscript(project, asset);
  if (doc && !doc.stale) {
    return doc.words.filter((w) => w.start >= from - 0.05 && w.end <= from + seconds + 0.05)
      .map((w) => ({ w: w.w, start: round(Math.max(0, w.start - from), 2), end: round(Math.min(seconds, w.end - from), 2) }));
  }
  const file = assetPath(project, asset);
  const key = `${asset}-${round(from, 2)}-${round(seconds, 2)}-${stamp(file)}-${lang}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const cache = cacheDir && path.join(cacheDir, `${key}.json`);
  if (cache && exists(cache)) return readJson(cache);
  const r = await transcribe(await decode(file, from, seconds), { lang });
  const words = r.words.filter((w) => w.start < seconds).map((w) => ({ ...w, end: Math.min(w.end, seconds) }));
  if (cache) { fs.mkdirSync(cacheDir, { recursive: true }); writeJson(cache, words); }
  return words;
}
