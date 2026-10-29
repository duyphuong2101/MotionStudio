// The one place Motion Studio starts Claude: Claude Code headless on the person's own logged-in seat,
// one click = one run, capped turns/time/log, an explicit tool allowlist, never render or approve.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { ROOT, DIRS, StudioError, assertId, within, readJson, writeJson, exists, nowIso, keyFreeEnv } from '../engine/core.mjs';
import { listJobs, loadBrief, loadBrand, getStatus, setStatus } from '../engine/jobs.mjs';
import { getSequenceStatus, setSequenceStatus } from '../engine/sequences.mjs';
import { runsToday, countRun, usage, readPause as readPauseFile, clearPause as clearPauseFile } from './caps.mjs';
import { startApiRun } from './worker/run.mjs';
import { redact } from './http.mjs';
import { keyEnvNames } from './keys.mjs';

export { runDay, runsToday, countRun } from './caps.mjs';

export const DIRECTOR_DIR = path.join(ROOT, 'logs', 'director');
const PAUSE_FILE = path.join(DIRECTOR_DIR, 'pause.json');
const RUNS_FILE = path.join(DIRECTOR_DIR, 'runs.json');
const PROVIDERS_FILE = path.join(DIRS.config, 'providers.json');
const PROVIDER_PAUSE_RE = /^pause-[a-z0-9-]+\.json$/;
// The setStatus actor of an API run is `director-<provider>`; the seat's is `claude-seat`.
const API_BY = 'director-';
// The in-flight record of an API run (it has no child process of its own).
const API_ACTION = 'director-api';
const TASKKILL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
const TAIL_BYTES = 6000;
const MAX_LINE = 1024 * 1024;
const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'];
const FORBIDDEN_ARGS = /^--(bare|dangerously-skip-permissions|allow-dangerously-skip-permissions)$|bypassPermissions/;
// Every legitimate Bash(node ...) rule is `Bash(node engine/cli.mjs <verb> *)`. Anything shaped like
// `Bash(node *)`, `Bash(node:*)`, `Bash(node --test *)` or `Bash(npm ...)` would let the seat run
// arbitrary Node (e.g. `node --test` on a file it just Edited under out/**), bypassing the named
// render/approve/sequence denials entirely — so only the one safe node shape is let through.
const SAFE_NODE_RULE = /^Bash\(node engine\/cli\.mjs [a-z-]+ \*\)$/;
const UNSAFE_RULE = (r) => /^(Bash|PowerShell|Edit|Write|WebFetch|WebSearch)$|engine\/cli\.mjs (render|approve|sequence|reset-dirty)\b/.test(r)
  || (/^Bash\(\s*(node|npm)(\s|:|\.exe)/.test(r) && !SAFE_NODE_RULE.test(r));
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
// Claude Code's own limit lines (a line start, an optional "API Error:"), never a word inside the Director's prose.
const LIMIT_RE = /^(?:api error:\s*)?(?:claude(?: ai)? usage limit reached|usage limit reached|(?:5-hour|weekly|session|opus|sonnet) limit reached|you['’]ve hit your (?:usage )?limit|(?:you['’]re )?out of extra usage)|^api error:\s*429\b|"type"\s*:\s*"rate_limit_error"/im;

/**
 * The models the Director may run on, as Claude Code's `--model` takes them (pinned ids, so a newer release never
 * swaps the model under a running setup). Only Opus and Sonnet, by the user's decision (2026-10-23). `auto` picks
 * one of them per job with `jobModel`.
 */
