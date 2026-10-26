import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, getStatus, jobDir } from '../engine/jobs.mjs';
import { usage, runsToday, runDay } from '../server/caps.mjs';
import { startApiRun } from '../server/worker/run.mjs';
import {
  DIRECTOR_DIR, pickBackend, planRun, studioCommand, assertCanStart, backendPause, startDirector, directorState, directorProviders, recoverStale, engineEnv,
} from '../server/director.mjs';

globalThis.fetch = () => { throw new Error('No network in tests'); };

const P = 'zz-test-worker-run';
const JOBS = ['a', 'b', 'c'];
const HOST = 'shop.example.com';
const KEY = 'SENTINEL-KEY-123';
const ENV = { OPENAI_API_KEY: KEY };
const D = loadStudioConfig().director;
const SOURCE = { name: 'Acme', bullets: [{ text: 'Ships in a day', ref: 'brief' }] };
const SCRIPT = { scenes: [
  { id: 'intro', kind: 'title', vo: 'How it works.', title: 'How it works' },
  { id: 's1', kind: 'step', vo: 'It ships in a day.', title: 'Ships fast', icon: 'chat', source: 'bullets[0]' },
] };
const JOB_STEPS = [['claim'], ['write_draft', { kind: 'source', content: SOURCE }], ['commit', { kind: 'source' }],
  ['write_draft', { kind: 'script', content: SCRIPT }], ['commit', { kind: 'script' }], ['prepare'], ['done', { summary: 'An explainer.' }]];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-worker-run-'));
