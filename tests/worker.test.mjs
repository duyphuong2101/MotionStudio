import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, redact, flatLine } from '../server/http.mjs';

// npm test never reaches the network: every call must go through an injected fake.
globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const KEY = 'SENTINEL-KEY-123';

/** A fake fetch that records each call and answers from a list (a function answers with its result). */
function fakeFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length, answers.length) - 1];
    return typeof a === 'function' ? a(url, init) : a;
  };
  fn.calls = calls;
  return fn;
}

const OPTS = { url: 'https://api.example.test/v1/x', init: { method: 'POST' }, who: 'Example', timeoutMs: 1000, timeoutLabel: 'director.api.requestTimeoutSeconds', maxBytes: 64, label: 'director.api.maxResponseBytes', keys: KEY };
const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

/* ---------- server/http.mjs ---------- */
test('redact removes every provider key shape and each listed key value', () => {
  const s = redact('sk-abcdefghijklmnopqrstuv and xai-abcdefghijklmnopqr', ['v1']);
  assert.ok(!s.includes('sk-abcdefghijklmnopqrstuv') && !s.includes('xai-abcdefghijklmnopqr'), s);
  assert.equal(s, '[key] and [key]');
  assert.equal(redact(`a sk-ant-${'x'.repeat(20)} b AIza${'y'.repeat(30)}`), 'a [key] b [key]');
  assert.equal(redact(`one ${KEY} two k-999`, [KEY, 'k-999', '']), 'one [key] two [key]');
  assert.equal(redact(`one ${KEY}`, KEY), 'one [key]');
  assert.equal(redact('sk-short', []), 'sk-short');
});

test('flatLine turns control characters and line separators into one space', () => {
  assert.equal(flatLine(`a\r\nb${String.fromCharCode(0x2028)}c\x00d`), 'a b c d');
});

test('a redirect is refused after one call with 502', async () => {
  const fetch = fakeFetch(new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }), () => reply('{}'));
  await assert.rejects(fetchJson(fetch, OPTS), (e) => e.code === 502 && /redirect.*never sent to another host/.test(e.message));
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.redirect, 'error');
});

test('a body over maxBytes is refused with 413 naming the cap', async () => {
  const streamed = fakeFetch(() => reply(JSON.stringify({ text: 'x'.repeat(100) })));
  await assert.rejects(fetchJson(streamed, OPTS), (e) => e.code === 413 && e.message.includes('director.api.maxResponseBytes') && e.message.includes('64 bytes'));
  const declared = fakeFetch(() => reply('{}', 200, { 'content-length': '1000' }));
  await assert.rejects(fetchJson(declared, OPTS), (e) => e.code === 413 && e.message.includes('director.api.maxResponseBytes'));
});

test('any other status comes back with the parsed body, or null json for text', async () => {
  const { res, json } = await fetchJson(fakeFetch(reply('{"error":{"message":"bad"}}', 400)), OPTS);
  assert.equal(res.status, 400);
  assert.equal(json.error.message, 'bad');
  const plain = await fetchJson(fakeFetch(reply('not json', 500)), OPTS);
  assert.equal(plain.json, null);
  assert.equal(plain.text, 'not json');
});

test('a hung request times out with 504 naming the timeout key', async (t) => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  // AbortSignal.timeout does not hold the event loop open; the server does in real use.
  const hold = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(hold));
  await assert.rejects(fetchJson(fakeFetch(hang), { ...OPTS, timeoutMs: 10 }),
    (e) => e.code === 504 && /Example did not answer.*0\.01 s \(director\.api\.requestTimeoutSeconds\)/.test(e.message));
});

test('a network error is a 502 without the key', async () => {
  const down = () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error(`connect refused ${KEY}`) }); };
  await assert.rejects(fetchJson(fakeFetch(down), OPTS), (e) => e.code === 502 && /Could not reach Example/.test(e.message) && !e.message.includes(KEY));
});
