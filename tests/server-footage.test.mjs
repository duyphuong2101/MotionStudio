import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../engine/core.mjs';
import { reviewRoute } from '../server/review.mjs';

const PORT = 4795;
const HOST = `127.0.0.1:${PORT}`;
const P = 'zz-test-footage-routes';

function request(p, { method = 'GET', studio = true, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: HOST, ...(studio ? { 'X-Studio': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers, timeout: 10000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('the review link reaches no footage route, read or write', () => {
  for (const [m, p] of [
    ['POST', `/api/projects/${P}/footage/a.mp4/clip`], ['POST', `/api/projects/${P}/footage/a.mp4/analyse`], ['POST', `/api/projects/${P}/footage/a.mp4/preview`],
    ['GET', `/api/projects/${P}/footage/a.mp4/clip`], ['GET', `/api/projects/${P}/footage/a.mp4`], ['GET', `/api/projects/${P}/footage/a.mp4/images/1.jpg`],
  ]) assert.equal(reviewRoute(m, p), null, `${m} ${p}`);
});

test('footage routes refuse traversal, cross-site writes and missing assets', { timeout: 60000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 55000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 30000);
    const on = (d) => { out = (out + d).slice(-20000); if (out.includes('Motion Studio UI:')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
  const base = `/api/projects/${P}/footage`;
  const status = async (p, o) => (await request(p, o)).status;

  assert.equal(await status(`${base}/..%2F..%2Fconfig%2Fstudio.json`), 400, 'asset with folders');
  assert.equal(await status(`${base}/a.mp4/images/..%2Fshots.json`), 400, 'image outside thumbs');
  assert.equal(await status(`${base}/a.mp4/images/shots.json`), 400, 'only <n>.jpg and preview.jpg');
  assert.equal(await status(`${base}/a.mp4/images/1.jpg`), 404, 'no thumbnail yet');
  assert.equal(await status(`/api/projects/..%2Fx/footage/a.mp4`), 400, 'project id');
  assert.equal(await status(`${base}/notes.png`), 400, 'not a video');
  assert.equal(await status(`${base}/missing.mp4`), 404);
  assert.equal(await status(`${base}/missing.mp4/clip`, { method: 'POST', studio: false, body: { in: 0, out: 1, name: 'x' } }), 403, 'no X-Studio');
  assert.equal(await status(`${base}/missing.mp4/clip`, { method: 'POST', body: { in: 0, out: 1, name: 'x' } }), 404);
  assert.equal(await status(`${base}/missing.mp4/analyse`, { method: 'POST' }), 404, 'no child for a missing asset');
  const r = await request(`${base}/..%2Fsecret.mp4/clip`, { method: 'POST', body: { in: 0, out: 1, name: '../../evil' } });
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.text).error, /Invalid asset name/);
});
