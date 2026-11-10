// Piper voices through sherpa-onnx (models/piper/<voice>/ + models/sherpa-onnx/, both placed by a person; the tool
// never downloads them). Pure helpers here: the voice folder rule, the model card's licence, the voice ids (a
// multi-speaker voice lists its first speakers as "<voice> (n)"), the text guard and the integrity check of the
// runtime files against the hashes pinned in config/studio.json → piper.sha256.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PIPER_DIR = 'models/piper';
export const SHERPA_DIR = 'models/sherpa-onnx';
export const SHERPA_FILES = ['sherpa-onnx.dll', 'sherpa-onnx-c-api.dll', 'onnxruntime.dll'];
// vi_VN-vivos-x_low: language_REGION-name-quality, as Piper names its voices.
export const PIPER_VOICE_RE = /^([a-z]{2,3})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/;
const SPEAKER_RE = /^(.+) \((\d{1,3})\)$/;
export const LISTED_SPEAKERS = 10;
// The longest text one call speaks, and the characters it may hold: letters and marks of any script, digits, spaces
// and plain punctuation. Everything else is dropped before the text reaches espeak-ng inside sherpa-onnx.
export const PIPER_TEXT_MAX = 1000;
const KEEP = /[^\p{L}\p{M}\p{N}\s.,!?;:'"()%\-/]/gu;

/** "vi_VN-vivos-x_low (12)" → { name, speaker: 12 }; a plain name is speaker 0. Null for anything else. */
export function parseVoiceId(id) {
  const m = SPEAKER_RE.exec(String(id));
  const name = m ? m[1] : String(id), speaker = m ? Number(m[2]) : 0;
  return PIPER_VOICE_RE.test(name) ? { name, speaker } : null;
}

/** The model card's speakers, sample rate and licence, and whether the licence forbids commercial use. Pure. */
export function readModelCard(text) {
  const field = (k) => (new RegExp(`^\\*\\s*${k}:\\s*(.+)$`, 'mi').exec(text || '') || [])[1]?.trim() || '';
  const license = field('License');
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i.exec(license);
  const name = cc ? `CC ${cc[1].toUpperCase()} ${cc[2]}` : license;
  return { speakers: Number(field('Speakers')) || 1, sampleRate: Number(String(field('Samplerate')).replace(/\D/g, '')) || null, license: name || 'unknown', nonCommercial: /\bNC\b|-nc-|by-nc/i.test(name) };
}

/** The voices in `dir` (models/piper): one per folder with its .onnx, tokens.txt and espeak-ng-data/. */
export function listPiperVoices(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const m = PIPER_VOICE_RE.exec(name);
    const vdir = path.join(dir, name);
    if (!m || !['tokens.txt', `${name}.onnx`, 'espeak-ng-data'].every((f) => fs.existsSync(path.join(vdir, f)))) continue;
    const card = readModelCard(fs.existsSync(path.join(vdir, 'MODEL_CARD')) ? fs.readFileSync(path.join(vdir, 'MODEL_CARD'), 'utf8') : '');
    const culture = `${m[1]}-${m[2]}`;
    const terms = card.nonCommercial ? `non-commercial (${card.license}): tests and internal videos only` : card.license;
    const n = Math.min(card.speakers, LISTED_SPEAKERS);
    for (let s = 0; s < n; s++) {
      const id = card.speakers > 1 ? `${name} (${s})` : name;
      out.push({ id, culture, label: `${m[3]} · ${culture}${card.speakers > 1 ? ` · speaker ${s}` : ''} · ${m[4].replace('_', '-')} · ${terms}`, nonCommercial: card.nonCommercial });
    }
  }
  return out;
}

/** The text one call speaks: guarded characters, spaces collapsed, at most PIPER_TEXT_MAX characters. Pure. */
export const piperText = (text) => String(text ?? '').normalize('NFC').replace(KEEP, '').replace(/\s+/g, ' ').trim().slice(0, PIPER_TEXT_MAX);

const hashCache = new Map();
/**
 * Why the runtime in `dir` may not run, or null: every file must be present and match its pinned sha256. A file a
 * person swapped (another build, a tampered DLL) is refused by name. Hashes are kept per path, size and time.
 */
export function sherpaProblem(dir, pinned) {
  if (!pinned || !Object.keys(pinned).length) return 'config/studio.json → piper.sha256 pins no sherpa-onnx files';
  for (const f of SHERPA_FILES) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) return `${SHERPA_DIR}/${f} is missing (sherpa-onnx 1.13.8 for Windows, see README → Voice)`;
    const st = fs.statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
    if (!hashCache.has(key)) hashCache.set(key, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    if (hashCache.get(key) !== String(pinned[f] || '').toLowerCase()) return `${SHERPA_DIR}/${f} is not the pinned build (its sha256 differs from config/studio.json → piper.sha256)`;
  }
  return null;
}
