import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError, ID_RE, assertId, loadStudioConfig, keyFreeEnv } from './core.mjs';

/*
 * Evidence import, gathered by a person (CLI or the brief form), never by the Director:
 * read-only git history of a configured repo, and period totals from a CSV export.
 * Both return rows plus fact lines that name their source, ready to paste into a brief's facts.
 */

const TICKET_RE = /^[A-Z]+-\d+$/;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_TICKETS = 30;
export const MAX_RANGES = 2;
const MAX_VALUE_COLS = 10;
const MAX_GROUPS = 50;
const MAX_GREP_CHARS = 100;
const GIT_OUTPUT_CAP = 8 * 1024 * 1024;
const GIT_STDERR_CAP = 16 * 1024;
const SEP = '\x1f';
const END = '\x1e';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PR_PREFIX_RE = /^Merged PR \d+:\s*/i;
const GH_MERGE_RE = /^Merge pull request #\d+ from \S+\s*/i;
const MERGE_RE = /^Merge\b/i;
const MONEY_RE = /revenue|value|price|amount|cost|sales|spend|income|profit|aov/i;
const NATURAL = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DEFAULTS = { repos: {}, releasePattern: 'release/', maxCommits: 300, timeoutSeconds: 60 };

export const evidenceConfig = (ev = loadStudioConfig().evidence) => ({ ...DEFAULTS, ...(ev || {}) });

/** Repo aliases a person may pick (paths stay on the server). */
export const repoAliases = (ev = evidenceConfig()) => Object.keys(ev.repos || {}).filter((a) => ID_RE.test(a));

/** The folder of a configured repo. Only aliases from `evidence.repos` resolve; a raw path never does. */
export function resolveRepo(alias, ev = evidenceConfig()) {
  assertId(alias, 'repo alias');
  const dir = Object.hasOwn(ev.repos || {}, alias) ? ev.repos[alias] : null;
  if (typeof dir !== 'string' || !dir) throw new StudioError(`Unknown repo "${alias}": add it to config/studio.json → evidence.repos`, 400);
  let st = null;
  try { st = fs.statSync(dir); } catch { /* reported below */ }
  if (!st?.isDirectory()) throw new StudioError(`The folder for repo "${alias}" does not exist: fix config/studio.json → evidence.repos`, 400);
  return dir;
}

