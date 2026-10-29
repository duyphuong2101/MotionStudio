import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig } from '../engine/core.mjs';
import { profileDir } from '../engine/jobs.mjs';
import { usage, countUse, runDay, runMonth } from '../server/caps.mjs';
import {
  assertGenerateConfig, optionsFor, validateRequest, imageRequest, imageFromInteraction, modelsRequest, filterModels, sortModels,
  assertKnownModel, assetNameFor, redact, FALLBACK_MODELS, filesIn, startGenerate, generateState, generateHas, sidecarFile,
  refreshModels, saveModelDefaults, modelDefaults, MAX_MODEL_PAGES, MAX_REF_BYTES,
  videoRequest, videoFromInteraction, videoDownloadUrl, shapeOf, assertClipLength, readRefs,
} from '../server/generate.mjs';

// npm test never reaches the network: every call must go through an injected fake.
globalThis.fetch = () => { throw new Error('tests must not call the network'); };

const G = loadStudioConfig().generate;
const KEY = 'SENTINEL-KEY-123';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

/* ---------- config and request ---------- */
test('a missing or non-positive cap refuses with 503', () => {
  assert.equal(assertGenerateConfig(G), G);
  assert.throws(() => assertGenerateConfig({ ...G, maxImagesPerMonth: 0 }), (e) => e.code === 503 && /maxImagesPerMonth/.test(e.message));
  assert.throws(() => assertGenerateConfig({ ...G, maxVideosPerDay: '4' }), (e) => e.code === 503);
  assert.throws(() => assertGenerateConfig(undefined), (e) => e.code === 503);
  assert.throws(() => assertGenerateConfig({ ...G, imageSize: '4K' }), (e) => e.code === 503 && /imageSize/.test(e.message));
});

test('a request is checked against the options table', () => {
  const o = optionsFor(G);
  // Omni takes no clip length: no durations are offered.
  assert.deepEqual(o.video, { aspectRatios: ['16:9', '9:16'], maxRefs: 3 });
  const r = validateRequest({ kind: 'image', prompt: '  a cup  ', acknowledged: true }, o);
  assert.deepEqual(r, { kind: 'image', prompt: 'a cup', aspectRatio: '16:9', refs: [], model: null, name: '', replace: false, unique: false, acknowledged: true });
  assert.throws(() => validateRequest({ kind: 'audio', prompt: 'x' }, o), (e) => e.code === 400);
  assert.throws(() => validateRequest({ kind: 'image', prompt: ' ' }, o), /prompt/);
  assert.throws(() => validateRequest({ kind: 'image', prompt: 'x'.repeat(2001) }, o), /2001 characters, limit 2000: cut 1/);
  assert.throws(() => validateRequest({ kind: 'image', prompt: 'x', aspectRatio: '3:1' }, o), /Aspect ratio/);
  assert.throws(() => validateRequest({ kind: 'video', prompt: 'x', aspectRatio: '1:1' }, o), /Aspect ratio/);
  assert.deepEqual(validateRequest({ kind: 'video', prompt: 'x', refs: ['a.png', 'b.jpg'], unique: true }, o).refs, ['a.png', 'b.jpg']);
  assert.throws(() => validateRequest({ kind: 'image', prompt: 'x', refs: ['a.png'] }, o), /clips only/);
  assert.throws(() => validateRequest({ kind: 'video', prompt: 'x', refs: ['a.png', 'b.png', 'c.png', 'd.png'] }, o), /at most 3/);
  assert.throws(() => validateRequest({ kind: 'video', prompt: 'x', refs: ['a.png', 'a.png'] }, o), /twice/);
  assert.throws(() => validateRequest({ kind: 'video', prompt: 'x', refs: 'a.png' }, o), /list of picture names/);
  assert.throws(() => validateRequest({ kind: 'video', prompt: 'x', refs: [{ name: 'a.png' }] }, o), /list of picture names/);
  assert.throws(() => validateRequest({ kind: 'image', prompt: 'x', model: '../models' }, o), /model/);
});

test('the image request goes to the fixed host with the key in the header only', () => {
  const { url, init } = imageRequest({ model: 'gemini-nano-banana-2.1', prompt: 'a cup', aspectRatio: '16:9', size: '1K' }, KEY);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.ok(!url.includes(KEY) && !init.body.includes(KEY));
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gemini-nano-banana-2.1');
  assert.equal(body.input, 'a cup');
  assert.equal(body.response_format.type, 'image');
  assert.equal(body.response_format.aspect_ratio, '16:9');
});

test('the image is read from the interaction steps under the byte cap', () => {
  const json = { id: 'r1', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'image', mime_type: 'image/jpeg', data: JPEG.toString('base64') }] }] };
  const { buf, mime } = imageFromInteraction(json, 1000);
  assert.deepEqual(buf, JPEG);
  assert.equal(mime, 'image/jpeg');
  assert.throws(() => imageFromInteraction({ steps: [{ content: [{ type: 'text', text: 'no' }] }] }, 1000), (e) => e.code === 502);
  assert.throws(() => imageFromInteraction({}, 1000), (e) => e.code === 502);
  assert.throws(() => imageFromInteraction(json, 8), (e) => e.code === 413);
});

