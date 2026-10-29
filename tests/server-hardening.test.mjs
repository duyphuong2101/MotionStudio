import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS } from '../engine/core.mjs';
import { createProject, jobDir } from '../engine/jobs.mjs';
import { lanInterface } from '../server/review.mjs';
import { pinnedFetch } from '../server/worker/fetch-page.mjs';

const PORT = 4801, REVIEW_PORT = 4802;
const HOST = `127.0.0.1:${PORT}`;
const P = 'zz-test-server-hardening';
const wipe = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(wipe);
wipe();
createProject({ id: P, name: 'Hardening' });

/** Each spawn/spawnSync call's argument text in server/ and server/worker/, parentheses matched. */
function spawnCalls() {
  const files = ['server', path.join('server', 'worker')].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, d, f)));
  return files.flatMap((file) => {
    const src = fs.readFileSync(file, 'utf8');
    return [...src.matchAll(/\bspawn(?:Sync)?\(/g)].map((m) => {
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
      return { file: path.basename(file), call: src.slice(m.index, i + 1) };
    });
  });
}

test('every child the server starts gets a key-free env, no shell and a hidden window', () => {
  const calls = spawnCalls();
  assert.ok(calls.length >= 5, 'the scan finds the spawns');
  for (const { file, call } of calls) {
    assert.match(call, /\benv\b/, `${file}: ${call.slice(0, 120)}`);
    assert.match(call, /shell: false/, `${file}: ${call.slice(0, 120)}`);
    assert.match(call, /windowsHide: true/, `${file}: ${call.slice(0, 120)}`);
  }
  const src = fs.readFileSync(path.join(ROOT, 'server', 'server.mjs'), 'utf8');
  assert.match(src, /const engineChild = [^\n]*env: engineEnv\(\)/, 'engine children (prepare, render, transcribe, shots, evidence) share one key-free spawn');
});

