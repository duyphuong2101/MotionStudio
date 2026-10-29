import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  gitEvidence, gitSearch, resolveRepo, aliasForPath, releaseBranches, changeTitle, csvRecords, csvTables, csvColumns, csvEvidence,
  parseNumber, parseDate, parseRange, growth, readCsvFile, decodeCsv, MAX_CSV_BYTES,
} from '../engine/evidence.mjs';

/* ---------- a temporary repo: main with ticket commits, release branches cut from points in its history ---------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-evidence-'));
const src = path.join(tmp, 'src');
const clone = path.join(tmp, 'clone');
const run = (cwd, args, date) => {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, env, shell: false, windowsHide: true, timeout: 30000, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const commit = (msg, date) => run(src, ['commit', '-q', '--allow-empty', '-m', msg], `${date}T10:00:00+00:00`);

fs.mkdirSync(src);
run(src, ['init', '-q']);
run(src, ['checkout', '-q', '-b', 'main']);
commit('Initial commit', '2026-01-01');
commit('OP-1: add catalog feed', '2026-01-10');
run(src, ['branch', 'release/sprint-2']);
commit('Merged PR 12: OP-2: build export', '2026-02-01');
commit('OP-20 unrelated work', '2026-02-05');
run(src, ['branch', 'release/sprint-10']);
commit('OP-3 not shipped yet', '2026-03-01');
run(src, ['branch', 'hotfix/release-1']);
run(tmp, ['clone', '-q', src, clone]);

const EV = { repos: { src, clone }, releasePattern: 'release/', maxCommits: 300, timeoutSeconds: 30 };
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a ticket gets its first release branch in natural order, from remote branches of a clone', async () => {
  const r = await gitEvidence('clone', { tickets: 'OP-1' }, EV);
  const row = r.rows[0];
  assert.equal(row.found, true);
  assert.equal(row.release, 'release/sprint-2', 'sprint-2 comes before sprint-10');
  assert.equal(row.releases, 2);
  assert.deepEqual(r.lines, ['- OP-1 add catalog feed: committed 2026-01-10, first released in release/sprint-2 (CLONE repo, git).']);
});

test('local release branches count too', async () => {
  const r = await gitEvidence('src', { tickets: ['OP-1'] }, EV);
  assert.equal(r.rows[0].release, 'release/sprint-2');
});

test('a PR merge gives the title and merge date; OP-20 is not OP-2', async () => {
  const r = await gitEvidence('clone', { tickets: 'op-2' }, EV);
  const row = r.rows[0];
  assert.equal(row.term, 'OP-2');
  assert.equal(row.commits.length, 1);
  assert.equal(row.merged.date, '2026-02-01');
  assert.equal(row.date, '2026-02-01');
  assert.equal(row.line, '- OP-2 build export: merged 2026-02-01, first released in release/sprint-10 (CLONE repo, git).');
});

test('a ticket in no release branch says so; a branch merely named like a release does not count', async () => {
  const r = await gitEvidence('clone', { tickets: 'OP-3' }, EV);
  assert.equal(r.rows[0].release, null);
  assert.match(r.lines[0], /^- OP-3 not shipped yet: committed 2026-03-01, not in any release branch \(CLONE repo, git\)\.$/);
});

test('an unknown ticket is reported without a fact line', async () => {
  const r = await gitEvidence('clone', { tickets: 'OP-999' }, EV);
  assert.equal(r.rows[0].found, false);
  assert.deepEqual(r.lines, []);
});

test('grep is a fixed, case-insensitive string; since and until bound the commits', async () => {
  const g = await gitEvidence('clone', { grep: 'CATALOG' }, EV);
  assert.equal(g.rows[0].commits[0].subject, 'OP-1: add catalog feed');
  const later = await gitEvidence('clone', { tickets: 'OP-1,OP-3', since: '2026-02-15' }, EV);
  assert.deepEqual(later.rows.map((x) => x.found), [false, true]);
  const until = await gitEvidence('clone', { tickets: 'OP-3', until: '2026-02-28' }, EV);
  assert.equal(until.rows[0].found, false);
});

test('the commit cap stops the search and says so', async () => {
  const r = await gitEvidence('clone', { tickets: 'OP-1,OP-3', max: 1 }, EV);
  assert.equal(r.cap, 1);
  assert.equal(r.capped, true);
  assert.equal(r.rows[1].skipped, true);
  const big = await gitEvidence('clone', { tickets: 'OP-1', max: 10000 }, EV);
  assert.equal(big.cap, 300, 'never above evidence.maxCommits');
});

test('only configured aliases resolve; a raw path never does', () => {
  assert.throws(() => resolveRepo('nope', EV), /Unknown repo "nope"/);
  assert.throws(() => resolveRepo(src, EV), /Invalid repo alias/);
  assert.throws(() => resolveRepo('../src', EV), /Invalid repo alias/);
  assert.throws(() => resolveRepo('constructor', EV), /Unknown repo/);
  assert.throws(() => resolveRepo('gone', { ...EV, repos: { gone: path.join(tmp, 'missing') } }), /does not exist/);
  assert.equal(resolveRepo('src', EV), src);
  assert.equal(aliasForPath(path.join(src, '.'), EV), 'src');
  assert.throws(() => aliasForPath(tmp, EV), /--repo-path must be one of the paths/);
});

test('ticket ids, grep text and dates are validated before git runs', () => {
  for (const bad of ['OP1', 'OP-', 'op-1;rm -rf', '--all', 'OP-1 OR 1', '1-2']) {
    assert.throws(() => gitSearch({ tickets: [bad] }, EV), (e) => e.code === 400 && /Invalid ticket id/.test(e.message), bad);
  }
  assert.deepEqual(gitSearch({ tickets: 'op-1, OP-2;OP-1' }, EV).tickets, ['OP-1', 'OP-2']);
  assert.throws(() => gitSearch({}, EV), /Give ticket ids or a grep text/);
  assert.throws(() => gitSearch({ grep: '--output=x' }, EV), /cannot start with a dash/);
  assert.throws(() => gitSearch({ grep: 'a\nb' }, EV), /one line/);
  assert.throws(() => gitSearch({ grep: 'x', since: 'last week' }, EV), /since must be a date/);
  assert.throws(() => gitSearch({ grep: 'x', since: '2026-03-01', until: '2026-01-01' }, EV), /on or before/);
  assert.throws(() => gitSearch({ tickets: Array.from({ length: 31 }, (_, i) => `OP-${i}`) }, EV), /At most 30/);
});

test('release branches: heads and remotes, release pattern only, natural order', () => {
  const refs = 'refs/remotes/origin/HEAD\nrefs/remotes/origin/release/sprint-110\nrefs/heads/release/sprint-109\nrefs/remotes/origin/release/sprint-109\nrefs/remotes/origin/bugfix/release-x\nrefs/heads/main\n';
  assert.deepEqual(releaseBranches(refs, 'release/'), ['release/sprint-109', 'release/sprint-110']);
});

test('change titles drop PR prefixes and keep the ticket in front', () => {
  assert.equal(changeTitle({ subject: 'Merged PR 5404: Merged PR 5403: OP-8254: refactor code', body: '' }, 'OP-8254'), 'OP-8254 refactor code');
  assert.equal(changeTitle({ subject: 'Merge pull request #3 from org/feature-x', body: 'Add the feed\n\nmore' }, 'OP-5'), 'OP-5 Add the feed');
  assert.equal(changeTitle({ subject: 'Fix OP-7 in checkout', body: '' }, 'OP-7'), 'Fix OP-7 in checkout');
  assert.equal(changeTitle({ subject: 'Catalog feed', body: '' }, null), 'Catalog feed');
});

/* ---------- CSV ---------- */