test('the model list request carries the key in the header and pages by token', () => {
  const first = modelsRequest(null, KEY);
  assert.equal(first.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
  assert.equal(first.init.headers['x-goog-api-key'], KEY);
  assert.ok(!first.url.includes(KEY));
  assert.match(modelsRequest('abc=', KEY).url, /pageToken=abc%3D$/);
});

/* ---------- model list ---------- */
const res = (name, methods, displayName = name) => ({ name: `models/${name}`, displayName, description: `${displayName} model`, supportedGenerationMethods: methods });
const PROBE = [
  res('gemini-nano-banana-2.1', ['generateContent'], 'Nano Banana 2.1'),
  res('nano-banana-pro-preview', ['generateContent', 'countTokens'], 'Nano Banana Pro'),
  res('gemini-3.1-flash-image', ['generateContent']),
  res('gemini-3.1-flash-image-preview', ['generateContent']),
  res('gemini-3-pro-image', ['generateContent']),
  res('veo-3.1-lite-generate-preview', ['predictLongRunning']),
  res('veo-3.1-generate-preview', ['predictLongRunning']),
  res('veo-3.0-generate-001', ['predictLongRunning']),
  res('gemini-2.5-pro', ['generateContent', 'countTokens'], 'Gemini 2.5 Pro'),
  res('text-embedding-004', ['embedContent']),
  res('gemini-omni-1.1-flash', ['generateContent'], 'Gemini Omni Flash'),
  res('imagen-4.0-generate-001', ['predict']),
];

test('the filter keeps image and clip models and drops the rest', () => {
  const kinds = Object.fromEntries(filterModels(PROBE).map((m) => [m.id, m.kind]));
  for (const id of ['gemini-nano-banana-2.1', 'nano-banana-pro-preview', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview']) assert.equal(kinds[id], 'image', id);
  // Clips come from Gemini Omni through generateContent; the Veo previews (predictLongRunning) were shut down on 2026-10-22.
  assert.equal(kinds['gemini-omni-1.1-flash'], 'video');
  for (const id of ['veo-3.1-lite-generate-preview', 'veo-3.1-generate-preview', 'veo-3.0-generate-001', 'gemini-2.5-pro', 'text-embedding-004', 'imagen-4.0-generate-001']) assert.ok(!(id in kinds), id);
  assert.deepEqual(filterModels([res('gemini-omni-1.1-flash', ['predictLongRunning'])]), [], 'an Omni id without generateContent is dropped');
  const one = filterModels(PROBE).find((m) => m.id === 'nano-banana-pro-preview');
  assert.deepEqual(Object.keys(one), ['id', 'displayName', 'description', 'methods', 'kind']);
});

test('the sort puts the newest first, GA before preview, no version last', () => {
  const ids = sortModels(filterModels(PROBE)).map((m) => m.id);
  const at = (id) => ids.indexOf(id);
  assert.ok(at('gemini-3.1-flash-image') < at('gemini-3.1-flash-image-preview'));
  assert.ok(at('gemini-3.1-flash-image-preview') < at('gemini-3-pro-image'));
  assert.ok(at('gemini-3-pro-image') < at('gemini-omni-1.1-flash'));
  assert.equal(ids.at(-1), 'nano-banana-pro-preview');
});

test('a model id must be in the fetched list, or the default before any list', () => {
  const list = filterModels(PROBE);
  assert.throws(() => assertKnownModel('image', 'x', list, FALLBACK_MODELS), (e) => e.code === 400 && /Refresh models/.test(e.message));
  assert.equal(assertKnownModel('image', 'gemini-3-pro-image', list, FALLBACK_MODELS), 'gemini-3-pro-image');
  assert.equal(assertKnownModel('image', FALLBACK_MODELS.image, null, FALLBACK_MODELS), FALLBACK_MODELS.image);
  assert.throws(() => assertKnownModel('image', 'other', null, FALLBACK_MODELS), (e) => e.code === 400);
  assert.throws(() => assertKnownModel('image', 'veo-3.1-generate-preview', list, FALLBACK_MODELS), (e) => e.code === 400);
});

/* ---------- names and redaction ---------- */
test('a generated asset gets a dated name or the cleaned name the person typed', () => {
  const date = new Date(2026, 9, 15, 7, 31);
  assert.equal(assetNameFor('image', '', date), 'gen-20261015-0731.jpg');
  assert.equal(assetNameFor('video', '', date), 'gen-20261015-0731.mp4');
  assert.equal(assetNameFor('image', '../Hero Shot.PNG'), 'Hero-Shot.png');
  assert.equal(assetNameFor('image', 'hero'), 'hero.jpg');
  assert.throws(() => assetNameFor('image', 'hero.mp4'), (e) => e.code === 400);
  assert.throws(() => assetNameFor('image', 'hero.exe'), (e) => e.code === 400);
});

test('redact removes the key from any text', () => {
  assert.ok(!redact('key k-123 leaked', 'k-123').includes('k-123'));
  assert.ok(!redact(`bad key AIza${'x'.repeat(35)}`, '').includes('AIza'));
  assert.equal(redact('plain', ''), 'plain');
});

/* ---------- caps ---------- */
test('usage resets the day at midnight and the month on the 1st, independently', (t) => {
  const file = path.join(tmpDir(t), 'images.json');
  const late = new Date(2026, 9, 31, 23, 50), nov = new Date(2026, 10, 1, 0, 5), nov2 = new Date(2026, 10, 2, 9, 0);
  assert.deepEqual(usage(file, late), { day: 0, month: 0 });
  countUse(file, late); countUse(file, late);
  assert.deepEqual(usage(file, late), { day: 2, month: 2 });
  assert.deepEqual(usage(file, nov), { day: 0, month: 0 });
  countUse(file, nov);
  assert.deepEqual(usage(file, nov2), { day: 0, month: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { day: runDay(nov), count: 1, month: runMonth(nov), monthCount: 1 });
});

/* ---------- the image runner ---------- */
const P = 'zz-test-generate';
const PROVIDERS = { providers: { gemini: { keyEnv: 'GEMINI_API_KEY', models: { ...FALLBACK_MODELS } } } };
const ENV = { GEMINI_API_KEY: KEY };
const IMAGE_JSON = { id: 'resp-1', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: JPEG.toString('base64') }] }] };
const reply = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t, ...projects) {
  for (const p of projects.length ? projects : [P]) {
    fs.mkdirSync(profileDir(p), { recursive: true });
    t.after(() => fs.rmSync(profileDir(p), { recursive: true, force: true }));
  }
  return filesIn(tmpDir(t));
}

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

