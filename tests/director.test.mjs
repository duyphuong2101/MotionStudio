import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig, DIRS } from '../engine/core.mjs';
import {
  DIRECTOR_MODELS, DEFAULT_ROUTING, assertDirectorModel, setDirectorModel, jobModel, pickRun, directorArgs, studioCommand, resolveClaude, detectPause, eventText, assertCanStart, inDirectorQueue, runsToday, countRun, runDay,
} from '../server/director.mjs';
import { directorEnv } from '../server/director.mjs';
import { keyEnvNames, loadKeysFromEnvFile } from '../server/keys.mjs';
import { ADAPTER_KINDS, assertApiConfig, pickBackend, hardJob, workerModel, planRun, setDefaultProvider } from '../server/director.mjs';
import { writeJson } from '../engine/core.mjs';
import { validateBrief, saveBrief } from '../engine/jobs.mjs';
import { nextRun, directorProviders } from '../server/director.mjs';

const D = loadStudioConfig().director;
const FORBIDDEN = ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'];
const between = (args, from, to) => args.slice(args.indexOf(from) + 1, args.indexOf(to));

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/* ---------- argument builder ---------- */
test('director args carry no permission-bypass flag and run print mode', () => {
  const args = directorArgs('/studio run acme/promo', D, { jobs: 1 });
  assert.deepEqual(args.slice(0, 2), ['-p', '/studio run acme/promo']);
  for (const f of FORBIDDEN) assert.ok(!args.includes(f), f);
  assert.ok(!args.some((a) => a.includes('bypassPermissions')));
  assert.deepEqual(between(args, '--permission-prompts', '--max-turns'), ['none']);
  // dontAsk overrides a user-level defaultMode such as auto, so only the allowlist runs.
  assert.deepEqual(between(args, '--permission-mode', '--permission-prompts'), ['dontAsk']);
});

test('the allowlist lets the director prepare but never render or approve', () => {
  const args = directorArgs('/studio run acme/promo', D, { jobs: 1 });
  const allowed = between(args, '--allowedTools', '--disallowedTools');
  const denied = between(args, '--disallowedTools', '--permission-mode');
  assert.ok(allowed.includes('Bash(node engine/cli.mjs prepare *)'));
  assert.ok(!allowed.some((r) => /render|approve|^Bash$|^Edit$|^Write$/.test(r)));
  assert.ok(denied.includes('Bash(node engine/cli.mjs render *)'));
  assert.ok(denied.includes('Bash(node engine/cli.mjs approve *)'));
  assert.ok(!args[args.indexOf('--tools') + 1].split(',').includes('PowerShell'));
});

test('max turns scale with the number of jobs', () => {
  const args = directorArgs('/studio run a/b a/c', D, { jobs: 2 });
  assert.equal(args[args.indexOf('--max-turns') + 1], String(D.maxTurnsPerJob * 2));
});

test('WebFetch is offered only for the brand allowed hosts', () => {
  const none = directorArgs('x', D, { jobs: 1 });
  assert.ok(!none.some((a) => a.includes('WebFetch')));
  const args = directorArgs('x', D, { jobs: 1, hosts: ['shop.example.com', 'bad host/x'] });
  assert.ok(args[args.indexOf('--tools') + 1].split(',').includes('WebFetch'));
  assert.ok(args.includes('WebFetch(domain:shop.example.com)'));
  assert.ok(!args.some((a) => a.includes('bad host')));
});

