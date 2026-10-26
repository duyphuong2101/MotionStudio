import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, StudioError, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, getStatus, jobDir, jobFile } from '../engine/jobs.mjs';
import { toolsFor, checkArgs, readImage, pngSize, jpegSize } from '../server/worker/tools.mjs';
import { fetchPage, pageText } from '../server/worker/fetch-page.mjs';

globalThis.fetch = () => { throw new Error('No network in tests'); };

const P = 'zz-test-worker-tools';
const ID = 'promo';
const HOST = 'shop.example.com';
const API = loadStudioConfig().director.api;
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SOURCE = { name: 'Acme', bullets: [{ text: 'Ships in a day', ref: 'brief' }] };

after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
createProject({ id: P, name: 'Worker tools' });
const brandFile = path.join(DIRS.profiles, P, 'brand.json');
writeJson(brandFile, { ...readJson(brandFile), sources: { allowedHosts: [HOST] } });
saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url: `https://${HOST}/p` }));
const assets = path.join(DIRS.profiles, P, 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'stub.png'), PNG_1X1.subarray(0, 4));
fs.writeFileSync(path.join(assets, 'real.png'), PNG_1X1);

const fresh = () => fs.rmSync(jobDir(P, ID), { recursive: true, force: true });
// No DNS in tests: every name resolves to one public documentation address.
const publicDns = async () => [{ address: '203.0.113.10', family: 4 }];
const ctx = (over = {}) => ({ project: P, job: ID, by: 'director-test', hosts: [HOST], g: API, vision: true, fetch: globalThis.fetch, runPrepare: async () => {}, lookup: publicDns, ...over });
const tool = (c, name) => toolsFor(c).find((t) => t.name === name);
const call = (c, name, args = {}) => tool(c, name).run(args);

/** A recording fetch that answers from a list of Responses, in order. */
function stubFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return answers[calls.length - 1](); };
  return Object.assign(fn, { calls });
}
const html = (body, headers = {}) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (to) => () => new Response(null, { status: 302, headers: { location: to } });

test('the tool list is exactly the job-bound set: no render, approve, sequence, reset-dirty, shell or file tool', () => {
  assert.deepEqual(toolsFor(ctx()).map((t) => t.name), ['claim', 'fetch_page', 'read_job_file', 'write_draft', 'commit', 'prepare', 'read_image', 'fail', 'done']);
  assert.deepEqual(toolsFor(ctx({ vision: false })).map((t) => t.name), ['claim', 'fetch_page', 'read_job_file', 'write_draft', 'commit', 'prepare', 'fail', 'done']);
  for (const t of toolsFor(ctx())) {
    assert.equal(t.schema.type, 'object');
    assert.equal(t.schema.additionalProperties, false, t.name);
    for (const key of ['project', 'job', 'path', 'file', 'dir']) assert.ok(!(key in t.schema.properties), `${t.name} takes no ${key}`);
  }
});

test('checkArgs refuses unknown, missing, wrongly typed and off-enum arguments', () => {
  const s = tool(ctx(), 'write_draft').schema;
  assert.equal(checkArgs(s, { kind: 'source', content: {} }), null);
  assert.equal(checkArgs(s, {}), 'needs kind and content');
  assert.equal(checkArgs(s, { kind: 'render', content: {} }), 'needs kind as one of source, script');
  assert.equal(checkArgs(s, { kind: 'source', content: [] }), 'needs content as an object');
  assert.equal(checkArgs(s, { kind: 'source', content: {}, project: 'x' }), 'got an unknown argument project');
  assert.equal(checkArgs(s, { kind: 'source', content: {}, constructor: 1 }), 'got an unknown argument constructor');
  assert.equal(checkArgs(s, null), 'needs its arguments as an object');
  assert.equal(checkArgs(tool(ctx(), 'fetch_page').schema, { url: 'x'.repeat(2001) }), 'needs url of at most 2000 characters');
});

test('claim moves the job to scripting; read_job_file is an enum and reads the status', async () => {
  fresh();
  assert.deepEqual(await call(ctx(), 'claim'), { status: 'scripting' });
  assert.equal(getStatus(P, ID).status, 'scripting');
  assert.match((await call(ctx(), 'read_job_file', { name: '../brand.json' })).error, /read_job_file needs name as one of source\.json/);
  assert.equal((await call(ctx(), 'read_job_file', { name: 'status.json' })).status, 'scripting');
  assert.deepEqual(await call(ctx(), 'read_job_file', { name: 'source.json' }), { error: 'No source.json yet' });
});