const start = (files, fetch, { body = {}, project = P, ...opts } = {}) => startGenerate(G, PROVIDERS, {
  project, body: { kind: 'image', prompt: 'a red cup', acknowledged: true, ...body }, by: 'tester', env: ENV, fetch, files, ...opts,
});

async function settle(project = P) {
  for (let i = 0; i < 400 && generateHas(project); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(!generateHas(project), 'the generation did not finish');
}

const state = (files, project = P) => generateState(G, PROVIDERS, project, { env: ENV, files });

test('a generated image is saved as an asset with a sidecar and counted once', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply(IMAGE_JSON));
  assert.deepEqual(usage(files.images), { day: 0, month: 0 });
  assert.deepEqual(start(files, fetch, { body: { name: 'hero' } }), { started: 'image', name: 'hero.jpg', model: FALLBACK_MODELS.image });
  await settle();
  assert.equal(fetch.calls[0].init.headers['x-goog-api-key'], KEY);
  assert.equal(state(files).last.status, 'done');
  const asset = fs.readFileSync(path.join(profileDir(P), 'assets', 'hero.jpg'));
  assert.deepEqual([...asset.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const side = JSON.parse(fs.readFileSync(sidecarFile(P, 'hero.jpg'), 'utf8'));
  assert.equal(side.provider, 'gemini');
  assert.equal(side.key, 'personal (GEMINI_API_KEY)');
  assert.equal(side.prompt, 'a red cup');
  assert.equal(side.model, FALLBACK_MODELS.image);
  assert.equal(side.responseId, 'resp-1');
  assert.ok(Date.parse(side.madeAt));
  assert.deepEqual(usage(files.images), { day: 1, month: 1 });
  assert.equal(state(files).generated['hero.jpg'].model, FALLBACK_MODELS.image);
});

test('a second generation is refused while one is running', async (t) => {
  const files = setup(t);
  let release;
  const fetch = fakeFetch(() => new Promise((r) => { release = () => r(reply(IMAGE_JSON)); }));
  start(files, fetch);
  assert.throws(() => start(files, fetch, { body: { name: 'other' } }), (e) => e.code === 409);
  assert.equal(state(files).running.project, P);
  await new Promise((r) => setImmediate(r));
  release();
  await settle();
});

test('a 429 from Google pauses the generator', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply({ error: { code: 429, message: 'Resource has been exhausted' } }, 429)));
  await settle();
  const pause = JSON.parse(fs.readFileSync(files.pause, 'utf8'));
  assert.ok(Date.parse(pause.until) > Date.now());
  assert.match(state(files).last.message, /quota/);
  assert.throws(() => start(files, fakeFetch(reply(IMAGE_JSON))), (e) => e.code === 429 && /Paused until/.test(e.message));
});

test('the day and the month caps refuse before any request', (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply(IMAGE_JSON));
  fs.writeFileSync(files.images, JSON.stringify({ day: runDay(), count: G.maxImagesPerDay, month: runMonth(), monthCount: G.maxImagesPerDay }));
  assert.throws(() => start(files, fetch), (e) => e.code === 429 && /Daily image limit/.test(e.message));
  fs.writeFileSync(files.images, JSON.stringify({ day: '2000-01-01', count: 99, month: runMonth(), monthCount: G.maxImagesPerMonth }));
  assert.throws(() => start(files, fetch), (e) => e.code === 429 && /Monthly image limit/.test(e.message));
  assert.equal(fetch.calls.length, 0);
});

