import test from 'node:test';
import assert from 'node:assert/strict';
import * as openai from '../server/worker/adapters/openai-chat.mjs';
import * as anthropic from '../server/worker/adapters/anthropic.mjs';
import { providerError } from '../server/worker/adapters/shared.mjs';

// The adapters are pure: any network call is a bug.
globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const KEY = 'SENTINEL-KEY-123';
const OPENAI = { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/', keyEnv: 'OPENAI_API_KEY' };
const COMPAT = { kind: 'openai-compatible', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' };
const CLAUDE = { kind: 'anthropic', label: 'Claude API', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY' };
const TOOLS = [{ name: 'write_draft', description: 'Write a draft', schema: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'], additionalProperties: false } }];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const args = (provider, messages = [{ role: 'user', text: 'Job acme/promo. Context: {}' }]) =>
  ({ provider, model: 'model-a', key: KEY, system: 'You are the director.', messages, tools: TOOLS, maxOutputTokens: 8192 });
const body = (req) => JSON.parse(req.init.body);
const keyFree = (req) => !req.url.includes(KEY) && !req.init.body.includes(KEY);

const openaiAnswer = (message, finish = 'tool_calls') =>
  ({ choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: finish }], usage: { prompt_tokens: 1200, completion_tokens: 34 } });
const callOf = (id, name, argText) => ({ ...(id ? { id } : {}), type: 'function', function: { name, arguments: argText } });

/* ---------- openai-chat ---------- */
test('openai request posts to <baseUrl>/chat/completions with the key in Authorization only', () => {
  const req = openai.request(args(OPENAI));
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(keyFree(req));
  const b = body(req);
  assert.equal(b.tool_choice, 'auto');
  assert.equal(b.parallel_tool_calls, false);
  assert.equal(b.stream, false);
  assert.equal(b.max_completion_tokens, 8192);
  assert.equal(b.max_tokens, undefined);
  assert.deepEqual(b.tools[0], { type: 'function', function: { name: 'write_draft', description: 'Write a draft', parameters: TOOLS[0].schema } });
  assert.deepEqual(b.messages.slice(0, 2), [{ role: 'system', content: 'You are the director.' }, { role: 'user', content: 'Job acme/promo. Context: {}' }]);
});

test('an openai-compatible request uses max_tokens', () => {
  const b = body(openai.request(args(COMPAT)));
  assert.equal(b.max_tokens, 8192);
  assert.equal(b.max_completion_tokens, undefined);
});

test('openai parse reads the tool call arguments, usage and stop', () => {
  const p = openai.parse(openaiAnswer({ tool_calls: [callOf('call_x', 'write_draft', '{"kind":"source"}')] }));
  assert.equal(p.calls[0].id, 'call_x');
  assert.equal(p.calls[0].name, 'write_draft');
  assert.equal(p.calls[0].args.kind, 'source');
  assert.deepEqual(p.usage, { input: 1200, output: 34 });
  assert.equal(p.stop, 'tool_use');
  assert.equal(p.text, '');
});

test('a call without an id gets a generated one, written into the stored assistant message', () => {
  const raw = openaiAnswer({ tool_calls: [callOf(null, 'claim', '')] });
  const p = openai.parse(raw, { turn: 3 });
  assert.equal(p.calls[0].id, 'call_3_1');
  assert.deepEqual(p.calls[0].args, {});
  const next = body(openai.request(args(COMPAT, [{ role: 'user', text: 'go' }, openai.assistantMessage(p, raw), openai.toolResultMessage('call_3_1', { status: 'scripting' })])));
  assert.equal(next.messages[2].tool_calls[0].id, 'call_3_1');
  assert.deepEqual(next.messages[3], { role: 'tool', tool_call_id: 'call_3_1', content: '{"status":"scripting"}' });
});

test('arguments that are not a JSON object make that call carry an error', () => {
  const p = openai.parse(openaiAnswer({ tool_calls: [callOf('a', 'write_draft', '{bad'), callOf('b', 'write_draft', '[1]')] }));
  assert.equal(p.calls[0].args, null);
  assert.match(p.calls[0].error, /write_draft are not a JSON object/);
  assert.match(p.calls[1].error, /not a JSON object/);
});

test('finish_reason length is stop length, and text comes back', () => {
  const p = openai.parse(openaiAnswer({ content: 'Half an ans' }, 'length'));
  assert.equal(p.stop, 'length');
  assert.equal(p.text, 'Half an ans');
  assert.deepEqual(p.calls, []);
});

test('an openai answer without a message is a 502', () => {
  assert.throws(() => openai.parse({ choices: [] }), (e) => e.code === 502);
});

test('the assistant message is echoed verbatim, reasoning_content included', () => {
  const raw = openaiAnswer({ content: '', reasoning_content: 'thinking…', tool_calls: [callOf('c1', 'claim', '{}')] });
  const stored = openai.assistantMessage(openai.parse(raw), raw);
  const sent = body(openai.request(args(COMPAT, [{ role: 'user', text: 'go' }, stored]))).messages[2];
  assert.deepEqual(sent, raw.choices[0].message);
});

test('an openai tool image follows the run of tool messages as one user message', () => {
  const image = openai.imagePart(PNG, 'image/png');
  assert.equal(image.image_url.url, `data:image/png;base64,${PNG.toString('base64')}`);
  const raw = openaiAnswer({ tool_calls: [callOf('c1', 'read_image', '{}'), callOf('c2', 'read_image', '{}')] });
  const msgs = body(openai.request(args(OPENAI, [{ role: 'user', text: 'go' }, openai.assistantMessage(openai.parse(raw), raw),
    openai.toolResultMessage('c1', { width: 1, height: 1 }, { image }), openai.toolResultMessage('c2', { error: 'No such still' }, { isError: true })]))).messages;
  assert.deepEqual(msgs.slice(3).map((m) => m.role), ['tool', 'tool', 'user']);
  assert.deepEqual(msgs[5].content[1], image);
});

/* ---------- anthropic ---------- */
const claudeAnswer = (content, stop = 'tool_use') =>
  ({ id: 'msg_1', type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 40 } });
const THINKING = { type: 'thinking', thinking: 'Claim first.', signature: 'sig-abc==' };
const USE = { type: 'tool_use', id: 'toolu_1', name: 'write_draft', input: { kind: 'source' } };

test('anthropic request has the key header, version, cached system, input_schema and auto tool choice', () => {
  const req = anthropic.request(args(CLAUDE));
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.init.headers['x-api-key'], KEY);
  assert.equal(req.init.headers['anthropic-version'], '2023-06-01');
  assert.ok(keyFree(req));
  const b = body(req);
  assert.deepEqual(b.system[0], { type: 'text', text: 'You are the director.', cache_control: { type: 'ephemeral' } });
  assert.deepEqual(b.tools[0].input_schema, TOOLS[0].schema);
  assert.equal(b.tool_choice.type, 'auto');
  assert.equal(b.max_tokens, 8192);
  assert.deepEqual(b.messages, [{ role: 'user', content: 'Job acme/promo. Context: {}' }]);
});

test('anthropic asks for one tool call per answer (disable_parallel_tool_use)', () => {
  assert.deepEqual(body(anthropic.request(args(CLAUDE))).tool_choice, { type: 'auto', disable_parallel_tool_use: true });
});

test('anthropic parse reads tool_use, usage with cached tokens, and stop', () => {
  const p = anthropic.parse(claudeAnswer([THINKING, { type: 'text', text: 'Writing.' }, USE]));
  assert.deepEqual(p.calls, [{ id: 'toolu_1', name: 'write_draft', args: { kind: 'source' } }]);
  assert.equal(p.text, 'Writing.');
  assert.deepEqual(p.usage, { input: 1000, output: 40 });
  assert.equal(p.stop, 'tool_use');
  assert.equal(anthropic.parse(claudeAnswer([], 'max_tokens')).stop, 'length');
  assert.throws(() => anthropic.parse({ type: 'message' }), (e) => e.code === 502);
});

test('a thinking block then a tool_use block round-trip byte-equal into the next request', () => {
  const raw = claudeAnswer([THINKING, USE]);
  const stored = anthropic.assistantMessage(anthropic.parse(raw), raw);
  const b = body(anthropic.request(args(CLAUDE, [{ role: 'user', text: 'go' }, stored, anthropic.toolResultMessage('toolu_1', { bytes: 120 })])));
  assert.equal(JSON.stringify(b.messages[1]), JSON.stringify({ role: 'assistant', content: [THINKING, USE] }));
  assert.deepEqual(b.messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"bytes":120}' }] });
});

test('tool results of one turn and a following nudge share one user message; errors carry is_error', () => {
  const raw = claudeAnswer([USE, { ...USE, id: 'toolu_2' }]);
  const image = anthropic.imagePart(PNG, 'image/png');
  const b = body(anthropic.request(args(CLAUDE, [{ role: 'user', text: 'go' }, anthropic.assistantMessage(null, raw),
    anthropic.toolResultMessage('toolu_1', { width: 2, height: 2 }, { image }), anthropic.toolResultMessage('toolu_2', { error: 'Unknown tool x' }, { isError: true }),
    { role: 'user', text: 'Call done when the job is in awaiting_review.' }])));
  assert.equal(b.messages.length, 3);
  const [first, second, nudge] = b.messages[2].content;
  assert.equal(first.content[1].source.type, 'base64');
  assert.deepEqual(first.content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });
  assert.equal(first.is_error, undefined);
  assert.equal(second.is_error, true);
  assert.deepEqual(nudge, { type: 'text', text: 'Call done when the job is in awaiting_review.' });
});

