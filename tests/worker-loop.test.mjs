import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, StudioError, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, getStatus, jobDir } from '../engine/jobs.mjs';
import { toolsFor } from '../server/worker/tools.mjs';
import { runJob } from '../server/worker/loop.mjs';
import * as openai from '../server/worker/adapters/openai-chat.mjs';
import { toolResultMessage } from '../server/worker/adapters/shared.mjs';

globalThis.fetch = () => { throw new Error('No network in tests'); };

const P = 'zz-test-worker-loop';
const ID = 'promo';
const HOST = 'shop.example.com';
const KEY = 'SENTINEL-KEY-123';
const API = loadStudioConfig().director.api;
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SOURCE = { name: 'Acme', bullets: [{ text: 'Ships in a day', ref: 'brief' }] };
const SCRIPT = { scenes: [
  { id: 'intro', kind: 'title', vo: 'How it works.', title: 'How it works' },
  { id: 's1', kind: 'step', vo: 'It ships in a day.', title: 'Ships fast', icon: 'chat', source: 'bullets[0]' },
] };
const PROVIDER = { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.example.test/v1', keyEnv: 'OPENAI_API_KEY' };

after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
createProject({ id: P, name: 'Worker loop' });
const brandFile = path.join(DIRS.profiles, P, 'brand.json');
writeJson(brandFile, { ...readJson(brandFile), sources: { allowedHosts: [HOST] } });
saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url: `https://${HOST}/p` }));
fs.mkdirSync(path.join(DIRS.profiles, P, 'assets'), { recursive: true });
fs.writeFileSync(path.join(DIRS.profiles, P, 'assets', 'real.png'), PNG_1X1);

const lines = [];
const fresh = () => fs.rmSync(jobDir(P, ID), { recursive: true, force: true });
// No DNS in tests: every name resolves to one public documentation address.
const ctx = (over = {}) => ({ project: P, job: ID, by: 'director-test', hosts: [HOST], g: API, vision: true, fetch: globalThis.fetch, runPrepare: async () => {}, lookup: async () => [{ address: '203.0.113.10', family: 4 }], ...over });
const call = (name, args = {}) => ({ name, args });
const nudges = (messages) => messages.filter((m) => m.role === 'user' && /^Call done when/.test(m.text)).length;
const toolMessages = (messages) => messages.filter((m) => m.role === 'tool');

/** A scripted adapter: each answer is already neutral (`{ text, calls, usage, stop }`), served by `send` in order. */
function scripted(answers) {
  const s = { sent: 0, messages: null, signals: [] };
  s.adapter = {
    request: ({ messages }) => { s.messages = messages; return { url: 'scripted' }; },
    parse: (json) => ({ text: '', usage: { input: 0, output: 0 }, stop: 'tool_use', ...json, calls: (json.calls || []).map((c, i) => ({ id: `c${i}`, ...c })) }),
    assistantMessage: (parsed) => ({ role: 'assistant', raw: parsed }),
    toolResultMessage,
    imagePart: (buf, mime) => ({ mime, bytes: buf.length }),
  };
  s.send = async (req, signal) => {
    s.signals.push(signal);
    if (s.sent >= answers.length) throw new Error('The script ran out');
    return answers[s.sent++];
  };
  return s;
}

const run = (s, { tools, ctx: c, ...over } = {}) => runJob({
  adapter: s.adapter, send: s.send, provider: PROVIDER, model: 'gpt-test', key: KEY,
  tools: tools || toolsFor(ctx(c)), system: 'system', context: 'context', g: API, job: ID,
  deadline: Date.now() + 60_000, log: (l) => lines.push(l), ...over,
});