test('a listed model that Google refuses asks for Refresh models and writes nothing', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply({ error: { code: 404, message: `models/${FALLBACK_MODELS.image} is not found for API version v1beta` } }, 404)), { body: { name: 'gone' } });
  await settle();
  const { last } = state(files);
  assert.equal(last.status, 'error');
  assert.match(last.message, new RegExp(`Model ${FALLBACK_MODELS.image}.*Refresh models`));
  assert.ok(!fs.existsSync(path.join(profileDir(P), 'assets', 'gone.jpg')));
  assert.ok(!fs.existsSync(sidecarFile(P, 'gone.jpg')));
});

test('a request that runs past the timeout ends with an error', async (t) => {
  const files = setup(t);
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  startGenerate({ ...G, requestTimeoutSeconds: 0.01 }, PROVIDERS, { project: P, body: { kind: 'image', prompt: 'x', acknowledged: true }, by: 'tester', env: ENV, fetch: fakeFetch(hang), files });
  await settle();
  const { last } = state(files);
  assert.equal(last.status, 'error');
  assert.match(last.message, /timed out/);
});

test('without a key nothing starts and the message names the variable', (t) => {
  const files = setup(t);
  assert.throws(() => start(files, fakeFetch(), { env: {} }), (e) => e.code === 503 && /GEMINI_API_KEY/.test(e.message));
  assert.equal(state(files).hasKey, true);
  assert.equal(generateState(G, PROVIDERS, P, { env: {}, files }).hasKey, false);
});

test('the notice is ticked once per machine, not per project', async (t) => {
  const files = setup(t, P, `${P}-2`);
  const fetch = fakeFetch(() => reply(IMAGE_JSON));
  assert.throws(() => start(files, fetch, { body: { acknowledged: false } }), (e) => e.code === 400 && /Tick the notice first/.test(e.message));
  assert.equal(state(files).notice, null);
  start(files, fetch);
  await settle();
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(files.notice, 'utf8')).acknowledgedAt));
  assert.equal(state(files).notice.by, 'tester');
  start(files, fetch, { project: `${P}-2`, body: { acknowledged: false } });
  await settle(`${P}-2`);
  assert.equal(state(files, `${P}-2`).last.status, 'done');
});

test('a model outside the fetched list is refused before any request', (t) => {
  const files = setup(t);
  fs.writeFileSync(files.models, JSON.stringify({ fetchedAt: new Date().toISOString(), models: filterModels(PROBE) }));
  const fetch = fakeFetch(reply(IMAGE_JSON));
  assert.throws(() => start(files, fetch, { body: { model: 'gemini-9-image' } }), (e) => e.code === 400 && /Refresh models/.test(e.message));
  assert.throws(() => start(files, fetch, { body: { model: 'veo-3.1-generate-preview' } }), (e) => e.code === 400);
  assert.equal(fetch.calls.length, 0);
});

test('the key never reaches the state, the log or an error message', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply({ error: { code: 400, message: `API key not valid: ${KEY}` } }, 400)));
  await settle();
  const s = state(files);
  assert.equal(s.last.status, 'error');
  assert.ok(!JSON.stringify(s).includes(KEY));
  const log = fs.readFileSync(path.join(files.dir, `${P}.log`), 'utf8');
  assert.match(log, /\[key\]/);
  assert.ok(!log.includes(KEY));
});

/* ---------- review fixes ---------- */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PNG_JSON = { id: 'resp-png', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: PNG.toString('base64') }] }] };
const assetFile = (name, project = P) => path.join(profileDir(project), 'assets', name);

test('a redirect from Google is never followed, so the key stays with Google', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }), () => reply(IMAGE_JSON));
  start(files, fetch);
  await settle();
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.redirect, 'error');
  assert.match(state(files).last.message, /redirect.*never sent to another host/);
});

test('another format than asked never overwrites, even with Replace ticked', async (t) => {
  const files = setup(t);
  fs.mkdirSync(path.join(profileDir(P), 'assets'), { recursive: true });
  fs.writeFileSync(assetFile('hero.png'), PNG);
  const before = fs.readFileSync(assetFile('hero.png'));
  start(files, fakeFetch(reply(PNG_JSON)), { body: { name: 'hero.jpg', replace: true } });
  await settle();
  const { last } = state(files);
  assert.equal(last.status, 'done');
  assert.equal(last.name, 'hero-2.png');
  assert.match(last.message, /hero-2\.png.*another format/);
  assert.deepEqual(fs.readFileSync(assetFile('hero.png')), before);
  assert.ok(fs.existsSync(sidecarFile(P, 'hero-2.png')));
  assert.ok(!fs.existsSync(assetFile('hero.jpg')));
});

test('another format than asked takes the first free name', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply(PNG_JSON)), { body: { name: 'shot' } });
  await settle();
  assert.equal(state(files).last.name, 'shot.png');
  fs.writeFileSync(assetFile('shot-2.png'), PNG);
  start(files, fakeFetch(reply(PNG_JSON)), { body: { name: 'shot' } });
  await settle();
  assert.equal(state(files).last.name, 'shot-3.png');
});

test('RESOURCE_EXHAUSTED pauses whatever the HTTP status', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply({ error: { code: 400, status: 'RESOURCE_EXHAUSTED', message: 'Spend cap reached' } }, 400)));
  await settle();
  assert.ok(Date.parse(JSON.parse(fs.readFileSync(files.pause, 'utf8')).until) > Date.now());
  assert.match(state(files).last.message, /Paused until/);
});

