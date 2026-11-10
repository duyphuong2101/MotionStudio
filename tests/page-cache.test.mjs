import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageCache, checkerStamp } from './helpers/page-cache.mjs';

// The page cache behind the slow play-through sweeps: a page is skipped only when the same HTML passed with the same
// checker before.
const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pagecache-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('a page that passed is skipped next run; a changed page, a changed checker or a failed page plays again', (t) => {
  const dir = tmp(t);
  const first = pageCache('play-x', 'stamp-1', { dir, all: false });
  assert.equal(first.passed('explainer|16:9', '<a>'), false, 'nothing is known on the first run');
  first.pass('explainer|16:9', '<a>');
  first.pass('promo|16:9', '<p>');
  first.save();

  const second = pageCache('play-x', 'stamp-1', { dir, all: false });
  assert.equal(second.passed('explainer|16:9', '<a>'), true, 'same page, same checker');
  assert.equal(second.passed('promo|16:9', '<p2>'), false, 'the page changed');
  assert.equal(second.passed('new|16:9', '<n>'), false, 'a page never played');
  second.save();

  const third = pageCache('play-x', 'stamp-1', { dir, all: false });
  assert.equal(third.passed('explainer|16:9', '<a>'), true, 'a skipped page stays recorded');
  assert.equal(third.passed('promo|16:9', '<p>'), false, 'a page that did not pass again is forgotten, old HTML included');

  assert.equal(pageCache('play-x', 'stamp-2', { dir, all: false }).passed('explainer|16:9', '<a>'), false, 'the checker changed');
  assert.equal(pageCache('play-x', 'stamp-1', { dir, all: true }).passed('explainer|16:9', '<a>'), false, 'play-all ignores the cache');
  assert.equal(pageCache('play-y', 'stamp-1', { dir, all: false }).passed('explainer|16:9', '<a>'), false, 'each name has its own file');
  assert.throws(() => pageCache('../x', 's', { dir }), /page cache name/);
});

test('a broken cache file reads as empty', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'play-x.json'), '{ not json');
  assert.equal(pageCache('play-x', 's', { dir, all: false }).passed('a|16:9', '<a>'), false);
});

test('the checker stamp follows its files, the caller settings and nothing else; line endings do not count', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'a.mjs'), 'one\ntwo\n');
  const stamp = (extra = []) => checkerStamp(extra, { root, files: ['a.mjs'], packages: ['gsap'] });
  const base = stamp();
  assert.match(base, /^[0-9a-f]{40}$/);
  assert.equal(stamp(), base);
  fs.writeFileSync(path.join(root, 'a.mjs'), 'one\r\ntwo\r\n');
  assert.equal(stamp(), base, 'CRLF and LF checkouts share a stamp');
  assert.notEqual(stamp([1 / 6]), base, 'a setting of the caller');
  fs.writeFileSync(path.join(root, 'a.mjs'), 'one\nthree\n');
  assert.notEqual(stamp(), base, 'the checker file changed');
  assert.match(checkerStamp(), /^[0-9a-f]{40}$/, 'the real checker files all exist');
});