/** CLI `--repo-path`: accepted only when it is one of the configured paths; answers its alias. */
export function aliasForPath(dir, ev = evidenceConfig()) {
  const norm = (p) => { const r = path.resolve(String(p)); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const hit = Object.entries(ev.repos || {}).find(([a, p]) => ID_RE.test(a) && typeof p === 'string' && norm(p) === norm(dir));
  if (!hit) throw new StudioError('--repo-path must be one of the paths in config/studio.json → evidence.repos', 400);
  return hit[0];
}

/* ---------- git ---------- */

function git(repo, args, deadline) {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) return Promise.reject(new StudioError('git took too long: search fewer tickets or a shorter period', 504));
  return new Promise((resolve, reject) => {
    // cwd stays ROOT and the repo goes in -C: on Windows a git.exe at the repo's root would otherwise run before PATH.
    const proc = spawn('git', ['-C', repo, '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
      cwd: ROOT, shell: false, windowsHide: true, env: { ...keyFreeEnv(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    const out = [];
    let bytes = 0, stderr = '', over = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
    proc.stdout.on('data', (d) => {
      bytes += d.length;
      if (bytes > GIT_OUTPUT_CAP) { if (!over) { over = true; proc.kill(); } return; }
      out.push(d);
    });
    proc.stderr.on('data', (d) => { if (stderr.length < GIT_STDERR_CAP) stderr += d; });
    proc.on('error', (err) => { clearTimeout(timer); reject(err.code === 'ENOENT' ? new StudioError('git was not found: install Git and put it on PATH', 503) : err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new StudioError('git took too long: search fewer tickets or a shorter period', 504));
      if (over) return reject(new StudioError('git printed too much: narrow the search', 413));
      if (code !== 0) return reject(new StudioError(`git ${args[0]} failed: ${stderr.trim().split('\n')[0] || `exit ${code}`}`, 400));
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}

function optDate(v, what) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DAY_RE.test(v) || Number.isNaN(Date.parse(v))) throw new StudioError(`${what} must be a date like 2026-01-31`, 400);
  return v;
}

/** Validated search: tickets (`OP-8254`) and/or one fixed-string grep, a date window and a commit cap. */
export function gitSearch(opts = {}, ev = evidenceConfig()) {
  const since = optDate(opts.since, 'since'), until = optDate(opts.until, 'until');
  if (since && until && since > until) throw new StudioError('since must be on or before until', 400);
  const list = Array.isArray(opts.tickets) ? opts.tickets : String(opts.tickets ?? '').split(/[\s,;]+/);
  const tickets = [...new Set(list.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  for (const t of tickets) if (!TICKET_RE.test(t)) throw new StudioError(`Invalid ticket id "${t.slice(0, 40)}": use letters, a dash and a number, like OP-8254`, 400);
  if (tickets.length > MAX_TICKETS) throw new StudioError(`At most ${MAX_TICKETS} tickets at once`, 400);
  const grep = String(opts.grep ?? '').trim();
  if (grep.length > MAX_GREP_CHARS || /[\x00-\x1f\x7f]/.test(grep)) throw new StudioError(`grep must be one line of at most ${MAX_GREP_CHARS} characters`, 400);
  // A leading dash would read as a flag on the CLI's command line.
  if (grep.startsWith('-')) throw new StudioError('grep text cannot start with a dash', 400);
  if (!tickets.length && !grep) throw new StudioError('Give ticket ids or a grep text', 400);
  const max = Math.min(Number(opts.max) > 0 ? Math.floor(Number(opts.max)) : ev.maxCommits, ev.maxCommits);
  return { since, until, tickets, grep, max };
}

/** Ref names → branch names without `refs/heads/` or `refs/remotes/<remote>/`, release branches only, natural order. */
export function releaseBranches(refs, pattern) {
  const names = new Set();
  for (const ref of String(refs).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const name = ref.startsWith('refs/heads/') ? ref.slice(11) : ref.startsWith('refs/remotes/') ? ref.slice(13).replace(/^[^/]+\//, '') : null;
    if (name && name !== 'HEAD' && name.startsWith(pattern)) names.add(name);
  }
  return [...names].sort(NATURAL.compare);
}

/** Title of a change: a PR's own title rather than "Merged PR 12:" or "Merge pull request #3 from …". */
export function changeTitle(c, ticket) {
  let t = c.subject;
  if (GH_MERGE_RE.test(t)) t = c.body.split(/\r?\n/).find((l) => l.trim())?.trim() || t.replace(GH_MERGE_RE, '');
  while (PR_PREFIX_RE.test(t)) t = t.replace(PR_PREFIX_RE, '');
  if (!ticket) return t;
  const lead = new RegExp(`^\\[?${ticket}\\]?[:\\s-]+`);
  return lead.test(t) ? t.replace(lead, `${ticket} `) : t.includes(ticket) ? t : `${ticket} ${t}`;
}

async function findCommits(repo, term, s, left, deadline) {
  const args = ['log', '--all', '--fixed-strings', `--grep=${term.text}`, `--max-count=${left}`, '--format=%H%x1f%cI%x1f%s%x1f%b%x1e'];
  if (term.kind === 'grep') args.splice(2, 0, '--regexp-ignore-case');
  if (s.since) args.push(`--since=${s.since}T00:00:00`);
  if (s.until) args.push(`--until=${s.until}T23:59:59`);
  const records = (await git(repo, args, deadline)).split(END).map((r) => r.replace(/^\s+/, '')).filter(Boolean);
  // --fixed-strings OP-82 also matches OP-8254: keep whole ticket ids only.
  const whole = term.kind === 'ticket' ? new RegExp(`(?<![A-Za-z0-9])${term.text}(?!\\d)`) : null;
  const commits = records.map((r) => {
    const [sha, iso, subject = '', body = ''] = r.split(SEP);
    return { sha, iso, date: iso.slice(0, 10), subject, body: body.trim(), pr: PR_PREFIX_RE.test(subject) || GH_MERGE_RE.test(subject) };
  }).filter((c) => !whole || whole.test(`${c.subject}\n${c.body}`));
  commits.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
  return { examined: records.length, commits };
}

/**
 * Read-only git evidence for one configured repo: per ticket (or grep text) its commits, the PR that merged it,
 * and the earliest release branch (natural order: sprint-109 before sprint-110) holding its first commit
 * (else the commit its title comes from). Local and remote branches both count.
 */
export async function gitEvidence(alias, opts = {}, ev = evidenceConfig()) {
  const repo = resolveRepo(alias, ev);
  const s = gitSearch(opts, ev);
  const pattern = String(ev.releasePattern || DEFAULTS.releasePattern);
  const deadline = Date.now() + ev.timeoutSeconds * 1000;
  const terms = [...s.tickets.map((text) => ({ kind: 'ticket', text })), ...(s.grep ? [{ kind: 'grep', text: s.grep }] : [])];
  const where = `${alias.toUpperCase()} repo, git`;
  const rows = [], lines = [];
  let examined = 0, capped = false;
  for (const term of terms) {
    const left = s.max - examined;
    if (left <= 0) { capped = true; rows.push({ term: term.text, kind: term.kind, found: false, skipped: true, commits: [] }); continue; }
    const found = await findCommits(repo, term, s, left, deadline);
    examined += found.examined;
    if (found.examined >= left) capped = true;
    const { commits } = found;
    if (!commits.length) { rows.push({ term: term.text, kind: term.kind, found: false, commits: [] }); continue; }
    const first = commits[0], pr = commits.find((c) => c.pr) || null;
    // The title comes from the merging PR, else the first own commit naming the term (not a "Merge develop into …" sync).
    const own = commits.filter((c) => !MERGE_RE.test(c.subject));
    const lead = pr || own.find((c) => c.subject.toLowerCase().includes(term.text.toLowerCase())) || own[0] || first;
    let release = null, releaseSha = null, releases = [];
    for (const c of [...new Set([first, lead])]) {
      releases = releaseBranches(await git(repo, ['branch', '-a', '--contains', c.sha, '--format=%(refname)'], deadline), pattern);
      if (releases.length) { release = releases[0]; releaseSha = c.sha.slice(0, 10); break; }
    }
    const title = changeTitle(lead, term.kind === 'ticket' ? term.text : null);
    const when = `${pr ? 'merged' : 'committed'} ${lead.date}`;
    const line = `- ${title}: ${when}, ${release ? `first released in ${release}` : 'not in any release branch'} (${where}).`;
    rows.push({
      term: term.text, kind: term.kind, found: true, title, date: lead.date, merged: pr ? { sha: pr.sha.slice(0, 10), date: pr.date, subject: pr.subject } : null,
      first: { sha: first.sha.slice(0, 10), date: first.date }, release, releaseSha, releases: releases.length,
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 10), date: c.date, subject: c.subject })), line,
    });
    lines.push(line);
  }
  return { repo: alias, since: s.since, until: s.until, releasePattern: pattern, examined, cap: s.max, capped, rows, lines };
}

/* ---------- CSV ---------- */

/** A CSV file's text: UTF-8 (BOM dropped) or UTF-16 LE with BOM; binary refused. */
export function decodeCsv(buf) {
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, '');
  if (text.includes('\u0000')) throw new StudioError('This file is not a text CSV', 400);
  return text;
}

/** CLI: a local file the person named, regular and under the size cap. */
export function readCsvFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { throw new StudioError(`No such file: ${file}`, 404); }
  if (!st.isFile()) throw new StudioError(`Not a regular file: ${file}`, 400);
  if (st.size > MAX_CSV_BYTES) throw new StudioError(`The CSV is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB: export a shorter period`, 413);
  return decodeCsv(fs.readFileSync(file));
}

/** A file name safe to show in a fact line. */
export const csvName = (name) => path.basename(String(name || '')).replace(/[^\w .()-]/g, '').trim().slice(0, 100) || 'upload.csv';

function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  const outside = line.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, outside.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ',';
}

/** Records of a CSV; `null` marks a blank or `#` comment line, which separates tables (GA4 puts several in one file). */
export function csvRecords(text, delim = sniffDelimiter(text)) {
  const recs = [];
  let rec = [], field = '', quoted = false;
  const endRecord = () => { rec.push(field); recs.push(rec.length === 1 && !rec[0].trim() ? null : rec); rec = []; field = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      continue;
    }
    if (c === '#' && !rec.length && !field) {
      while (i < text.length && text[i] !== '\n') i++;
      recs.push(null);
      continue;
    }
    if (c === '"' && !field) quoted = true;
    else if (c === delim) { rec.push(field); field = ''; }
    else if (c === '\n') endRecord();
    else if (c !== '\r') field += c;
  }
  if (field || rec.length) endRecord();
  return recs;
}

/** Tables of a CSV: a header row and its data rows, split at blank and comment lines. */
export function csvTables(text) {
  const tables = [];
  let cur = null;
  for (const r of csvRecords(text)) {
    if (!r) { cur = null; continue; }
    if (!cur) { cur = { columns: r.map((c) => c.trim()), rows: [] }; tables.push(cur); } else cur.rows.push(r);
  }
  return tables.filter((t) => t.columns.some(Boolean));
}

/** `12,258,510`, `$1,234.50`, `9.7%`, `(42)` → numbers; empty → null; anything else → NaN. */
export function parseNumber(raw) {
  let s = String(raw ?? '').replace(/[\s ]/g, '').replace(/[$€£¥%]/g, '');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? sign * Number(s) : NaN;
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `YYYYMMDD`, `YYYYMM`, `YYYY-MM-DD` (time allowed after it), `YYYY-MM`, `YYYY/MM/DD` → { from, to } as yyyymmdd numbers. */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ].*)?$/.exec(s) || /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s) || /^(\d{4})-?(\d{2})()$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const base = y * 10000 + mo * 100;
  if (!m[3]) return { from: base + 1, to: base + daysIn(y, mo), month: true };
  const d = Number(m[3]);
  return d >= 1 && d <= daysIn(y, mo) ? { from: base + d, to: base + d, month: false } : null;
}