const LS = String.fromCharCode(0x2028);

test('line breaks in a prompt or in Google\'s text cannot forge a log line', async (t) => {
  const files = setup(t);
  start(files, fakeFetch(reply({ error: { message: 'bad\r\n2026-01-01T00:00:00.000Z admin image ok' } }, 400)), { body: { prompt: `cup\n2026-01-01T00:00:00.000Z forged${LS}line` } });
  await settle();
  const lines = fs.readFileSync(path.join(files.dir, `${P}.log`), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => !l.includes('\r') && !l.includes(LS)));
  assert.match(lines[0], /cup 2026-01-01T00:00:00\.000Z forged line/);
});

/* ---------- model list ---------- */
const refresh = (files, fetch, g = G) => refreshModels(g, PROVIDERS, { by: 'tester', env: ENV, fetch, files });

test('refresh has its own daily cap', async (t) => {
  const files = setup(t);
  await refresh(files, fakeFetch(() => reply({ models: PROBE })));
  assert.equal(usage(files.refreshes).day, 1);
  fs.writeFileSync(files.refreshes, JSON.stringify({ day: runDay(), count: G.maxRefreshesPerDay, month: runMonth(), monthCount: G.maxRefreshesPerDay }));
  const fetch = fakeFetch(() => reply({ models: PROBE }));
  await assert.rejects(refresh(files, fetch), (e) => e.code === 429 && /Daily model refresh limit reached \(10, generate\.maxRefreshesPerDay\)/.test(e.message));
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(usage(files.images), { day: 0, month: 0 });
});

test('one timeout covers every page of a refresh', async (t) => {
  const files = setup(t);
  // Each page answers in 40 ms, under a 100 ms timeout per call, but the whole refresh passes 100 ms by the third page.
  const slowPage = (url, init) => new Promise((resolve, reject) => {
    if (init.signal.aborted) return reject(init.signal.reason);
    const timer = setTimeout(() => resolve(reply({ models: [], nextPageToken: 'more' })), 40);
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
  });
  const fetch = fakeFetch(slowPage);
  await assert.rejects(refresh(files, fetch, { ...G, requestTimeoutSeconds: 0.1 }), (e) => e.code === 504 && /timed out/.test(e.message));
  assert.ok(fetch.calls.length < MAX_MODEL_PAGES);
  assert.ok(!fs.existsSync(files.models));
});

test('refresh follows the page token and stores one filtered, sorted list', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply({ models: PROBE.slice(0, 6), nextPageToken: 'p2' }), reply({ models: PROBE.slice(6) }));
  const stored = await refresh(files, fetch);
  assert.equal(fetch.calls.length, 2);
  assert.match(fetch.calls[1].url, /pageToken=p2/);
  assert.ok(fetch.calls.every((c) => c.init.headers['x-goog-api-key'] === KEY && !c.url.includes(KEY)));
  assert.deepEqual(stored.models, sortModels(filterModels(PROBE)));
  const file = JSON.parse(fs.readFileSync(files.models, 'utf8'));
  assert.ok(Date.parse(file.fetchedAt));
  assert.equal(file.models.length, 6);
  assert.ok(!fs.readFileSync(files.models, 'utf8').includes(KEY));
  assert.deepEqual(usage(files.images), { day: 0, month: 0 });
  assert.equal(state(files).models.fetchedAt, file.fetchedAt);
});

test('refresh stops after the page limit', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(() => reply({ models: [], nextPageToken: 'more' }));
  await refresh(files, fetch);
  assert.equal(fetch.calls.length, MAX_MODEL_PAGES);
});

test('refresh is refused while a generation runs', async (t) => {
  const files = setup(t);
  let release;
  start(files, fakeFetch(() => new Promise((r) => { release = () => r(reply(IMAGE_JSON)); })));
  await assert.rejects(refresh(files, fakeFetch(reply({ models: PROBE }))), (e) => e.code === 409);
  release();
  await settle();
});

test('a 429 on refresh pauses and the next refresh is refused', async (t) => {
  const files = setup(t);
  await assert.rejects(refresh(files, fakeFetch(reply({ error: { message: 'quota' } }, 429))), (e) => e.code === 429);
  assert.ok(fs.existsSync(files.pause));
  await assert.rejects(refresh(files, fakeFetch(reply({ models: PROBE }))), (e) => e.code === 429 && /Paused until/.test(e.message));
});

test('saving the picks changes only gemini.models in providers.json', (t) => {
  const file = path.join(tmpDir(t), 'providers.json');
  fs.copyFileSync(new URL('../config/providers.json', import.meta.url), file);
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = filterModels(PROBE);
  assert.deepEqual(saveModelDefaults(file, { image: 'gemini-3-pro-image', video: 'gemini-omni-1.1-flash' }, list),
    { models: { image: 'gemini-3-pro-image', video: 'gemini-omni-1.1-flash' } });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.providers.gemini.models, { image: 'gemini-3-pro-image', video: 'gemini-omni-1.1-flash' });
  delete before.providers.gemini.models;
  delete after.providers.gemini.models;
  assert.deepEqual(after, before);
});

