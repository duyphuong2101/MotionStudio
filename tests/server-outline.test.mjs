import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS, writeJson, readJson } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, setStatus, jobFile } from '../engine/jobs.mjs';
import { commit } from '../engine/pipeline.mjs';

// The job route returns the outline a quick-mode script was built from (plan quick-video T13), read-only,
// on the local UI and on the review link; every other job's detail has no `outline` key.
const PORT = 4807, REVIEW_PORT = 4808;
const HOST = `127.0.0.1:${PORT}`;
const P = 'zz-test-server-outline';
const wipe = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(wipe);
wipe();
createProject({ id: P, name: 'Outline Route' });

const SOURCE = {
  name: 'MegaMax Classic',
  bullets: [
    { text: 'MegaMax Classic is back', ref: 'https://example.com/megamax' },
    { text: 'Up to 12 hours dry', ref: 'https://example.com/megamax' },
    { text: 'Free shipping on every order over $30', ref: 'https://example.com/shipping' },
  ],
  facts: [{ text: '30-day returns, no questions', ref: 'brief.facts[0]' }],
};
const OUTLINE = {
  mood: 'energetic',
  headline: { text: 'MegaMax Classic is back', source: 'bullets[0]' },
  points: [
    { label: 'Absorbency', text: 'Up to 12 hours dry', say: 'Twelve hours of protection, day or night.', source: 'bullets[1]' },
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'Easy returns', text: '30 days, no questions', source: 'facts[0]' },
  ],
  cta: { text: 'Try it today', button: 'Shop now' },
};

function seed(id, quick) {
  saveBrief(validateBrief({ project: P, id, template: 'explainer', format: '16:9', duration: 30, message: 'm', ...(quick ? { quick: true } : {}) }));
  setStatus(P, id, { status: 'scripting', step: 4 }, 'test');
  writeJson(jobFile(P, id, 'source.json'), { ...SOURCE, locks: {} });
}

// A quick job after an outline commit; a plain job whose script was not built from an outline, with a stray outline.json.
seed('quick', true);
writeJson(jobFile(P, 'quick', 'outline.draft.json'), OUTLINE);
commit(P, 'quick', 'outline', 'director');
seed('plain', false);
const { generated, ...full } = readJson(jobFile(P, 'quick', 'script.json'));
assert.equal(generated, 'outline');
writeJson(jobFile(P, 'plain', 'script.json'), full);
writeJson(jobFile(P, 'plain', 'outline.json'), OUTLINE);

function request(port, p, { method = 'GET', host = HOST, studio = true, body, cookie, address = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: host, ...(studio ? { 'X-Studio': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) };
    const req = http.request({ host: address, port, method, path: p, headers, timeout: 10000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

function startServer(t) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs'), '--review'], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 110000,
    env: { ...process.env, MOTION_STUDIO_PORT: String(PORT), MOTION_STUDIO_REVIEW_PORT: String(REVIEW_PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 40000);
    const ready = () => out.includes('Motion Studio UI:') && /Review link[^\n]*?http:\/\/\S+|Review link not started/.test(out);
    const on = (d) => { out = (out + d).slice(-20000); if (ready()) { clearTimeout(timer); resolve(() => out); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
}

test('the job route returns the outline of a generated script, read-only on the review link, and no outline otherwise', { timeout: 120000 }, async (t) => {
  const output = await startServer(t);
  const job = (id) => request(PORT, `/api/jobs/${P}/${id}`);

  const quick = await job('quick');
  assert.equal(quick.status, 200);
  assert.equal(quick.json.script.generated, 'outline');
  assert.deepEqual(quick.json.outline, OUTLINE);

  const plain = await job('plain');
  assert.equal(plain.status, 200);
  assert.equal('outline' in plain.json, false, 'a script not built from an outline shows none, even with an outline.json beside it');

  // Nothing in the UI edits the outline, so a broken file hides the panel and the job still opens.
  fs.writeFileSync(jobFile(P, 'quick', 'outline.json'), '{ not json');
  const broken = await job('quick');
  assert.equal(broken.status, 200);
  assert.equal('outline' in broken.json, false);
  writeJson(jobFile(P, 'quick', 'outline.json'), OUTLINE);

  const link = /Review link[^\n]*?(http:\/\/\S+)/.exec(output())?.[1];
  if (!link) { t.diagnostic('no private network address: review link checks skipped'); return; }
  const u = new URL(link);
  const r = (p, o = {}) => request(REVIEW_PORT, p, { address: u.hostname, host: u.host, studio: false, ...o });
  const cookie = String((await r(u.pathname + u.search)).headers['set-cookie']).split(';')[0];
  const viewed = await r(`/api/jobs/${P}/quick`, { cookie });
  assert.equal(viewed.status, 200);
  assert.deepEqual(viewed.json.outline, OUTLINE);
  assert.equal('outline' in (await r(`/api/jobs/${P}/plain`, { cookie })).json, false);
  for (const [method, p] of [['PUT', `/api/jobs/${P}/quick/script`], ['POST', `/api/jobs/${P}/quick/prepare`], ['GET', `/files/${P}/quick/outline.json`]]) {
    const res = await r(p, { method, cookie, ...(method === 'GET' ? {} : { body: {} }) });
    assert.ok([404, 405].includes(res.status), `${method} ${p} → ${res.status}`);
  }
  assert.deepEqual(readJson(jobFile(P, 'quick', 'outline.json')), OUTLINE, 'the review link changed nothing');
});
