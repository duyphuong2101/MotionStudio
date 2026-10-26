import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DIRS = {
  profiles: path.join(ROOT, 'profiles'),
  briefs: path.join(ROOT, 'briefs'),
  sequences: path.join(ROOT, 'sequences'),
  out: path.join(ROOT, 'out'),
  templates: path.join(ROOT, 'templates'),
  config: path.join(ROOT, 'config'),
  ui: path.join(ROOT, 'ui'),
  trash: path.join(ROOT, 'trash'),
};

export class StudioError extends Error {
  constructor(message, code = 500) {
    super(message);
    this.code = code;
  }
}

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertId(value, what = 'id') {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new StudioError(`Invalid ${what}: use a-z, 0-9 and dashes`, 400);
  return value;
}

export function assertFileName(value, what = 'file') {
  if (typeof value !== 'string' || !FILE_RE.test(value) || value.includes('..')) throw new StudioError(`Invalid ${what} name`, 400);
  return value;
}

export function within(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  const root = path.resolve(base);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new StudioError('Path escapes its base folder', 400);
  return resolved;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err.code === 'ENOENT') throw new StudioError(`Missing file: ${path.relative(ROOT, file)}`, 404);
    throw new StudioError(`Cannot parse ${path.relative(ROOT, file)}: ${err.message}`, 400);
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function exists(file) {
  return fs.existsSync(file);
}

export const nowIso = () => new Date().toISOString();

export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function jsonForScript(data) {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(92);
  return JSON.stringify(data).replace(/</g, BS + 'u003c').split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029');
}

export function loadStudioConfig() {
  return readJson(path.join(DIRS.config, 'studio.json'));
}

// Keys, tokens and provider switches no in-process child (ffmpeg, Chrome, PowerShell, git) may inherit.
const CHILD_ENV_DENY = ['GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK'];

/** `env` without any `keyEnv` named in config/providers.json or CHILD_ENV_DENY (names compared case-insensitively). */
export function keyFreeEnv(env = process.env, providers = readJson(path.join(DIRS.config, 'providers.json'), {})) {
  const keyEnvs = Object.values(providers?.providers || {}).map((p) => String(p?.keyEnv || '').toUpperCase()).filter(Boolean);
  const names = new Set([...keyEnvs, ...CHILD_ENV_DENY]);
  return Object.fromEntries(Object.entries(env).filter(([k]) => !names.has(k.toUpperCase())));
}

export function listIds(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ID_RE.test(d.name))
    .map((d) => d.name)
    .sort();
}