test('a pick outside the list is refused and the file is untouched', (t) => {
  const file = path.join(tmpDir(t), 'providers.json');
  fs.copyFileSync(new URL('../config/providers.json', import.meta.url), file);
  const bytes = fs.readFileSync(file);
  assert.throws(() => saveModelDefaults(file, { image: 'nope', video: 'veo-3.1-generate-preview' }, filterModels(PROBE)), (e) => e.code === 400 && /Refresh models/.test(e.message));
  assert.throws(() => saveModelDefaults(file, { image: 'gemini-3-pro-image', video: 'nope' }, null), (e) => e.code === 400);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('without a fetched list the defaults come from the file or the fallback', (t) => {
  const files = setup(t);
  assert.deepEqual(state(files).models, { defaults: FALLBACK_MODELS, available: [], fetchedAt: null });
  const saved = { providers: { gemini: { keyEnv: 'GEMINI_API_KEY', models: { image: 'gemini-3-pro-image' } } } };
  assert.deepEqual(modelDefaults(saved), { image: 'gemini-3-pro-image', video: FALLBACK_MODELS.video });
  assert.deepEqual(modelDefaults({}), FALLBACK_MODELS);
});

/* ---------- clips (Gemini Omni, plan scene-script B1) ---------- */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(36, 1)]);
const CLIP_JSON = { id: 'resp-clip', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') }] }] };
const URI_JSON = { id: 'resp-uri', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri: 'files/abc123' }] }] };
const DOWNLOAD = 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media';
const PROBED = { duration: 8.04, hasAudio: true, hasVideo: true, width: 720, height: 1280, fps: 24 };
const probeOk = async () => PROBED;
const REF = { name: 'huy.png', mime: 'image/png', data: PNG.toString('base64') };
const clipStart = (files, fetch, { body = {}, ...opts } = {}) => start(files, fetch, {
  body: { kind: 'video', prompt: 'Huy drills into wood', aspectRatio: '9:16', ...body }, probe: probeOk, ...opts,
});
const parts = () => { const dir = path.join(profileDir(P), 'generated'); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.part')) : []; };

function withPictures(t, ...more) {
  const files = setup(t, P, ...more);
  fs.mkdirSync(path.join(profileDir(P), 'assets'), { recursive: true });
  fs.writeFileSync(assetFile('huy.png'), PNG);
  return files;
}

test('the clip request sends the pictures, then the prompt, to the fixed host with the key in the header only', () => {
  const { url, init } = videoRequest({ model: 'gemini-omni-1.1-flash', prompt: 'Huy drills', aspectRatio: '9:16', refs: [REF, { ...REF, name: 'b.jpg', mime: 'image/jpeg' }] }, KEY);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.ok(!url.includes(KEY) && !init.body.includes(KEY));
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gemini-omni-1.1-flash');
  assert.deepEqual(body.input.map((p) => p.type), ['image', 'image', 'text']);
  assert.deepEqual(body.input[0], { type: 'image', data: REF.data, mime_type: 'image/png' });
  assert.equal(body.input[1].mime_type, 'image/jpeg');
  assert.deepEqual(body.input[2], { type: 'text', text: 'Huy drills' });
  assert.deepEqual(body.generation_config, { video_config: { task: 'reference_to_video' } });
  assert.deepEqual(body.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p' });
  assert.deepEqual([body.store, body.background, body.stream], [false, false, false]);
  const plain = JSON.parse(videoRequest({ model: 'm', prompt: 'p', aspectRatio: '16:9' }, KEY).init.body);
  assert.equal(plain.generation_config.video_config.task, 'text_to_video');
  assert.deepEqual(plain.input, [{ type: 'text', text: 'p' }]);
});

test('the clip is read inline or as a link; no clip is 502, over the cap 413', () => {
  const inline = videoFromInteraction(CLIP_JSON, 1000);
  assert.equal(inline.delivery, 'inline');
  assert.deepEqual(inline.buf, MP4);
  assert.deepEqual(videoFromInteraction(URI_JSON, 1000), { delivery: 'uri', url: DOWNLOAD });
  assert.throws(() => videoFromInteraction({ steps: [{ content: [{ type: 'text', text: 'no' }] }] }, 1000), (e) => e.code === 502 && /without a clip/.test(e.message));
  assert.throws(() => videoFromInteraction({}, 1000), (e) => e.code === 502);
  assert.throws(() => videoFromInteraction(CLIP_JSON, 8), (e) => e.code === 413 && /maxResponseBytes/.test(e.message));
  assert.throws(() => videoFromInteraction({ steps: [{ content: [{ type: 'video', mime_type: 'video/webm', data: 'AAAA' }] }] }, 1000), (e) => e.code === 502 && /not an MP4/.test(e.message));
});

test('a clip link is fetched only from the API host', () => {
  assert.equal(videoDownloadUrl('files/abc123:download'), DOWNLOAD);
  assert.equal(videoDownloadUrl(DOWNLOAD), DOWNLOAD);
  assert.equal(videoDownloadUrl('https://generativelanguage.googleapis.com/v1beta/files/abc123:download'), DOWNLOAD);
  for (const bad of ['https://storage.googleapis.com/x.mp4', 'http://generativelanguage.googleapis.com/v1beta/files/abc:download',
    'https://generativelanguage.googleapis.com.evil.example/x', 'https://user:pw@generativelanguage.googleapis.com/x', 'files/../x', '']) {
    assert.throws(() => videoDownloadUrl(bad), (e) => e.code === 502, bad);
  }
});

test('the shape line holds keys and types, never the clip data or its link', () => {
  assert.deepEqual(shapeOf(CLIP_JSON), { keys: ['id', 'steps'], steps: [{ type: 'model_output', content: [{ type: 'text' }, { type: 'video', mime_type: 'video/mp4', dataChars: MP4.toString('base64').length }] }] });
  const uri = JSON.stringify(shapeOf(URI_JSON));
  assert.ok(!uri.includes('abc123') && uri.includes('"uri":true'));
  assert.deepEqual(shapeOf(null), { keys: [], steps: [] });
});

test('a probed clip longer than generate.maxVideoSeconds is 422, no playable video 502', () => {
  assert.equal(assertClipLength(PROBED, 600), 8.04);
  assert.throws(() => assertClipLength({ ...PROBED, duration: 601 }, 600), (e) => e.code === 422 && /maxVideoSeconds/.test(e.message));
  assert.throws(() => assertClipLength({ ...PROBED, hasVideo: false }, 600), (e) => e.code === 502);
  assert.throws(() => assertClipLength({ ...PROBED, duration: 0 }, 600), (e) => e.code === 502);
});

test('a reference must be a listed picture of this brand, at most 8 MB', (t) => {
  const other = `${P}-other`;
  withPictures(t, other);
  fs.writeFileSync(assetFile('clip.mp4'), MP4);
  fs.writeFileSync(assetFile('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.writeFileSync(assetFile('big.png'), Buffer.concat([PNG, Buffer.alloc(MAX_REF_BYTES)]));
  fs.mkdirSync(path.join(profileDir(other), 'assets'), { recursive: true });
  fs.writeFileSync(assetFile('theirs.png', other), PNG);
  assert.deepEqual(readRefs(P, ['huy.png']), [REF]);
  assert.throws(() => readRefs(P, ['clip.mp4']), (e) => e.code === 400 && /not a picture/.test(e.message));
  assert.throws(() => readRefs(P, ['logo.svg']), (e) => e.code === 400);
  assert.throws(() => readRefs(P, ['gone.png']), (e) => e.code === 404);
  assert.throws(() => readRefs(P, ['theirs.png']), (e) => e.code === 404, 'another brand\'s picture');
  assert.throws(() => readRefs(P, [`../${other}/assets/theirs.png`]), (e) => e.code === 400);
  assert.throws(() => readRefs(P, ['big.png']), (e) => e.code === 413);
});

test('a clip from a reference picture is saved with its sidecar, counted once and logged by shape only', async (t) => {
  const files = withPictures(t);
  const fetch = fakeFetch(reply(CLIP_JSON));
  assert.deepEqual(clipStart(files, fetch, { body: { name: 'huy-1', refs: ['huy.png'] } }), { started: 'video', name: 'huy-1.mp4', model: FALLBACK_MODELS.video });
  await settle();
  assert.equal(state(files).last.status, 'done', state(files).last.message);
  assert.equal(fetch.calls.length, 1);
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.model, 'gemini-omni-1.1-flash');
  assert.equal(body.generation_config.video_config.task, 'reference_to_video');
  assert.deepEqual(body.input, [{ type: 'image', data: REF.data, mime_type: 'image/png' }, { type: 'text', text: 'Huy drills into wood' }]);
  assert.deepEqual(fs.readFileSync(assetFile('huy-1.mp4')), MP4);
  const side = JSON.parse(fs.readFileSync(sidecarFile(P, 'huy-1.mp4'), 'utf8'));
  assert.deepEqual([side.kind, side.model, side.prompt, side.references, side.delivery, side.seconds, side.bytes, side.task, side.aspectRatio],
    ['video', 'gemini-omni-1.1-flash', 'Huy drills into wood', ['huy.png'], 'inline', 8.04, MP4.length, 'reference_to_video', '9:16']);
  assert.deepEqual(usage(files.videos), { day: 1, month: 1 });
  assert.deepEqual(usage(files.images), { day: 0, month: 0 });
  const log = fs.readFileSync(path.join(files.dir, `${P}.log`), 'utf8');
  const shape = log.split('\n').filter((l) => l.includes('clip shape:'));
  assert.equal(shape.length, 1, log);
  assert.match(shape[0], /"delivery":"inline","bytes":48,"duration":8\.04,"width":720,"height":1280,"audio":true/);
  assert.ok(!log.includes(MP4.toString('base64')) && !log.includes(PNG.toString('base64')) && !log.includes(KEY));
  assert.deepEqual(parts(), []);
});

test('a clip sent as a link is streamed from the API host with the key header and saved', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply(URI_JSON), () => new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } }));
  clipStart(files, fetch, { body: { name: 'linked' } });
  await settle();
  assert.equal(state(files).last.status, 'done', state(files).last.message);
  assert.equal(fetch.calls.length, 2);
  assert.equal(JSON.parse(fetch.calls[0].init.body).generation_config.video_config.task, 'text_to_video');
  assert.equal(fetch.calls[1].url, DOWNLOAD);
  assert.equal(fetch.calls[1].init.headers['x-goog-api-key'], KEY);
  assert.equal(fetch.calls[1].init.redirect, 'error');
  assert.deepEqual(fs.readFileSync(assetFile('linked.mp4')), MP4);
  assert.equal(JSON.parse(fs.readFileSync(sidecarFile(P, 'linked.mp4'), 'utf8')).delivery, 'uri');
  assert.deepEqual(parts(), []);
});

