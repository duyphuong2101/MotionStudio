import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../engine/core.mjs';
import { isPrivateIPv4, lanAddress, reviewRoute, cookieCode, codeMatches, newCode, COOKIE } from '../server/review.mjs';

test('the review link binds only to a private IPv4 of this machine', () => {
  for (const ip of ['10.0.0.5', '172.16.1.2', '172.31.255.1', '192.168.1.20']) assert.ok(isPrivateIPv4(ip), ip);
  for (const ip of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '172.32.0.1', '169.254.1.1', '192.169.0.1', '10.0.0.256', '::1', '']) assert.ok(!isPrivateIPv4(ip), ip);
  const ifaces = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], wifi: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }], pub: [{ family: 'IPv4', address: '8.8.4.4', internal: false }] };
  assert.equal(lanAddress('', ifaces), '192.168.1.20');
  assert.equal(lanAddress('192.168.1.20', ifaces), '192.168.1.20');
  assert.throws(() => lanAddress('0.0.0.0', ifaces), /not a private network address/);
  assert.throws(() => lanAddress('8.8.4.4', ifaces), /not a private network address/);
  assert.throws(() => lanAddress('10.1.1.1', ifaces), /not an address of this machine/);
  assert.throws(() => lanAddress('', { pub: ifaces.pub }), /No private network address/);
});

test('review routes are a GET allowlist: the UI, its reads, job files and brand assets', () => {
  const allowed = {
    '/': 'page', '/index.html': 'page', '/ui/app.js': 'ui', '/ui/app.css': 'ui', '/api/state': 'api', '/api/options': 'api', '/api/director': 'director',
    '/api/templates/promo': 'api', '/api/music/steady-tech': 'api', '/api/jobs': 'api', '/api/jobs/nsc-award/a1-open': 'api', '/api/sequences': 'api',
    '/api/sequences/nsc-award/award-full': 'api', '/api/projects/nsc-award': 'api', '/api/projects/nsc-award/transcripts/clip.mp4': 'api',
    '/files/nsc-award/a1-open/final.mp4': 'files', '/assets/nsc-award/logo.svg': 'assets',
  };
  for (const [p, kind] of Object.entries(allowed)) assert.equal(reviewRoute('GET', p), kind, p);
  assert.equal(reviewRoute('HEAD', '/files/nsc-award/a1-open/final.mp4'), 'files');
  const refused = [
    ['GET', '/api/tts/preview'], ['GET', '/api/generate/models'], ['GET', '/api/jobs/p/j/run'], ['GET', '/api/projects/p/brand'], ['GET', '/api/projects'],
    ['GET', '/api/director/run'], ['GET', '/ui/../server/keys.mjs'], ['GET', '/.env'], ['HEAD', '/api/jobs'], ['HEAD', '/api/director'],
    ['POST', '/api/director/run'], ['POST', '/api/jobs/p/j/approve'], ['POST', '/api/jobs/p/j/run'], ['PUT', '/api/jobs/p/j/script'],
    ['DELETE', '/api/jobs/p/j'], ['POST', '/api/projects/p/generate'], ['POST', '/api/sequences'], ['POST', '/'],
  ];
  for (const [m, p] of refused) assert.equal(reviewRoute(m, p), null, `${m} ${p}`);
});

test('the access code is random per start and read only from its own cookie', () => {
  const code = newCode();
  assert.ok(code.length >= 24 && code !== newCode());
  assert.equal(cookieCode(`a=1; ${COOKIE}=${code}; b=2`), code);
  assert.equal(cookieCode('a=1'), '');
  assert.ok(codeMatches(code, code));
  assert.ok(!codeMatches(code.slice(1), code));
  assert.ok(!codeMatches('', code));
});

function request(port, { method = 'GET', path: p = '/', host, cookie, address = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: address, port, method, path: p, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) }, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

test('a running review link serves views behind its code and refuses everything else', { timeout: 60000 }, async (t) => {
  let ip;
  try { ip = lanAddress(); } catch { t.skip('no private network address on this machine'); return; }
  const mainPort = 4793, reviewPort = 4794;
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs'), '--review'], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 55000,
    env: { ...process.env, MOTION_STUDIO_PORT: String(mainPort), MOTION_STUDIO_REVIEW_PORT: String(reviewPort) },
  });
  t.after(() => child.kill());
  let out = '';
  const link = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no review link in: ${out.slice(0, 2000)}`)), 30000);
    const on = (d) => { out = (out + d).slice(-20000); const m = /Review link[^\n]*?(http:\/\/\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(m[1]); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
  const u = new URL(link);
  assert.equal(u.hostname, ip);
  const host = `${ip}:${reviewPort}`;
  const r = (o) => request(reviewPort, { address: ip, host, ...o });

  assert.equal((await r({ path: '/' })).status, 401, 'no code, no access');
  assert.equal((await r({ path: '/api/jobs' })).status, 401);
  assert.equal((await r({ path: '/?code=wrong' })).status, 401);
  assert.equal((await r({ path: '/', host: `evil.example:${reviewPort}` })).status, 421, 'wrong Host');
  const login = await r({ path: u.pathname + u.search });
  assert.equal(login.status, 302);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  assert.match(String(login.headers['set-cookie']), /HttpOnly; SameSite=Strict/);

  const page = await r({ path: '/', cookie });
  assert.equal(page.status, 200);
  assert.match(page.body, /<html lang="en" data-review="1">/, 'the normal UI, flagged read-only');
  assert.equal((await r({ path: '/ui/app.js', cookie })).status, 200);
  const jobs = await r({ path: '/api/jobs', cookie });
  assert.equal(jobs.status, 200);
  assert.ok(Array.isArray(JSON.parse(jobs.body)));
  const dir = JSON.parse((await r({ path: '/api/director', cookie })).body);
  assert.equal(dir.tail, '', 'no Director log over the network');
  const state = await r({ path: '/api/state', cookie });
  assert.equal(state.status, 200);
  assert.ok(Array.isArray(JSON.parse(state.body).projects));
  assert.ok(!('providers' in JSON.parse(state.body)), 'no provider list over the network');
  for (const word of ['keyEnv', 'hasKey', '_API_KEY']) assert.ok(!state.body.includes(word), word);
  const localState = await request(mainPort, { path: '/api/state', host: `127.0.0.1:${mainPort}` });
  assert.ok(localState.status === 200 && 'providers' in JSON.parse(localState.body), 'the local UI still gets them');

  for (const p of ['/api/tts/preview', '/api/generate/models', '/api/projects/x/brand', '/.env']) {
    assert.equal((await r({ path: p, cookie })).status, 404, `GET ${p}`);
  }
  for (const [method, p] of [['POST', '/api/director/run'], ['POST', '/api/jobs/x/y/approve'], ['PUT', '/api/jobs/x/y/script'], ['DELETE', '/api/jobs/x/y'], ['POST', '/api/projects/x/generate']]) {
    assert.equal((await r({ method, path: p, cookie })).status, 405, `${method} ${p}`);
  }
  // The main UI still answers only on 127.0.0.1 and only to its own Host.
  assert.equal((await request(mainPort, { host: `${ip}:${mainPort}` })).status, 421);
  await assert.rejects(request(mainPort, { address: ip, host: `${ip}:${mainPort}` }));
});