test('a happy script ends done in awaiting_review with usage summed and the image handed to the adapter', async () => {
  fresh();
  const runPrepare = async (project, job) => {
    fs.mkdirSync(path.join(jobDir(project, job), 'stills'), { recursive: true });
    fs.writeFileSync(path.join(jobDir(project, job), 'stills', 's1.png'), PNG_1X1);
    setStatus(project, job, { status: 'awaiting_review', duration: 8, lint: { errors: 0, warnings: 2, findings: [] }, stills: [{ id: 's1', t: 1, file: 'stills/s1.png' }] }, 'stub prepare', 'test');
  };
  const steps = [call('claim'), call('write_draft', { kind: 'source', content: SOURCE }), call('commit', { kind: 'source' }),
    call('write_draft', { kind: 'script', content: SCRIPT }), call('commit', { kind: 'script' }), call('prepare'),
    call('read_image', { kind: 'still', name: 's1.png' }), call('done', { summary: 'An 8 s explainer.' })];
  const s = scripted(steps.map((c, i) => ({ calls: [c], usage: { input: 1000 + i, output: 10 + i } })));
  const from = lines.length;
  const r = await run(s, { ctx: { runPrepare } });
  assert.deepEqual([r.outcome, r.turns, r.summary, s.sent], ['done', 8, 'An 8 s explainer.', 8]);
  assert.deepEqual(r.usage, { input: 8028, output: 108 });
  assert.equal(getStatus(P, ID).status, 'awaiting_review');
  assert.ok(toolMessages(s.messages).every((m) => !m.isError), 'no step failed');
  const img = toolMessages(s.messages).at(-2);
  assert.deepEqual(img.image, { mime: 'image/png', bytes: PNG_1X1.length });
  assert.ok(!JSON.stringify(img.content).includes('buf'), 'the buffer is not stringified into the result');
  const log = lines.slice(from);
  assert.ok(log.includes(`[${ID}] turn 2 > write_draft source (${Buffer.byteLength(JSON.stringify(SOURCE, null, 2) + '\n')} bytes)`), log.join('\n'));
  assert.ok(log.includes(`[${ID}] turn 6 > prepare: awaiting_review, 0 errors, 2 warnings`));
  assert.equal(log.at(-1), `[${ID}] done in 8 turns, 8 028 in / 108 out tokens`);
});

test('done while the job is still scripting ends done; the run layer fails the job', async () => {
  fresh();
  const s = scripted([{ calls: [call('claim')] }, { calls: [call('done', { summary: 'early' })] }]);
  const r = await run(s);
  assert.equal(r.outcome, 'done');
  assert.equal(getStatus(P, ID).status, 'scripting');
});

test('41 answers stop as turns after exactly maxTurnsPerJob requests', async () => {
  fresh();
  const s = scripted(Array.from({ length: API.maxTurnsPerJob + 1 }, () => ({ calls: [call('read_job_file', { name: 'status.json' })] })));
  const r = await run(s);
  assert.deepEqual([r.outcome, r.turns, s.sent], ['turns', API.maxTurnsPerJob, API.maxTurnsPerJob]);
  assert.match(r.message, /maxTurnsPerJob/);
});

