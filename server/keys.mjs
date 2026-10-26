// The one key file the tool reads: the gitignored .env at the repo root, read once by the UI server at start,
// for the keyEnv names in config/providers.json only. The environment wins; no value is ever logged or returned.
import fs from 'node:fs';
import { parseEnv } from 'node:util';

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** The `keyEnv` names in config/providers.json. */
export const keyEnvNames = (providers) => [...new Set(Object.values(providers?.providers || {}).map((p) => p?.keyEnv).filter((n) => typeof n === 'string' && NAME_RE.test(n)))];

/** Copies the allowed `names` from `file` into `env` where `env` has no value. Returns the names loaded, never a value. */
export function loadKeysFromEnvFile(file, names, env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const parsed = parseEnv(text);
  const loaded = [];
  for (const name of names) {
    const value = typeof parsed[name] === 'string' ? parsed[name].trim() : '';
    if (!value || env[name]) continue;
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
}