test('write_draft refuses an unclaimed job and a draft over maxDraftBytes, and writes nothing', async () => {
  fresh();
  assert.match((await call(ctx(), 'write_draft', { kind: 'source', content: SOURCE })).error, /Claim the job first/);
  await call(ctx(), 'claim');
  const r = await call(ctx(), 'write_draft', { kind: 'source', content: { ...SOURCE, pad: 'x'.repeat(300 * 1024) } });
  assert.match(r.error, /maxDraftBytes/);
  assert.ok(!fs.existsSync(jobFile(P, ID, 'source.draft.json')));
});

test('write_draft and commit of a valid source keep the job in scripting', async () => {
  fresh();
  await call(ctx(), 'claim');
  const w = await call(ctx(), 'write_draft', { kind: 'source', content: SOURCE });
  assert.equal(w.bytes, fs.statSync(jobFile(P, ID, 'source.draft.json')).size);
  assert.deepEqual(await call(ctx(), 'commit', { kind: 'source' }), { status: 'scripting', kept: [] });
  assert.deepEqual(readJson(jobFile(P, ID, 'source.json')), { ...SOURCE, locks: {} });
  assert.ok(!fs.existsSync(jobFile(P, ID, 'source.draft.json')));
});

test('commit of an invalid draft answers the validation text and leaves the status alone', async () => {
  fresh();
  await call(ctx(), 'claim');
  await call(ctx(), 'write_draft', { kind: 'source', content: { name: 'Acme', bullets: [] } });
  const before = getStatus(P, ID);
  assert.match((await call(ctx(), 'commit', { kind: 'source' })).error, /source invalid/);
  assert.deepEqual(getStatus(P, ID), before);
  setStatus(P, ID, { status: 'approved' }, 'test');
  assert.match((await call(ctx(), 'commit', { kind: 'source' })).error, /"approved"\. Claim the job first/);
});

test('prepare runs the injected runner, answers lint and stills, and stops after maxPrepareRounds', async () => {
  fresh();
  let runs = 0;
  const runPrepare = async (project, job) => {
    runs++;
    setStatus(project, job, { status: 'awaiting_review', duration: 12.5, lint: { errors: 0, warnings: 1, findings: [{ level: 'warning', el: 's1', msg: 'tight' }] }, stills: [{ id: 's1', t: 1, file: 'stills/s1.png' }] }, 'stub prepare', 'test');
  };
  const c = ctx({ runPrepare, counters: { prepare: 0, images: 0 } });
  for (let i = 0; i < API.maxPrepareRounds; i++) {
    assert.deepEqual(await call(c, 'prepare'), { status: 'awaiting_review', duration: 12.5, lint: { errors: 0, warnings: 1, findings: [{ level: 'warning', el: 's1', msg: 'tight' }] }, stills: [{ id: 's1', t: 1, file: 'stills/s1.png' }] });
  }
  assert.match((await call(c, 'prepare')).error, /maxPrepareRounds/);
  assert.equal(runs, API.maxPrepareRounds);
  const failing = ctx({ runPrepare: async () => setStatus(P, ID, { status: 'error', error: '1 lint error(s)' }, 'stub', 'test') });
  assert.equal((await call(failing, 'prepare')).message, '1 lint error(s)');
});

