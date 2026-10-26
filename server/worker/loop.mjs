// The API worker's loop for one job: one provider call per turn, the answer's tool calls run in order,
// every cap checked before the next call. Never retries; a provider error ends the job and goes back to the run.
import { StudioError } from '../../engine/core.mjs';
import { fetchJson, redact, flatLine } from '../http.mjs';
import { providerError } from './adapters/shared.mjs';

const NUDGE = 'Call done when the job is in awaiting_review, or fail with a reason.';
const LENGTH_NUDGE = 'Your answer was cut at the output token limit (maxOutputTokens). Answer with one tool call and keep it shorter.';
const CUT_NOTE = ' The answer was cut at the output token limit (maxOutputTokens); send a shorter one.';
const MAX_PROSE = 400;
const MAX_ERROR = 300;
const MAX_ARG = 200;

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
// A tool's error answer is `{ error }` alone; a job file that happens to hold an `error` field is not one.
const isError = (r) => Boolean(r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length === 1 && typeof r.error === 'string');

/** The default `send`: one capped request, the provider's error answer (a 429 carries `pauseMinutes`) thrown. */
async function callProvider(fetch, { url, init }, { provider, model, key, g, signal }) {
  const { res, json, text } = await fetchJson(fetch, {
    url, init, who: provider.label || provider.kind, signal, keys: key,
    timeoutMs: g.requestTimeoutSeconds * 1000, timeoutLabel: 'requestTimeoutSeconds', maxBytes: g.maxResponseBytes, label: 'maxResponseBytes',
  });
  const err = providerError(res, json, provider, { text, model, keys: key, pauseMinutes: g.pauseMinutes });
  if (err) throw err;
  return json;
}

// The run's signal plus the job deadline, for the provider call.
function callSignal(signal, deadline) {
  const list = [signal, Number.isFinite(deadline) && AbortSignal.timeout(Math.max(1, deadline - Date.now()))].filter(Boolean);
  return list.length > 1 ? AbortSignal.any(list) : list[0];
}

// Over `room` characters the wire text is cut with a note naming the cap; `size` is what it adds to the turn.
function capped(content, room) {
  const s = typeof content === 'string' ? content : JSON.stringify(content) ?? 'null';
  return s.length > room ? { content: `${s.slice(0, room)}\n[cut at ${room} characters (maxToolResultChars)]`, size: room } : { content, size: s.length };
}

/**
 * One call answered: `{ message, result, failed, size }`. A StudioError is a tool error; any other throw ends the job.
 * `room` is what is left of this answer's `maxToolResultChars`; with none left the call is not run.
 */
async function runCall(adapter, byName, call, g, cutOff, room) {
  const tool = byName.get(call.name);
  let result;
  if (room <= 0) result = { error: `Not run: this answer's tool results already reached ${g.maxToolResultChars} characters (maxToolResultChars per answer). Call it again on its own.` };
  else if (call.error) result = { error: call.error + (cutOff ? CUT_NOTE : '') };
  else if (!tool) result = { error: `Unknown tool ${cut(call.name, 60)}. Use one of ${[...byName.keys()].join(', ')}.` };
  else {
    try { result = await tool.run(call.args); } catch (err) {
      if (!(err instanceof StudioError)) throw new Error(`${call.name} failed: ${err?.message}`, { cause: err });
      result = { error: err.message };
    }
  }
  const image = Buffer.isBuffer(result?.image?.buf) ? adapter.imagePart(result.image.buf, result.image.mime) : undefined;
  // The fixed not-run note is never cut and uses no room.
  const left = room > 0;
  const { content, size } = left ? capped(image ? { ...result, image: undefined } : result, room) : { content: result, size: 0 };
  const failed = isError(result);
  return { message: adapter.toolResultMessage(call.id, content, { isError: failed, image }), result, failed, size };
}

// What one call did, for the log: names, sizes and statuses only, never a body or page text.
function toolLine(name, args, result, failed) {
  if (failed) return `! ${cut(name, 60)}: ${cut(result.error, MAX_ERROR)}`;
  switch (name) {
    case 'fetch_page': return `> fetch_page ${cut(args.url, MAX_ARG)}${result.truncated ? ' (cut at maxPageChars)' : ''}`;
    case 'write_draft': return `> write_draft ${args.kind} (${num(result.bytes)} bytes)`;
    case 'commit': return `> commit ${args.kind}: ${result.status}${result.kept?.length ? `, kept ${plural(result.kept.length, 'locked field')}` : ''}`;
    case 'prepare': return `> prepare: ${result.status}${result.lint ? `, ${plural(result.lint.errors, 'error')}, ${plural(result.lint.warnings, 'warning')}` : ''}${result.message ? `: ${cut(result.message, MAX_ERROR)}` : ''}`;
    case 'read_job_file': return `> read_job_file ${args.name}`;
    case 'read_image': return `> read_image ${args.kind} ${args.name}`;
    case 'fail': return `> fail: ${cut(args.reason, MAX_ERROR)}`;
    default: return `> ${name}${result?.status ? `: ${result.status}` : ''}`;
  }
}

