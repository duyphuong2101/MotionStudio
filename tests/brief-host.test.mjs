import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson, readJson } from '../engine/core.mjs';
import { createProject, validateBrief, saveBrief, updateBrief, loadBrief, listJobs, briefFile, setStatus, getStatus } from '../engine/jobs.mjs';
import { validateBrand, urlCheck } from '../engine/brand.mjs';
import { fail, claim } from '../engine/pipeline.mjs';

const P = 'zz-test-hosts';
const ID = 'cro-16x9';
const brief = (url) => ({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url });
const HOST_MSG = /The brief URL host niteco\.com is not in this brand's allowed hosts\. Add it in Brand → Allowed data hosts, or clear the URL\./;

function seed(t, hosts) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Hosts' });
  const file = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(file, { ...readJson(file), site: 'niteco.com', sources: { allowedHosts: hosts } });
}

test('urlCheck matches the brief host against the allowed list, case-insensitive and exact', () => {
  assert.equal(urlCheck(''), null);
  assert.deepEqual(urlCheck('https://Niteco.com/our-services/', ['niteco.com']), { host: 'niteco.com', allowed: true });
  assert.deepEqual(urlCheck('https://niteco.com/x', ['NITECO.COM']), { host: 'niteco.com', allowed: true });
  assert.deepEqual(urlCheck('https://shop.niteco.com/x', ['niteco.com']), { host: 'shop.niteco.com', allowed: false }, 'no subdomain match');
  assert.deepEqual(urlCheck('https://niteco.com/x', []), { host: 'niteco.com', allowed: false });
  assert.deepEqual(urlCheck('ftp://niteco.com/x', ['niteco.com']), { host: null, allowed: false });
  assert.deepEqual(urlCheck('not a url', ['niteco.com']), { host: null, allowed: false });
});

test('a new brief whose URL host is not allowed is refused with the host and the fix', (t) => {
  seed(t, []);
  assert.throws(() => saveBrief(validateBrief(brief('https://niteco.com/our-services/conversion-rate-optimization/'))), (e) => e.code === 400 && HOST_MSG.test(e.message));
  assert.ok(!fs.existsSync(briefFile(P, ID)), 'nothing is written');
  assert.throws(() => validateBrief(brief('niteco.com/page')), (e) => e.code === 400 && /url must be an http\(s\) URL/.test(e.message), 'an invalid URL has its own message');
});

test('a brief whose URL host is allowed, or without a URL, is saved', (t) => {
  seed(t, ['niteco.com', 'www.niteco.com']);
  assert.equal(saveBrief(validateBrief(brief('https://WWW.niteco.com/x'))).url, 'https://WWW.niteco.com/x');
  fs.unlinkSync(briefFile(P, ID));
  assert.equal(saveBrief(validateBrief(brief(''))).url, '');
});

test('an edit is checked too, but a stored brief with a refused host still loads', (t) => {
  seed(t, []);
  writeJson(briefFile(P, ID), validateBrief(brief('https://niteco.com/x')));
  assert.equal(loadBrief(P, ID).url, 'https://niteco.com/x');
  assert.deepEqual(listJobs(P).map((j) => j.brief.id), [ID]);
  assert.throws(() => updateBrief(P, ID, brief('https://niteco.com/x')), HOST_MSG);
  assert.equal(updateBrief(P, ID, brief('')).changed.join(), 'url', 'clearing the URL saves');
});

test('an empty host list follows the site on save; a typed list stays', () => {
  const base = JSON.parse(fs.readFileSync(path.join(DIRS.profiles, 'nsc', 'brand.json'), 'utf8'));
  assert.deepEqual(validateBrand({ ...base, site: 'https://www.Niteco.com/en', sources: { allowedHosts: [] } }).sources.allowedHosts, ['www.niteco.com', 'niteco.com']);
  assert.deepEqual(validateBrand({ ...base, site: 'niteco.com', sources: undefined }).sources.allowedHosts, ['niteco.com', 'www.niteco.com']);
  assert.deepEqual(validateBrand({ ...base, site: 'niteco.com', sources: { allowedHosts: ['cdn.example.com'] } }).sources.allowedHosts, ['cdn.example.com']);
  assert.deepEqual(validateBrand({ ...base, site: '', sources: { allowedHosts: [] } }).sources.allowedHosts, []);
  assert.deepEqual(validateBrand({ ...base, site: 'not a host!', sources: { allowedHosts: [] } }).sources.allowedHosts, [], 'a site that is no host name adds nothing');
});

/* ---------- the Director sees the host problem and fails the job ---------- */
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true });
const cliError = (...args) => {
  try { cli(...args); } catch (e) { return String(e.stderr); }
  return '';
};
// A stored brief from before the host check: the case the Director has to stop.
const storedJob = (t, url) => { seed(t, []); writeJson(briefFile(P, ID), validateBrief(brief(url))); };

test('cli context reports whether the brief URL host is allowed', (t) => {
  storedJob(t, 'https://niteco.com/our-services/');
  assert.deepEqual(JSON.parse(cli('context', P, ID)).urlCheck, { host: 'niteco.com', allowed: false });
  writeJson(briefFile(P, ID), validateBrief(brief('')));
  assert.equal(JSON.parse(cli('context', P, ID)).urlCheck, null);
});

test('cli fail puts a job before review into error with a clean, capped reason', (t) => {
  storedJob(t, 'https://niteco.com/x');
  const out = cli('fail', P, ID, '--reason', 'Host niteco.com is not allowed.\nAdd it in Brand.\x07', '--by', 'claude-seat');
  assert.equal(out.trim(), 'error: Host niteco.com is not allowed. Add it in Brand.');
  const st = getStatus(P, ID);
  assert.equal(st.status, 'error');
  assert.equal(st.error, 'Host niteco.com is not allowed. Add it in Brand.');
  assert.deepEqual([st.history.at(-1).by, st.history.at(-1).event], ['claude-seat', `failed by director: ${st.error}`]);
  for (const status of ['scripting', 'scripted', 'dirty']) {
    setStatus(P, ID, { status }, 'test');
    assert.equal(fail(P, ID, 'x'.repeat(400), 'claude-seat').error.length, 300);
  }
});

test('fail needs a reason and is refused once a person reviews or a render runs', (t) => {
  storedJob(t, '');
  assert.match(cliError('fail', P, ID), /Give the reason: --reason/);
  assert.throws(() => fail(P, ID, ' \n\t', 'claude-seat'), (e) => e.code === 400);
  for (const status of ['preparing', 'awaiting_review', 'approved', 'rendering', 'done', 'error']) {
    setStatus(P, ID, { status }, 'test');
    assert.throws(() => fail(P, ID, 'stop', 'claude-seat'), (e) => e.code === 409 && e.message.includes(`"${status}"`), status);
  }
  assert.throws(() => fail(P, '../x', 'stop', 'claude-seat'), /Invalid job/);
});

test('after the person fixes the hosts, Run Director can claim the failed job again', (t) => {
  storedJob(t, 'https://niteco.com/x');
  fail(P, ID, 'Host niteco.com is not allowed.', 'claude-seat');
  const file = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(file, { ...readJson(file), sources: { allowedHosts: ['niteco.com'] } });
  assert.deepEqual(JSON.parse(cli('context', P, ID)).urlCheck, { host: 'niteco.com', allowed: true });
  const st = claim(P, ID, 'claude-seat');
  assert.deepEqual([st.status, st.error], ['scripting', null]);
});
