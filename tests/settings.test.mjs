// The Settings tab's server side: key state without values, the one-line rewrite of a key file, the Assistant's
// model choices, and Connect (one capped model-list request per click). Temp files only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../engine/core.mjs';
import { allowedKeyNames, keyStates, rewriteEnv, saveKey, removeKey, saveAssistantSettings } from '../server/settings.mjs';
import { connectProvider, connectedModels, chatModels, filesIn } from '../server/worker/models.mjs';
import * as openaiChat from '../server/worker/adapters/openai-chat.mjs';
import * as anthropic from '../server/worker/adapters/anthropic.mjs';

globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const PROVIDERS = { providers: {
  seat: { kind: 'claude-code', label: 'Claude Code (seat)' },
  openai: { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  claude: { kind: 'anthropic', label: 'Claude API', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY' },
  gemini: { kind: 'openai-compatible', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
} };
const CFG = { voiceCloud: { keyEnv: 'ELEVENLABS_API_KEY' } };
const KEY = 'sk-FAKE-settings-0123456789';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the key names are the providers\' and the cloud voice\'s; a state never carries a value', () => {
  const names = allowedKeyNames(PROVIDERS, CFG);
  assert.deepEqual(names, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY']);
  const states = keyStates(names, { OPENAI_API_KEY: KEY, GEMINI_API_KEY: KEY }, new Set(['GEMINI_API_KEY']));
  assert.deepEqual(states.map((s) => [s.name, s.hasKey, s.source]), [
    ['OPENAI_API_KEY', true, 'environment'], ['ANTHROPIC_API_KEY', false, null], ['GEMINI_API_KEY', true, 'file'], ['ELEVENLABS_API_KEY', false, null],
  ]);
  assert.ok(!JSON.stringify(states).includes(KEY));
});

test('the rewrite touches one NAME= line and keeps every other line and the line ending', () => {
  const text = '# keys\r\nGEMINI_API_KEY=old\r\nOTHER=1\r\nexport GEMINI_API_KEY=dup\r\n';
  assert.equal(rewriteEnv(text, 'GEMINI_API_KEY', 'new'), '# keys\r\nGEMINI_API_KEY=new\r\nOTHER=1\r\n');
  assert.equal(rewriteEnv(text, 'GEMINI_API_KEY', null), '# keys\r\nOTHER=1\r\n');
  assert.equal(rewriteEnv('A=1\n', 'B', 'x'), 'A=1\nB=x\n');
  assert.equal(rewriteEnv('', 'B', 'x'), 'B=x\n');
  assert.equal(rewriteEnv('GEMINI_API_KEY_2=keep\n', 'GEMINI_API_KEY', null), 'GEMINI_API_KEY_2=keep\n', 'a longer name is another key');
});

test('a key is saved into the file and the environment, answered without its value, and removed again', (t) => {
  const file = path.join(tmpDir(t), 'keys.env');
  fs.writeFileSync(file, 'OTHER=1\n');
  const env = { };
  const fromFile = new Set();
  const ctx = { env, fromFile, allowed: allowedKeyNames(PROVIDERS, CFG) };
  const r = saveKey(file, 'OPENAI_API_KEY', `  ${KEY}  `, ctx);
  assert.deepEqual(r, { name: 'OPENAI_API_KEY', hasKey: true, source: 'file' });
  assert.equal(env.OPENAI_API_KEY, KEY);
  assert.equal(fs.readFileSync(file, 'utf8'), `OTHER=1\nOPENAI_API_KEY=${KEY}\n`);
  assert.deepEqual(removeKey(file, 'OPENAI_API_KEY', ctx), { name: 'OPENAI_API_KEY', hasKey: false, source: null });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), 'OTHER=1\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['keys.env'], 'no temp file is left');
});

test('a key is refused for an unknown name, a bad value or a name the environment sets', (t) => {
  const file = path.join(tmpDir(t), 'keys.env');
  const ctx = { env: { ANTHROPIC_API_KEY: 'from-env-123456' }, fromFile: new Set(), allowed: allowedKeyNames(PROVIDERS, CFG) };
  assert.throws(() => saveKey(file, 'PATH', KEY, ctx), (e) => e.code === 400 && /not a key this tool uses/.test(e.message));
  for (const bad of ['short', `${KEY}\nPATH=x`, 'has space in it', '"quoted-key-123"', 'x'.repeat(513)]) {
    assert.throws(() => saveKey(file, 'OPENAI_API_KEY', bad, ctx), (e) => e.code === 400 && !e.message.includes(bad), JSON.stringify(bad));
  }
  assert.throws(() => saveKey(file, 'ANTHROPIC_API_KEY', KEY, ctx), (e) => e.code === 409 && /environment/.test(e.message));
  assert.throws(() => removeKey(file, 'ANTHROPIC_API_KEY', ctx), (e) => e.code === 409);
  assert.ok(!fs.existsSync(file), 'nothing was written');
});

test('the Assistant takes only connected models, and a model already saved', (t) => {
  const file = path.join(tmpDir(t), 'studio.json');
  writeJson(file, { director: { model: 'auto' }, assistant: { approvalMinutes: 10, models: ['gemini:gemini-3.5-flash'] } });
  const choices = new Set(['openai:gpt-5.1', 'gemini:gemini-3.5-flash-lite']);
  const saved = saveAssistantSettings(file, { freeform: true, models: ['openai:gpt-5.1', 'gemini:gemini-3.5-flash', 'openai:gpt-5.1'], maxAsksPerDay: 50 }, choices);
  assert.deepEqual(saved, { approvalMinutes: 10, freeform: true, models: ['openai:gpt-5.1', 'gemini:gemini-3.5-flash'], maxAsksPerDay: 50 });
  assert.deepEqual(readJson(file).director, { model: 'auto' }, 'the rest of the file stays');
  assert.throws(() => saveAssistantSettings(file, { freeform: true, models: ['openai:gpt-9'] }, choices), (e) => e.code === 400 && /Connect the provider/.test(e.message));
  assert.throws(() => saveAssistantSettings(file, { freeform: true, models: [] }, choices), (e) => e.code === 400 && /at least one/.test(e.message));
  assert.throws(() => saveAssistantSettings(file, { freeform: 'yes', models: [] }, choices), (e) => e.code === 400);
  assert.throws(() => saveAssistantSettings(file, { freeform: false, models: [], maxAsksPerDay: 0 }, choices), (e) => e.code === 400);
});

/* ---------- Connect ---------- */
const reply = (json, status = 200) => ({ status, ok: status < 300, statusText: 'x', headers: new Map(), body: (async function* () { yield Buffer.from(JSON.stringify(json)); })() });
function fakeFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return answers.shift(); };
  fn.calls = calls;
  return fn;
}