test('read_image goes through assertFileName + within, refuses a non-image and stops at maxImagesPerJob', async () => {
  fresh();
  const c = ctx({ counters: { prepare: 0, images: 0 } });
  assert.throws(() => readImage(c, 'still', '../../brand.json'), /Invalid image name/);
  assert.equal((await call(c, 'read_image', { kind: 'still', name: '../../brand.json' })).error, 'Invalid image name');
  assert.match((await call(c, 'read_image', { kind: 'asset', name: 'stub.png' })).error, /not a readable image/);
  assert.match((await call(c, 'read_image', { kind: 'asset', name: 'brand.json' })).error, /Only PNG, JPEG or WebP/);
  assert.match((await call(c, 'read_image', { kind: 'still', name: 's1.png' })).error, /No still named s1\.png/);
  fs.mkdirSync(path.join(jobDir(P, ID), 'stills'), { recursive: true });
  fs.writeFileSync(path.join(jobDir(P, ID), 'stills', 's1.png'), PNG_1X1);
  const still = await call(c, 'read_image', { kind: 'still', name: 's1.png' });
  assert.deepEqual([still.width, still.height, still.image.mime, still.image.buf.equals(PNG_1X1)], [1, 1, 'image/png', true]);
  for (let i = 1; i < API.maxImagesPerJob; i++) assert.equal((await call(c, 'read_image', { kind: 'asset', name: 'real.png' })).width, 1);
  assert.match((await call(c, 'read_image', { kind: 'asset', name: 'real.png' })).error, /maxImagesPerJob/);
  assert.match((await call(ctx({ g: { ...API, maxImageBytes: 10 } }), 'read_image', { kind: 'asset', name: 'real.png' })).error, /maxImageBytes/);
});

test('pngSize and jpegSize read the header and refuse anything else', () => {
  assert.deepEqual(pngSize(PNG_1X1), { width: 1, height: 1 });
  assert.equal(pngSize(PNG_1X1.subarray(0, 4)), null);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof0 = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(jpegSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0])), { width: 1280, height: 720 });
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0x00, 0x00])), null);
  assert.equal(jpegSize(PNG_1X1), null);
});

test('fetch_page refuses a host outside allowedHosts without fetching', async () => {
  const f = stubFetch();
  assert.match((await call(ctx({ fetch: f }), 'fetch_page', { url: 'https://evil.example/x' })).error, /evil\.example is not in this brand's allowed hosts/);
  assert.match((await call(ctx({ fetch: f }), 'fetch_page', { url: 'file:///C:/x' })).error, /Not an http\(s\) URL/);
  assert.equal(f.calls.length, 0);
});

test('fetch_page checks every redirect hop and follows at most 3', async () => {
  const off = stubFetch(redirect('https://cdn.evil.example/'));
  assert.match((await call(ctx({ fetch: off }), 'fetch_page', { url: `https://${HOST}/a` })).error, /cdn\.evil\.example is not in this brand's allowed hosts/);
  assert.equal(off.calls.length, 1);

  const on = stubFetch(redirect('/p'), html('<title>P</title><p>Hi</p>'));
  const page = await call(ctx({ fetch: on }), 'fetch_page', { url: `https://${HOST}/a` });
  assert.deepEqual([on.calls.length, on.calls[1].url, page.url, page.finalUrl, page.text], [2, `https://${HOST}/p`, `https://${HOST}/a`, `https://${HOST}/p`, 'Hi']);
  assert.equal(on.calls[0].init.redirect, 'manual');
  assert.deepEqual(on.calls[0].init.headers, { accept: 'text/html,*/*' });

  const loop = stubFetch(...Array.from({ length: 5 }, () => redirect('/again')));
  assert.match((await call(ctx({ fetch: loop }), 'fetch_page', { url: `https://${HOST}/a` })).error, /redirected more than 3 times/);
  assert.equal(loop.calls.length, 4);
});

test('fetch_page refuses a body over maxFetchBytes and a page that is not text', async () => {
  const big = stubFetch(html('x'.repeat(2000)));
  assert.match((await call(ctx({ fetch: big, g: { ...API, maxFetchBytes: 1000 } }), 'fetch_page', { url: `https://${HOST}/` })).error, /maxFetchBytes/);
  const png = stubFetch(() => new Response(PNG_1X1, { headers: { 'content-type': 'image/png' } }));
  assert.equal((await call(ctx({ fetch: png }), 'fetch_page', { url: `https://${HOST}/a.png` })).error, 'Not a text page (image/png)');
  const gone = stubFetch(() => new Response('no', { status: 404 }));
  assert.match((await call(ctx({ fetch: gone }), 'fetch_page', { url: `https://${HOST}/x` })).error, /answered 404/);
});

test('pageText keeps the title, breaks lines at headings and items, drops script and resolves images', () => {
  const doc = '<html><head><title>Acme &amp; Co</title><style>p{}</style><script>alert("x")</script></head><body>'
    + '<h1>Fast&nbsp;shipping</h1><ul><li>One &lt;day&gt;</li><li>Free   returns</li></ul><noscript>no</noscript>'
    + '<svg><text>logo</text></svg><img src="/a.png" alt="A"><img alt=\'B &quot;b&quot;\' src="https://cdn.example.com/b.jpg"><img src="data:image/png;base64,AAAA"></body></html>';
  const page = pageText(doc, `https://${HOST}/p`);
  assert.equal(page.title, 'Acme & Co');
  assert.equal(page.text, 'Fast shipping\nOne <day>\nFree returns');
  assert.deepEqual(page.images, [{ src: `https://${HOST}/a.png`, alt: 'A' }, { src: 'https://cdn.example.com/b.jpg', alt: 'B "b"' }]);
});

test('fetchPage cuts the text at maxPageChars with truncated: true and passes plain text through', async () => {
  const g = { ...API, maxPageChars: 10 };
  const long = await fetchPage(`https://${HOST}/`, { hosts: [HOST], fetch: stubFetch(html('<p>0123456789abcdef</p>')), g, lookup: publicDns });
  assert.deepEqual([long.text, long.truncated], ['0123456789', true]);
  const plain = await fetchPage(`https://${HOST}/t`, { hosts: [HOST], fetch: stubFetch(() => new Response('<b>raw</b>', { headers: { 'content-type': 'text/plain' } })), g: API, lookup: publicDns });
  assert.deepEqual([plain.text, plain.title, plain.images, plain.truncated], ['<b>raw</b>', '', [], undefined]);
});

test('fail puts the job into error with the reason; done only reports the status', async () => {
  fresh();
  await call(ctx(), 'claim');
  assert.deepEqual(await call(ctx(), 'done', { summary: 'early' }), { status: 'scripting' });
  assert.deepEqual(await call(ctx(), 'fail', { reason: 'The page has no prices.' }), { status: 'error', reason: 'The page has no prices.' });
  const st = getStatus(P, ID);
  assert.deepEqual([st.status, st.error, st.history.at(-1).by], ['error', 'The page has no prices.', 'director-test']);
});

test('a network failure is a tool error; any other exception is thrown, not turned into a tool result', async () => {
  const down = () => { throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }); };
  assert.equal((await call(ctx({ fetch: down }), 'fetch_page', { url: `https://${HOST}/` })).error, `Could not reach ${HOST}: ECONNREFUSED`);
  fresh();
  await assert.rejects(call(ctx({ runPrepare: async () => { throw new TypeError('boom'); } }), 'prepare'), TypeError);
});