const GA4 = [
  '# ----------------------------------------',
  '# Ecommerce purchases: Year month',
  '# Account: Example',
  '# ----------------------------------------',
  '',
  'Year month,Purchase revenue,Sessions,"Channel, group"',
  '202501,"1,000.50",100,Organic',
  '202502,"2,000",200,"Paid ""search"""',
  '202601,"1,500.50",150,Organic',
  '202602,"2,500",250,Organic',
  '202603,99,1,Organic',
  '',
  '# Second table',
  'Date,Users',
  '20250101,5',
].join('\r\n');

test('CSV parsing: comment lines, quoted commas and quotes, CRLF, several tables', () => {
  const tables = csvTables(GA4);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].columns, ['Year month', 'Purchase revenue', 'Sessions', 'Channel, group']);
  assert.equal(tables[0].rows[1][3], 'Paid "search"');
  assert.equal(tables[0].rows.length, 5);
  assert.deepEqual(tables[1].columns, ['Date', 'Users']);
  assert.deepEqual(csvRecords('a;b\n"x\ny";2\n'), [['a', 'b'], ['x\ny', '2']], 'semicolon file, newline inside quotes');
});

test('a "#" row inside a table is data, so a page path never splits the table; a header comment with a comma is still a comment', () => {
  const csv = ['# Account: Acme, Inc.', '', 'Page,Date,Sessions', '/home,20250101,10', '#/checkout,20250102,20', '/cart,20250103,30'].join('\n');
  const tables = csvTables(csv);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].columns, ['Page', 'Date', 'Sessions']);
  assert.deepEqual(tables[0].rows.map((r) => r[2]), ['10', '20', '30'], 'every row sums, not only the ones above the # row');
});

