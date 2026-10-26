import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS } from '../engine/core.mjs';
import { createProject } from '../engine/jobs.mjs';

const PORT = 4806;
const HOST = `127.0.0.1:${PORT}`;
const P = 'zz-test-server-banner';
const wipe = () => ['profiles', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(wipe);
wipe();
createProject({ id: P, name: 'Banner server' });

function request(p, { method = 'GET', studio = true, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: HOST, ...(studio ? { 'X-Studio': '1' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h, timeout: 10000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function startServer(t) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 110000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 40000);
    const on = (d) => { out = (out + d).slice(-20000); if (out.includes('Motion Studio UI:')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
}

test('the banner route writes one page and serves it sandboxed; cross-site and bad input are refused', { timeout: 120000 }, async (t) => {
  await startServer(t);
  const url = `/api/projects/${P}/banner`;
  const ok = { backdrop: 'aurora', size: '1440x480', headline: '<i>Hi</i>', parallax: true };

  assert.equal((await request(url, { method: 'POST', studio: false, body: ok })).status, 403, 'no X-Studio header');
  const foreign = await request(url, { method: 'POST', body: ok, headers: { Origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403, 'a foreign Origin');
  assert.equal(JSON.parse(foreign.text).error, 'Cross-site request refused');
  assert.ok(!fs.existsSync(path.join(DIRS.out, P, '_banner')), 'nothing written for a refused request');

  const badId = await request('/api/projects/Bad_Id/banner', { method: 'POST', body: ok });
  assert.equal(badId.status, 400);
  assert.match(JSON.parse(badId.text).error, /Invalid project/);
  const unknown = await request('/api/projects/zz-no-such-project/banner', { method: 'POST', body: ok });
  assert.equal(unknown.status, 404);
  assert.match(JSON.parse(unknown.text).error, /has no brand/);
  for (const [body, re] of [[{ size: '999x999' }, /Size must be one of/], [{ backdrop: 'plasma' }, /Backdrop must be one of/], [{ button: 'x'.repeat(25) }, /at most 24 characters/]]) {
    const r = await request(url, { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(JSON.parse(r.text).error, re);
  }

  const made = await request(url, { method: 'POST', body: ok, headers: { Origin: `http://${HOST}` } });
  assert.equal(made.status, 201, made.text);
  assert.deepEqual(JSON.parse(made.text), { path: `out/${P}/_banner/aurora-1440x480.html`, url: `/banner/${P}/aurora-1440x480.html` });

  const page = await request(`/banner/${P}/aurora-1440x480.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.headers['content-security-policy'], /sandbox allow-scripts$/);
  assert.ok(!page.headers['content-security-policy'].includes('allow-same-origin'), 'the page never runs as the UI origin');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.ok(page.text.includes('<h1 class="hb-h">&lt;i&gt;Hi&lt;/i&gt;</h1>'));

  for (const p of [`/banner/${P}/..%2F..%2Fpackage.json`, `/banner/${P}/brand.json`, `/banner/${P}/mesh-1920x600.html`, '/banner/Bad_Id/mesh-1920x600.html']) {
    assert.ok([400, 404].includes((await request(p)).status), p);
  }
  const options = JSON.parse((await request('/api/options')).text);
  assert.deepEqual(options.banner.sizes, ['1920x600', '1920x1080', '1440x480', '1080x1080']);
  assert.deepEqual(options.banner.limits, { headline: 60, subline: 120, button: 24 });
});