test('a busy engine (429) is a tool error that uses no prepare round', async () => {
  fresh();
  let busy = true, runs = 0;
  const runPrepare = (project, job) => {
    if (busy) throw new StudioError('Another render or prepare is running. Wait for it to finish.', 429);
    runs++;
    setStatus(project, job, { status: 'awaiting_review' }, 'stub prepare', 'test');
    return { done: Promise.resolve(), kill() {} };
  };
  const counters = { prepare: 0, images: 0 };
  const c = ctx({ runPrepare, counters });
  for (let i = 0; i < API.maxPrepareRounds + 2; i++) assert.match((await call(c, 'prepare')).error, /Another render or prepare is running/);
  assert.equal(counters.prepare, 0);
  busy = false;
  for (let i = 0; i < API.maxPrepareRounds; i++) assert.equal((await call(c, 'prepare')).status, 'awaiting_review');
  assert.match((await call(c, 'prepare')).error, /maxPrepareRounds/);
  assert.equal(runs, API.maxPrepareRounds);
});

test('fetch_page stops at maxFetchesPerJob with a message naming the key', async () => {
  const f = stubFetch(...Array.from({ length: 10 }, () => html('<p>Hi</p>')));
  const c = ctx({ fetch: f, counters: { prepare: 0, images: 0 }, g: { ...API, maxFetchesPerJob: 2 } });
  assert.match(tool(c, 'fetch_page').description, /at most 2 per job/);
  for (let i = 0; i < 2; i++) assert.equal((await call(c, 'fetch_page', { url: `https://${HOST}/${i}` })).text, 'Hi');
  const r = await call(c, 'fetch_page', { url: `https://${HOST}/2` });
  assert.match(r.error, /Already fetched 2 pages for this job \(maxFetchesPerJob\)/);
  assert.equal(f.calls.length, 2);
});