test('an empty assistant answer is left out so the history stays valid', () => {
  const raw = claudeAnswer([], 'end_turn');
  const b = body(anthropic.request(args(CLAUDE, [{ role: 'user', text: 'go' }, anthropic.assistantMessage(null, raw), { role: 'user', text: 'Call done or fail.' }])));
  assert.equal(b.messages.length, 1);
  assert.deepEqual(b.messages[0].content.map((c) => c.text), ['go', 'Call done or fail.']);
});

test('neither adapter puts the key in the url or body, with every message kind present', () => {
  for (const [a, p] of [[openai, OPENAI], [openai, COMPAT], [anthropic, CLAUDE]]) {
    const raw = a === anthropic ? claudeAnswer([USE]) : openaiAnswer({ tool_calls: [callOf('toolu_1', 'write_draft', '{}')] });
    const req = a.request(args(p, [{ role: 'user', text: 'go' }, a.assistantMessage(a.parse(raw), raw),
      a.toolResultMessage('toolu_1', { ok: true }, { image: a.imagePart(PNG, 'image/png') })]));
    assert.ok(keyFree(req), p.label);
  }
});

/* ---------- providerError ---------- */
const res = (status, headers = {}) => new Response(null, { status, headers });
const err = (status, json, opts = {}, headers) => providerError(res(status, headers), json, OPENAI, { model: 'gpt-x', keys: KEY, pauseMinutes: 15, ...opts });

