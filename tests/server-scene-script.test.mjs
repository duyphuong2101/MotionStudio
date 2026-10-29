// New from script on a live server (port 4811): cross-site writes refused, a check that writes nothing, a refused
// import that names its scene, a created job; the review link never reaches the route.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS, within } from '../engine/core.mjs';
import { createProject, getStatus } from '../engine/jobs.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { reviewRoute } from '../server/review.mjs';

const PORT = 4811;
const HOST = `127.0.0.1:${PORT}`;
const P = 'zz-test-server-scene-script';
const URL_ = `/api/projects/${P}/scene-script`;
const wipe = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(wipe);
wipe();
createProject({ id: P, name: 'Scene script server' });

const SCRIPT = 'TITLE: Route test\nVOICE: One clip.\nFORMAT: 9:16\n\nSCENE 1 — ONLY (0–3 seconds)\nCLIP: clip.mp4\nVOICE: The only clip.\n';

function request(p, { method = 'GET', studio = true, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: HOST, ...(studio ? { 'X-Studio': '1' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h, timeout: 60000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function startServer(t) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 170000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
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

test('the review link never reaches New from script', () => {
  assert.equal(reviewRoute('POST', URL_), null);
  assert.equal(reviewRoute('GET', URL_), null);
});

test('POST scene-script: refused cross-site, checked without writing, refused naming the scene, then created', { timeout: 180000 }, async (t) => {
  await startServer(t);
  const body = { text: SCRIPT, file: 'route.txt' };
  assert.equal((await request(URL_, { method: 'POST', studio: false, body })).status, 403, 'no X-Studio header');
  assert.equal((await request(URL_, { method: 'POST', body, headers: { Origin: 'http://evil.example' } })).status, 403, 'a foreign Origin');
  assert.equal((await request('/api/projects/Bad_Id/scene-script', { method: 'POST', body })).status, 400);
  assert.equal((await request(URL_, { method: 'POST', body: { text: '' } })).status, 400);

  // Before the clip is uploaded: the check names the scene and the file, and nothing is written.
  const missing = await request(URL_, { method: 'POST', body: { ...body, check: true } });
  assert.equal(missing.status, 200, missing.text);
  const m = missing.json();
  assert.deepEqual(m.errors, ['Scene 1: clip.mp4 is not in the project assets: upload it, then check again']);
  assert.deepEqual(m.rows.map((r) => r.at), ['Title card', 'Scene 1']);
  const refused = await request(URL_, { method: 'POST', body });
  assert.equal(refused.status, 400);
  assert.match(refused.json().error, /^The scene script has 1 problem\(s\):\n- Scene 1: clip\.mp4 is not in the project assets/);
  assert.ok(!fs.existsSync(within(DIRS.briefs, P, 'route-test.json')), 'nothing written');

  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', within(DIRS.profiles, P, 'assets', 'clip.mp4')], { timeoutMs: 60000 });
  const ok = await request(URL_, { method: 'POST', body: { ...body, check: true } });
  assert.deepEqual([ok.json().errors, ok.json().id, ok.json().format], [[], 'route-test', '9:16']);
  const made = await request(URL_, { method: 'POST', body: { ...body, job: 'route-job' }, headers: { Origin: `http://${HOST}` } });
  assert.equal(made.status, 201, made.text);
  assert.deepEqual([made.json().brief.id, made.json().script.generated], ['route-job', 'scene-script']);
  assert.equal(getStatus(P, 'route-job').status, 'scripted');
  const again = await request(URL_, { method: 'POST', body: { ...body, job: 'route-job' } });
  assert.equal(again.status, 409);
});
