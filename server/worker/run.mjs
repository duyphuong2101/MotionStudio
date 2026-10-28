// One API Director run: the planned jobs one after another through the loop, on one provider with the person's own key.
// Started only from startDirector. Never retries, never switches to the seat; a 429 pauses that provider and ends the run.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, writeJson, nowIso } from '../../engine/core.mjs';
import { getStatus } from '../../engine/jobs.mjs';
import { fail } from '../../engine/pipeline.mjs';
import { countRun, usage, countUse, readPause } from '../caps.mjs';
import { redact, flatLine } from '../http.mjs';
import { runJob } from './loop.mjs';
import { toolsFor } from './tools.mjs';
import { jobPrompt } from './prompt.mjs';
import * as openaiChat from './adapters/openai-chat.mjs';
import * as anthropic from './adapters/anthropic.mjs';

// `kind` in config/providers.json → the adapter module (director.mjs ADAPTER_KINDS lists the same names).
const ADAPTERS = { openai: openaiChat, 'openai-compatible': openaiChat, anthropic };
const UNFINISHED = ['scripting', 'scripted'];
const REASONS = { done: 'it called done before the storyboard was built', failed: 'it gave up', turns: 'out of turns', tokens: 'out of tokens', time: 'out of time', cancelled: 'the run was stopped', error: 'an error' };

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const until = (iso) => new Date(iso).toLocaleString('en-US');

function openLog(file, max) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(file, { flags: 'w' });
  let bytes = 0, broken = false;
  // A log that cannot be written (disk full, file locked) stops logging; the run goes on and still ends.
  out.on('error', () => { broken = true; });
  const write = (s) => {
    if (!s || broken || bytes >= max) return;
    const line = `${s}\n`;
    bytes += Buffer.byteLength(line);
    out.write(bytes < max ? line : '[log capped at director.maxLogBytes]\n');
  };
  const end = (s) => new Promise((resolve) => {
    if (broken) return resolve();
    out.once('error', resolve);
    out.end(`${s}\n`, resolve);
  });
  return { write, end };
}

const isHttps = (s) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };

/**
 * Starts the run and returns its live object (the shape the seat makes, plus `backend: 'api'`, `provider`, `usage`,
 * `stop(status, message)` and `done`, a promise that settles when the run has ended). Throws a StudioError, before any
 * call or count, when the key is missing, the provider is paused or `maxCallsPerDay` is used up.
 * `files` = `{ runs, pause(provider), calls(provider), log(project) }`; `runPrepare(project, job)` → `{ done, kill(reason) }`.
 */