test('a linked clip past generate.maxVideoBytes stops the download and leaves nothing', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply(URI_JSON), () => new Response(MP4));
  startGenerate({ ...G, maxVideoBytes: 16 }, PROVIDERS, { project: P, body: { kind: 'video', prompt: 'x', acknowledged: true, name: 'big' }, by: 'tester', env: ENV, fetch, files, probe: probeOk });
  await settle();
  const { last } = state(files);
  assert.equal(last.status, 'error');
  assert.match(last.message, /larger than 16 bytes \(generate\.maxVideoBytes\)/);
  assert.ok(!fs.existsSync(assetFile('big.mp4')) && !fs.existsSync(sidecarFile(P, 'big.mp4')));
  assert.deepEqual(parts(), []);
});

test('a clip link on another host is never fetched', async (t) => {
  const files = setup(t);
  const fetch = fakeFetch(reply({ steps: [{ content: [{ type: 'video', mime_type: 'video/mp4', uri: 'https://evil.example/clip.mp4' }] }] }), () => new Response(MP4));
  clipStart(files, fetch);
  await settle();
  assert.equal(fetch.calls.length, 1);
  assert.match(state(files).last.message, /not on https:\/\/generativelanguage\.googleapis\.com/);
});

test('a clip longer than generate.maxVideoSeconds is not saved, and the paid call still counts', async (t) => {
  const files = setup(t);
  clipStart(files, fakeFetch(reply(CLIP_JSON)), { body: { name: 'long' }, probe: async () => ({ ...PROBED, duration: G.maxVideoSeconds + 5 }) });
  await settle();
  const { last } = state(files);
  assert.equal(last.status, 'error');
  assert.equal(last.message.includes(`longer than ${G.maxVideoSeconds} s (generate.maxVideoSeconds)`), true, last.message);
  assert.ok(!fs.existsSync(assetFile('long.mp4')) && !fs.existsSync(sidecarFile(P, 'long.mp4')));
  assert.deepEqual(parts(), []);
  assert.deepEqual(usage(files.videos), { day: 1, month: 1 });
});