test('each adapter lists models with its own header, and only chat models are kept', () => {
  const o = openaiChat.modelsRequest({ provider: PROVIDERS.providers.openai, key: KEY });
  assert.deepEqual([o.url, o.init.method, o.init.headers.authorization], ['https://api.openai.com/v1/models', 'GET', `Bearer ${KEY}`]);
  const a = anthropic.modelsRequest({ provider: PROVIDERS.providers.claude, key: KEY });
  assert.deepEqual([a.url, a.init.headers['x-api-key'], a.init.headers['anthropic-version']], ['https://api.anthropic.com/v1/models?limit=100', KEY, '2023-06-01']);
  const list = openaiChat.modelsFrom({ data: [{ id: 'gpt-5.1' }, { id: 'text-embedding-3-large' }, { id: 'models/gemini-3.5-flash' }, { id: 'dall-e-3' }, { id: 'gpt-5.1' }, { id: '../bad' }] });
  assert.deepEqual(chatModels(list).map((m) => m.id), ['gpt-5.1', 'gemini-3.5-flash']);
  assert.deepEqual(anthropic.modelsFrom({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] }), [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }]);
});

test('Connect makes one request, saves the chat models and counts it', async (t) => {
  const files = filesIn(tmpDir(t));
  const fetch = fakeFetch(reply({ data: [{ id: 'gpt-5.1' }, { id: 'gpt-5.1-mini' }, { id: 'whisper-1' }] }));
  const r = await connectProvider({ maxConnectsPerDay: 2 }, PROVIDERS, 'openai', { by: 'tester', fetch, env: { OPENAI_API_KEY: KEY }, files });
  assert.equal(r.count, 2);
  assert.deepEqual(connectedModels('openai', files).models.map((m) => m.id), ['gpt-5.1-mini', 'gpt-5.1']);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.redirect, 'error');
  assert.ok(!fs.readFileSync(files.log, 'utf8').includes(KEY));
});

test('Connect refuses the seat, a missing key, a refused key and the daily cap, without retrying', async (t) => {
  const files = filesIn(tmpDir(t));
  const env = { OPENAI_API_KEY: KEY };
  await assert.rejects(() => connectProvider({}, PROVIDERS, 'seat', { env, files, fetch: fakeFetch() }), (e) => e.code === 400 && /not an API provider/.test(e.message));
  await assert.rejects(() => connectProvider({}, PROVIDERS, 'claude', { env, files, fetch: fakeFetch() }), (e) => e.code === 400 && /ANTHROPIC_API_KEY/.test(e.message));
  await assert.rejects(() => connectProvider({}, PROVIDERS, '../x', { env, files, fetch: fakeFetch() }), (e) => e.code === 400);
  const fetch = fakeFetch(reply({ error: { message: `bad key ${KEY}` } }, 401));
  await assert.rejects(() => connectProvider({ maxConnectsPerDay: 1 }, PROVIDERS, 'openai', { env, files, fetch }), (e) => e.code === 502 && /refused the key/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(() => connectProvider({ maxConnectsPerDay: 1 }, PROVIDERS, 'openai', { env, files, fetch }), (e) => e.code === 429 && /Daily Connect limit/.test(e.message));
  assert.equal(fetch.calls.length, 1);
  assert.equal(connectedModels('openai', files), null);
});
