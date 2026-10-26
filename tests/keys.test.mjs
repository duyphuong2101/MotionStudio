import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyEnvNames, loadKeysFromEnvFile } from '../server/keys.mjs';

// Temp files only: the real .env at the repo root is never read here.
function envFile(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'keys.env');
  fs.writeFileSync(file, text);
  return file;
}

const NAMES = ['GEMINI_API_KEY', 'XAI_API_KEY'];

test('only the allowed names are loaded', (t) => {
  const file = envFile(t, 'GEMINI_API_KEY=g-1\nOTHER_SECRET=nope\nPATH=/evil\nNODE_OPTIONS=--inspect\n');
  const env = { PATH: 'p' };
  assert.deepEqual(loadKeysFromEnvFile(file, NAMES, env), ['GEMINI_API_KEY']);
  assert.deepEqual(env, { PATH: 'p', GEMINI_API_KEY: 'g-1' });
});

test('a value already in the environment wins; an empty one is filled', (t) => {
  const file = envFile(t, 'GEMINI_API_KEY=from-file\nXAI_API_KEY=x-file\n');
  const env = { GEMINI_API_KEY: 'from-env', XAI_API_KEY: '' };
  assert.deepEqual(loadKeysFromEnvFile(file, NAMES, env), ['XAI_API_KEY']);
  assert.deepEqual(env, { GEMINI_API_KEY: 'from-env', XAI_API_KEY: 'x-file' });
});

test('a missing file or an empty value loads nothing', (t) => {
  const env = {};
  assert.deepEqual(loadKeysFromEnvFile(path.join(os.tmpdir(), 'ms-no-such-dir', '.env'), NAMES, env), []);
  assert.deepEqual(loadKeysFromEnvFile(envFile(t, 'GEMINI_API_KEY=\nXAI_API_KEY=   \n'), NAMES, env), []);
  assert.deepEqual(env, {});
});

test('the result names keys and never carries a value', (t) => {
  const file = envFile(t, 'GEMINI_API_KEY=SENTINEL-KEY-123\n');
  const loaded = loadKeysFromEnvFile(file, NAMES, {});
  assert.ok(!JSON.stringify(loaded).includes('SENTINEL-KEY-123'));
});

test('comments, quotes and export lines parse', (t) => {
  const file = envFile(t, '# a comment\nexport GEMINI_API_KEY="g 2"\nXAI_API_KEY=\'x-3\' # trailing\n');
  const env = {};
  loadKeysFromEnvFile(file, NAMES, env);
  assert.deepEqual(env, { GEMINI_API_KEY: 'g 2', XAI_API_KEY: 'x-3' });
});

test('the allowed names come from keyEnv in providers.json', () => {
  const providers = JSON.parse(fs.readFileSync(new URL('../config/providers.json', import.meta.url), 'utf8'));
  assert.deepEqual(keyEnvNames(providers).sort(), ['ANTHROPIC_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY']);
  assert.deepEqual(keyEnvNames({ providers: { a: { keyEnv: 'lower_case' }, b: { keyEnv: 'OK_KEY' }, c: {} } }), ['OK_KEY']);
});
