// The Assistant's intent picker (server/assistant-model.mjs): one capped request through the API worker's adapters
// with the person's own key, one tool call typed and checked, a pause on 429, a daily cap, no retry. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson } from '../engine/core.mjs';
import { createIntentPicker, pickedFrom, pickRequest, modelConfig, modelLabel, parseRef, filesIn, INTENTS, PICK_TOOL } from '../server/assistant-model.mjs';

globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const KEY = 'AIzaFAKE-assistant-key-0123456789';
const AKEY = 'sk-ant-FAKE-assistant-0123456789';
const ENV = { GEMINI_API_KEY: KEY, ANTHROPIC_API_KEY: AKEY };
const PROVIDERS = () => ({ providers: {
  gemini: { kind: 'openai-compatible', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  claude: { kind: 'anthropic', label: 'Claude API', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY' },
  openai: { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  seat: { kind: 'claude-code', label: 'Claude Code (seat)' },
} });
const G = 'gemini:gemini-3.5-flash-lite';
const C = 'claude:claude-haiku-5-5';
const CFG = { freeform: true, models: [G, C, 'openai:gpt-5.1'], maxAsksPerDay: 3, requestTimeoutSeconds: 5, maxResponseBytes: 100000, maxContextChars: 500, maxReplyChars: 60, pauseMinutes: 15, maxLogBytes: 2000 };

const openaiAnswer = (args) => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'pick_intent', arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: {} });
const reply = (json, status = 200) => ({ status, ok: status < 300, statusText: 'x', headers: new Map(), body: (async function* () { yield Buffer.from(JSON.stringify(json)); })() });
function fakeFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); const a = answers.shift(); return typeof a === 'function' ? a() : a; };
  fn.calls = calls;
  return fn;
}
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-assistant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return filesIn(dir);
}
const ask = (model = G) => ({ text: 'make it feel like a film', model, context: 'Templates: explainer\nBrand fields: motion: standard|cinematic' });

test('refs, labels, config and the request through each adapter', () => {
  assert.deepEqual(parseRef('openai:gpt-5.1'), { provider: 'openai', model: 'gpt-5.1' });
  assert.deepEqual(parseRef('gemini-3.5-flash'), { provider: 'gemini', model: 'gemini-3.5-flash' }, 'a bare id is a Gemini model');
  assert.throws(() => parseRef('../x:y'), /not a model/);
  assert.equal(modelLabel('gemini-3.5-flash-lite'), 'Gemini 3.5 Flash Lite');
  assert.equal(modelLabel('gpt-5.1'), 'gpt-5.1');
  assert.equal(modelConfig({}).freeform, false);
  assert.deepEqual(modelConfig({ models: ['gemini-3.5-flash'] }).models, ['gemini:gemini-3.5-flash']);
  assert.throws(() => modelConfig({ maxAsksPerDay: 0 }), /positive/);

  const g = pickRequest({ provider: PROVIDERS().providers.gemini, model: 'gemini-3.5-flash-lite', text: 'hi', context: 'ctx' }, KEY);
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(g.init.headers.authorization, `Bearer ${KEY}`);
  const gb = JSON.parse(g.init.body);
  assert.equal(gb.tools[0].function.name, PICK_TOOL.name);
  assert.deepEqual(gb.tools[0].function.parameters.properties.intent.enum, INTENTS);
  assert.match(gb.messages.at(-1).content, /Message:\nhi$/);
  assert.ok(!g.url.includes(KEY) && !g.init.body.includes(KEY), 'the key is a header only');

  const c = pickRequest({ provider: PROVIDERS().providers.claude, model: 'claude-haiku-5-5', text: 'hi', context: 'ctx' }, AKEY);
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.init.headers['x-api-key'], AKEY);
  assert.equal(JSON.parse(c.init.body).tools[0].name, PICK_TOOL.name);
  assert.throws(() => pickRequest({ provider: PROVIDERS().providers.seat, model: 'x', text: 'hi', context: '' }, 'k'), /cannot answer/, 'never the seat');
});

test('the tool call is typed and capped; a JSON text answer works; junk is unknown', () => {
  const call = (args) => ({ calls: [{ id: '1', name: 'pick_intent', args }], text: '' });
  assert.deepEqual(pickedFrom(call({ intent: 'brand', args: { field: 'motion', value: ' cinematic ' }, reply: 'ok' }), 60), { intent: 'brand', args: { field: 'motion', value: 'cinematic' }, reply: 'ok' });
  assert.deepEqual(pickedFrom(call({ intent: 'clip', args: { asset: 'talk.mp4', from: 4, to: '12' } }), 60).args, { asset: 'talk.mp4', from: 4, to: null, name: null });
  assert.deepEqual(pickedFrom(call({ intent: 'sequence', args: { parts: ['A-16x9', 7, 'b-16x9'], title: 'Launch' } }), 60).args, { parts: ['a-16x9', 'b-16x9'], title: 'Launch' });
  assert.equal(pickedFrom(call({ intent: 'brief', args: { template: 'Explainer', message: 'x'.repeat(900) } }), 60).args.message.length, 800);
  assert.equal(pickedFrom(call({ intent: 'render' }), 60).intent, 'unknown');
  assert.equal(pickedFrom({ calls: [], text: '```json\n{"intent":"status","args":{}}\n```' }, 60).intent, 'status');
  const plain = pickedFrom({ calls: [], text: 'I can only queue briefs.' }, 60);
  assert.deepEqual([plain.intent, plain.reply], ['unknown', 'I can only queue briefs.']);
  assert.equal(pickedFrom(call({ intent: 'unknown', reply: 'y'.repeat(100) }), 60).reply.length, 60);
  assert.equal(pickedFrom(null, 60).intent, 'unknown');
});