test('usage at maxTokensPerJob stops as tokens with no further request', async () => {
  fresh();
  const s = scripted([{ calls: [call('claim')], usage: { input: 900, output: 100 } }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { g: { ...API, maxTokensPerJob: 1000 } });
  assert.deepEqual([r.outcome, s.sent], ['tokens', 1]);
  assert.match(r.message, /maxTokensPerJob/);
});

test('a deadline of 10 ms with a slow tool stops as time', async () => {
  fresh();
  const slow = async () => new Promise((res) => setTimeout(res, 40));
  const s = scripted([{ calls: [call('prepare')] }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { ctx: { runPrepare: slow }, deadline: Date.now() + 10 });
  assert.deepEqual([r.outcome, s.sent], ['time', 1]);
  assert.match(r.message, /jobTimeoutMinutes/);
});

test('an aborted signal stops as cancelled: before the first request, and during one (the signal reaches send)', async () => {
  fresh();
  const pre = scripted([{ calls: [call('claim')] }]);
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual([(await run(pre, { signal: ac.signal })).outcome, pre.sent], ['cancelled', 0]);

  const mid = new AbortController();
  let seen;
  const r = await run(scripted([]), {
    signal: mid.signal,
    send: async (req, signal) => { mid.abort(); seen = signal.aborted; throw new StudioError('OpenAI did not answer', 504); },
  });
  assert.deepEqual([r.outcome, seen], ['cancelled', true]);
});

test('two text-only answers end as failed with exactly one nudge', async () => {
  fresh();
  const s = scripted([{ text: 'Thinking.', stop: 'end' }, { text: 'Still thinking.', stop: 'end' }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s);
  assert.deepEqual([r.outcome, s.sent, nudges(s.messages)], ['failed', 2, 1]);
  const cut = scripted([{ text: 'x', stop: 'length' }, { calls: [call('done', { summary: 'x' })] }]);
  assert.equal((await run(cut)).outcome, 'done');
  assert.match(cut.messages.find((m) => m.role === 'user' && m !== cut.messages[0]).text, /maxOutputTokens/);
});

test('an unknown tool and a StudioError from a tool are tool errors and the loop goes on', async () => {
  fresh();
  const odd = { name: 'odd', description: '', schema: {}, run: async () => { throw new StudioError('Not now', 409); } };
  const s = scripted([{ calls: [call('render')] }, { calls: [call('claim'), call('commit', { kind: 'source' })] }, { calls: [call('odd')] }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { tools: [...toolsFor(ctx()), odd] });
  assert.deepEqual([r.outcome, r.turns], ['done', 4]);
  const [unknown, claim, commit, oddResult] = toolMessages(s.messages);
  assert.deepEqual([unknown.isError, claim.isError, commit.isError, oddResult.isError], [true, false, true, true]);
  assert.match(unknown.content.error, /^Unknown tool render\. Use one of claim, /);
  assert.match(commit.content.error, /draft/i);
  assert.deepEqual(oddResult.content, { error: 'Not now' });
});

test('a thrown TypeError from a tool ends the job as error', async () => {
  fresh();
  const s = scripted([{ calls: [call('prepare')] }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { ctx: { runPrepare: async () => { throw new TypeError('boom'); } } });
  assert.deepEqual([r.outcome, s.sent, r.message], ['error', 1, 'prepare failed: boom']);
});

test('three calls in one answer run in order, each answered with its own id', async () => {
  fresh();
  const order = [];
  const tools = toolsFor(ctx()).map((t) => ({ ...t, run: (a) => { order.push(t.name); return t.run(a); } }));
  const s = scripted([{ calls: [call('claim'), call('read_job_file', { name: 'status.json' }), call('write_draft', { kind: 'source', content: SOURCE })] }, { calls: [call('done', { summary: 'x' })] }]);
  await run(s, { tools });
  assert.deepEqual(order, ['claim', 'read_job_file', 'write_draft', 'done']);
  assert.deepEqual(toolMessages(s.messages).map((m) => m.id), ['c0', 'c1', 'c2', 'c0'], 'the done of the next answer is its own c0');
});

test('the run signal on the tools ctx stops fetch_page, and the loop ends cancelled', async () => {
  fresh();
  const ac = new AbortController();
  let got;
  const fetch = async (url, init) => { got = init.signal; ac.abort(); throw new DOMException('aborted', 'AbortError'); };
  const s = scripted([{ calls: [call('fetch_page', { url: `https://${HOST}/p` })] }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { ctx: { fetch, signal: ac.signal }, signal: ac.signal });
  assert.deepEqual([r.outcome, s.sent, got.aborted], ['cancelled', 1, true]);
  assert.deepEqual(toolMessages(s.messages)[0].content, { error: 'The run was stopped' });
});

test('a tool result over maxToolResultChars is cut with a note naming the cap', async () => {
  fresh();
  const s = scripted([{ calls: [call('claim')] }, { calls: [call('read_job_file', { name: 'status.json' })] }, { calls: [call('done', { summary: 'x' })] }]);
  await run(s, { g: { ...API, maxToolResultChars: 50 } });
  const big = toolMessages(s.messages)[1].content;
  assert.equal(typeof big, 'string');
  assert.ok(big.startsWith('{"') && big.endsWith('[cut at 50 characters (maxToolResultChars)]'));
});

test('one answer shares maxToolResultChars: a later result is cut to what is left, then calls are not run', async () => {
  fresh();
  const order = [];
  const tools = toolsFor(ctx()).map((t) => ({ ...t, run: (a) => { order.push(t.name); return t.run(a); } }));
  const read = call('read_job_file', { name: 'status.json' });
  const s = scripted([{ calls: [call('claim'), read, read, call('claim')] }, { calls: [call('done', { summary: 'x' })] }]);
  const r = await run(s, { tools, g: { ...API, maxToolResultChars: 50 } });
  assert.equal(r.outcome, 'done');
  assert.deepEqual(order, ['claim', 'read_job_file', 'done'], 'the third and fourth calls never ran');
  const [claimed, cutRead, skipped, skipped2] = toolMessages(s.messages);
  const used = JSON.stringify(claimed.content).length;
  assert.ok(cutRead.content.endsWith(`[cut at ${50 - used} characters (maxToolResultChars)]`), cutRead.content);
  for (const m of [skipped, skipped2]) {
    assert.equal(m.isError, true);
    assert.match(m.content.error, /^Not run: this answer's tool results already reached 50 characters \(maxToolResultChars per answer\)/);
  }
});

test('the default send goes through fetchJson: OpenAI wire, the image in the next request, a 429 surfaces with pauseMinutes', async () => {
  fresh();
  const calls = [];
  const answers = [
    () => Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_image', arguments: '{"kind":"asset","name":"real.png"}' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    () => Response.json({ error: { message: `slow down ${KEY}` } }, { status: 429, headers: { 'retry-after': '120' } }),
  ];
  const fetch = async (url, init) => { calls.push({ url, init }); return answers[calls.length - 1](); };
  const r = await runJob({ adapter: openai, provider: PROVIDER, model: 'gpt-test', key: KEY, tools: toolsFor(ctx()), system: 'system', context: 'context', g: API, job: ID, deadline: Date.now() + 60_000, log: (l) => lines.push(l), fetch });
  assert.deepEqual([r.outcome, r.turns, r.pauseMinutes, r.usage], ['error', 2, 2, { input: 10, output: 5 }]);
  assert.match(r.message, /^OpenAI rate or spend limit reached: slow down \[key\]/);
  assert.equal(calls[0].url, 'https://api.example.test/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual([calls[0].init.redirect, calls[0].init.signal instanceof AbortSignal], ['error', true]);
  const second = JSON.parse(calls[1].init.body).messages;
  assert.equal(second.find((m) => m.role === 'tool').tool_call_id, 't1');
  assert.match(second.at(-1).content[1].image_url.url, /^data:image\/png;base64,/);
  assert.ok(!second.find((m) => m.role === 'tool').content.includes('buf'));
});

test('the sentinel key never reaches a log line or a result, and no line can be split', async () => {
  fresh();
  const s = scripted([
    { text: `My key is ${KEY}\n[promo] done in 1 turn`, calls: [call('fetch_page', { url: `https://${HOST}/?k=${KEY}` })] },
    { calls: [call(KEY)] },
    { calls: [call('prepare')] },
  ]);
  const r = await run(s, { ctx: { runPrepare: async () => { throw new TypeError(`bad ${KEY}`); } } });
  assert.equal(r.outcome, 'error');
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(lines.length > 20);
  for (const l of lines) {
    assert.ok(!l.includes(KEY), l);
    assert.ok(!/[\n\r]/.test(l), l);
  }
});
