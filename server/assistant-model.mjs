// The fourth model path (user decision 2026-10-30): a person sends a line in the Assistant panel with a model picked
// in its composer, the parser does not know the line, and the local server asks that model once, through the API
// worker's own adapters (server/worker/adapters/), to name one of the panel's own intents with one tool call. The
// model picks; it never writes. The models are `provider:model` refs chosen in the Settings tab from a provider's
// Connect list; the key is the person's own, from that provider's `keyEnv`, in a request header only. The Claude
// seat is never one of them. Every answer is typed and capped before it reaches a proposal. Caps in
// config/studio.json → assistant, read on every call so a Settings save applies at once.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError, within, writeJson, exists, nowIso } from '../engine/core.mjs';
import { usage, countUse, readPause } from './caps.mjs';
import { fetchJson, redact, flatLine } from './http.mjs';
import { providerError } from './worker/adapters/shared.mjs';
import * as openaiChat from './worker/adapters/openai-chat.mjs';
import * as anthropic from './worker/adapters/anthropic.mjs';

const ADAPTERS = { openai: openaiChat, 'openai-compatible': openaiChat, anthropic };
const REF_RE = /^([a-z0-9][a-z0-9-]{0,29}):([a-z0-9][a-z0-9._:/-]{0,79})$/i;
const MAX_OUTPUT_TOKENS = 400;

export const INTENTS = ['help', 'status', 'director', 'brief', 'sequence', 'clip', 'brand', 'unknown'];

export const DEFAULTS = {
  freeform: false, models: ['gemini:gemini-3.5-flash-lite'], maxAsksPerDay: 200, requestTimeoutSeconds: 30, maxResponseBytes: 200000,
  maxContextChars: 6000, maxReplyChars: 300, pauseMinutes: 15, maxLogBytes: 200000,
};

export const filesIn = (dir) => ({ dir, count: path.join(dir, 'count.json'), pause: (provider) => within(dir, `pause-${provider}.json`) });
export const FILES = filesIn(path.join(ROOT, 'logs', 'assistant'));

/** `openai:gpt-5.1` → `{ provider, model }`; a bare id is a Gemini model (the first config shape). */
export function parseRef(ref) {
  const s = String(ref ?? '');
  const m = REF_RE.exec(s.includes(':') ? s : `gemini:${s}`);
  if (!m) throw new StudioError(`${s} is not a model (use provider:model)`, 400);
  return { provider: m[1].toLowerCase(), model: m[2] };
}

/** `gemini-3.5-flash-lite` → `Gemini 3.5 Flash Lite`; other ids stay as the provider names them. */
export const modelLabel = (id) => (/^(gemini|claude)-/i.test(id)
  ? String(id).split('-').map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
  : String(id));

/** The `assistant` block over its defaults; a bad model ref or cap is a config error. */
export function modelConfig(a = {}) {
  const c = { ...DEFAULTS, ...a, models: Array.isArray(a.models) ? a.models : DEFAULTS.models };
  c.models = c.models.map((r) => { try { const p = parseRef(r); return `${p.provider}:${p.model}`; } catch { throw new StudioError(`assistant.models: ${r} is not a model`, 500); } });
  for (const k of ['maxAsksPerDay', 'requestTimeoutSeconds', 'maxResponseBytes', 'maxContextChars', 'maxReplyChars', 'pauseMinutes', 'maxLogBytes']) {
    if (!(Number(c[k]) > 0)) throw new StudioError(`assistant.${k} must be a positive number`, 500);
  }
  return c;
}

export const SYSTEM = `You route one message from a person using Motion Studio, a brief-to-video tool, to exactly one intent by calling the pick_intent tool once.
You never write anything yourself; the tool shows the person a card to approve.
Intents and their args:
- status: { job? } the state of the jobs (or one job id)
- director: { job? } run the Director (the writer) on the jobs waiting for it
- brief: { template, format?, message } queue a new video brief; template is one of the listed ids; format like "16:9" or "9:16"; message is what the video should say, in the person's words, never invented
- sequence: { parts: [job ids], title? } join two or more finished jobs into one film
- clip: { asset, from, to, name? } cut seconds from..to of a video asset (asset is one of the listed names)
- brand: { field, value } change one brand field to a listed value, or "off" to remove it
- help: {} what the assistant can do
- unknown: {} anything else (a question you cannot answer from the data, rendering, approving, deleting, or small talk); then put one short English sentence in reply saying what you can do instead
Use only ids, names and values from the context. Do not invent a job, asset, template or field.`;

export const PICK_TOOL = {
  name: 'pick_intent',
  description: 'Name the one intent the message asks for, with its args.',
  schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: INTENTS },
      args: {
        type: 'object',
        properties: {
          job: { type: 'string' }, template: { type: 'string' }, format: { type: 'string' }, message: { type: 'string' },
          parts: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, asset: { type: 'string' },
          from: { type: 'number' }, to: { type: 'number' }, name: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' },
        },
      },
      reply: { type: 'string' },
    },
    required: ['intent'],
  },
};

/** `{ url, init }` for one pick through the provider's adapter: one user message, one tool. */
export function pickRequest({ provider, model, text, context }, key) {
  const adapter = ADAPTERS[provider?.kind];
  if (!adapter) throw new StudioError(`${provider?.label || 'This provider'} cannot answer the Assistant`, 400);
  return adapter.request({
    provider, model, key, system: SYSTEM, tools: [PICK_TOOL], maxOutputTokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'user', text: `Context:\n${context}\n\nMessage:\n${text}` }],
  });
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);
const short = (v) => str(v, 120)?.toLowerCase();
const jsonIn = (text) => { try { return JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } };

