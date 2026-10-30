// Settings → Connect for an API provider: one person-clicked request for the provider's model list (metadata, no
// model runs), with the person's own key from the `keyEnv` variable in a header only. The chat models it lists are
// saved under logs/providers/ and become the choices for the Director and the Assistant. Capped by
// config/studio.json → settings; one at a time; no retry. Gemini connects through server/generate.mjs instead,
// whose list also holds the image and clip models.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError, assertId, within, readJson, writeJson, exists, nowIso } from '../../engine/core.mjs';
import { usage, countUse } from '../caps.mjs';
import { fetchJson, redact, flatLine } from '../http.mjs';
import { providerError } from './adapters/shared.mjs';
import * as openaiChat from './adapters/openai-chat.mjs';
import * as anthropic from './adapters/anthropic.mjs';

const ADAPTERS = { openai: openaiChat, 'openai-compatible': openaiChat, anthropic };
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._:/-]{0,79}$/i;
// Listed ids that cannot answer a chat call: embeddings, speech, pictures, moderation, realtime and the like.
const NOT_CHAT_RE = /embed|tts|whisper|dall-e|image|imagen|banana|audio|realtime|moderation|transcribe|search|computer-use|robotics|veo|lyria|omni|aqa|deep-research|antigravity|-live|babbage|davinci|sora/i;
export const MAX_MODELS = 300;

export const SETTINGS_DEFAULTS = { maxConnectsPerDay: 30, requestTimeoutSeconds: 20, maxResponseBytes: 2000000, maxLogBytes: 200000 };

export const filesIn = (dir) => ({
  dir, count: path.join(dir, 'connects.json'), log: path.join(dir, 'connect.log'),
  models: (id) => within(dir, `${assertId(id, 'provider')}.json`),
});
export const FILES = filesIn(path.join(ROOT, 'logs', 'providers'));

export const settingsConfig = (s = {}) => ({ ...SETTINGS_DEFAULTS, ...s });

/** The chat models from a list answer: valid ids, no non-chat kinds, unique, sorted, capped. */
export function chatModels(list) {
  const seen = new Set();
  return list.filter((m) => MODEL_ID_RE.test(m.id) && !NOT_CHAT_RE.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }))
    .slice(0, MAX_MODELS)
    .map((m) => ({ id: m.id, label: m.label.slice(0, 80) || m.id }));
}

/** The last Connect's list for a provider, or null before the first one. */
export function connectedModels(id, files = FILES) {
  const doc = readJson(files.models(id), null);
  return doc && Array.isArray(doc.models) ? doc : null;
}

let current = false;

function logLine(s, files, key, text) {
  const line = `${nowIso()} ${redact(flatLine(text), key)}\n`;
  fs.mkdirSync(files.dir, { recursive: true });
  const size = exists(files.log) ? fs.statSync(files.log).size : 0;
  if (size + Buffer.byteLength(line) > s.maxLogBytes) fs.writeFileSync(files.log, `[log restarted at settings.maxLogBytes]\n${line}`);
  else fs.appendFileSync(files.log, line);
}

/**
 * One model-list request for provider `id`. Returns `{ provider, fetchedAt, count, models }`; refuses an unknown
 * provider, a missing key, a second request while one runs and `maxConnectsPerDay`.
 */
export async function connectProvider(settings, providers, id, { by, fetch = globalThis.fetch, env = process.env, files = FILES, now = () => new Date() } = {}) {
  const s = settingsConfig(settings);
  assertId(id, 'provider');
  const provider = providers?.providers?.[id];
  const adapter = ADAPTERS[provider?.kind];
  if (!provider || !adapter) throw new StudioError(`${id} is not an API provider in config/providers.json`, 400);
  const key = provider.keyEnv ? env[provider.keyEnv] : null;
  if (!key) throw new StudioError(`Add the ${provider.keyEnv || 'API'} key for ${provider.label || id} first.`, 400);
  if (current) throw new StudioError('A Connect is already running. Wait for it to finish.', 409);
  if (usage(files.count, now()).day >= s.maxConnectsPerDay) throw new StudioError(`Daily Connect limit reached (${s.maxConnectsPerDay}, settings.maxConnectsPerDay)`, 429);
  current = true;
  try {
    countUse(files.count, now());
    const req = adapter.modelsRequest({ provider, key });
    const label = provider.label || id;
    const { res, json, text } = await fetchJson(fetch, {
      ...req, who: label, keys: key, timeoutMs: s.requestTimeoutSeconds * 1000, timeoutLabel: 'settings.requestTimeoutSeconds',
      maxBytes: s.maxResponseBytes, label: 'settings.maxResponseBytes',
    });
    const err = providerError(res, json, provider, { text, keys: key, pauseMinutes: 0 });
    if (err) { logLine(s, files, key, `${by || '?'} ${id} ${res.status} ${err.message}`); throw err; }
    const models = chatModels(adapter.modelsFrom(json));
    if (!models.length) throw new StudioError(`${label} listed no chat models for this key`, 502);
    const doc = { provider: id, fetchedAt: now().toISOString(), by: by || null, models };
    writeJson(files.models(id), doc);
    logLine(s, files, key, `${by || '?'} ${id} ${models.length} models`);
    return { ...doc, count: models.length };
  } finally { current = false; }
}