test('CSV column guesses for the pickers', () => {
  const c = csvColumns(GA4);
  assert.equal(c.rows, 5);
  assert.deepEqual(c.dateColumns, ['Year month']);
  assert.ok(c.numberColumns.includes('Purchase revenue') && c.numberColumns.includes('Sessions'));
  assert.ok(!c.numberColumns.includes('Channel, group'));
});

test('numbers and dates as exports write them', () => {
  assert.equal(parseNumber('12,258,510'), 12258510);
  assert.equal(parseNumber('"$1,234.50"'.replace(/"/g, '')), 1234.5);
  assert.equal(parseNumber('9.7%'), 9.7);
  assert.equal(parseNumber('(42)'), -42);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('n/a')));
  assert.ok(Number.isNaN(parseNumber('1,23')), 'not a thousands group');
  assert.deepEqual(parseDate('202502'), { from: 20250201, to: 20250228, month: true });
  assert.deepEqual(parseDate('20240229'), { from: 20240229, to: 20240229, month: false });
  assert.deepEqual(parseDate('2026-09-30T10:00:00Z'), { from: 20260930, to: 20260930, month: false });
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('202513'), null);
  assert.equal(parseDate('Total'), null);
});

test('range labels', () => {
  assert.equal(parseRange('2025-01..2025-09').label, 'Jan-Sep 2025');
  assert.equal(parseRange('2025-11..2026-02').label, 'Nov 2025-Feb 2026');
  assert.equal(parseRange('202603..202603').label, 'Mar 2026');
  assert.equal(parseRange('2026-01-01..2026-03-31').label, 'Jan-Mar 2026');
  assert.equal(parseRange('2026-01-05..2026-02-03').label, '2026-01-05 to 2026-02-03');
  assert.throws(() => parseRange('2025-09..2025-01'), /ends before it starts/);
  assert.throws(() => parseRange('2025'), /must look like/);
});

test('growth maths', () => {
  assert.equal(growth(11178103, 12258510), 9.7);
  assert.equal(growth(200, 150), -25);
  assert.equal(growth(100, 100), 0);
  assert.equal(growth(0, 5), null);
});

test('range sums, growth and the fact line', () => {
  const r = csvEvidence(GA4, { file: 'C:/exports/ga4-export.csv', dateCol: 'Year month', valueCols: 'Purchase revenue,Sessions', ranges: ['2025-01..2025-02', '2026-01..2026-02'], prefix: '$' });
  assert.deepEqual(r.ranges.map((x) => [x.label, x.rows]), [['Jan-Feb 2025', 2], ['Jan-Feb 2026', 2]]);
  const rev = r.rows.find((x) => x.column === 'Purchase revenue');
  assert.deepEqual(rev.totals, [3000.5, 4000.5]);
  assert.equal(rev.growth, 33.3);
  assert.equal(r.lines[0], '- Purchase revenue Jan-Feb 2026 vs Jan-Feb 2025: $4,001 vs $3,001, up 33.3% (ga4-export.csv, column Purchase revenue).');
  assert.equal(r.lines[1], '- Sessions Jan-Feb 2026 vs Jan-Feb 2025: 400 vs 300, up 33.3% (ga4-export.csv, column Sessions).', 'the sign stays off a count');
  const signed = csvEvidence('Date,Sales\n20250101,€10\n', { dateCol: 'Date', valueCols: ['Sales'], ranges: ['2025-01..2025-01'], prefix: '$' });
  assert.equal(signed.lines[0], '- Sales Jan 2025: €10 (upload.csv, column Sales).', 'the sign in the cells wins');
});