/** The tool call (or a JSON answer in text) as one of the panel's intents, every field typed and capped. */
export function pickedFrom(parsed, maxReplyChars) {
  const call = parsed?.calls?.find((c) => c.name === PICK_TOOL.name && c.args);
  const out = call ? call.args : jsonIn(parsed?.text || '');
  if (!out || !INTENTS.includes(out.intent)) return { intent: 'unknown', args: {}, reply: str(parsed?.text, maxReplyChars) || null };
  const a = out.args && typeof out.args === 'object' ? out.args : {};
  const args = {
    status: () => ({ job: short(a.job) || null }),
    director: () => ({ job: short(a.job) || null }),
    brief: () => ({ template: short(a.template) || null, format: short(a.format) || null, message: str(a.message, 800) || '' }),
    sequence: () => ({ parts: Array.isArray(a.parts) ? a.parts.map((p) => short(p)).filter(Boolean).slice(0, 12) : [], title: str(a.title, 80) || '' }),
    clip: () => ({ asset: str(a.asset, 160) || '', from: num(a.from) ?? null, to: num(a.to) ?? null, name: str(a.name, 60) || null }),
    brand: () => ({ field: str(a.field, 40) || '', value: str(a.value, 200) || '' }),
    help: () => ({}),
    unknown: () => ({}),
  }[out.intent]();
  return { intent: out.intent, args, reply: str(out.reply, maxReplyChars) || null };
}

const when = (iso) => new Date(iso).toLocaleString('en-US');
let current = false;

/**
 * One picker per server. `cfg` is the `assistant` block or a function returning it (read on every call).
 * `deps`: { providers(), env, fetch, files, now }. `pick({ text, model, context })` makes one request and
 * returns { intent, args, reply, model }; a 429 pauses that provider; nothing is retried.
 */
export function createIntentPicker(cfg, { providers, env = process.env, fetch = globalThis.fetch, files = FILES, now = () => new Date() } = {}) {
  const conf = () => modelConfig(typeof cfg === 'function' ? cfg() : cfg);
  const log = (c, key, line) => {
    const file = within(files.dir, 'asks.log');
    const text = `${nowIso()} ${redact(flatLine(line), key)}\n`;
    fs.mkdirSync(files.dir, { recursive: true });
    const size = exists(file) ? fs.statSync(file).size : 0;
    if (size + Buffer.byteLength(text) > c.maxLogBytes) fs.writeFileSync(file, `[log restarted at assistant.maxLogBytes]\n${text}`);
    else fs.appendFileSync(file, text);
  };
  const describe = (ref) => {
    const { provider: id, model } = parseRef(ref);
    const p = providers()?.providers?.[id];
    return { id: ref, provider: id, providerLabel: p?.label || id, model, label: modelLabel(model), hasKey: Boolean(p?.keyEnv && env[p.keyEnv] && ADAPTERS[p.kind]) };
  };

  return {
    models: () => { const c = conf(); return c.freeform ? c.models.map(describe) : []; },
    state() {
      const c = conf();
      const list = c.models.map(describe);
      return { freeform: c.freeform, hasKey: list.some((m) => m.hasKey), usedToday: usage(files.count, now()).day, maxAsksPerDay: c.maxAsksPerDay };
    },
    async pick({ text, model, context }) {
      const c = conf();
      if (!c.freeform) throw new StudioError('Freeform asks are off (Settings → Assistant)', 400);
      const ref = String(model ?? '');
      if (!c.models.includes(ref)) throw new StudioError(`Pick a model from the list: ${c.models.join(', ')}`, 400);
      const { provider: id, model: modelId } = parseRef(ref);
      const provider = providers()?.providers?.[id];
      if (!provider || !ADAPTERS[provider.kind]) throw new StudioError(`${id} is not an API provider in config/providers.json`, 400);
      const key = provider.keyEnv ? env[provider.keyEnv] : null;
      if (!key) throw new StudioError(`Add the ${provider.keyEnv || 'API'} key for ${provider.label || id} in Settings.`, 503);
      if (current) throw new StudioError('The assistant is already asking a model. Wait for that answer.', 409);
      const pause = readPause(files.pause(id));
      if (pause) throw new StudioError(`${provider.label || id} is paused until ${when(pause.until)} after a rate or spend limit.`, 429);
      if (usage(files.count, now()).day >= c.maxAsksPerDay) throw new StudioError(`Daily assistant limit reached (${c.maxAsksPerDay}, assistant.maxAsksPerDay)`, 429);
      current = true;
      try {
        countUse(files.count, now());
        const req = pickRequest({ provider, model: modelId, text, context: String(context).slice(0, c.maxContextChars) }, key);
        const label = provider.label || id;
        const { res, json, text: body } = await fetchJson(fetch, {
          ...req, who: label, keys: key, timeoutMs: c.requestTimeoutSeconds * 1000, timeoutLabel: 'assistant.requestTimeoutSeconds',
          maxBytes: c.maxResponseBytes, label: 'assistant.maxResponseBytes',
        });
        const err = providerError(res, json, provider, { text: body, model: modelId, keys: key, pauseMinutes: c.pauseMinutes });
        if (err) {
          if (err.pauseMinutes) writeJson(files.pause(id), { until: new Date(now().getTime() + err.pauseMinutes * 60000).toISOString(), reason: err.message, at: nowIso(), provider: id });
          log(c, key, `${ref} ${res.status} ${err.message}`);
          throw err;
        }
        const picked = pickedFrom(ADAPTERS[provider.kind].parse(json), c.maxReplyChars);
        log(c, key, `${ref} ${picked.intent} "${text.slice(0, 120)}"`);
        return { ...picked, model: ref };
      } finally { current = false; }
    },
  };
}