const ymd = (n) => ({ y: Math.floor(n / 10000), m: Math.floor(n / 100) % 100, d: n % 100 });
const isoOf = (n) => { const { y, m, d } = ymd(n); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

/** `2025-01..2025-09` → an inclusive range with a label such as `Jan-Sep 2025`. */
export function parseRange(raw) {
  const [a, b, extra] = String(raw ?? '').split('..');
  const from = parseDate(a), to = parseDate(b);
  if (extra !== undefined || !from || !to) throw new StudioError(`Range "${String(raw).slice(0, 40)}" must look like 2025-01..2025-09 or 2025-01-01..2025-09-30`, 400);
  if (from.from > to.to) throw new StudioError(`Range "${raw}" ends before it starts`, 400);
  const f = ymd(from.from), t = ymd(to.to);
  const whole = f.d === 1 && t.d === daysIn(t.y, t.m);
  const mon = (x) => MONTHS[x.m - 1];
  const label = !whole ? `${isoOf(from.from)} to ${isoOf(to.to)}`
    : f.y !== t.y ? `${mon(f)} ${f.y}-${mon(t)} ${t.y}`
    : f.m === t.m ? `${mon(f)} ${f.y}` : `${mon(f)}-${mon(t)} ${f.y}`;
  return { raw: String(raw), from: from.from, to: to.to, label };
}

/** For the column pickers: the first table's columns, which look like dates and which like numbers. */
export function csvColumns(text) {
  const t = csvTables(text)[0];
  if (!t || !t.rows.length) throw new StudioError('No table with a header and rows was found in this CSV', 400);
  const sample = t.rows.slice(0, 20);
  const share = (i, fn) => sample.filter((r) => fn(r[i])).length / sample.length;
  return {
    columns: t.columns, rows: t.rows.length,
    dateColumns: t.columns.filter((_, i) => share(i, parseDate) >= 0.8),
    numberColumns: t.columns.filter((_, i) => share(i, (v) => { const n = parseNumber(v); return n !== null && !Number.isNaN(n); }) >= 0.8),
  };
}

function money(v, prefix) {
  const digits = Math.abs(v) >= 1000 ? 0 : 2;
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: digits });
  return `${v < 0 ? '-' : ''}${prefix}${s}`;
}

