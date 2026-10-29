// Cloud voice takes: server/voice-cloud.mjs makes them when a person clicks Make cloud voice, each line's audio and
// word times saved once in the job and keyed by what was said and by which voice. Prepare reads them here; nothing in
// the engine calls the provider.
import crypto from 'node:crypto';
import { readJson, within, exists } from './core.mjs';

export const CLOUD_DIR = 'cloud-voice';
export const CLOUD_PROVIDERS = ['elevenlabs'];
export const CLOUD_MODEL = 'eleven_multilingual_v2';
const VOICE_ID = /^[A-Za-z0-9]{8,40}$/;
const MODEL_ID = /^[a-z0-9_]{3,60}$/;
const LINE_FILE = /^[a-f0-9]{20}\.wav$/;

/** brand.voice.cloud, checked: `{ provider, voice, model }` or null when absent; problems go into `errors`. */
export function cloudVoice(raw, errors) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) { errors.push('voice.cloud must be { provider, voice, model }'); return null; }
  const provider = raw.provider ?? CLOUD_PROVIDERS[0];
  if (!CLOUD_PROVIDERS.includes(provider)) errors.push(`voice.cloud.provider must be ${CLOUD_PROVIDERS.join(' or ')}`);
  if (typeof raw.voice !== 'string' || !VOICE_ID.test(raw.voice)) errors.push('voice.cloud.voice must be the provider\'s voice id (8-40 letters and digits)');
  const model = raw.model ?? CLOUD_MODEL;
  if (typeof model !== 'string' || !MODEL_ID.test(model)) errors.push('voice.cloud.model must be a model id such as eleven_multilingual_v2');
  return { provider, voice: String(raw.voice), model: String(model) };
}

/** One line's key: the same words by the same voice and model are made once. */
export const lineKey = (cloud, text) => crypto.createHash('sha1').update(JSON.stringify([cloud.provider, cloud.voice, cloud.model, text])).digest('hex').slice(0, 20);

/** Words with their offsets from a character alignment: each run of non-space characters is one word. */
export function alignmentWords(al) {
  const ch = Array.isArray(al?.characters) ? al.characters : [];
  const st = al?.character_start_times_seconds, en = al?.character_end_times_seconds;
  if (!Array.isArray(st) || !Array.isArray(en) || st.length !== ch.length || en.length !== ch.length) return [];
  const out = [];
  let cur = null;
  ch.forEach((c, i) => {
    if (/\s/.test(c)) { cur = null; return; }
    if (!cur) { cur = { w: '', at: Number(st[i]) || 0, end: 0 }; out.push(cur); }
    cur.w += c; cur.end = Number(en[i]) || cur.at;
  });
  return out.map((x) => ({ w: x.w, at: Math.round(x.at * 1000) / 1000, end: Math.round(x.end * 1000) / 1000 }));
}

export const takeFile = (jobDir) => within(jobDir, CLOUD_DIR, 'take.json');

/** The job's saved cloud lines for this voice: `get(text)` gives `{ wav, seconds, words }` or null when not made. */
export function cloudTake(jobDir, cloud) {
  const lines = readJson(takeFile(jobDir), null)?.lines;
  return {
    get(text) {
      const l = lines && Object.hasOwn(lines, lineKey(cloud, text)) ? lines[lineKey(cloud, text)] : null;
      if (!l || !LINE_FILE.test(String(l.file)) || !(l.seconds > 0) || !Array.isArray(l.words)) return null;
      const wav = within(jobDir, CLOUD_DIR, l.file);
      return exists(wav) ? { wav, seconds: l.seconds, words: l.words.map((x) => ({ w: String(x.w), at: Number(x.at) || 0 })) } : null;
    },
  };
}