export const DIRECTOR_MODELS = [
  { id: 'auto', label: 'Auto (Sonnet 5.5, Opus 5.5 for hard jobs)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
];
const PINNED = DIRECTOR_MODELS.filter((m) => m.id !== 'auto').map((m) => m.id);

// Templates that need exact numbers, verbatim code or screenshot coordinates go to the strong model under auto.
export const DEFAULT_ROUTING = {
  standard: 'claude-sonnet-5-5',
  strong: 'claude-opus-5-5',
  strongTemplates: ['data-story', 'before-after', 'testimonial', 'code-story', 'ui-story', 'feature-launch', 'app-walkthrough'],
};

/** A config model id checked against the list above; throws a message that names the fix. */
export function assertDirectorModel(id, { pinned = false } = {}) {
  const model = id == null ? 'auto' : String(id);
  const allowed = pinned ? PINNED : DIRECTOR_MODELS.map((m) => m.id);
  if (!allowed.includes(model)) {
    throw new StudioError(`director.model ${JSON.stringify(model)} is not allowed. Use one of: ${allowed.join(', ')}.`, 400);
  }
  return model;
}

export const modelLabel = (id) => DIRECTOR_MODELS.find((m) => m.id === id)?.label || id;

const routingOf = (d) => {
  const r = { ...DEFAULT_ROUTING, ...d.routing };
  return { ...r, standard: assertDirectorModel(r.standard, { pinned: true }), strong: assertDirectorModel(r.strong, { pinned: true }) };
};

/** Whether a job needs the strong model (error retry, mixed brief, a strong template, non-English copy), with the reason. */
export function hardJob(d, { brief, brand, status }) {
  const strongTemplates = d.routing?.strongTemplates ?? DEFAULT_ROUTING.strongTemplates;
  const lang = String(brief.lang || brand?.voice?.lang || 'en');
  const why = [
    status?.status === 'error' && 'a retry after an error',
    Array.isArray(brief.mix) && brief.mix.length > 0 && 'a mixed brief',
    strongTemplates.includes(brief.template) && `the ${brief.template} template`,
    !/^en\b/i.test(lang) && `copy in ${lang}`,
  ].filter(Boolean);
  return why.length ? { hard: true, why: why.join(', ') } : { hard: false, why: 'a standard job' };
}

/** The model one seat job runs on: the one set in the panel, or under auto the strong model when the job is hard. */
export function jobModel(d, job) {
  const set = assertDirectorModel(d.model);
  if (set !== 'auto') return { model: set, why: 'set in the Director panel' };
  const r = routingOf(d);
  const { hard, why } = hardJob(d, job);
  return { model: hard ? r.strong : r.standard, why };
}

/** The model one API job runs on: the provider's strong model for a hard job when one is set. */
export function workerModel(provider, hard, why = hard ? 'a hard job' : 'a standard job') {
  const strong = hard && provider.strongModel;
  return { model: strong ? provider.strongModel : provider.model, why: hard && !strong ? `${why}, no strong model set` : why };
}

/* ---------- backend: the Claude seat or an API provider, picked once per click ---------- */
/** Provider kinds the API worker has an adapter for. `claude-code` (the seat) is not one of them. */
export const ADAPTER_KINDS = ['openai', 'openai-compatible', 'anthropic'];
const API_CAPS = ['maxTurnsPerJob', 'requestTimeoutSeconds', 'maxOutputTokens', 'maxTokensPerJob', 'maxCallsPerDay', 'maxResponseBytes', 'maxToolResultChars',
  'maxDraftBytes', 'maxFetchBytes', 'maxPageChars', 'maxFetchesPerJob', 'maxImagesPerJob', 'maxImageBytes', 'maxPrepareRounds', 'pauseMinutes'];
const PROVIDER_MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SEAT = { kind: 'seat' };

/** config/studio.json → director.api, every cap a positive number. */
export function assertApiConfig(a) {
  const bad = API_CAPS.find((k) => !(Number.isFinite(a?.[k]) && a[k] > 0));
  if (bad) throw new StudioError(`config/studio.json director.api.${bad} must be a positive number. Fix it and restart npm run ui.`, 503);
  return a;
}

/** Where the next click goes: the provider named by `default` when it has an adapter, a model and its key; else the seat, with the reason. */
export function pickBackend(providers, env = process.env) {
  const id = providers?.default;
  if (!id || id === 'seat') return SEAT;
  const p = providers.providers?.[id];
  const seat = (reason) => ({ ...SEAT, reason });
  if (!p || !ADAPTER_KINDS.includes(p.kind)) return seat(`${id} has no adapter`);
  if (!p.keyEnv || !env[p.keyEnv]) return seat(`${p.keyEnv || `${id}.keyEnv`} is not set`);
  if (!p.model) return seat(`${id} has no model set`);
  return { kind: 'api', provider: id, label: p.label || id, keyEnv: p.keyEnv, model: p.model, strongModel: p.strongModel || '', vision: p.vision === true };
}

/** One run, one model: the first queued job's model and the queued jobs that share it, up to the cap. */
export function pickRun(queue, max) {
  if (!queue.length) return { model: null, jobs: [], waiting: 0 };
  const model = queue[0].model;
  const jobs = queue.filter((q) => q.model === model).slice(0, max);
  return { model, jobs, waiting: queue.length - jobs.length };
}

/* ---------- pure parts (tested) ---------- */
export const inDirectorQueue = (st) => st.status === 'queued' || (st.status === 'dirty' && (st.dirty_from ?? 99) <= 4);

export const studioCommand = (project, jobs) => `/studio run ${jobs.map((j) => `${project}/${j}`).join(' ')}`;

export function directorArgs(prompt, d, { jobs, hosts = [], model: picked }) {
  const want = picked ?? d.model;
  const model = assertDirectorModel(want == null || want === 'auto' ? routingOf(d).standard : want, { pinned: true });
  const badTool = d.tools.find((t) => !SAFE_TOOLS.includes(t));
  const badRule = d.allowedTools.find((r) => UNSAFE_RULE(r));
  if (badTool || badRule) throw new StudioError(`config/studio.json director allows "${badTool || badRule}". Remove it.`, 503);
  const web = hosts.filter((h) => HOST_RE.test(h)).map((h) => `WebFetch(domain:${h})`);
  const args = [
    '-p', prompt,
    // The seat must run on this allowlist alone: with cwd: ROOT it would otherwise also load
    // .claude/settings.json and the gitignored settings.local.json (project/local sources), whose
    // own permission rules (e.g. a broad Bash(node:*) someone added for interactive work) get merged
    // in and can reopen what --disallowedTools just closed. `user` keeps the person's own
    // ~/.claude/settings.json; project and local are excluded. strict-mcp-config with an empty
    // server list stops enableAllProjectMcpServers from handing the run extra tools.
    '--setting-sources', 'user',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--tools', [...d.tools, ...(web.length ? ['WebFetch'] : [])].join(','),
    '--allowedTools', ...d.allowedTools, ...web,
    '--disallowedTools', ...d.disallowedTools,
    // dontAsk overrides a user-level defaultMode (e.g. auto): anything outside the allowlist is denied.
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--max-turns', String(d.maxTurnsPerJob * jobs),
    '--output-format', 'stream-json', '--verbose',
    '--model', model,
  ];
  const modes = args.flatMap((a, i) => (a === '--permission-mode' ? [args[i + 1]] : []));
  if (args.some((a) => FORBIDDEN_ARGS.test(a)) || modes.some((m) => m !== 'dontAsk')) throw new StudioError('Refusing a Director run with a permission-bypass flag', 503);
  return args;
}

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// shell:false cannot run a .cmd/.ps1 shim, and we never fall back to a shell.
export function resolveClaude(configured, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const win = platform === 'win32';
  const exe = win ? 'claude.exe' : 'claude';
  if (configured) {
    if (win && !/\.exe$/i.test(configured)) throw new StudioError('director.claudePath must point to claude.exe, not a .cmd or .ps1 shim', 503);
    if (!path.isAbsolute(configured) || !isFile(configured)) throw new StudioError(`director.claudePath was not found: ${configured}`, 503);
    return configured;
  }
  const dirs = String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  const onPath = dirs.map((d) => path.join(d, exe)).find(isFile);
  if (onPath) return onPath;
  const extDir = path.join(home, '.vscode', 'extensions');
  const bundled = (exists(extDir) ? fs.readdirSync(extDir) : [])
    .filter((n) => n.startsWith('anthropic.claude-code-'))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .map((n) => path.join(extDir, n, 'resources', 'native-binary', exe))
    .find(isFile);
  if (bundled) return bundled;
  const shim = win && dirs.some((d) => ['claude.cmd', 'claude.ps1', 'claude'].some((n) => isFile(path.join(d, n))));
  throw new StudioError(shim
    ? 'Only a claude.cmd shim was found. It cannot run without a shell. Install the native Claude Code build (claude install) or set director.claudePath in config/studio.json to claude.exe.'
    : 'Claude Code was not found. Install it, or set director.claudePath in config/studio.json to the claude executable.', 503);
}

function parseReset(text, now) {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return new Date(Number(epoch[1]) * 1000);
  const rel = /resets? in (\d+)\s*(h|hours?|m|min|minutes?)\b/i.exec(text);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * (/^h/i.test(rel[2]) ? 3600000 : 60000));
  const at = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!at) return null;
  const min = Number(at[2] || 0);
  const h = at[3] ? (Number(at[1]) % 12) + (/pm/i.test(at[3]) ? 12 : 0) : Number(at[1]);
  if (h > 23 || min > 59) return null;
  const t = new Date(now);
  t.setHours(h, min, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

export function detectPause(text, now = new Date(), minutes = 60) {
  if (!text || !LIMIT_RE.test(text)) return null;
  const until = parseReset(text, now) || new Date(now.getTime() + minutes * 60000);
  return { until: until.toISOString(), reason: text.trim().slice(0, 300) };
}

const target = (i = {}) => String(i.command || i.file_path || i.url || i.pattern || '').slice(0, 200);

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, 2000);