test('a usable 2xx answer is no error; a 2xx that is not JSON is a 502', () => {
  assert.equal(err(200, { choices: [] }), null);
  assert.match(err(200, null).message, /OpenAI answered something that is not JSON/);
});

test('a 429 pauses for retry-after up to an hour, else pauseMinutes; Anthropic rate_limit_error too', () => {
  const short = err(429, { error: { message: 'Rate limit' } }, {}, { 'retry-after': '90' });
  assert.equal(short.code, 429);
  assert.equal(short.pauseMinutes, 2);
  assert.match(short.message, /OpenAI rate or spend limit reached: Rate limit\. Paused for 2 min/);
  assert.equal(err(429, null, {}, { 'retry-after': '86400' }).pauseMinutes, 15);
  assert.equal(err(429, null).pauseMinutes, 15);
  assert.equal(err(400, { type: 'error', error: { type: 'rate_limit_error', message: 'spend cap' } }).code, 429);
});

test('401 and 403 name the key variable; a refused model names the id and the panel', () => {
  assert.match(err(401, { error: { message: 'Incorrect API key' } }).message, /OpenAI refused the key \(OPENAI_API_KEY\): Incorrect API key/);
  assert.match(err(403, null, { text: 'forbidden' }).message, /refused the key.*forbidden/);
  assert.match(err(404, { error: { message: 'nope' } }).message, /Model gpt-x was refused by OpenAI: nope\. Change the model in the Director panel/);
  assert.match(err(400, [{ error: { message: 'The model gpt-x is deprecated' } }]).message, /^Model gpt-x was refused/);
  assert.match(err(400, { error: { message: 'tool_call_id call_1 not found' } }).message, /^OpenAI answered 400: tool_call_id/);
});

test('413, 5xx and 529 map to their messages, every one redacted and cut at 300 chars', () => {
  assert.match(err(413, null).message, /The request is too large for OpenAI/);
  assert.match(err(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }).message, /OpenAI answered 529: Overloaded/);
  const long = err(500, { error: { message: `bad ${KEY} sk-${'a'.repeat(30)}\n${'x'.repeat(400)}` } });
  assert.equal(long.code, 502);
  assert.ok(!long.message.includes(KEY) && !long.message.includes('sk-aaaa') && !long.message.includes('\n'), long.message);
  assert.ok(long.message.length <= 'OpenAI answered 500: '.length + 300);
});