test('the review link prefers a physical adapter and says which addresses it passed over', () => {
  const v4 = (address) => [{ family: 'IPv4', address, internal: false }];
  const ifaces = { 'vEthernet (WSL)': v4('172.20.0.1'), 'NordLynx VPN': v4('10.5.0.2'), 'Wi-Fi': v4('192.168.1.20'), lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
  assert.deepEqual(lanInterface('', ifaces), { address: '192.168.1.20', name: 'Wi-Fi', others: ['172.20.0.1 (vEthernet (WSL))', '10.5.0.2 (NordLynx VPN)'] });
  assert.equal(lanInterface('10.5.0.2', ifaces).name, 'NordLynx VPN', 'server.reviewHost still wins');
  assert.deepEqual(lanInterface('', { 'Docker NAT': v4('10.0.75.1') }), { address: '10.0.75.1', name: 'Docker NAT', others: [] }, 'a virtual one when it is the only one');
});

test('pinnedFetch connects to the checked address, keeps the Host header and never follows a redirect', async (t) => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.headers.host);
    if (req.url === '/r') { res.writeHead(302, { location: '/next' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>ok</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const { port } = srv.address();
  // shop.example.com never resolves here: the request reaches 127.0.0.1 only because the address is pinned.
  const get = pinnedFetch({ address: '127.0.0.1', family: 4 });
  const ok = await get(`http://shop.example.com:${port}/p`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(5000) });
  assert.deepEqual([ok.status, ok.headers.get('content-type'), await ok.text()], [200, 'text/html', '<p>ok</p>']);
  const moved = await get(`http://shop.example.com:${port}/r`, {});
  assert.deepEqual([moved.status, moved.headers.get('location')], [302, '/next']);
  assert.deepEqual(seen, [`shop.example.com:${port}`, `shop.example.com:${port}`]);
});

function request(port, p, { method = 'GET', host = HOST, studio = true, body, headers = {}, cookie, address = '127.0.0.1', hold = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host, ...(studio ? { 'X-Studio': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
    let answered = false;
    const req = http.request({ host: address, port, method, path: p, headers: h, timeout: 10000 }, (res) => {
      answered = true;
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', (e) => { if (!answered) reject(e); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(body);
    if (!hold) req.end();
  });
}

function startServer(t, args = []) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs'), ...args], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 110000,
    env: { ...process.env, MOTION_STUDIO_PORT: String(PORT), MOTION_STUDIO_REVIEW_PORT: String(REVIEW_PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 40000);
    const ready = () => out.includes('Motion Studio UI:') && (!args.includes('--review') || /Review link[^\n]*?http:\/\/\S+|Review link not started/.test(out));
    const on = (d) => { out = (out + d).slice(-20000); if (ready()) { clearTimeout(timer); resolve(() => out); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
}

test('bodies and URLs that are not what a route expects answer 400 or 413, never 500', { timeout: 120000 }, async (t) => {
  const output = await startServer(t, ['--review']);
  const post = (body, o = {}) => request(PORT, '/api/briefs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, ...o });
  for (const body of ['null', '[1]', '5', '"text"']) {
    const r = await post(body);
    assert.equal(r.status, 400, body);
    assert.equal(JSON.parse(r.text).error, 'Body must be a JSON object', body);
  }
  assert.equal(JSON.parse((await post('{bad')).text).error, 'Body must be JSON');

  // Over 256 KB by its Content-Length: the 413 arrives before any of the body is read.
  const big = await post('{', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(300 * 1024) }, hold: true });
  assert.equal(big.status, 413);
  assert.equal(JSON.parse(big.text).error, 'Request body too large');
  assert.equal(big.headers.connection, 'close');
  // Over 256 KB with no length given: read up to the cap, then refused.
  const chunked = await post(`{"a":"${'x'.repeat(256 * 1024)}`, { headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, hold: true });
  assert.equal(chunked.status, 413);

  for (const p of [`/files/${P}/x/%E0%A4%A`, `/assets/${P}/%E0%A4%A`, `/api/projects/${P}/transcripts/%E0%A4%A`]) {
    const r = await request(PORT, p);
    assert.equal(r.status, 400, p);
    assert.equal(JSON.parse(r.text).error, 'Bad %-encoding in the URL', p);
  }

  // An asset prepare copied into the job (the brand logo, an uploaded SVG) must never run or be
  // sniffed as HTML: it goes out with the same sandbox CSP as /assets/<project>/<name>. The
  // composition HTML next to it still needs to run script (the Preview tab reads
  // frame.contentWindow.seek() directly, which a sandboxed iframe would break) and the model3d
  // template fetches its own .glb same-origin, so it gets a same-origin CSP instead of the full
  // sandbox: form-action and frame-src are 'none', so an injected script in the composition cannot
  // open a new top-level target or submit a form out of the page (it can still reach this server's
  // own /api on connect-src 'self' -- confirmed under real Chrome CSP enforcement that 'none' there
  // breaks the model3d .glb fetch, so 'self' is what's left without splitting the composition onto
  // its own origin).
  const dir = jobDir(P, 'x');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><script src="vendor/gsap.min.js"></script></html>');
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor', 'gsap.min.js'), '/* stub */');
  const asset = await request(PORT, `/files/${P}/x/assets/logo.svg`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-security-policy'] || '', /sandbox/);
  assert.equal(asset.headers['x-content-type-options'], 'nosniff');
  const html = await request(PORT, `/files/${P}/x/index.html`);
  assert.equal(html.status, 200);
  const csp = html.headers['content-security-policy'] || '';
  assert.match(csp, /connect-src 'self'/, 'the composition page can fetch its own job assets (model3d\'s .glb)');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-src 'none'/);
  const vendor = await request(PORT, `/files/${P}/x/vendor/gsap.min.js`);
  assert.equal(vendor.status, 200);
  assert.ok(!vendor.headers['content-security-policy'], 'the composition\'s own script file is not sandboxed or CSP-limited itself');

  const local = JSON.parse((await request(PORT, `/api/projects/${P}`)).text);
  assert.ok('generate' in local, 'the local UI still gets the Gemini state');
  const link = /Review link[^\n]*?(http:\/\/\S+)/.exec(output())?.[1];
  if (!link) { t.diagnostic('no private network address: review checks skipped'); return; }
  const u = new URL(link);
  const r = (p, o = {}) => request(REVIEW_PORT, p, { address: u.hostname, host: u.host, studio: false, ...o });
  const cookie = String((await r(u.pathname + u.search)).headers['set-cookie']).split(';')[0];
  const viewed = await r(`/api/projects/${P}`, { cookie });
  assert.equal(viewed.status, 200);
  assert.ok(!('generate' in JSON.parse(viewed.text)), 'no Gemini state over the network');
  for (const word of ['keyEnv', 'hasKey', 'GEMINI', 'acknowledgedAt']) assert.ok(!viewed.text.includes(word), word);
  assert.equal((await r('/files/x/y/%E0%A4%A', { cookie })).status, 400, 'the review link maps a bad %-escape to 400 too');
});