/**
 * One stream-json line → a readable log line, plus the text worth checking for a usage limit: only what Claude Code
 * itself says (a non-JSON line, its `<synthetic>` reply, an error result, an error event), never the model's prose.
 */
export function eventText(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return { text: line, check: line }; }
  if (ev.type === 'system' && ev.subtype === 'init') return { text: `Session started (${ev.model || 'default model'})` };
  if (ev.type === 'error' || (ev.type === 'system' && /error/i.test(String(ev.subtype || '')))) {
    const msg = asText(ev.error?.message ?? ev.error ?? ev.message ?? ev);
    return { text: `! ${msg}`, check: msg };
  }
  if (ev.type === 'assistant') {
    const blocks = ev.message?.content || [];
    const text = blocks.map((c) => (c.type === 'text' ? c.text : c.type === 'tool_use' ? `> ${c.name} ${target(c.input)}` : '')).filter(Boolean).join('\n');
    return { text, check: ev.message?.model === '<synthetic>' ? text : '' };
  }
  if (ev.type === 'user') {
    const errs = (ev.message?.content || []).filter((c) => c.type === 'tool_result' && c.is_error);
    return { text: errs.map((c) => `! ${JSON.stringify(c.content).slice(0, 300)}`).join('\n') };
  }
  if (ev.type === 'result') {
    const head = `Finished: ${ev.subtype}${ev.is_error ? ' (error)' : ''}${ev.num_turns ? `, ${ev.num_turns} turns` : ''}`;
    return { text: [head, ev.result].filter(Boolean).join('\n'), check: ev.is_error ? String(ev.result || '') : '', result: ev };
  }
  return { text: '' };
}