test('one range gives a total; a group splits it; an empty range gives no line', () => {
  const one = csvEvidence(GA4, { file: 'ga4.csv', dateCol: 'Year month', valueCols: ['Sessions'], ranges: ['2026-01..2026-03'] });
  assert.deepEqual(one.lines, ['- Sessions Jan-Mar 2026: 401 (ga4.csv, column Sessions).']);
  const g = csvEvidence(GA4, { file: 'ga4.csv', dateCol: 'Year month', valueCols: ['Sessions'], groupCol: 'Channel, group', ranges: ['2025-01..2025-12'] });
  assert.deepEqual(g.rows.map((x) => [x.group, x.totals[0]]), [[null, 300], ['Paid "search"', 200], ['Organic', 100]]);
  assert.equal(g.lines[1], '- Sessions for Paid "search" Jan-Dec 2025: 200 (ga4.csv, column Sessions, Channel, group = Paid "search").');
  const empty = csvEvidence(GA4, { file: 'ga4.csv', dateCol: 'Year month', valueCols: ['Sessions'], ranges: ['2024-01..2024-12', '2026-01..2026-02'] });
  assert.deepEqual(empty.lines, []);
  assert.ok(empty.warnings.includes('No rows fall in Jan-Dec 2024'));
});

test('month rows against a day range are left out and counted; daily rows sum by month range', () => {
  const r = csvEvidence(GA4, { file: 'ga4.csv', dateCol: 'Year month', valueCols: ['Sessions'], ranges: ['2026-01-15..2026-03-31'] });
  assert.equal(r.rows[0].totals[0], 251);
  assert.ok(r.warnings.some((w) => /1 row\(s\) only partly inside/.test(w)));
  const daily = 'Date,Users\n20250101,5\n20250131,7\n20250201,100\n';
  assert.equal(csvEvidence(daily, { dateCol: 'Date', valueCols: ['Users'], ranges: ['2025-01..2025-01'] }).rows[0].totals[0], 12);
});

test('CSV errors name the fix', () => {
  const base = { dateCol: 'Year month', valueCols: ['Sessions'], ranges: ['2025-01..2025-02'] };
  assert.throws(() => csvEvidence(GA4, { ...base, valueCols: ['Revenue'] }), /Column not found: Revenue/);
  assert.throws(() => csvEvidence('Day,Users\nMonday,1\nTuesday,2\n', { ...base, dateCol: 'Day', valueCols: ['Users'] }), /Cannot read dates in column Day/);
  assert.throws(() => csvEvidence('Date,Users\n20250101,lots\n', { ...base, dateCol: 'Date', valueCols: ['Users'] }), /Row 1: "lots" in column Users is not a number/);
  assert.throws(() => csvEvidence(GA4, { ...base, ranges: [] }), /Give 1 or 2 ranges/);
  assert.throws(() => csvEvidence(GA4, { ...base, ranges: ['2025-01..2025-02', '2025-03..2025-04', '2025-05..2025-06'] }), /Give 1 or 2 ranges/);
  assert.throws(() => csvEvidence(GA4, { ...base, dateCol: '' }), /Pick the date column/);
});

test('the CLI reads only a regular file under the size cap; binary is refused', () => {
  const big = path.join(tmp, 'big.csv');
  fs.writeFileSync(big, Buffer.alloc(MAX_CSV_BYTES + 1, 0x31));
  assert.throws(() => readCsvFile(big), (e) => e.code === 413);
  assert.throws(() => readCsvFile(tmp), /Not a regular file/);
  assert.throws(() => readCsvFile(path.join(tmp, 'none.csv')), (e) => e.code === 404);
  assert.throws(() => decodeCsv(Buffer.from([0x50, 0x4b, 0x03, 0x00])), /not a text CSV/);
  assert.equal(decodeCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b', 'utf16le')])), 'a,b');
});