const realLog = path.join(DIRECTOR_DIR, `${P}.log`);
const wipe = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(() => { wipe(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(realLog, { force: true }); });
wipe();
createProject({ id: P, name: 'Worker run' });
const brandFile = path.join(DIRS.profiles, P, 'brand.json');
writeJson(brandFile, { ...readJson(brandFile), sources: { allowedHosts: [HOST] } });
// listJobs puts the newest brief first: a, b, c.
JOBS.forEach((id, i) => saveBrief(validateBrief({
  id, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url: `https://${HOST}/p`, createdAt: `2026-10-23T10:0${9 - i}:00.000Z`,
})));

let n = 0;
/** Fresh job folders (every job queued) and fresh state files in their own temp folder. */
function fresh() {
  JOBS.forEach((id) => fs.rmSync(jobDir(P, id), { recursive: true, force: true }));
  const dir = fs.mkdtempSync(path.join(tmp, `s${n++}-`));
  return {
    runs: path.join(dir, 'runs.json'),
    pause: (p) => path.join(dir, p ? `pause-${p}.json` : 'pause.json'),
    calls: (p) => path.join(dir, `calls-${p}.json`),
    log: (p) => path.join(dir, `${p}.log`),
  };
}

const PROVIDERS = () => {
  const p = JSON.parse(fs.readFileSync(path.join(DIRS.config, 'providers.json'), 'utf8'));
  p.default = 'openai';
  p.providers.openai.model = 'gpt-test';
  return p;
};

const answer = ([name, args = {}], i, text = null) => Response.json({
  choices: [{ message: { role: 'assistant', content: text, tool_calls: [{ id: `t${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }],
  usage: { prompt_tokens: 100, completion_tokens: 10 },
});

/** An OpenAI-shaped fake: each step is a tool call `[name, args]` or a function of the request init. */
function fakeFetch(steps) {
  const f = async (url, init) => {
    f.calls.push({ url, init });
    const s = steps[f.calls.length - 1];
    if (!s) throw new Error('The fake script ran out');
    return typeof s === 'function' ? s(init) : answer(s, f.calls.length);
  };
  f.calls = [];
  return f;
}

const runPrepare = (p, j) => {
  setStatus(p, j, { status: 'awaiting_review', duration: 8, lint: { errors: 0, warnings: 0, findings: [] }, stills: [] }, 'stub prepare', 'test');
  return { started: 'prepare', done: Promise.resolve(), kill() {} };
};

function start({ d = D, files, fetch, providers = PROVIDERS(), env = ENV, backend = pickBackend(providers, env), ...over }) {
  const plan = planRun(d, P, null, backend);
  return startApiRun(d, providers, {
    backend, plan, prompt: studioCommand(P, plan.jobs.map((q) => q.id)), project: P, by: 'tester', runPrepare, fetch, env, files, ...over,
  });
}

test('a scripted OpenAI run does two jobs, counts every call and names the backend in the log', async () => {
  const files = fresh();
  const fetch = fakeFetch([...JOB_STEPS, ...JOB_STEPS]);
  const run = start({ d: { ...D, maxJobsPerRun: 2 }, files, fetch });
  await run.done;
  assert.deepEqual([run.status, run.backend, run.provider, run.jobs], ['done', 'api', 'openai', ['a', 'b']]);
  assert.deepEqual(JOBS.map((id) => getStatus(P, id).status), ['awaiting_review', 'awaiting_review', 'queued']);
  assert.equal(runsToday(files.runs), 1);
  assert.equal(fetch.calls.length, 14);
  assert.equal(usage(files.calls('openai')).day, 14);
  assert.deepEqual(run.usage, { calls: 14, inputTokens: 1400, outputTokens: 140 });
  assert.ok(fetch.calls.every((c) => c.url === 'https://api.openai.com/v1/chat/completions' && c.init.headers.authorization === `Bearer ${KEY}`));
  assert.ok(getStatus(P, 'a').history.some((h) => h.by === 'director-openai' && /claimed/.test(h.event)));
  const log = fs.readFileSync(files.log(P), 'utf8').split('\n');
  assert.match(log[0], /tester started: \/studio run zz-test-worker-run\/a zz-test-worker-run\/b \(limit \d+ min, on OpenAI gpt-test\)$/);
  assert.ok(log.includes('[a] done in 7 turns, 700 in / 70 out tokens'), log.join('\n'));
  assert.match(log.filter(Boolean).at(-1), / done: Finished$/);
});

test('a 429 on the second job pauses the provider and ends the run: job 1 kept, job 2 error, job 3 queued', async () => {
  const files = fresh();
  const limited = () => Response.json({ error: { message: 'Rate limit reached' } }, { status: 429, headers: { 'retry-after': '120' } });
  const fetch = fakeFetch([...JOB_STEPS, ['claim'], limited]);
  const run = start({ files, fetch });
  await run.done;
  assert.equal(run.status, 'paused');
  assert.match(run.message, /^OpenAI rate or spend limit reached\. Paused until /);
  assert.deepEqual(JOBS.map((id) => getStatus(P, id).status), ['awaiting_review', 'error', 'queued']);
  assert.match(getStatus(P, 'b').error, /^The director stopped before the storyboard: Director run paused: OpenAI rate or spend limit reached/);
  const pause = readJson(files.pause('openai'));
  assert.equal(pause.provider, 'openai');
  assert.ok(Math.abs(Date.parse(pause.until) - (Date.now() + 120_000)) < 10_000, pause.until);
  assert.equal(fetch.calls.length, 9);
  assert.deepEqual([usage(files.calls('openai')).day, run.usage.calls], [9, 9]);
});

test('a provider pause blocks the next API click and leaves the seat free', async () => {
  const files = fresh();
  writeJson(files.pause('openai'), { until: new Date(Date.now() + 600_000).toISOString(), reason: 'x', provider: 'openai' });
  const api = pickBackend(PROVIDERS(), ENV);
  assert.throws(() => assertCanStart(null, backendPause(api, files), undefined, api), (e) => e.code === 429 && /^OpenAI rate or spend limit reached\. Director runs are paused/.test(e.message));
  assert.doesNotThrow(() => assertCanStart(null, backendPause({ kind: 'seat' }, files)));
  const fetch = fakeFetch([]);
  assert.throws(() => start({ files, fetch }), (e) => e.code === 429 && /paused/.test(e.message));
  assert.equal(fetch.calls.length, 0);
});

test('maxCallsPerDay used up refuses the run with 429 before any fetch or count', () => {
  const files = fresh();
  writeJson(files.calls('openai'), { day: runDay(), count: D.api.maxCallsPerDay, month: runDay().slice(0, 7), monthCount: D.api.maxCallsPerDay });
  const fetch = fakeFetch(JOB_STEPS);
  assert.throws(() => start({ files, fetch }), (e) => e.code === 429 && e.message.includes('director.api.maxCallsPerDay'));
  assert.equal(fetch.calls.length, 0);
  assert.equal(fs.existsSync(files.runs), false, 'a refused run is not counted');
  assert.throws(() => start({ files, fetch, backend: pickBackend(PROVIDERS(), ENV), env: {} }),(e) => e.code === 503 && /OPENAI_API_KEY is not set/.test(e.message), 'a vanished key fails, never falls back');
});

test('a log file that cannot be written stops logging, and the run still ends and reports', async () => {
  const files = fresh();
  const dir = path.join(path.dirname(files.runs), 'log-is-a-dir');
  fs.mkdirSync(dir);
  let ended = null;
  const run = start({ files: { ...files, log: () => dir }, fetch: fakeFetch(JOB_STEPS), onEnd: (r) => { ended = r; } });
  await run.done;
  assert.deepEqual([run.status, ended, getStatus(P, 'a').status], ['done', run, 'awaiting_review']);
  assert.ok(fs.statSync(dir).isDirectory());
});

test('a provider baseUrl that is not https is refused before any call or count', () => {
  const files = fresh();
  const fetch = fakeFetch(JOB_STEPS);
  for (const baseUrl of ['http://api.openai.com/v1', 'ftp://x', 'not a url']) {
    const providers = PROVIDERS();
    providers.providers.openai.baseUrl = baseUrl;
    assert.throws(() => start({ files, fetch, providers }), (e) => e.code === 503 && e.message.includes('providers.openai.baseUrl in config/providers.json'), baseUrl);
  }
  assert.equal(fetch.calls.length, 0);
  assert.equal(fs.existsSync(files.runs), false);
});

test('cancel aborts the in-flight fetch and leaves the job in error with the reason', async () => {
  const files = fresh();
  let run, seen;
  const hang = (init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { seen = init.signal.aborted; reject(new DOMException('aborted', 'AbortError')); });
    queueMicrotask(() => run.stop('cancelled', 'Cancelled in the UI'));
  });
  const fetch = fakeFetch([['claim'], hang]);
  run = start({ files, fetch });
  await run.done;
  assert.deepEqual([run.status, seen, fetch.calls.length], ['cancelled', true, 2]);
  assert.equal(getStatus(P, 'a').status, 'error');
  assert.match(getStatus(P, 'a').error, /Director run cancelled: Cancelled in the UI/);
  assert.deepEqual(['b', 'c'].map((id) => getStatus(P, id).status), ['queued', 'queued']);
});

test('cancel during prepare kills the prepare child through its handle', async () => {
  const files = fresh();
  let run, killed = null, release;
  const slowPrepare = () => ({ done: new Promise((r) => { release = r; }), kill: (why) => { killed = why; release(); } });
  const fetch = fakeFetch([['claim'], ['prepare']]);
  run = start({ files, fetch, runPrepare: slowPrepare });
  while (!release) await new Promise((r) => setTimeout(r, 5));
  run.stop('cancelled', 'Cancelled in the UI');
  await run.done;
  assert.equal(killed, 'Director run cancelled: Cancelled in the UI');
  assert.equal(run.status, 'cancelled');
});

test('the sentinel key never reaches directorState, the panel list, the log or a status file', async () => {
  const files = { ...fresh(), log: () => realLog };
  const refused = () => Response.json({ error: { message: `Incorrect API key provided: ${KEY}` } }, { status: 401 });
  const fetch = fakeFetch([(init) => answer(['claim'], 1, `my key is ${KEY}`), refused]);
  const providers = PROVIDERS();
  const r = startDirector({ ...D, maxJobsPerRun: 1 }, { project: P, by: 'tester', engineBusy: () => false, runPrepare, providers, env: ENV, fetch, files });
  assert.deepEqual([r.backend, r.provider, r.status], ['api', 'openai', 'running']);
  while (directorState(P).running) await new Promise((res) => setTimeout(res, 10));
  const state = directorState(P);
  assert.deepEqual([state.last.status, state.last.usage.calls], ['done', 2]);
  assert.match(getStatus(P, 'a').error, /OpenAI refused the key \(OPENAI_API_KEY\): Incorrect API key provided: \[key\]/);
  const panel = directorProviders(D, providers, ENV, files);
  assert.deepEqual([panel.backend, panel.providers.find((p) => p.id === 'openai').hasKey, panel.usage.openai.day], [{ kind: 'api', provider: 'openai', label: 'OpenAI', reason: null }, true, 2]);
  assert.match(state.tail, /on OpenAI gpt-test/);
  for (const text of [JSON.stringify(state), JSON.stringify(panel), fs.readFileSync(realLog, 'utf8'), fs.readFileSync(path.join(jobDir(P, 'a'), 'status.json'), 'utf8')]) {
    assert.ok(!text.includes(KEY), text.slice(0, 200));
  }
});

test('recoverStale moves a job an API run left in scripting to error, and nothing else', () => {
  fresh();
  setStatus(P, 'a', { status: 'scripting' }, 'claimed by director', 'director-openai');
  setStatus(P, 'b', { status: 'scripting' }, 'claimed by director', 'claude-seat');
  setStatus(P, 'c', { status: 'awaiting_review' }, 'prepared', 'director-openai');
  assert.deepEqual(recoverStale(P), [`${P}/a`]);
  assert.deepEqual(JOBS.map((id) => getStatus(P, id).status), ['error', 'scripting', 'awaiting_review']);
  assert.match(getStatus(P, 'a').error, /The server stopped during a Director run/);
});

test('engine children get no key named in config/providers.json', () => {
  const { providers } = JSON.parse(fs.readFileSync(path.join(DIRS.config, 'providers.json'), 'utf8'));
  const keyEnvs = Object.values(providers).map((p) => p.keyEnv).filter(Boolean);
  const env = engineEnv({ ...Object.fromEntries(keyEnvs.map((k) => [k, KEY])), PATH: 'p', SystemRoot: 'C:\\Windows' });
  assert.ok(keyEnvs.length >= 5);
  assert.deepEqual(env, { PATH: 'p', SystemRoot: 'C:\\Windows' });
});