export function assertCanStart(active, pause, runs = { used: 0, max: Infinity }, backend = SEAT) {
  if (active) throw new StudioError('The Director is already running. Wait for it to finish or cancel it.', 409);
  const limit = backend.kind === 'api' ? `${backend.label} rate or spend limit reached` : 'Claude usage limit reached';
  if (pause) throw new StudioError(`${limit}. Director runs are paused until ${new Date(pause.until).toLocaleString('en-US')}.`, 429);
  if (runs.used >= runs.max) throw new StudioError(`Daily Director limit reached (${runs.max} runs, director.maxRunsPerDay). It resets at midnight. Type /studio run in Claude Code if you really need another run.`, 429);
}

// The Director runs only on the seat login: no other key, token, endpoint or cloud-provider switch may reach it
// (`keyFreeEnv`'s deny list). Every keyEnv is stripped too, by the user's decision (2026-10-15): if the company moves
// to the Claude API, seat Director mode is switched off, so the Director must never run on an API key by accident.
export const directorEnv = (env, providers) => keyFreeEnv(env, providers ?? {});

/** The environment of every engine child (prepare, render, sequence): the same key-free set as the seat child. */
export const engineEnv = (env = process.env) => directorEnv(env, readJson(PROVIDERS_FILE));

/* ---------- state ---------- */
let current = null;
let last = null;

const logFileFor = (project) => within(DIRECTOR_DIR, `${assertId(project, 'project')}.log`);

/** The state files of the runs: the seat's pause without a provider, one pause and one call counter per API provider. */
const FILES = {
  runs: RUNS_FILE,
  pause: (provider) => (provider ? within(DIRECTOR_DIR, `pause-${assertId(provider, 'provider')}.json`) : PAUSE_FILE),
  calls: (provider) => within(DIRECTOR_DIR, `calls-${assertId(provider, 'provider')}.json`),
  log: logFileFor,
};

/** The pause that blocks the next click on this backend: the seat's, or that provider's. */
export const backendPause = (backend, files = FILES) => readPauseFile(files.pause(backend.kind === 'api' ? backend.provider : null));

/** Clears the seat's pause and every provider's. */
export function clearPause() {
  clearPauseFile(PAUSE_FILE);
  for (const f of exists(DIRECTOR_DIR) ? fs.readdirSync(DIRECTOR_DIR) : []) if (PROVIDER_PAUSE_RE.test(f)) clearPauseFile(within(DIRECTOR_DIR, f));
}

export const directorHas = (project, job) => Boolean(current && current.project === project && (!job || current.jobs.includes(job)));

function tail(file) {
  if (!exists(file)) return '';
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  return buf.toString('utf8');
}

const publicRun = (r) => r && {
  project: r.project, jobs: r.jobs, command: r.prompt, model: r.model, by: r.by, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, message: r.message,
  backend: r.backend || 'seat', provider: r.provider || null, usage: r.usage ? { ...r.usage } : null,
};

/** A backend as the panel sees it: where the click goes and, for the seat, why a provider was passed over. */
const publicBackend = (b) => ({ kind: b.kind, provider: b.provider || null, label: b.kind === 'api' ? b.label : 'Claude seat', reason: b.reason || null });

/** Saves the Director's model into config/studio.json and into the running config; refused during a run. */
export function setDirectorModel(d, id) {
  const model = assertDirectorModel(id);
  if (current) throw new StudioError('The Director is running. Change the model when it has finished.', 409);
  const file = path.join(DIRS.config, 'studio.json');
  const stored = readJson(file);
  writeJson(file, { ...stored, director: { ...stored.director, model } });
  d.model = model;
  return { model, models: DIRECTOR_MODELS };
}

/**
 * Saves the Director backend into config/providers.json: `default`, and for an API provider its `model`,
 * `strongModel` and `vision`. Every other byte stays; refused during a run.
 */
export function setDefaultProvider(providersFile, body) {
  if (current) throw new StudioError('The Director is running. Change the provider when it has finished.', 409);
  const raw = readJson(providersFile);
  const id = String(body?.default ?? '');
  const given = ['model', 'strongModel', 'vision'].filter((k) => body?.[k] !== undefined);
  if (id === 'seat') {
    if (given.length) throw new StudioError('The Claude seat takes its model from the Director model list. Send no model fields with seat.', 400);
    raw.default = id;
    writeJson(providersFile, raw);
    return { default: id };
  }
  const p = raw?.providers?.[id];
  if (!p || !ADAPTER_KINDS.includes(p.kind)) {
    const ids = Object.keys(raw?.providers || {}).filter((k) => ADAPTER_KINDS.includes(raw.providers[k].kind));
    throw new StudioError(`Unknown Director provider ${JSON.stringify(id)}. Use seat or one of: ${ids.join(', ')}.`, 400);
  }
  for (const k of ['model', 'strongModel']) {
    const v = body[k];
    if (v !== undefined && (typeof v !== 'string' || (v !== '' && !PROVIDER_MODEL_RE.test(v)))) throw new StudioError(`${k} ${JSON.stringify(v)} is not a model id. Use letters, digits and . _ : - only.`, 400);
  }
  if (body.vision !== undefined && typeof body.vision !== 'boolean') throw new StudioError('vision must be true or false', 400);
  for (const k of given) p[k] = body[k];
  raw.default = id;
  writeJson(providersFile, raw);
  return { default: id, model: p.model || '', strongModel: p.strongModel || '', vision: p.vision === true };
}