test('a body that fails mid-read is a tool error: 502 on a dropped connection, 504 on a timeout, 499 when the run stops', async () => {
  const failing = (err) => () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<p>part')); c.error(err); } }), { headers: { 'content-type': 'text/html' } });
  const reset = Object.assign(new TypeError('terminated'), { cause: new Error('ECONNRESET') });
  const opts = (fetch, over = {}) => ({ hosts: [HOST], fetch, g: API, lookup: publicDns, ...over });
  await assert.rejects(fetchPage(`https://${HOST}/`, opts(stubFetch(failing(reset)))), (e) => e instanceof StudioError && e.code === 502 && e.message === `Could not read the page from ${HOST}: ECONNRESET`);
  await assert.rejects(fetchPage(`https://${HOST}/`, opts(stubFetch(failing(new DOMException('t', 'TimeoutError'))))), (e) => e.code === 504 && /requestTimeoutSeconds/.test(e.message));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(fetchPage(`https://${HOST}/`, opts(stubFetch(failing(new DOMException('a', 'AbortError'))), { signal: ac.signal })), (e) => e.code === 499 && e.message === 'The run was stopped');
  assert.match((await call(ctx({ fetch: stubFetch(failing(reset)) }), 'fetch_page', { url: `https://${HOST}/` })).error, /^Could not read the page from/);
});

test('fetch_page refuses a non-default port and any hop whose host resolves to a private or local address', async () => {
  const refused = ['127.0.0.1', '127.8.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.9', '169.254.169.254', '0.0.0.0', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1'];
  for (const address of refused) {
    const f = stubFetch(html('<p>Hi</p>'));
    const lookup = async () => [{ address, family: address.includes(':') ? 6 : 4 }];
    const r = await call(ctx({ fetch: f, lookup }), 'fetch_page', { url: `https://${HOST}/` });
    assert.match(r.error, /resolves to a private or local address/, address);
    assert.equal(f.calls.length, 0, address);
  }
  const mixed = async () => [{ address: '203.0.113.10', family: 4 }, { address: '10.0.0.1', family: 4 }];
  assert.match((await call(ctx({ lookup: mixed }), 'fetch_page', { url: `https://${HOST}/` })).error, /\(10\.0\.0\.1\)/, 'one private address is enough to refuse');
  for (const address of ['203.0.113.10', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
    const ok = await call(ctx({ fetch: stubFetch(html('<p>Hi</p>')), lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] }), 'fetch_page', { url: `https://${HOST}/` });
    assert.equal(ok.text, 'Hi', address);
  }
  const f = stubFetch();
  assert.match((await call(ctx({ fetch: f }), 'fetch_page', { url: `https://${HOST}:8443/` })).error, /port 8443 is refused/);
  assert.match((await call(ctx({ fetch: f }), 'fetch_page', { url: `http://${HOST}:22/` })).error, /port 22 is refused/);
  assert.equal(f.calls.length, 0);
  assert.equal((await call(ctx({ fetch: stubFetch(html('<p>Hi</p>')) }), 'fetch_page', { url: `https://${HOST}:443/` })).text, 'Hi', 'the default port spelled out is fine');
  // Every redirect hop is resolved again: the second answer resolves to loopback.
  const hosts = [];
  const rebind = async (h) => { hosts.push(h); return [{ address: hosts.length > 1 ? '127.0.0.1' : '203.0.113.10', family: 4 }]; };
  const hop = stubFetch(redirect('/next'));
  assert.match((await call(ctx({ fetch: hop, lookup: rebind }), 'fetch_page', { url: `https://${HOST}/` })).error, /private or local address \(127\.0\.0\.1\)/);
  assert.deepEqual([hop.calls.length, hosts], [1, [HOST, HOST]]);
  const nx = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); };
  assert.equal((await call(ctx({ lookup: nx }), 'fetch_page', { url: `https://${HOST}/` })).error, `Could not resolve ${HOST}: ENOTFOUND`);
});
