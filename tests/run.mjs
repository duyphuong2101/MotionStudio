// Test runner: every test file in its own `node --test` process (as `node --test` does), the slowest first, with only a
// few Chrome-heavy files at once so they do not starve each other. `--changed` runs only the files the working-tree
// changes can affect (tests/impact.mjs). Each file's time is kept in out/_test-times.json for the next run's order.
//
//   node tests/run.mjs                      every test file
//   node tests/run.mjs --changed            files affected by changes since HEAD (staged, unstaged, untracked)
//   node tests/run.mjs engine/tts.mjs ...   files affected by these source files (every declaration counts as changed)
//   node tests/run.mjs tests/x.test.mjs     just these test files
//   add --list to print the selection and why, --heavy <n> / --jobs <n> to change how many run at once, --no-retry to
//   skip the second, solo run of a file that failed beside others
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, buildGraph, testFiles, impacted, changedFiles } from './impact.mjs';

const TIMES = path.join(ROOT, 'out', '_test-times.json');
const FILE_TIMEOUT_MS = 40 * 60 * 1000;
const LOG_CAP = 256 * 1024;
// A file that took longer than this last time, or opens Chrome when it has no time yet, runs in the heavy pool.
const HEAVY_SECONDS = 20;
const OPENS_CHROME = /\b(prepare|render|playCheck|templatePreview|openComposition|renderSequence|sequencePreview|transitionPreview|bench)\s*\(/;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; args.splice(i, 1); return true; };
const num = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = Number(args[i + 1]); args.splice(i, 2); return Number.isInteger(v) && v > 0 ? v : dflt; };
const list = flag('--list');
const changed = flag('--changed');
const noRetry = flag('--no-retry');
const cpus = os.availableParallelism?.() || os.cpus().length;
const heavyMax = num('--heavy', Math.max(1, Math.min(4, Math.floor(cpus / 4))));
const jobs = num('--jobs', Math.max(2, cpus - 1));

const readTimes = () => { try { return JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch { return {}; } };

function select() {
  const mods = buildGraph();
  const all = testFiles(mods);
  if (!changed && !args.length) return { files: all, why: new Map(all.map((t) => [t, 'all'])), note: `all ${all.length} test files` };
  const given = args.map((a) => path.relative(ROOT, path.resolve(a)).split(path.sep).join('/'));
  const r = changed ? impacted(changedFiles(), { mods }) : impacted(given, { mods, byLine: false });
  const files = [...r.tests.keys()].sort();
  return { files, why: r.tests, note: r.all ? `all ${files.length} test files: ${r.all}` : `${files.length} of ${all.length} test files` };
}

/** One test file in its own process, with a timeout and a capped log. Resolves { file, ok, seconds, pass, fail, log }. */
function runFile(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: ROOT, shell: false, windowsHide: true });
    let log = '';
    const keep = (d) => { log += d; if (log.length > LOG_CAP) log = log.slice(-LOG_CAP); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, FILE_TIMEOUT_MS);
    const done = (code) => {
      clearTimeout(timer);
      const count = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(log) || [])[1] || 0);
      resolve({ file, ok: code === 0 && !timedOut, seconds: (Date.now() - t0) / 1000, pass: count('pass'), fail: count('fail'), timedOut, log });
    };
    child.on('close', done);
    child.on('error', (err) => { keep(String(err)); done(1); });
  });
}

/** The failing tests of a TAP log: each `not ok` line with the YAML block under it. */
function failures(log) {
  const lines = log.split(/\r?\n/);
  const out = [];
  lines.forEach((l, i) => {
    if (!/^\s*not ok /.test(l)) return;
    out.push(l.trim());
    for (let k = i + 1; k < lines.length && k < i + 40 && !/^\s*(ok|not ok) /.test(lines[k]); k++) out.push(lines[k]);
  });
  return out.join('\n').slice(0, 6000);
}

const { files, why, note } = select();
const times = readTimes();
const heavy = (f) => (times[f] !== undefined ? times[f] > HEAVY_SECONDS : OPENS_CHROME.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const guess = (f) => times[f] ?? (heavy(f) ? 120 : 1);
const queue = [...files].sort((a, b) => guess(b) - guess(a));

console.log(`${note}; up to ${jobs} at once, ${heavyMax} of them heavy`);
if (list) {
  for (const f of queue) console.log(`  ${heavy(f) ? 'heavy' : 'light'} ${String(Math.round(guess(f))).padStart(5)}s  ${f}  ← ${why.get(f)}`);
  process.exit(0);
}
if (!files.length) { console.log('Nothing to run: no test file can be affected by these changes.'); process.exit(0); }

const t0 = Date.now();
const results = [];
let running = 0, heavyRunning = 0;
await new Promise((resolveAll) => {
  const next = () => {
    if (!queue.length && !running) return resolveAll();
    while (running < jobs && queue.length) {
      // The slowest file that fits: a heavy one only while a heavy slot is free.
      const i = queue.findIndex((f) => !heavy(f) || heavyRunning < heavyMax);
      if (i < 0) break;
      const [f] = queue.splice(i, 1);
      const h = heavy(f);
      running++; if (h) heavyRunning++;
      runFile(f).then((r) => {
        running--; if (h) heavyRunning--;
        results.push(r);
        times[f] = Math.round(r.seconds * 10) / 10;
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.seconds.toFixed(1).padStart(7)}s  ${f}  (${r.pass} passed${r.fail ? `, ${r.fail} failed` : ''}${r.timedOut ? ', timed out' : ''})`);
        next();
      });
    }
  };
  next();
});

fs.mkdirSync(path.dirname(TIMES), { recursive: true });
fs.writeFileSync(TIMES, JSON.stringify({ ...readTimes(), ...times }, null, 2));
// Chrome-heavy files slow each other down (a clip seek misses its wait, a test runs past its timeout). A file that
// failed in the parallel pass runs once more with nothing else running: passing then marks it load-sensitive, not fine.
const loadSensitive = [];
if (!noRetry) {
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`retry alone  ${r.file}`);
    const again = await runFile(r.file);
    console.log(`${again.ok ? 'ok  ' : 'FAIL'} ${again.seconds.toFixed(1).padStart(7)}s  ${r.file}  alone (${again.pass} passed${again.fail ? `, ${again.fail} failed` : ''})`);
    if (again.ok) { loadSensitive.push({ first: r, again }); Object.assign(r, { ok: true, pass: again.pass, fail: 0 }); } else Object.assign(r, again);
  }
}
for (const { first } of loadSensitive) console.log(`\n--- ${first.file}: failed beside other files, passed alone (load-sensitive)\n${failures(first.log).slice(0, 1500)}`);
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`\n--- ${r.file}${r.timedOut ? ' (timed out)' : ''}\n${failures(r.log) || r.log.slice(-3000)}`);
const pass = results.reduce((a, r) => a + r.pass, 0), fail = results.reduce((a, r) => a + r.fail, 0);
console.log(`\n${results.length} files, ${pass} tests passed, ${fail} failed${failed.length ? `, ${failed.length} file(s) failed` : ''}${loadSensitive.length ? `, ${loadSensitive.length} load-sensitive (passed alone)` : ''} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failed.length ? 1 : 0);