/** What the next Run Director click would take, for the panel; null when the project cannot be planned. */
export function nextRun(d, project, backend = SEAT) {
  try {
    const { model, jobs, waiting, label } = planRun(d, project, null, backend);
    return { model, label, jobs: jobs.map(({ id, why }) => ({ id, why })), waiting, backend: publicBackend(backend) };
  } catch { return null; }
}

/** `pause` is the one that blocks the next click on `backend`. */
export function directorState(project, backend = SEAT) {
  return {
    running: publicRun(current),
    last: last && (!project || last.project === project) ? publicRun(last) : null,
    pause: backendPause(backend),
    tail: project ? tail(logFileFor(project)) : '',
  };
}

/**
 * The Director select for the panel: where the next click goes, every provider with an adapter (`hasKey` is a
 * boolean, never the key), the calls each made today and this month, and the daily call cap.
 */
export function directorProviders(d, providers, env = process.env, files = FILES) {
  const list = Object.entries(providers?.providers || {}).filter(([, p]) => ADAPTER_KINDS.includes(p.kind));
  return {
    backend: publicBackend(pickBackend(providers, env)),
    default: providers?.default || 'seat',
    providers: list.map(([id, p]) => ({
      id, kind: p.kind, label: p.label || id, keyEnv: p.keyEnv || null, hasKey: Boolean(p.keyEnv && env[p.keyEnv]),
      model: p.model || '', strongModel: p.strongModel || '', vision: p.vision === true, note: p.note || '',
    })),
    usage: Object.fromEntries(list.map(([id]) => [id, usage(files.calls(id))])),
    caps: { maxCallsPerDay: d.api?.maxCallsPerDay ?? null },
  };
}

/** On server start: a job an API run left before the storyboard (the loop died with the server) goes to error. */
export function recoverStale(project = null, { dir = INFLIGHT_DIR, self = SELF, probe = probeProcesses } = {}) {
  const fixed = [];
  // Another live server (a test's, or a second UI) may be running this job's API Director run right now: its
  // in-flight record names the jobs. Without a process list nobody can tell, so nothing is reset this start.
  const docs = (exists(dir) ? fs.readdirSync(dir) : []).filter((f) => INFLIGHT_RE.test(f)).map((f) => readJson(within(dir, f), null)).filter(Boolean);
  const others = docs.filter((d) => d.server && d.server.pid !== self.pid);
  const alive = others.length ? probe(others.map((d) => Number(d.server.pid))) : new Map();
  if (!alive) return fixed;
  const held = new Set(others.filter((d) => ownsProcess(d.server, alive.get(d.server.pid)))
    .flatMap((d) => Object.values(d.children || {}).filter((c) => c?.action === API_ACTION).flatMap((c) => (c.jobs || []).map((j) => `${c.project}/${j}`))));
  for (const { brief, status } of listJobs(project)) {
    if (!['scripting', 'scripted'].includes(status.status) || !String(status.history?.at(-1)?.by || '').startsWith(API_BY)) continue;
    if (held.has(`${brief.project}/${brief.id}`)) continue;
    setStatus(brief.project, brief.id, { status: 'error', error: 'The server stopped during a Director run. Click Run Director again.' }, 'server restarted during a Director run', 'server');
    fixed.push(`${brief.project}/${brief.id}`);
  }
  return fixed;
}

/* ---------- in-flight children: what a restarted server stops and resets ---------- */
// One file per server process (logs/inflight/<pid>.json), so two servers (the person's and a test's) never share one.
export const INFLIGHT_DIR = path.join(ROOT, 'logs', 'inflight');
const INFLIGHT_RE = /^\d+\.json$/;
// A pid counts as ours only when its image name matches and it started within this of the recorded time (pid reuse).
const SAME_START_MS = 60000;
const PROBE_BYTES = 256 * 1024;
const SELF = { pid: process.pid, startedAt: Date.now() - Math.round(process.uptime() * 1000) };
const RESTART_BY = 'server';

export const exeName = (file) => path.basename(String(file)).replace(/\.exe$/i, '').toLowerCase();

const inflightFile = (dir, pid) => within(dir, `${pid}.json`);

/** Records one child this server started (`{ kind: job|sequence|asset|director, action, project, id?, jobs?, pid, exe, startedAt }`). */
export function trackChild(key, rec, { dir = INFLIGHT_DIR, self = SELF } = {}) {
  if (!rec.pid) return;
  try {
    const file = inflightFile(dir, self.pid);
    const doc = readJson(file, null) || { server: { ...self, exe: exeName(process.execPath) }, children: {} };
    doc.children[key] = rec;
    fs.mkdirSync(dir, { recursive: true });
    writeJson(file, doc);
  } catch (err) { console.error(`Could not record ${key} in ${dir}: ${err.message}`); }
}

export function untrackChild(key, { dir = INFLIGHT_DIR, self = SELF } = {}) {
  try {
    const file = inflightFile(dir, self.pid);
    const doc = readJson(file, null);
    if (!doc?.children?.[key]) return;
    delete doc.children[key];
    if (Object.keys(doc.children).length) writeJson(file, doc);
    else fs.rmSync(file, { force: true });
  } catch (err) { console.error(`Could not clear ${key} in ${dir}: ${err.message}`); }
}