test('the clip call waits generate.maxPollMinutes, not requestTimeoutSeconds', async (t) => {
  const files = setup(t);
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  startGenerate({ ...G, requestTimeoutSeconds: 0.001, maxPollMinutes: 0.0005 }, PROVIDERS, {
    project: P, body: { kind: 'video', prompt: 'x', acknowledged: true }, by: 'tester', env: ENV, fetch: fakeFetch(hang), files, probe: probeOk,
  });
  await settle();
  assert.match(state(files).last.message, /timed out after 0\.03 s \(generate\.maxPollMinutes\)/);
});

test('a refused reference or a spent clip cap stops the click before any request or count', (t) => {
  const files = withPictures(t);
  const fetch = fakeFetch(reply(CLIP_JSON));
  assert.throws(() => clipStart(files, fetch, { body: { refs: ['missing.png'] } }), (e) => e.code === 404);
  assert.throws(() => clipStart(files, fetch, { body: { refs: ['../x/huy.png'] } }), (e) => e.code === 400);
  assert.throws(() => clipStart(files, fetch, { body: { refs: ['a.png', 'b.png', 'c.png', 'huy.png'] } }), (e) => e.code === 400);
  fs.writeFileSync(files.videos, JSON.stringify({ day: runDay(), count: G.maxVideosPerDay, month: runMonth(), monthCount: G.maxVideosPerDay }));
  assert.throws(() => clipStart(files, fetch, { body: { refs: ['huy.png'] } }), (e) => e.code === 429 && /Daily clip limit/.test(e.message));
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(usage(files.images), { day: 0, month: 0 });
});

test('a scene clip takes the first free name instead of refusing a taken one', async (t) => {
  const files = withPictures(t);
  fs.writeFileSync(assetFile('job-scene-1.mp4'), MP4);
  assert.equal(clipStart(files, fakeFetch(reply(CLIP_JSON)), { body: { name: 'job-scene-1.mp4', unique: true } }).name, 'job-scene-1-2.mp4');
  await settle();
  assert.equal(state(files).last.name, 'job-scene-1-2.mp4');
  assert.throws(() => clipStart(files, fakeFetch(reply(CLIP_JSON)), { body: { name: 'job-scene-1.mp4' } }), (e) => e.code === 409);
});