/** Growth from a to b in percent, one decimal; null when a is 0. */
export function growth(a, b) {
  if (!a) return null;
  return Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
}

const growthText = (g) => (g === null ? 'no growth figure (the earlier total is 0)' : g > 0 ? `up ${g}%` : g < 0 ? `down ${-g}%` : 'unchanged');

/**
 * Period totals from a CSV export: each value column summed per range (and per group), growth from the first
 * range to the second, and fact lines naming the file, column and ranges. Rows whose date only partly falls in a
 * range (a month row against a day range) are left out and counted.
 */
export function csvEvidence(text, opts = {}) {
  const file = csvName(opts.file);
  const dateCol = String(opts.dateCol ?? '').trim();
  const valueCols = (Array.isArray(opts.valueCols) ? opts.valueCols : String(opts.valueCols ?? '').split(',')).map((c) => String(c).trim()).filter(Boolean);
  const groupCol = String(opts.groupCol ?? '').trim() || null;
  const prefixIn = String(opts.prefix ?? '').trim();
  if (!dateCol) throw new StudioError('Pick the date column', 400);
  if (!valueCols.length || valueCols.length > MAX_VALUE_COLS) throw new StudioError(`Pick 1 to ${MAX_VALUE_COLS} value columns`, 400);
  if (prefixIn.length > 3 || /[\x00-\x1f]/.test(prefixIn)) throw new StudioError('The prefix is a currency sign of at most 3 characters', 400);
  const rangesIn = Array.isArray(opts.ranges) ? opts.ranges.filter(Boolean) : [];
  if (!rangesIn.length || rangesIn.length > MAX_RANGES) throw new StudioError(`Give 1 or ${MAX_RANGES} ranges, like 2025-01..2025-09`, 400);
  const ranges = rangesIn.map(parseRange);

  const need = [dateCol, ...valueCols, ...(groupCol ? [groupCol] : [])];
  const tables = csvTables(text);
  const table = tables.find((t) => need.every((c) => t.columns.includes(c)));
  if (!table) {
    const cols = tables[0]?.columns || [];
    const missing = need.filter((c) => !cols.includes(c));
    throw new StudioError(`Column not found: ${missing.join(', ')}. The CSV has: ${cols.join(', ').slice(0, 300) || 'no header'}`, 400);
  }
  const at = (c) => table.columns.indexOf(c);
  const di = at(dateCol), gi = groupCol ? at(groupCol) : -1, vi = valueCols.map(at);

  const sums = new Map(); // group ('' = all) → per range: { rows, totals[] }
  const bucket = (g) => {
    if (!sums.has(g)) sums.set(g, ranges.map(() => ({ rows: 0, totals: valueCols.map(() => 0) })));
    return sums.get(g);
  };
  bucket('');
  const symbols = valueCols.map(() => '');
  let undated = 0, partial = 0, used = 0;
  table.rows.forEach((row, n) => {
    if (row.every((c) => !c.trim())) return;
    const d = parseDate(row[di]);
    if (!d) { undated++; return; }
    ranges.forEach((r, ri) => {
      if (d.from >= r.from && d.to <= r.to) {
        used++;
        const values = vi.map((i, k) => {
          const v = parseNumber(row[i]);
          if (Number.isNaN(v)) throw new StudioError(`Row ${n + 1}: "${String(row[i]).slice(0, 30)}" in column ${valueCols[k]} is not a number`, 400);
          if (!symbols[k]) symbols[k] = /[$€£¥]/.exec(row[i] || '')?.[0] || '';
          return v ?? 0;
        });
        for (const g of groupCol ? ['', (row[gi] || '').trim() || '(not set)'] : ['']) {
          const slot = bucket(g)[ri];
          slot.rows++;
          values.forEach((v, k) => { slot.totals[k] += v; });
        }
      } else if (d.to >= r.from && d.from <= r.to) partial++;
    });
  });
  if (!used && undated && undated === table.rows.length) throw new StudioError(`Cannot read dates in column ${dateCol}: use YYYYMMDD, YYYYMM or YYYY-MM-DD`, 400);

  const warnings = [];
  const all = sums.get('');
  ranges.forEach((r, ri) => { if (!all[ri].rows) warnings.push(`No rows fall in ${r.label}`); });
  if (partial) warnings.push(`${partial} row(s) only partly inside a range were left out`);
  if (undated) warnings.push(`${undated} row(s) without a readable date were skipped`);

  let groups = [...sums.keys()].filter(Boolean);
  const last = ranges.length - 1;
  groups.sort((a, b) => sums.get(b)[last].totals[0] - sums.get(a)[last].totals[0] || NATURAL.compare(a, b));
  const groupsCapped = groups.length > MAX_GROUPS;
  groups = groups.slice(0, MAX_GROUPS);

  const rows = [], lines = [];
  for (const g of ['', ...groups]) {
    const per = sums.get(g);
    valueCols.forEach((col, k) => {
      const totals = per.map((p) => p.totals[k]);
      const g2 = ranges.length === 2 ? growth(totals[0], totals[1]) : null;
      // A sign the cells carry wins; the given sign goes only on money columns, never on sessions or users.
      const prefix = symbols[k] || (MONEY_RE.test(col) ? prefixIn : '');
      const what = `${col}${g ? ` for ${g}` : ''}`;
      const source = `(${file}, column ${col}${g ? `, ${groupCol} = ${g}` : ''})`;
      const complete = per.every((p) => p.rows);
      const line = !complete ? null : ranges.length === 1
        ? `- ${what} ${ranges[0].label}: ${money(totals[0], prefix)} ${source}.`
        : `- ${what} ${ranges[1].label} vs ${ranges[0].label}: ${money(totals[1], prefix)} vs ${money(totals[0], prefix)}, ${growthText(g2)} ${source}.`;
      rows.push({ column: col, group: g || null, totals, rows: per.map((p) => p.rows), growth: g2, line });
      if (line) lines.push(line);
    });
  }
  return {
    file, dateCol, valueCols, groupCol, ranges: ranges.map((r, ri) => ({ ...r, from: isoOf(r.from), to: isoOf(r.to), rows: all[ri].rows })),
    rows, lines, warnings, groupsCapped,
  };
}
