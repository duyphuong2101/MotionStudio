// The Settings tab's server side (user decision 2026-10-30): the state of every provider key (never its value),
// entering or removing a key in the gitignored root .env, and the Assistant's model choices. A key goes in one
// `NAME=value` line of .env and into this process's environment; it is never logged, returned or copied. Only the
// `keyEnv` names in config/providers.json (and `voiceCloud.keyEnv`) are accepted, and a key that comes from the real
// environment is left alone (the environment wins).
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, readJson, writeJson } from '../engine/core.mjs';
import { keyEnvNames } from './keys.mjs';
import { parseRef } from './assistant-model.mjs';

// API keys are letters, digits and a few separators; no space, quote, `#` or line break can reach the file.
const KEY_VALUE_RE = /^[A-Za-z0-9._:+/=-]{8,512}$/;
const MAX_ASKS = 2000;

/** Every key name the tab may set: the providers' `keyEnv` names and the cloud voice's. */
export function allowedKeyNames(providers, cfg) {
  const voice = cfg?.voiceCloud?.keyEnv ? { providers: { voiceCloud: { keyEnv: cfg.voiceCloud.keyEnv } } } : null;
  return [...new Set([...keyEnvNames(providers), ...keyEnvNames(voice)])];
}

/** `{ name, hasKey, source }` per name: `file` (.env, removable here), `environment` (set outside) or null. */
export const keyStates = (names, env, fromFile) => names.map((name) => ({
  name, hasKey: Boolean(env[name]), source: !env[name] ? null : fromFile.has(name) ? 'file' : 'environment',
}));

const lineRe = (name) => new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`);

/** The .env text with `name` set to `value` (first line replaced, repeats dropped) or removed when value is null. */
export function rewriteEnv(text, name, value) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const trailing = lines.length && lines.at(-1) === '';
  if (trailing) lines.pop();
  const re = lineRe(name);
  const out = [];
  let done = false;
  for (const l of lines) {
    if (!re.test(l)) { out.push(l); continue; }
    if (value != null && !done) { out.push(`${name}=${value}`); done = true; }
  }
  if (value != null && !done) out.push(`${name}=${value}`);
  return out.length ? `${out.join(eol)}${eol}` : '';
}

function writeEnvFile(file, name, value) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const next = rewriteEnv(text, name, value);
  // Gitignored (`.env.*.tmp`), and removed when the rename fails, so a half-written copy never lingers.
  const tmp = path.join(path.dirname(file), `.env.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, next, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new StudioError(`Could not save the key file (${err.code || 'write failed'})`, 500);
  }
}

function assertKeyName(name, allowed) {
  if (!allowed.includes(name)) throw new StudioError(`${String(name).slice(0, 40)} is not a key this tool uses. Keys: ${allowed.join(', ')}`, 400);
}

/** Saves `value` for `name` into `file` and `env`. Answers `{ name, hasKey, source }`, never the value. */
export function saveKey(file, name, value, { env, fromFile, allowed }) {
  assertKeyName(name, allowed);
  if (typeof value !== 'string') throw new StudioError('value must be a string', 400);
  const v = value.trim();
  if (!KEY_VALUE_RE.test(v)) throw new StudioError('A key is 8-512 letters, digits or . _ : + / = - with no spaces or quotes', 400);
  if (env[name] && !fromFile.has(name)) throw new StudioError(`${name} is set in your environment, which wins over .env. Change it there.`, 409);
  writeEnvFile(file, name, v);
  env[name] = v;
  fromFile.add(name);
  return { name, hasKey: true, source: 'file' };
}

/** Removes `name` from `file` and, when it came from there, from `env`. */
export function removeKey(file, name, { env, fromFile, allowed }) {
  assertKeyName(name, allowed);
  if (env[name] && !fromFile.has(name)) throw new StudioError(`${name} is set in your environment, not in .env. Remove it there.`, 409);
  writeEnvFile(file, name, null);
  delete env[name];
  fromFile.delete(name);
  return { name, hasKey: false, source: null };
}

/**
 * Saves `assistant.freeform`, `models` and `maxAsksPerDay` into `studioFile`. `choices` is the set of
 * `provider:model` refs a Connect listed; a ref outside it (and not already saved) is refused.
 */
export function saveAssistantSettings(studioFile, body, choices) {
  const stored = readJson(studioFile);
  const was = new Set(stored.assistant?.models || []);
  if (typeof body?.freeform !== 'boolean') throw new StudioError('freeform must be true or false', 400);
  if (!Array.isArray(body.models) || body.models.length > 20) throw new StudioError('models must be a list of at most 20 provider:model refs', 400);
  const models = [...new Set(body.models.map((r) => { const p = parseRef(r); return `${p.provider}:${p.model}`; }))];
  for (const r of models) if (!choices.has(r) && !was.has(r)) throw new StudioError(`${r} is not in a connected provider's list. Connect the provider first.`, 400);
  if (body.freeform && !models.length) throw new StudioError('Pick at least one model to turn freeform asks on', 400);
  const max = Number(body.maxAsksPerDay ?? stored.assistant?.maxAsksPerDay ?? 200);
  if (!Number.isInteger(max) || max < 1 || max > MAX_ASKS) throw new StudioError(`maxAsksPerDay must be a whole number from 1 to ${MAX_ASKS}`, 400);
  const assistant = { ...stored.assistant, freeform: body.freeform, models, maxAsksPerDay: max };
  writeJson(studioFile, { ...stored, assistant });
  return assistant;
}