test('the seat may Edit only the three draft files, never any other file under out/**', () => {
  assert.ok(D.allowedTools.every((r) => !/^Edit\(out\/\*\*/.test(r)), 'a blanket Edit(out/**) would let the seat rewrite an approved job\'s index.html');
  for (const kind of ['source', 'script', 'outline']) assert.ok(D.allowedTools.includes(`Edit(out/*/*/${kind}.draft.json)`));
});

test('the seat may not read secret files: .env, *.local.*, keys', () => {
  const denied = between(directorArgs('x', D, { jobs: 1 }), '--disallowedTools', '--permission-mode');
  for (const r of ['Read(.env)', 'Read(.env.*)', 'Read(*.local.json)', 'Read(*.local.md)', 'Read(*.pem)', 'Read(*.key)']) assert.ok(denied.includes(r), r);
});

test('the seat runs isolated from project/local settings.json and project MCP servers', () => {
  const args = directorArgs('/studio run acme/promo', D, { jobs: 1 });
  assert.deepEqual(between(args, '--setting-sources', '--strict-mcp-config'), ['user']);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(between(args, '--mcp-config', '--tools'), ['{"mcpServers":{}}']);
});

test('a config that allows render, plain Bash, a broad node/npm rule or an extra tool is refused', () => {
  assert.throws(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, 'Bash(node engine/cli.mjs render *)'] }, { jobs: 1 }), /render/);
  assert.throws(() => directorArgs('x', { ...D, allowedTools: ['Bash'] }, { jobs: 1 }), /Bash/);
  assert.throws(() => directorArgs('x', { ...D, tools: [...D.tools, 'PowerShell'] }, { jobs: 1 }), /PowerShell/);
  // A rule this broad would let the seat run `node --test` (or any node/npm command) on a file
  // it just Edited under out/**, bypassing the named render/approve/sequence denials.
  assert.throws(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, 'Bash(node --test *)'] }, { jobs: 1 }), /node --test/);
  assert.throws(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, 'Bash(node:*)'] }, { jobs: 1 }), /node:/);
  assert.throws(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, 'Bash(npm test*)'] }, { jobs: 1 }), /npm test/);
  // The one safe node shape still passes.
  assert.doesNotThrow(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, 'Bash(node engine/cli.mjs help *)'] }, { jobs: 1 }));
});

test('the command names one job or each queued job of the project', () => {
  assert.equal(studioCommand('acme', ['promo']), '/studio run acme/promo');
  assert.equal(studioCommand('acme', ['a', 'b']), '/studio run acme/a acme/b');
});

/* ---------- executable ---------- */
test('a claude.cmd shim alone is refused, never run through a shell', (t) => {
  const bin = tmp(t);
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '');
  assert.throws(() => resolveClaude('', { env: { PATH: bin }, platform: 'win32', home: tmp(t) }), /shim/);
  assert.throws(() => resolveClaude(path.join(bin, 'claude.cmd'), { platform: 'win32' }), /claude\.exe/);
});

