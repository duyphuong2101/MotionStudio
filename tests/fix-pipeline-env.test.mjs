import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { keyFreeEnv } from '../engine/core.mjs';
import { killTree, mediaTimeoutMs } from '../engine/media.mjs';

test('keyFreeEnv drops every provider keyEnv and the seat-only names, in any case, and keeps the rest', () => {
  const providers = { providers: { seat: { kind: 'claude-code' }, mine: { keyEnv: 'MY_KEY' } } };
  const env = {
    MY_KEY: 'a', my_key: 'b', Anthropic_Api_Key: 'c', ANTHROPIC_AUTH_TOKEN: 'd', ANTHROPIC_BASE_URL: 'e', GOOGLE_API_KEY: 'f',
    GOOGLE_GENAI_API_KEY: 'g', CLAUDE_CODE_USE_BEDROCK: '1', claude_code_use_vertex: '1', AWS_BEARER_TOKEN_BEDROCK: 'h', PATH: 'p', TEMP: 't',
  };
  assert.deepEqual(keyFreeEnv(env, providers), { PATH: 'p', TEMP: 't' });
  assert.equal(env.MY_KEY, 'a', 'the input is not changed');
});

test('keyFreeEnv reads the keyEnv names from config/providers.json by default', () => {
  const env = { OPENAI_API_KEY: '1', XAI_API_KEY: '2', GEMINI_API_KEY: '3', DASHSCOPE_API_KEY: '4', ANTHROPIC_API_KEY: '5', SystemRoot: 'C:\\Windows' };
  assert.deepEqual(keyFreeEnv(env), { SystemRoot: 'C:\\Windows' });
});

test('mediaTimeoutMs scales with the media length between a floor and the engine run timeout', () => {
  const engine = { runTimeoutMinutes: 15 };
  assert.equal(mediaTimeoutMs(0, engine), 180000, 'floor for a short clip');
  assert.equal(mediaTimeoutMs(30, engine), 300000, '10 s per media second');
  assert.equal(mediaTimeoutMs(600, engine), 900000, 'never past the run timeout');
  assert.equal(mediaTimeoutMs(30, { runTimeoutMinutes: 15, ffmpegMinSeconds: 120, ffmpegSecondsPerMediaSecond: 2 }), 120000, 'config overrides');
  assert.equal(mediaTimeoutMs(1, { runTimeoutMinutes: 0.5 }), 180000, 'a run timeout below the floor never cuts under the floor');
});

test('killTree stops a running child and leaves an ended one alone', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { shell: false, windowsHide: true, stdio: 'ignore' });
  await new Promise((ok) => child.once('spawn', ok));
  const closed = new Promise((ok) => child.once('close', ok));
  killTree(child);
  const timer = AbortSignal.timeout(10000);
  await Promise.race([closed, new Promise((_, no) => timer.addEventListener('abort', () => no(new Error('child still running'))))]);
  assert.doesNotThrow(() => killTree(child), 'a second kill on an ended child is a no-op');
});