test('one request with the key in a header, counted, logged without the key', async (t) => {
  const files = tmp(t);
  const fetch = fakeFetch(reply(openaiAnswer({ intent: 'brand', args: { field: 'motion', value: 'cinematic' } })));
  const p = createIntentPicker(() => CFG, { providers: PROVIDERS, env: ENV, fetch, files });
  assert.deepEqual(p.models().map((m) => [m.id, m.providerLabel, m.label, m.hasKey]), [
    [G, 'Gemini', 'Gemini 3.5 Flash Lite', true], [C, 'Claude API', 'Claude Haiku 5 5', true], ['openai:gpt-5.1', 'OpenAI', 'gpt-5.1', false],
  ]);
  const r = await p.pick(ask());
  assert.deepEqual(r, { intent: 'brand', args: { field: 'motion', value: 'cinematic' }, reply: null, model: G });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.redirect, 'error');
  assert.equal(p.state().usedToday, 1);
  const log = fs.readFileSync(path.join(files.dir, 'asks.log'), 'utf8');
  assert.match(log, /gemini:gemini-3.5-flash-lite brand "make it feel like a film"/);
  assert.ok(!log.includes(KEY));
});

test('an Anthropic model answers through its own adapter', async (t) => {
  const files = tmp(t);
  const fetch = fakeFetch(reply({ content: [{ type: 'tool_use', id: 'tu1', name: 'pick_intent', input: { intent: 'status', args: {} } }], stop_reason: 'tool_use', usage: {} }));
  const p = createIntentPicker(CFG, { providers: PROVIDERS, env: ENV, fetch, files });
  assert.equal((await p.pick(ask(C))).intent, 'status');
  assert.equal(fetch.calls[0].init.headers['x-api-key'], AKEY);
});

test('no key, a model not in the list, freeform off, the daily cap and a 429 pause each refuse; nothing is retried', async (t) => {
  const files = tmp(t);
  const off = createIntentPicker({ ...CFG, freeform: false }, { providers: PROVIDERS, env: ENV, fetch: fakeFetch(), files });
  assert.deepEqual(off.models(), []);
  await assert.rejects(() => off.pick(ask()), (e) => e.code === 400 && /Freeform/.test(e.message));
  const p0 = createIntentPicker(CFG, { providers: PROVIDERS, env: ENV, fetch: fakeFetch(), files });
  await assert.rejects(() => p0.pick(ask('openai:gpt-5.1')), (e) => e.code === 503 && /OPENAI_API_KEY/.test(e.message));
  await assert.rejects(() => p0.pick(ask('gemini:other')), (e) => e.code === 400 && /Pick a model/.test(e.message));
  const fetch = fakeFetch(reply(openaiAnswer({ intent: 'help' })), reply(openaiAnswer({ intent: 'help' })), reply({ error: { message: `quota ${KEY}` } }, 429));
  const p = createIntentPicker(CFG, { providers: PROVIDERS, env: ENV, fetch, files });
  await p.pick(ask()); await p.pick(ask());
  await assert.rejects(() => p.pick(ask()), (e) => e.code === 429 && !e.message.includes(KEY));
  const pause = readJson(files.pause('gemini'));
  assert.ok(Date.parse(pause.until) > Date.now());
  assert.ok(!pause.reason.includes(KEY), 'the pause reason is redacted');
  await assert.rejects(() => p.pick(ask()), (e) => e.code === 429 && /paused until/.test(e.message));
  assert.equal(fetch.calls.length, 3, 'nothing is retried');
  fs.rmSync(files.pause('gemini'));
  await assert.rejects(() => p.pick(ask()), (e) => e.code === 429 && /Daily assistant limit/.test(e.message));
});

test('a refused key is a 502 without the key, and only one request runs at a time', async (t) => {
  const files = tmp(t);
  let release;
  const fetch = fakeFetch(() => new Promise((r) => { release = () => r(reply(openaiAnswer({ intent: 'help' }))); }), reply({ error: { message: `bad ${KEY}` } }, 401));
  const p = createIntentPicker(CFG, { providers: PROVIDERS, env: ENV, fetch, files });
  const first = p.pick(ask());
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(() => p.pick(ask()), (e) => e.code === 409);
  release();
  assert.equal((await first).intent, 'help');
  await assert.rejects(() => p.pick(ask()), (e) => e.code === 502 && /refused the key/.test(e.message) && !e.message.includes(KEY));
});
