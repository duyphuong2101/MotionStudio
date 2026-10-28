// Which test files a change can affect, at the level of top-level functions and constants: the changed lines (git
// diff against HEAD) name the declarations that changed, and a test is affected when it reaches one of them through
// imports and the names each declaration uses. Plus the links that graph cannot see: templates loaded by path at run
// time, and files a test reads as text. It over-selects on purpose (a name in a comment or a string still counts).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['tests', 'engine', 'server', 'templates', 'motion-kit', 'ui'];
const CODE = /\.(mjs|js)$/;
// Files every run depends on: a change here runs everything.
const GLOBAL = [/^package(-lock)?\.json$/, /^config\//, /^tests\/(impact|run)\.mjs$/];
// Never code a test runs: docs, plans, AI kit files, job data and outputs.
const INERT = [/^[^/]+\.md$/i, /^docs\//, /^\.ai\//, /^\.claude\//, /^\.cursor\//, /^\.github\//, /^\.agents\//, /^\.vscode\//, /^out\//, /^briefs\//, /^profiles\//, /^sequences\//, /^trash\//, /^library\//, /^models\//];
const GIT_TIMEOUT_MS = 20000;
const GIT_MAX_BYTES = 8 * 1024 * 1024;

const IDENT = /[A-Za-z_$][\w$]*/g;
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
// Any other statement that starts at column 0 ends the declaration above it.
const TOP = /^(?:export|import|function|async|const|let|var|class|test|describe|before|after|if|for|while|try|await|[A-Za-z_$][\w$.]*\s*\()/;

export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (CODE.test(e.name)) out.push(p);
  }
  return out;
}

const resolveSpec = (from, spec) => {
  const target = path.resolve(path.dirname(path.join(ROOT, from)), spec);
  return fs.existsSync(target) ? rel(target) : null;
};

/**
 * One module: its top-level declarations (name, first and last line, the identifiers its body uses), what it imports
 * (local name → { mod, name }, name '*' for a namespace or a dynamic import) and what it re-exports.
 */
function parseModule(file, text) {
  const lines = text.split(/\r?\n/);
  const decls = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = DECL.exec(line);
    if (m || TOP.test(line)) {
      if (cur) cur.end = i;
      cur = m ? { name: m[1], start: i + 1, end: lines.length } : null;
      if (cur) decls.push(cur);
    }
  });
  for (const d of decls) d.uses = new Set(lines.slice(d.start - 1, d.end).join('\n').match(IDENT) || []);
  const imports = new Map();
  const reexports = [];
  const flat = text.replace(/\s+/g, ' ');
  for (const m of flat.matchAll(/\bimport\s+([^'"();]*?)\s+from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const mod = resolveSpec(file, m[2]);
    if (!mod) continue;
    const clause = m[1];
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) imports.set(ns[1], { mod, name: '*' });
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const part of named[1].split(',')) {
      const [a, b] = part.trim().split(/\s+as\s+/);
      if (a) imports.set((b || a).trim(), { mod, name: a.trim() });
    }
    const def = /^([\w$]+)\s*(?:,|$)/.exec(clause.trim());
    if (def && !ns) imports.set(def[1], { mod, name: 'default' });
  }
  // A dynamic import or a bare `import './x.mjs'` reaches the whole module.
  for (const m of flat.matchAll(/\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const mod = resolveSpec(file, m[1] || m[2]);
    if (mod) imports.set(`\0${mod}`, { mod, name: '*' });
  }
  for (const m of flat.matchAll(/\bexport\s+(\*|\{[^}]*\})\s+from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const mod = resolveSpec(file, m[2]);
    if (!mod) continue;
    if (m[1] === '*') reexports.push({ mod, from: '*', as: '*' });
    else for (const part of m[1].slice(1, -1).split(',')) {
      const [a, b] = part.trim().split(/\s+as\s+/);
      if (a) reexports.push({ mod, from: a.trim(), as: (b || a).trim() });
    }
  }
  return { file, text, decls, imports, reexports };
}

/** Every code file in the scanned folders, parsed. */
export function buildGraph() {
  const mods = new Map();
  for (const d of SCAN) for (const abs of walk(path.join(ROOT, d))) mods.set(rel(abs), parseModule(rel(abs), fs.readFileSync(abs, 'utf8')));
  return mods;
}

export const testFiles = (mods) => [...mods.keys()].filter((f) => /^tests\/[^/]+\.test\.mjs$/.test(f)).sort();

/**
 * Symbol nodes "file#name" and the nodes each one uses. A test file is one node, "file#*", that uses every name it
 * imports; "mod#*" (a namespace or dynamic import) uses every declaration of mod.
 */
function edges(mods) {
  const out = new Map();
  const add = (from, to) => { if (!out.has(from)) out.set(from, new Set()); out.get(from).add(to); };
  // The node a module's export `name` stands for, through re-exports.
  const target = (mod, name, depth = 0) => {
    const m = mods.get(mod);
    if (!m || depth > 8) return [];
    if (name === '*') return [`${mod}#*`];
    if (m.decls.some((d) => d.name === name)) return [`${mod}#${name}`];
    const via = m.reexports.filter((r) => r.as === name || r.as === '*');
    return via.length ? via.flatMap((r) => target(r.mod, r.as === '*' ? name : r.from, depth + 1)) : [`${mod}#*`];
  };
  for (const [file, m] of mods) {
    const names = new Set(m.decls.map((d) => d.name));
    for (const d of m.decls) add(`${file}#*`, `${file}#${d.name}`);
    const users = /^tests\/[^/]+\.test\.mjs$/.test(file) ? [{ name: '*', uses: new Set(m.text.match(IDENT) || []) }] : m.decls;
    for (const d of users) {
      const self = `${file}#${d.name}`;
      for (const id of d.uses) {
        if (id !== d.name && names.has(id)) add(self, `${file}#${id}`);
        const imp = m.imports.get(id);
        if (imp) for (const t of target(imp.mod, imp.name)) add(self, t);
      }
      for (const [k, imp] of m.imports) if (k.startsWith('\0')) for (const t of target(imp.mod, '*')) add(self, t);
    }
    // Code at the top level outside any declaration runs on import: treat it as part of every declaration.
  }
  return out;
}

/** Declarations whose lines changed in `file` since HEAD: names, or null when the change is outside every one. */
function changedDecls(file, m) {
  const r = spawnSync('git', ['diff', '-U0', 'HEAD', '--', file], { cwd: ROOT, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BYTES, shell: false, windowsHide: true });
  if (r.status !== 0 || !r.stdout) return null;
  const hit = new Set();
  let outside = false;
  // Import lines, comments and blank lines change no behaviour on their own: a declaration that uses a newly
  // imported name changed too.
  const newLines = m.text.split(/\r?\n/);
  const inImport = new Set();
  newLines.forEach((line, i) => {
    if (!/^import\b/.test(line)) return;
    for (let k = i; k < newLines.length; k++) { inImport.add(k + 1); if (/\bfrom\s*['"]|;\s*$|^import\s*['"]/.test(newLines[k])) break; }
  });
  const trivial = (s) => /^\s*(\/\/.*|\/\*.*|\*.*)?$/.test(s);
  for (const h of r.stdout.split(/^(?=@@ )/m).slice(1)) {
    const head = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(h);
    if (!head) continue;
    const start = +head[1], count = head[2] === undefined ? 1 : +head[2];
    const body = h.split(/\r?\n/).slice(1);
    const added = body.filter((l) => l.startsWith('+')).map((l, k) => ({ text: l.slice(1), line: start + k }));
    const removed = body.filter((l) => l.startsWith('-')).map((l) => l.slice(1));
    if (added.every((x) => inImport.has(x.line) || trivial(x.text)) && removed.every((s) => /^\s*import\b|^\s*[\w$\s,{}]*\}?\s*from\s*['"]/.test(s) || trivial(s))) continue;
    const [a, b] = count ? [start, start + count - 1] : [start, start + 1];
    const ds = m.decls.filter((d) => d.start <= b && d.end >= a);
    if (!ds.length) outside = true;
    for (const d of ds) hit.add(d.name);
  }
  return outside ? null : [...hit];
}

/** Files changed since HEAD (staged, unstaged and untracked), repo-relative. */
export function changedFiles() {
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BYTES, shell: false, windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').slice(0, 300)}`);
    return r.stdout.split(/\r?\n/).filter(Boolean);
  };
  return [...new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])])];
}

/**
 * The tests the changed files (repo-relative) can affect, each with one reason: { all, tests: Map<test, reason> }.
 * `byLine: false` treats every declaration of a changed code file as changed (for paths given by hand).
 */
export function impacted(changed, { mods = buildGraph(), byLine = true } = {}) {
  const tests = testFiles(mods);
  const picked = new Map();
  const pick = (t, why) => { if (!picked.has(t)) picked.set(t, why); };
  const seeds = new Map();
  for (const raw of changed) {
    const f = raw.split(path.sep).join('/');
    if (GLOBAL.some((re) => re.test(f))) return { all: `${f} is used by every test`, tests: new Map(tests.map((t) => [t, f])) };
    if (INERT.some((re) => re.test(f))) continue;
    if (tests.includes(f)) { pick(f, 'changed'); continue; }
    const m = mods.get(f);
    if (m) {
      const names = byLine ? changedDecls(f, m) : null;
      for (const n of names ?? m.decls.map((d) => d.name)) seeds.set(`${f}#${n}`, f);
      // A change outside every declaration (imports, top-level code) or a file with none counts as the whole module.
      if (names === null || !m.decls.length) seeds.set(`${f}#*`, f);
    }
    for (const t of tests) if (mods.get(t).text.includes(f)) pick(t, `reads ${f}`);
    // A data file the code reads at run time (a prompt, a stylesheet, an icon list): the modules that name it changed.
    if (!m && !/^templates\//.test(f)) {
      const base = path.basename(f);
      for (const [g, node] of mods) if (!g.startsWith('tests/') && node.text.includes(base)) for (const d of node.decls) if (node.text.split(/\r?\n/).slice(d.start - 1, d.end).join('\n').includes(base)) seeds.set(`${g}#${d.name}`, f);
    }
    // A template is loaded by path at run time: the tests that name it, or go through every template.
    const tpl = /^templates\/([^/]+)\//.exec(f);
    if (tpl) {
      const ids = new Set([tpl[1]]);
      for (const [g, node] of mods) if (/^templates\/[^/]+\/template\.mjs$/.test(g) && node.imports.size && [...node.imports.values()].some((i) => i.mod === f)) ids.add(g.split('/')[1]);
      for (const t of tests) {
        const text = mods.get(t).text;
        if ([...ids].some((id) => new RegExp(`['"\`/]${id}['"\`/]`).test(text))) pick(t, `renders template ${[...ids].length > 1 ? 'using ' + f : tpl[1]}`);
        else if (/\b(templatePreview|playCheck|playEveryTemplate)\b/.test(text)) pick(t, `renders every template (${f})`);
      }
    }
  }
  if (seeds.size) {
    const out = edges(mods);
    for (const t of tests) {
      if (picked.has(t)) continue;
      const seen = new Set();
      const stack = [`${t}#*`];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        if (seeds.has(n)) { pick(t, `uses ${n.replace('#*', '')}`); break; }
        for (const x of out.get(n) || []) stack.push(x);
      }
    }
  }
  return { all: null, tests: picked };
}