/**
 * One job through the provider. `g` is `director.api`; `deadline` a `Date.now()` value; `job` labels the log lines;
 * `log(line)` gets each line flattened and redacted; `onCall(turn)` runs before each request (count it, or throw to stop);
 * `send(req, signal)` → the 2xx JSON body (default: `fetchJson` with `fetch`, `providerError` thrown).
 * Returns `{ outcome, turns, usage: { input, output }, summary, message?, pauseMinutes? }`, `outcome` one of
 * `done`, `failed`, `turns`, `tokens`, `time`, `cancelled`, `error`. Never throws.
 */
export async function runJob({
  adapter, provider, model, key, tools, system, context, g, deadline = Infinity, job, log = () => {}, signal, onCall,
  fetch = globalThis.fetch, send = (req, s) => callProvider(fetch, req, { provider, model, key, g, signal: s }),
}) {
  const clean = (text, n) => cut(flatLine(redact(text, key)), n);
  const say = (text) => log(flatLine(redact(`[${job}] ${text}`, key)));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages = [{ role: 'user', text: context }];
  const usage = { input: 0, output: 0 };
  let turns = 0, nudged = false;

  const end = (outcome, { summary = '', message = '', pauseMinutes } = {}) => {
    const msg = clean(message, MAX_ERROR);
    say(`${outcome} in ${plural(turns, 'turn')}, ${num(usage.input)} in / ${num(usage.output)} out tokens${msg ? `: ${msg}` : ''}`);
    return { outcome, turns, usage, summary: clean(summary, MAX_PROSE), ...(msg ? { message: msg } : {}), ...(pauseMinutes ? { pauseMinutes } : {}) };
  };
  const stopped = () => {
    if (signal?.aborted) return ['cancelled', 'The run was stopped'];
    if (Date.now() >= deadline) return ['time', 'Ran out of time for this job (jobTimeoutMinutes)'];
    return null;
  };
  const limit = () => stopped()
    || (turns >= g.maxTurnsPerJob && ['turns', `Reached ${g.maxTurnsPerJob} turns (maxTurnsPerJob)`])
    || (usage.input + usage.output >= g.maxTokensPerJob && ['tokens', `Used ${num(usage.input + usage.output)} tokens, at the ${num(g.maxTokensPerJob)}-token limit (maxTokensPerJob)`])
    || null;

  try {
    for (;;) {
      const over = limit();
      if (over) return end(over[0], { message: over[1] });
      turns++;
      await onCall?.(turns);
      const req = adapter.request({ provider, model, key, system, messages, tools, maxOutputTokens: g.maxOutputTokens });
      const json = await send(req, callSignal(signal, deadline));
      const parsed = adapter.parse(json, { turn: turns });
      usage.input += parsed.usage?.input || 0;
      usage.output += parsed.usage?.output || 0;
      messages.push(adapter.assistantMessage(parsed, json));
      if (parsed.text) say(`turn ${turns}: ${cut(parsed.text, MAX_PROSE)}`);
      // Some endpoints answer `stop` with tool calls present: the calls decide.
      if (!parsed.calls?.length) {
        if (nudged) return end('failed', { message: 'The model answered twice without a tool call' });
        nudged = true;
        messages.push({ role: 'user', text: parsed.stop === 'length' ? LENGTH_NUDGE : NUDGE });
        continue;
      }
      // One answer adds at most maxToolResultChars of tool results, however many calls it makes.
      let room = g.maxToolResultChars;
      for (const call of parsed.calls) {
        const { message, result, failed, size } = await runCall(adapter, byName, call, g, parsed.stop === 'length', room);
        room -= size;
        messages.push(message);
        say(`turn ${turns} ${toolLine(call.name, call.args, result, failed)}`);
        if (!failed && call.name === 'done') return end('done', { summary: call.args.summary });
        if (!failed && call.name === 'fail') return end('failed', { summary: call.args.reason, message: result.reason });
        if (stopped()) break;
      }
    }
  } catch (err) {
    const over = stopped();
    if (over) return end(over[0], { message: over[1] });
    return end('error', { message: err?.message || String(err), pauseMinutes: err?.pauseMinutes });
  }
}
