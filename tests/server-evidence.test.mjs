import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../engine/core.mjs';
import { MAX_CSV_BYTES } from '../engine/evidence.mjs';
import { reviewRoute } from '../server/review.mjs';

const PORT = 4796;
const HOST = `127.0.0.1:${PORT}`;

function request(p, { method = 'GET', studio = true, json, raw } = {}) {
  return new Promise((resolve, reject) => {
    const body = json ? JSON.stringify(json) : raw;
    const headers = {
      Host: HOST, ...(studio ? { 'X-Studio': '1' } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    };
    let answered = false;
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers, timeout: 20000 }, (res) => {
      answered = true;
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    // A refused oversize upload may close the socket while the body is still going out.
    req.on('error', (err) => { if (!answered) reject(err); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

test('the review link reaches no evidence route, read or write', () => {
  for (const [m, p] of [['GET', '/api/evidence'], ['POST', '/api/evidence/git'], ['POST', '/api/evidence/csv'], ['GET', '/api/evidence/git'], ['HEAD', '/api/evidence']]) {
    assert.equal(reviewRoute(m, p), null, `${m} ${p}`);
  }
});

test('evidence routes: repo aliases only, validation before any child, CSV only and capped, never stored', { timeout: 90000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 85000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 30000);
    const on = (d) => { out = (out + d).slice(-20000); if (out.includes('Motion Studio UI:')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });

  const cfg = await request('/api/evidence');
  assert.equal(cfg.status, 200);
  assert.ok(Array.isArray(cfg.data.repos));
  assert.ok(!JSON.stringify(cfg.data).includes(':/') && !JSON.stringify(cfg.data).includes(':\\\\'), 'aliases only, no folder paths');

  const git = (json, o) => request('/api/evidence/git', { method: 'POST', json, ...o });
  assert.equal((await git({ repo: 'zz-nope', tickets: 'OP-1' }, { studio: false })).status, 403, 'no X-Studio');
  const unknown = await git({ repo: 'zz-nope', tickets: 'OP-1' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /Unknown repo "zz-nope"/);
  assert.match((await git({ repo: 'C:/Windows', tickets: 'OP-1' })).data.error, /Invalid repo alias/);
  const badTicket = await git({ repo: 'zz-nope', tickets: 'OP-1,--output=x' });
  assert.equal(badTicket.status, 400);
  assert.match(badTicket.data.error, /Invalid ticket id/);
  assert.match((await git({ repo: 'zz-nope', grep: '--all' })).data.error, /cannot start with a dash/);

  const csv = (q, raw, o) => request(`/api/evidence/csv?${new URLSearchParams(q)}`, { method: 'POST', raw, ...o });
  const text = 'Year month,Revenue\n202501,"1,000"\n202601,"1,100"\n';
  assert.equal((await csv({ name: 'a.csv' }, text, { studio: false })).status, 403, 'no X-Studio');
  assert.equal((await csv({ name: 'notes.txt' }, text)).status, 415, 'CSV only');
  const big = await csv({ name: 'big.csv' }, Buffer.alloc(MAX_CSV_BYTES + 1, 0x31));
  assert.equal(big.status, 413);
  assert.match(big.data.error, /larger than 5 MB/);
  const cols = await csv({ name: '../../x.csv' }, text);
  assert.equal(cols.status, 200);
  assert.equal(cols.data.file, 'x.csv', 'the name is only shown, as a base name');
  assert.deepEqual(cols.data.columns, ['Year month', 'Revenue']);
  const q = new URLSearchParams({ name: 'ga4.csv', date: 'Year month', value: 'Revenue' });
  q.append('range', '2025-01..2025-01');
  q.append('range', '2026-01..2026-01');
  const r = await request(`/api/evidence/csv?${q}`, { method: 'POST', raw: text });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.lines, ['- Revenue Jan 2026 vs Jan 2025: 1,100 vs 1,000, up 10% (ga4.csv, column Revenue).']);
  const missing = await csv({ name: 'ga4.csv', date: 'Day', value: 'Revenue', range: '2025-01..2025-01' }, text);
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /Column not found: Day/);
});