test('claude.exe on PATH or in the VS Code extension is found', (t) => {
  const bin = tmp(t);
  fs.writeFileSync(path.join(bin, 'claude.exe'), '');
  assert.equal(resolveClaude('', { env: { PATH: bin }, platform: 'win32', home: tmp(t) }), path.join(bin, 'claude.exe'));
  const home = tmp(t);
  for (const v of ['2.1.30', '2.1.299']) {
    const d = path.join(home, '.vscode', 'extensions', `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'claude.exe'), '');
  }
  assert.match(resolveClaude('', { env: { PATH: '' }, platform: 'win32', home }), /2\.1\.299/);
});

test('no claude at all asks the person to install it', (t) => {
  assert.throws(() => resolveClaude('', { env: { PATH: '' }, platform: 'win32', home: tmp(t) }), /not found/);
});

/* ---------- quota ---------- */
test('a usage-limit message with an epoch pauses until that time', () => {
  const p = detectPause('Claude AI usage limit reached|1760000000');
  assert.equal(p.until, new Date(1760000000 * 1000).toISOString());
});

test('a usage-limit message with a clock time pauses until the next such time', () => {
  const now = new Date(2026, 9, 14, 10, 0);
  assert.equal(new Date(detectPause("You've hit your limit · resets 3pm (Asia/Saigon)", now).until).getHours(), 15);
  const late = new Date(2026, 9, 14, 23, 0);
  const p = new Date(detectPause('5-hour limit reached ∙ resets 2am', late).until);
  assert.deepEqual([p.getDate(), p.getHours()], [15, 2]);
});

test('a usage limit without a time pauses for the default minutes', () => {
  const now = new Date(2026, 9, 14, 10, 0);
  assert.equal(detectPause('Usage limit reached.', now, 60).until, new Date(now.getTime() + 3600000).toISOString());
  assert.equal(detectPause('Wrote script.draft.json for 3 scenes', now), null);
});

test('only result text and short plain replies are checked for a limit', () => {
  const result = eventText(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'usage limit reached' }));
  assert.equal(result.check, 'usage limit reached');
  assert.equal(result.result.subtype, 'success');
  const tool = eventText(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node engine/cli.mjs list --queued' } }] } }));
  assert.equal(tool.text, '> Bash node engine/cli.mjs list --queued');
  assert.equal(tool.check, '');
});

/* ---------- one run at a time ---------- */
test('a second run is refused while one is active or while paused', () => {
  assert.throws(() => assertCanStart({ project: 'a' }, null), (e) => e.code === 409);
  assert.throws(() => assertCanStart(null, { until: new Date(Date.now() + 60000).toISOString() }), (e) => e.code === 429 && /paused/.test(e.message));
  assert.doesNotThrow(() => assertCanStart(null, null));
  assert.throws(() => assertCanStart(null, null, { used: 20, max: 20 }), (e) => e.code === 429 && /Daily Director limit/.test(e.message));
  assert.doesNotThrow(() => assertCanStart(null, null, { used: 19, max: 20 }));
});

test('the director queue is queued jobs and jobs edited before the script', () => {
  assert.ok(inDirectorQueue({ status: 'queued' }));
  assert.ok(inDirectorQueue({ status: 'dirty', dirty_from: 4 }));
  assert.ok(!inDirectorQueue({ status: 'dirty', dirty_from: 5 }));
  assert.ok(!inDirectorQueue({ status: 'awaiting_review' }));
});

test('the daily run count resets on a new local day', (t) => {
  const file = path.join(tmp(t), 'runs.json');
  const mon = new Date(2026, 9, 12, 23, 50), tue = new Date(2026, 9, 13, 0, 5);
  assert.equal(runsToday(file, mon), 0);
  countRun(file, mon); countRun(file, mon);
  assert.equal(runsToday(file, mon), 2);
  assert.equal(runsToday(file, tue), 0);
  countRun(file, tue);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { day: runDay(tue), count: 1 });
});

/* ---------- child environment ---------- */
test('the Claude child gets no API key named in config/providers.json', () => {
  const providers = JSON.parse(fs.readFileSync(new URL('../config/providers.json', import.meta.url), 'utf8'));
  const env = directorEnv({ GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a', XAI_API_KEY: 'x', PATH: 'p' }, providers);
  assert.deepEqual(env, { PATH: 'p' });
  assert.deepEqual(directorEnv({ gemini_api_key: 'k', Path: 'p' }, providers), { Path: 'p' });
});

test('the Claude child gets no other key, endpoint or cloud switch, but keeps the seat login', () => {
  const env = {
    GOOGLE_API_KEY: '1', google_genai_api_key: '2', ANTHROPIC_AUTH_TOKEN: '3', ANTHROPIC_BASE_URL: '4', CLAUDE_CODE_USE_BEDROCK: '5',
    claude_code_use_vertex: '6', AWS_BEARER_TOKEN_BEDROCK: '7', CLAUDE_CODE_OAUTH_TOKEN: 'seat', USERPROFILE: 'u', PATH: 'p',
  };
  assert.deepEqual(directorEnv(env, { providers: {} }), { CLAUDE_CODE_OAUTH_TOKEN: 'seat', USERPROFILE: 'u', PATH: 'p' });
});

test('a key loaded from .env never reaches the Claude child', (t) => {
  const providers = JSON.parse(fs.readFileSync(new URL('../config/providers.json', import.meta.url), 'utf8'));
  const file = path.join(tmp(t), 'keys.env');
  fs.writeFileSync(file, 'GEMINI_API_KEY=from-dotenv\nANTHROPIC_API_KEY=a\n');
  const env = { PATH: 'p' };
  assert.deepEqual(loadKeysFromEnvFile(file, keyEnvNames(providers), env).sort(), ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY']);
  assert.deepEqual(directorEnv(env, providers), { PATH: 'p' });
});

test('the director may read the pacing table and re-run the play-through check, which write nothing', () => {
  const args = between(directorArgs('/studio run acme/promo', D, { jobs: 1 }), '--allowedTools', '--disallowedTools');
  for (const cmd of ['review', 'playcheck']) assert.ok(args.includes(`Bash(node engine/cli.mjs ${cmd} *)`), cmd);
  for (const cmd of ['clip', 'shots']) assert.ok(!D.allowedTools.includes(`Bash(node engine/cli.mjs ${cmd} *)`), `${cmd} stays out: it writes assets or caches`);
});

test('the director may fail a job, but render, approve, sequence and reset-dirty stay refused', () => {
  const rule = 'Bash(node engine/cli.mjs fail *)';
  assert.ok(D.allowedTools.includes(rule));
  const args = directorArgs('/studio run acme/promo', D, { jobs: 1 });
  assert.ok(between(args, '--allowedTools', '--disallowedTools').includes(rule));
  for (const cmd of ['render', 'approve', 'sequence', 'reset-dirty']) {
    assert.throws(() => directorArgs('x', { ...D, allowedTools: [...D.allowedTools, `Bash(node engine/cli.mjs ${cmd} *)`] }, { jobs: 1 }), (e) => e.code === 503 && e.message.includes(cmd), cmd);
    assert.ok(D.disallowedTools.includes(`Bash(node engine/cli.mjs ${cmd} *)`), cmd);
  }
});

/* ---------- model ---------- */
test('the Director offers only auto, Opus 5.5 and Sonnet 5.5, and passes a pinned --model', () => {
  const A = { ...D, model: 'auto' };
  assert.deepEqual(DIRECTOR_MODELS.map((m) => m.id), ['auto', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  const args = directorArgs('/studio run acme/promo', D, { jobs: 1, model: 'claude-opus-5-5' });
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(directorArgs('x', { ...D, model: 'claude-sonnet-5-5' }, { jobs: 1 }).at(-1), 'claude-sonnet-5-5');
  assert.equal(directorArgs('x', A, { jobs: 1 }).at(-1), 'claude-sonnet-5-5', 'auto with no plan runs the standard model');
});

test('an unknown, empty, Haiku or Fable model is refused, and --model is never auto', () => {
  for (const bad of ['', 'opus', 'gpt-5', 'claude-haiku-5-5', 'claude-fable-5-1', '--bare', 'claude-opus-5-5 --dangerously-skip-permissions', 'claude-opus-5-5\n']) {
    assert.throws(() => assertDirectorModel(bad), /director\.model .* is not allowed/, bad);
    assert.throws(() => directorArgs('x', { ...D, model: bad }, { jobs: 1 }), /is not allowed/, bad);
  }
  assert.throws(() => assertDirectorModel('auto', { pinned: true }), /is not allowed/);
  assert.throws(() => directorArgs('x', D, { jobs: 1, model: 'claude-haiku-5-5' }), /is not allowed/);
  assert.throws(() => jobModel({ ...D, model: 'auto', routing: { strong: 'claude-fable-5-1' } }, { brief: { template: 'data-story' } }), /is not allowed/);
});

test('auto sends standard jobs to Sonnet and hard jobs to Opus, with the reason', () => {
  const A = { ...D, model: 'auto' };
  const en = { voice: { lang: 'en' } };
  const pick = (brief, extra = {}) => jobModel(A, { brief, brand: en, status: { status: 'queued' }, ...extra });
  for (const template of ['explainer', 'promo', 'product-demo', 'logo-reveal', 'talking-head']) {
    assert.deepEqual(pick({ template }), { model: 'claude-sonnet-5-5', why: 'a standard job' }, template);
  }
  for (const template of DEFAULT_ROUTING.strongTemplates) {
    assert.equal(pick({ template }).model, 'claude-opus-5-5', template);
  }
  assert.equal(pick({ template: 'explainer', mix: ['data-story'] }).why, 'a mixed brief');
  assert.equal(pick({ template: 'explainer', lang: 'vi' }).why, 'copy in vi');
  assert.equal(pick({ template: 'explainer', lang: 'en-gb' }).model, 'claude-sonnet-5-5');
  assert.equal(jobModel(A, { brief: { template: 'promo' }, brand: { voice: { lang: 'de' } } }).model, 'claude-opus-5-5', 'brand language counts');
  assert.equal(pick({ template: 'promo' }, { status: { status: 'error' } }).why, 'a retry after an error');
  assert.deepEqual(jobModel({ ...D, model: 'claude-sonnet-5-5' }, { brief: { template: 'data-story' }, brand: en }), { model: 'claude-sonnet-5-5', why: 'set in the Director panel' });
  assert.equal(jobModel({ ...A, routing: { strongTemplates: [] } }, { brief: { template: 'data-story' }, brand: en }).model, 'claude-sonnet-5-5', 'routing is configurable');
});

test('one run takes one model: the first queued job sets it, the rest wait', () => {
  const q = [{ id: 'a', model: 'S' }, { id: 'b', model: 'O' }, { id: 'c', model: 'S' }, { id: 'd', model: 'S' }];
  assert.deepEqual(pickRun(q, 5), { model: 'S', jobs: [q[0], q[2], q[3]], waiting: 1 });
  assert.deepEqual(pickRun(q, 2), { model: 'S', jobs: [q[0], q[2]], waiting: 2 });
  assert.deepEqual(pickRun(q.slice(1), 5).jobs.map((j) => j.id), ['b']);
  assert.deepEqual(pickRun([], 5), { model: null, jobs: [], waiting: 0 });
});

test('setDirectorModel saves the choice into config/studio.json and the running config', (t) => {
  const file = path.join(DIRS.config, 'studio.json');
  const before = fs.readFileSync(file, 'utf8');
  t.after(() => fs.writeFileSync(file, before, 'utf8'));
  const d = { ...loadStudioConfig().director };
  const res = setDirectorModel(d, 'claude-sonnet-5-5');
  assert.equal(res.model, 'claude-sonnet-5-5');
  assert.equal(d.model, 'claude-sonnet-5-5');
  assert.equal(loadStudioConfig().director.model, 'claude-sonnet-5-5');
  assert.deepEqual(res.models, DIRECTOR_MODELS);
  assert.deepEqual({ ...loadStudioConfig().director, model: JSON.parse(before).director.model }, JSON.parse(before).director, 'only the model changed');
  assert.throws(() => setDirectorModel(d, 'sonnet'), /is not allowed/);
  assert.equal(loadStudioConfig().director.model, 'claude-sonnet-5-5', 'a refused value changes nothing');
});

/* ---------- backend: seat or API provider ---------- */
const PROVIDERS = () => JSON.parse(fs.readFileSync(new URL('../config/providers.json', import.meta.url), 'utf8'));
const withDefault = (id, patch = {}) => {
  const p = PROVIDERS();
  p.default = id;
  Object.assign(p.providers[id] || {}, patch);
  return p;
};

test('the next click goes to the seat unless the default provider has an adapter, its key and a model', () => {
  const env = { OPENAI_API_KEY: 'k' };
  assert.deepEqual(pickBackend(PROVIDERS(), env), { kind: 'seat' }, 'default seat');
  assert.deepEqual(pickBackend({ providers: {} }, env), { kind: 'seat' }, 'no default');
  const noKey = pickBackend(withDefault('openai', { model: 'gpt-5.6' }), {});
  assert.equal(noKey.kind, 'seat');
  assert.match(noKey.reason, /OPENAI_API_KEY is not set/);
  const noModel = pickBackend(withDefault('openai'), env);
  assert.equal(noModel.kind, 'seat');
  assert.match(noModel.reason, /no model set/);
  const api = pickBackend(withDefault('openai', { model: 'gpt-5.6', strongModel: 'gpt-5.6-pro' }), env);
  assert.deepEqual(api, { kind: 'api', provider: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', model: 'gpt-5.6', strongModel: 'gpt-5.6-pro', vision: true });
  const seatKind = pickBackend({ default: 'cc', providers: { cc: { kind: 'claude-code', model: 'm', keyEnv: 'OPENAI_API_KEY' } } }, env);
  assert.equal(seatKind.kind, 'seat', 'claude-code has no adapter, so it never becomes an HTTP call');
  assert.match(seatKind.reason, /no adapter/);
  assert.match(pickBackend({ default: 'nope', providers: {} }, env).reason, /nope has no adapter/);
});

test('every API provider in providers.json has an adapter kind and a key name, and the seat has none', () => {
  const { providers } = PROVIDERS();
  assert.equal(providers.seat.kind, 'claude-code');
  assert.ok(!ADAPTER_KINDS.includes(providers.seat.kind));
  for (const id of ['openai', 'grok', 'gemini', 'claude', 'qwen']) {
    assert.ok(ADAPTER_KINDS.includes(providers[id].kind), id);
    assert.match(providers[id].keyEnv, /^[A-Z][A-Z0-9_]*$/, id);
    assert.match(providers[id].baseUrl, /^https:\/\//, id);
  }
});

test('hardJob is the predicate behind auto routing and agrees with jobModel', () => {
  const A = { ...D, model: 'auto' };
  const en = { voice: { lang: 'en' } };
  const queued = { status: 'queued' };
  const cases = [
    { brief: { template: 'explainer' }, brand: en, status: queued },
    { brief: { template: 'data-story' }, brand: en, status: queued },
    { brief: { template: 'explainer', mix: ['data-story'] }, brand: en, status: queued },
    { brief: { template: 'explainer', lang: 'vi' }, brand: en, status: queued },
    { brief: { template: 'explainer', lang: 'en-gb' }, brand: en, status: queued },
    { brief: { template: 'promo' }, brand: { voice: { lang: 'de' } } },
    { brief: { template: 'promo' }, brand: en, status: { status: 'error' } },
  ];
  const r = { ...DEFAULT_ROUTING, ...A.routing };
  for (const c of cases) {
    const h = hardJob(A, c);
    assert.deepEqual(jobModel(A, c), { model: h.hard ? r.strong : r.standard, why: h.why }, JSON.stringify(c.brief));
  }
  assert.deepEqual(hardJob(A, cases[0]), { hard: false, why: 'a standard job' });
  assert.equal(hardJob({ ...A, routing: { strongTemplates: [] } }, cases[1]).hard, false, 'routing is configurable');
  assert.equal(hardJob({ ...A, routing: undefined }, cases[1]).hard, true, 'default strong templates');
});

test('an API job takes the strong model when it is hard and one is set', () => {
  assert.equal(workerModel({ model: 'a', strongModel: 'b' }, true).model, 'b');
  assert.equal(workerModel({ model: 'a', strongModel: '' }, true).model, 'a');
  assert.equal(workerModel({ model: 'a', strongModel: 'b' }, false).model, 'a');
  assert.deepEqual(workerModel({ model: 'a', strongModel: '' }, true, 'copy in vi'), { model: 'a', why: 'copy in vi, no strong model set' });
  assert.deepEqual(workerModel({ model: 'a' }, false), { model: 'a', why: 'a standard job' });
});

test('director.api: every cap is a positive number', () => {
  const api = loadStudioConfig().director.api;
  assert.equal(assertApiConfig(api), api);
  assert.throws(() => assertApiConfig({ ...api, maxTurnsPerJob: 0 }), (e) => e.code === 503 && e.message.includes('director.api.maxTurnsPerJob'));
  assert.throws(() => assertApiConfig({ ...api, maxCallsPerDay: '400' }), (e) => e.code === 503 && e.message.includes('director.api.maxCallsPerDay'));
  const { pauseMinutes, ...missing } = api;
  assert.throws(() => assertApiConfig(missing), /director\.api\.pauseMinutes/);
  assert.throws(() => assertApiConfig(undefined), (e) => e.code === 503);
  const { maxFetchesPerJob, ...noFetchCap } = api;
  assert.equal(maxFetchesPerJob, 6);
  assert.throws(() => assertApiConfig(noFetchCap), (e) => e.code === 503 && e.message.includes('director.api.maxFetchesPerJob'));
});

test('setDefaultProvider changes only default and that provider\'s model, strongModel and vision', (t) => {
  const file = path.join(tmp(t), 'providers.json');
  fs.copyFileSync(new URL('../config/providers.json', import.meta.url), file);
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(setDefaultProvider(file, { default: 'openai', model: 'gpt-5.6', strongModel: 'gpt-5.6-pro', vision: false }),
    { default: 'openai', model: 'gpt-5.6', strongModel: 'gpt-5.6-pro', vision: false });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.default, 'openai');
  assert.deepEqual([after.providers.openai.model, after.providers.openai.strongModel, after.providers.openai.vision], ['gpt-5.6', 'gpt-5.6-pro', false]);
  for (const doc of [before, after]) {
    delete doc.default;
    for (const k of ['model', 'strongModel', 'vision']) delete doc.providers.openai[k];
  }
  assert.deepEqual(after, before);
  assert.deepEqual(setDefaultProvider(file, { default: 'seat' }), { default: 'seat' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).providers.openai.model, 'gpt-5.6', 'going back to the seat keeps the provider models');
});

test('setDefaultProvider refuses an unknown provider, a bad model id and seat with model fields, leaving the file as it was', (t) => {
  const file = path.join(tmp(t), 'providers.json');
  fs.copyFileSync(new URL('../config/providers.json', import.meta.url), file);
  const bytes = fs.readFileSync(file);
  for (const body of [{ default: 'nope' }, { default: 'openai', model: 'x y' }, { default: 'seat', model: 'a' }, { default: 'openai', strongModel: 7 }, { default: 'openai', vision: 'yes' }, {}, null]) {
    assert.throws(() => setDefaultProvider(file, body), (e) => e.code === 400, JSON.stringify(body));
  }
  assert.throws(() => setDefaultProvider(file, { default: 'nope' }), /Use seat or one of: openai, grok, gemini, claude, qwen/);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('planRun groups a project\'s queue under the seat model, or under the provider model for the API', (t) => {
  const P = 'zz-test-director-backend';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  writeJson(path.join(DIRS.profiles, P, 'brand.json'), { voice: { lang: 'en' } });
  const brief = (id, more = {}) => saveBrief(validateBrief({ id, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', ...more }));
  // listJobs puts the newest brief first, so a-std is the one that sets the run's model.
  brief('a-std', { createdAt: '2026-10-23T10:00:00.000Z' });
  brief('b-hard', { lang: 'vi', createdAt: '2026-10-23T09:00:00.000Z' });
  const A = { ...D, model: 'auto' };
  const seat = planRun(A, P);
  assert.deepEqual([seat.model, seat.label, seat.jobs.map((j) => j.id), seat.waiting], [DEFAULT_ROUTING.standard, 'Sonnet 5.5', ['a-std'], 1]);
  const backend = { kind: 'api', provider: 'openai', label: 'OpenAI', model: 'gpt-5.6', strongModel: 'gpt-5.6-pro' };
  const api = planRun(A, P, null, backend);
  assert.deepEqual([api.model, api.label, api.jobs, api.waiting], ['gpt-5.6', 'OpenAI gpt-5.6', [{ id: 'a-std', model: 'gpt-5.6', why: 'a standard job' }], 1]);
  const hard = planRun(A, P, 'b-hard', backend);
  assert.deepEqual([hard.label, hard.jobs], ['OpenAI gpt-5.6-pro', [{ id: 'b-hard', model: 'gpt-5.6-pro', why: 'copy in vi' }]]);
  const one = planRun(A, P, 'b-hard', { ...backend, strongModel: '' });
  assert.deepEqual(one.jobs, [{ id: 'b-hard', model: 'gpt-5.6', why: 'copy in vi, no strong model set' }]);
  assert.equal(planRun({ ...D, model: 'claude-opus-5-5' }, P, null, backend).model, 'gpt-5.6', 'the seat model setting does not reach the API');
});

test('a pause names the backend it blocks: the Claude seat, or the API provider', () => {
  const pause = { until: new Date(Date.now() + 60000).toISOString() };
  assert.throws(() => assertCanStart(null, pause, undefined, { kind: 'api', provider: 'openai', label: 'OpenAI' }), (e) => e.code === 429 && /^OpenAI rate or spend limit reached\. Director runs are paused/.test(e.message));
  assert.throws(() => assertCanStart(null, pause), (e) => e.code === 429 && /^Claude usage limit reached/.test(e.message));
});

test('nextRun and the panel list say where the next click goes, with hasKey booleans only', (t) => {
  const P = 'zz-test-director-next';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  writeJson(path.join(DIRS.profiles, P, 'brand.json'), { voice: { lang: 'en' } });
  saveBrief(validateBrief({ id: 'one', project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  const dir = tmp(t);
  const files = { calls: (id) => path.join(dir, `calls-${id}.json`) };
  const noKey = withDefault('openai', { model: 'gpt-5.6' });
  const seat = pickBackend(noKey, {});
  assert.deepEqual(nextRun(D, P, seat).backend, { kind: 'seat', provider: null, label: 'Claude seat', reason: 'OPENAI_API_KEY is not set' });
  const panel = directorProviders(D, noKey, {}, files);
  assert.deepEqual(panel.providers.map((p) => p.id), ['openai', 'grok', 'gemini', 'claude', 'qwen'], 'the seat entry is not a provider');
  assert.ok(panel.providers.every((p) => p.hasKey === false));
  assert.deepEqual([panel.default, panel.backend.kind, panel.usage.openai, panel.caps.maxCallsPerDay], ['openai', 'seat', { day: 0, month: 0 }, D.api.maxCallsPerDay]);
  const api = pickBackend(noKey, { OPENAI_API_KEY: 'k-value' });
  assert.deepEqual([nextRun(D, P, api).label, nextRun(D, P, api).backend.label], ['OpenAI gpt-5.6', 'OpenAI']);
  const withKey = directorProviders(D, noKey, { OPENAI_API_KEY: 'k-value' }, files);
  assert.equal(withKey.providers[0].hasKey, true);
  assert.ok(!JSON.stringify(withKey).includes('k-value'));
});