export function startApiRun(d, providers, { backend, plan, prompt, project, by, runPrepare, fetch = globalThis.fetch, env = process.env, files, onEnd = () => {} }) {
  const g = d.api;
  const id = backend.provider;
  const provider = providers.providers?.[id];
  const adapter = ADAPTERS[provider?.kind];
  if (!adapter) throw new StudioError(`${id} has no adapter. Pick another Director in the panel.`, 503);
  const label = provider.label || id;
  if (provider.baseUrl && !isHttps(provider.baseUrl)) throw new StudioError(`${label} baseUrl must be an https:// URL. Fix providers.${id}.baseUrl in config/providers.json.`, 503);
  const key = env[provider.keyEnv];
  if (!key) throw new StudioError(`${provider.keyEnv} is not set. Set it in .env or the environment and restart npm run ui.`, 503);
  const pause = readPause(files.pause(id));
  if (pause) throw new StudioError(`${label} rate or spend limit reached. Director runs on it are paused until ${until(pause.until)}.`, 429);
  const callsFile = files.calls(id);
  const assertCalls = () => {
    if (usage(callsFile).day >= g.maxCallsPerDay) throw new StudioError(`${label} reached ${g.maxCallsPerDay} calls today (director.api.maxCallsPerDay). It resets at midnight.`, 429);
  };
  assertCalls();

  const jobs = plan.jobs.map((q) => q.id);
  const minutes = d.jobTimeoutMinutes * jobs.length;
  const who = `director-${id}`;
  const log = openLog(files.log(project), d.maxLogBytes);
  const say = (s) => log.write(flatLine(redact(s, key)));
  say(`${nowIso()} ${by} started: ${prompt} (limit ${minutes} min, on ${plan.label})`);
  for (const q of plan.jobs) say(`  ${q.id}: ${q.model}, ${q.why}`);
  if (plan.waiting) say(`  ${plan.waiting} more queued job(s) wait for the next run (another model, or over director.maxJobsPerRun).`);
  countRun(files.runs);

  const ac = new AbortController();
  const run = { project, jobs, prompt, model: plan.label, by, startedAt: nowIso(), status: 'running', backend: 'api', provider: id, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  let killPrepare = null;
  run.stop = (status, message) => {
    if (run.status !== 'running') return;
    run.status = status; run.message = message;
    ac.abort();
    killPrepare?.(`Director run ${status}: ${message}`);
  };
  const timer = setTimeout(() => run.stop('timeout', `Stopped after ${minutes} min, the limit for ${jobs.length} job(s)`), minutes * 60000);

  // Throws (a busy engine, 429) before anything starts; once it returns, the prepare runs.
  const prepare = (p, j) => {
    const handle = runPrepare(p, j);
    killPrepare = handle.kill;
    return { done: Promise.resolve(handle.done).finally(() => { killPrepare = null; }) };
  };
  let capHit = null;
  const onCall = () => {
    try { assertCalls(); } catch (err) { capHit = err.message; throw err; }
    countUse(callsFile);
    run.usage.calls++;
  };
  // A job the loop left before the storyboard goes to error with the reason, so the next click can take it again.
  const settle = (job, r) => {
    try {
      if (!UNFINISHED.includes(getStatus(project, job).status)) return;
      const why = (run.status !== 'running' ? `Director run ${run.status}: ${run.message}` : r.message || REASONS[r.outcome] || r.outcome).replace(/\.$/, '');
      fail(project, job, `The director stopped before the storyboard: ${why}. Click Run Director again.`, who);
    } catch (err) { say(`Could not reset ${job}: ${err.message}`); }
  };

  async function body() {
    const hosts = plan.brand.sources?.allowedHosts || [];
    const runEnd = Date.now() + minutes * 60000;
    for (const q of plan.jobs) {
      if (run.status !== 'running') break;
      let r;
      try {
        const tools = toolsFor({ project, job: q.id, by: who, hosts, g, runPrepare: prepare, fetch, vision: backend.vision, signal: ac.signal });
        // Per job: a quick brief's context gets the outline rules, any other the full-script rules.
        const { system, context } = jobPrompt(project, q.id, { provider, d, vision: backend.vision });
        r = await runJob({
          adapter, provider, model: q.model, key, tools, system, context, g, job: q.id,
          deadline: Math.min(Date.now() + d.jobTimeoutMinutes * 60000, runEnd), log: say, signal: ac.signal, onCall, fetch,
        });
      } catch (err) {
        r = { outcome: 'error', usage: { input: 0, output: 0 }, message: err.message };
        say(`[${q.id}] error: ${err.message}`);
      }
      run.usage.inputTokens += r.usage.input;
      run.usage.outputTokens += r.usage.output;
      if (r.pauseMinutes) {
        const p = { until: new Date(Date.now() + r.pauseMinutes * 60000).toISOString(), reason: r.message, at: nowIso(), project, provider: id };
        writeJson(files.pause(id), p);
        run.stop('paused', `${label} rate or spend limit reached. Paused until ${until(p.until)}.`);
      } else if (capHit) run.stop('error', capHit);
      settle(q.id, r);
    }
    if (run.status === 'running') { run.status = 'done'; run.message = 'Finished'; }
  }

  run.done = Promise.resolve().then(body).catch((err) => {
    if (run.status === 'running') { run.status = 'error'; run.message = 'The API worker stopped on an error'; }
    say(`The API worker stopped: ${err?.message || err}`);
  }).finally(async () => {
    clearTimeout(timer);
    run.endedAt = nowIso();
    const u = run.usage;
    say(`  ${num(u.calls)} call(s), ${num(u.inputTokens)} in / ${num(u.outputTokens)} out tokens`);
    await log.end(flatLine(redact(`${run.endedAt} ${run.status}: ${run.message}`, key)));
    onEnd(run);
  }).catch(() => {});
  return run;
}