/** Whether a probed process (`{ name, startedAt }` or undefined) is the one `rec` recorded. */
export const ownsProcess = (rec, info) => Boolean(info && rec?.exe && exeName(info.name) === rec.exe
  && Number.isFinite(rec.startedAt) && Math.abs(info.startedAt - rec.startedAt) <= SAME_START_MS);

/**
 * pid → `{ name, startedAt }` for the live ones, from one PowerShell (Windows) or ps call; no shell, a timeout, a capped
 * output. null when the probe itself failed, so nobody reads "could not look" as "nothing runs".
 */
export function probeProcesses(pids) {
  const ids = [...new Set(pids)].filter((p) => Number.isSafeInteger(p) && p > 0);
  const out = new Map();
  if (!ids.length) return out;
  const win = process.platform === 'win32';
  const filter = ids.map((p) => `ProcessId=${p}`).join(' OR ');
  const [cmd, args] = win
    ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, $_.CreationDate.ToUniversalTime().ToString('o') }`]]
    : ['ps', ['-o', 'pid=,etimes=,comm=', '-p', ids.join(',')]];
  const r = spawnSync(cmd, args, { shell: false, windowsHide: true, timeout: 20000, maxBuffer: PROBE_BYTES, encoding: 'utf8', env: engineEnv() });
  // ps exits 1 when none of the pids runs, which is an answer; PowerShell exits 0 then.
  if (r.error || r.signal || (r.status !== 0 && (win || String(r.stderr || '').trim()))) return null;
  const now = Date.now();
  for (const line of String(r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = win ? /^(\d+)\|(.+)\|(.+)$/.exec(line) : /^(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const startedAt = win ? Date.parse(m[3]) : now - Number(m[2]) * 1000;
    out.set(Number(m[1]), win ? { name: m[2], startedAt } : { name: m[3], startedAt });
  }
  return out;
}

function killPid(pid) {
  if (process.platform === 'win32') {
    spawnSync(TASKKILL, ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore', timeout: 15000, env: engineEnv() });
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}

// What the killed (or already dead) child leaves behind: a busy status nobody will clear.
function resetAfterRestart(rec, killed) {
  const { project, id } = rec;
  if (rec.kind === 'director') {
    // One job deleted since must not leave the run's other jobs stuck.
    for (const job of rec.jobs || []) {
      try {
        if (!['scripting', 'preparing'].includes(getStatus(project, assertId(job, 'job')).status)) continue;
        setStatus(project, job, { status: 'error', error: 'The UI server restarted during a Director run. Click Run Director again.' }, 'server restarted during a Director run', RESTART_BY);
      } catch { /* the job is gone */ }
    }
  } else if (rec.kind === 'job') {
    const st = getStatus(project, id).status;
    if (st === 'preparing' || st === 'rendering') setStatus(project, id, { status: 'error', error: `The UI server restarted while this job was ${st}. Run it again.` }, `server restarted during ${rec.action}`, RESTART_BY);
  } else if (rec.action === 'sequence') {
    if (getSequenceStatus(project, id).status === 'rendering') setSequenceStatus(project, id, { status: 'error', error: 'The UI server restarted while this sequence was rendering. Render it again.' }, 'server restarted during sequence', RESTART_BY);
  } else if (rec.action === 'sequence-preview' && killed) {
    setSequenceStatus(project, id, { preview: { file: null, error: 'The UI server restarted while this preview was being made. Make it again.' } }, 'server restarted during sequence-preview', RESTART_BY);
  }
}

/**
 * On server start: every child a server that is gone recorded is stopped (only when its pid still runs the same
 * program that started at the recorded time), and the job, sequence or Director jobs it held leave their busy state.
 * A file of a live server (another port, a test) is left alone. Returns one line per child.
 */
export function recoverInflight({ dir = INFLIGHT_DIR, self = SELF, probe = probeProcesses, kill = killPid } = {}) {
  const docs = (exists(dir) ? fs.readdirSync(dir) : []).filter((f) => INFLIGHT_RE.test(f))
    .map((f) => ({ file: within(dir, f), doc: readJson(within(dir, f), null) }));
  if (!docs.length) return [];
  const pids = docs.flatMap(({ doc }) => [doc?.server?.pid, ...Object.values(doc?.children || {}).map((c) => c?.pid)]);
  const alive = probe(pids.map(Number));
  // Without an answer a live server's children look dead: leave every file for the next start.
  if (!alive) return ['could not list running processes: left the in-flight records alone'];
  const lines = [];
  for (const { file, doc } of docs) {
    const owner = doc?.server;
    // Our own pid in an old file means the old server is gone: nothing is recorded yet at start.
    if (owner && owner.pid !== self.pid && ownsProcess(owner, alive.get(owner.pid))) continue;
    for (const [key, rec] of Object.entries(doc?.children || {})) {
      const killed = ownsProcess(rec, alive.get(rec.pid));
      if (killed) kill(rec.pid);
      try {
        assertId(rec.project, 'project');
        if (rec.id) assertId(rec.id, 'job');
        resetAfterRestart(rec, killed);
      } catch (err) { lines.push(`${key}: could not reset (${err.message})`); continue; }
      lines.push(`${key} (${rec.action}${killed ? ', stopped' : ''})`);
    }
    fs.rmSync(file, { force: true });
  }
  return lines;
}

/** Engine slots a Director run holds outside `running`: the seat prepares its jobs itself, under claude.exe. */
export const directorSlots = () => (current && current.backend !== 'api' ? 1 : 0);

/**
 * A seat run that did not finish: its jobs still in scripting go to error, and so does a job in preparing (the
 * prepare it ran was killed with it and never writes its own error).
 */
export function resetUnfinished(project, jobs, run) {
  for (const id of run.status === 'done' ? [] : jobs) {
    const st = getStatus(project, id).status;
    if (st === 'scripting') setStatus(project, id, { status: 'error', error: `Director run ${run.status}: ${run.message}` }, 'director run ended early', 'server');
    else if (st === 'preparing') {
      setStatus(project, id, { status: 'error', error: `Director run ${run.status} during prepare: ${run.message}. The prepare was stopped. Click Run Director again.` }, 'director run ended during prepare', 'server');
    }
  }
}

/* ---------- run ---------- */
function killTree(child) {
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
    return;
  }
  const k = spawn(TASKKILL, ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore', timeout: 15000, env: engineEnv() });
  k.on('error', () => child.kill());
}

// If the UI server stops, the Claude child must not keep running on its own. 'exit' allows only sync work.
function killOnExit() {
  if (!current?.child?.pid) return;
  if (process.platform === 'win32') killPid(current.child.pid);
  else { try { process.kill(-current.child.pid, 'SIGTERM'); } catch { current.child.kill(); } }
}
process.once('exit', killOnExit);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(sig, () => process.exit(130));

export function cancelDirector() {
  if (!current) throw new StudioError('No Director run is active', 409);
  current.stop('cancelled', 'Cancelled in the UI');
  return publicRun(current);
}

/** The jobs the next click runs and the model it runs them on; one job when `job` is given. */
export function planRun(d, project, job = null, backend = SEAT) {
  assertId(project, 'project');
  const api = backend.kind === 'api';
  const modelOf = api ? (j) => { const { hard, why } = hardJob(d, j); return workerModel(backend, hard, why); } : (j) => jobModel(d, j);
  const brand = loadBrand(project);
  let queue;
  if (job) {
    const brief = loadBrief(project, assertId(job, 'job'));
    const status = getStatus(project, job);
    if (!inDirectorQueue(status) && status.status !== 'error') throw new StudioError('This job is not waiting for the Director', 409);
    queue = [{ id: job, ...modelOf({ brief, brand, status }) }];
  } else {
    queue = listJobs(project).filter((j) => inDirectorQueue(j.status)).map((j) => ({ id: j.brief.id, ...modelOf({ brief: j.brief, brand, status: j.status }) }));
  }
  const plan = pickRun(queue, d.maxJobsPerRun);
  return { ...plan, label: plan.model && (api ? `${backend.label} ${plan.model}` : modelLabel(plan.model)), brand };
}

/**
 * One click: the backend is picked here, once, and the run stays on it. `providers`, `env`, `fetch` and `files`
 * default to config/providers.json, the process, Node's fetch and logs/director/; `runPrepare` serves the API worker.
 */
/**
 * The pid of another live Motion Studio server running a Director run now (seat or API, from its in-flight record),
 * or null. "One run at a time" is per process otherwise: a second UI or a test server shares the daily counters but
 * not `current`. A process list that cannot be read answers null rather than block every run.
 */
export function directorElsewhere({ dir = INFLIGHT_DIR, self = SELF, probe = probeProcesses } = {}) {
  const docs = (exists(dir) ? fs.readdirSync(dir) : []).filter((f) => INFLIGHT_RE.test(f)).map((f) => readJson(within(dir, f), null))
    .filter((d) => d?.server && d.server.pid !== self.pid && Object.values(d.children || {}).some((c) => c?.kind === 'director'));
  if (!docs.length) return null;
  const alive = probe(docs.map((d) => Number(d.server.pid)));
  return alive ? docs.find((d) => ownsProcess(d.server, alive.get(d.server.pid)))?.server.pid ?? null : null;
}

export function startDirector(d, { project, job, by, engineBusy, runPrepare, providers = readJson(PROVIDERS_FILE), env = process.env, fetch = globalThis.fetch, files = FILES, elsewhere = directorElsewhere }) {
  const other = elsewhere();
  if (other) throw new StudioError(`The Director is already running from another Motion Studio server (process ${other}). Wait for it to finish.`, 409);
  const backend = pickBackend(providers, env);
  assertCanStart(current, backendPause(backend, files), { used: runsToday(files.runs), max: d.maxRunsPerDay ?? 20 }, backend);
  const plan = planRun(d, project, job, backend);
  if (!plan.jobs.length) throw new StudioError('No jobs in this project are waiting for the Director', 409);
  const jobs = plan.jobs.map((q) => q.id);
  if (jobs.some(engineBusy)) throw new StudioError('A prepare or render of one of these jobs is running. Wait for it to finish.', 409);
  if (backend.kind === 'seat') return startSeatRun(d, { project, by, plan, jobs });
  assertApiConfig(d.api);
  // The run lives in this process: recorded like a child, so another server starting meanwhile leaves its jobs
  // alone, and a start after this server stops resets them.
  trackChild(API_ACTION, { kind: 'director', action: API_ACTION, project, jobs, pid: SELF.pid, exe: exeName(process.execPath), startedAt: SELF.startedAt });
  const run = startApiRun(d, providers, {
    backend, plan, prompt: studioCommand(project, jobs), project, by, runPrepare, fetch, env, files,
    onEnd: (r) => { untrackChild(API_ACTION); if (current === r) current = null; last = r; },
  });
  current = run;
  return publicRun(run);
}

function startSeatRun(d, { project, by, plan, jobs }) {
  const exe = resolveClaude(d.claudePath);
  const prompt = studioCommand(project, jobs);
  const args = directorArgs(prompt, d, { jobs: jobs.length, hosts: plan.brand.sources?.allowedHosts || [], model: plan.model });
  const minutes = d.jobTimeoutMinutes * jobs.length;

  const logFile = logFileFor(project);
  fs.mkdirSync(DIRECTOR_DIR, { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'w' });
  let logBytes = 0;
  // A log that cannot be written stops logging instead of crashing the server; the run goes on.
  log.on('error', () => { logBytes = d.maxLogBytes; });
  // The UI shows this log. Whatever the run read or printed, no key value (by value or by shape) reaches it.
  const keys = [...keyEnvNames(readJson(PROVIDERS_FILE)), 'GEMINI_API_KEY'].map((n) => process.env[n]).filter(Boolean);
  const write = (s) => {
    if (!s || logBytes >= d.maxLogBytes) return;
    const line = `${redact(s, keys)}\n`;
    logBytes += Buffer.byteLength(line);
    log.write(logBytes < d.maxLogBytes ? line : '[log capped at director.maxLogBytes]\n');
  };
  write(`${nowIso()} ${by} started: ${prompt} (limit ${minutes} min, on the Claude seat (${plan.label}))`);
  for (const q of plan.jobs) write(`  ${q.id}: ${modelLabel(q.model)}, ${q.why}`);
  if (plan.waiting) write(`  ${plan.waiting} more queued job(s) wait for the next run (another model, or over director.maxJobsPerRun).`);

  const env = directorEnv(process.env, readJson(path.join(DIRS.config, 'providers.json')));
  countRun(RUNS_FILE);
  const child = spawn(exe, args, { cwd: ROOT, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const run = { project, jobs, prompt, model: plan.label, by, startedAt: nowIso(), status: 'running', child };
  trackChild('director', { kind: 'director', action: 'director', project, jobs, pid: child.pid, exe: exeName(exe), startedAt: Date.now() });
  run.stop = (status, message) => {
    if (run.status !== 'running') return;
    run.status = status; run.message = message;
    killTree(child);
  };
  current = run;
  const timer = setTimeout(() => run.stop('timeout', `Stopped after ${minutes} min, the limit for ${jobs.length} job(s)`), minutes * 60000);

  let outBytes = 0;
  const watch = (text) => {
    const p = detectPause(text, new Date(), d.defaultPauseMinutes);
    if (!p) return;
    writeJson(PAUSE_FILE, { ...p, at: nowIso(), project });
    run.stop('paused', `Claude usage limit reached. Paused until ${new Date(p.until).toLocaleString('en-US')}.`);
  };
  const counted = (chunk) => {
    outBytes += chunk.length;
    if (outBytes > d.maxOutputBytes) run.stop('error', 'Director output passed director.maxOutputBytes');
    return outBytes <= d.maxOutputBytes;
  };
  const dec = new StringDecoder('utf8');
  let pending = '';
  child.stdout.on('data', (chunk) => {
    if (!counted(chunk)) return;
    const lines = (pending + dec.write(chunk)).split('\n');
    pending = lines.pop();
    if (pending.length > MAX_LINE) pending = '';
    for (const l of lines.map((x) => x.trim()).filter(Boolean)) {
      const ev = eventText(l);
      write(ev.text);
      if (ev.result) run.result = ev.result;
      watch(ev.check);
    }
  });
  child.stderr.on('data', (chunk) => {
    if (!counted(chunk)) return;
    const s = chunk.toString('utf8').trimEnd();
    write(s);
    watch(s);
  });

  const finish = (code, err) => {
    if (current !== run) return;
    clearTimeout(timer);
    current = null;
    if (err) write(`Could not start Claude Code: ${err.message}`);
    if (run.status === 'running') {
      const ok = code === 0 && !err && !run.result?.is_error;
      run.status = ok ? 'done' : 'error';
      run.message = ok ? 'Finished' : err ? 'Claude Code could not start' : `Claude Code stopped (${run.result?.subtype || `exit code ${code}`})`;
    }
    run.endedAt = nowIso();
    untrackChild('director');
    try { resetUnfinished(project, jobs, run); } catch (e) { write(`Could not reset job status: ${e.message}`); }
    log.end(`${run.endedAt} ${run.status}: ${run.message}\n`);
    last = run;
  };
  child.on('error', (err) => finish(null, err));
  child.on('close', (code) => finish(code));
  return publicRun(run);
}
