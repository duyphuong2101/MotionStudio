#!/usr/bin/env node
// prose-audit.js — flag AI-tells in prose (guide HTML, docs, plan files).
//
// Reports only; never edits. Checks the tells that survived measurement against
// this repo on 2026-09-03 — see `.claude/output-styles/nsc.md` § "Prose voice"
// for what was tested and REJECTED (em-dashes and sentence-length uniformity
// are not tells here; do not add them back).
//
// Baseline caveat: this repo has no long-form human prose to compare against —
// commits authored before 2026 have subject lines and empty bodies. Thresholds
// contrast heavily-edited against unedited AI prose, the best available proxy.
//
// Usage:
//   node .ai/scripts/prose-audit.js claude-code-guide.html docs/foo.html
//   node .ai/scripts/prose-audit.js .ai/plans/OP-1234.md

const fs = require('fs');
const path = require('path');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Rule 2 banlist. Vietnamese entries are match data, not prose.
const BANNED = [
  "in today's world", 'it is important to note', "it's important to note",
  "let's explore", 'in conclusion', 'at the end of the day',
  "it's worth mentioning", 'it is worth mentioning', 'when it comes to',
  'navigating the landscape', 'delve into', 'robust solution',
  'seamless experience',
  'trong thời đại ngày nay', 'điều quan trọng cần lưu ý',
  'hãy cùng khám phá', 'nói tóm lại', 'đáng chú ý là',
];

// Declarative connectors — 1 occurrence per 40 commit bodies in this repo.
const CONNECTORS = [
  'this is because', 'note that', 'keep in mind', 'that said',
  'in other words', 'importantly,', 'essentially,', 'simply put',
  'it should be noted', 'as mentioned earlier', 'furthermore,', 'moreover,',
];

const CLOSERS = /\b(this is (the|why|where)|it is where|earns its keep)\b/gi;

// Shouted words, but NOT when the doc is *about* the NEVER/ALWAYS ruleset —
// the config guides quote those keywords as content, which is a false positive.
const SHOUTED = /\b(ONLY|ALL|MUST)\b/g;
const RULESET_DOC = /\b(NEVER\/ALWAYS|NEVER:|ALWAYS:|Safety Rules)\b/;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' CODE ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function countAll(haystack, needle) {
  let i = 0, n = 0;
  const h = haystack.toLowerCase(), p = needle.toLowerCase();
  while ((i = h.indexOf(p, i)) !== -1) { n++; i += p.length; }
  return n;
}

function auditFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return { rel, missing: true };

  // A file that DEFINES the rules quotes every banned phrase and every tell as
  // an example, so scoring it against itself is pure noise. Skip those.
  const norm = rel.replace(/\\/g, '/');
  const RULE_DEFS = [
    'output-styles/nsc.md', 'project-conventions/SKILL.md',
    'rules/project.mdc', 'copilot-instructions.md',
    'AGENTS.md', 'prose-audit.js',
  ];
  if (RULE_DEFS.some(x => norm.endsWith(x))) return { rel, ruleDefinition: true };

  const raw = fs.readFileSync(p, 'utf8');
  const isHtml = /\.html?$/i.test(rel);
  const prose = isHtml ? stripHtml(raw) : raw.replace(/```[\s\S]*?```/g, ' ');
  const words = prose.split(/\s+/).filter(Boolean).length;

  const banned = BANNED.map(x => [x, countAll(prose, x)]).filter(r => r[1]);
  const conn = CONNECTORS.map(x => [x, countAll(prose, x)]).filter(r => r[1]);
  const closers = (prose.match(CLOSERS) || []).length;
  const rulesetDoc = RULESET_DOC.test(prose);
  const shouted = rulesetDoc ? 0 : (prose.match(SHOUTED) || []).length;

  const emphasis = isHtml
    ? (raw.match(/<(strong|b)[ >]/gi) || []).length
    : Math.floor((raw.match(/\*\*/g) || []).length / 2);

  const whyHeaders = isHtml
    ? (raw.match(/<(strong|b)>\s*Why [^<]{4,70}<\/(strong|b)>/gi) || []).length
    : (raw.match(/\*\*Why [^*]{4,70}\*\*/g) || []).length;

  let bulletsTotal = 0, bulletsPatterned = 0, samples = [];
  if (isHtml) {
    // Only prose bullets count. A "`file.md` — Rebuild export" row is a
    // lookup table, not a sentence, so it cannot share a "skeleton" in the
    // sense rule 7 means; counting it flagged every reference list as a tell.
    const lis = [...raw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(m => stripHtml(m[1]))
      .filter(t => t.split(/\s+/).filter(Boolean).length >= 8);
    bulletsTotal = lis.length;
    const hits = lis.filter(t => /^\s*(CODE|[A-Za-z0-9_./-]+\.(ts|js|cs|vue|md|json|html))\s*[—–]/.test(t));
    bulletsPatterned = hits.length;
    samples = hits.slice(0, 3).map(t => t.slice(0, 70));
  } else {
    const lines = raw.split('\n').filter(l => /^\s*-( \[[ x]\])? /.test(l));
    bulletsTotal = lines.length;
    const hits = lines.filter(l => /^\s*-( \[[ x]\])? \*\*/.test(l));
    bulletsPatterned = hits.length;
    samples = hits.slice(0, 3).map(t => t.trim().slice(0, 70));
  }

  return { rel, words, banned, conn, closers, shouted, emphasis, whyHeaders,
           bulletsTotal, bulletsPatterned, samples };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node .ai/scripts/prose-audit.js <file> [file ...]');
  process.exit(2);
}

const rows = files.map(auditFile);
let findings = 0;

for (const r of rows) {
  if (r.missing) { console.log('\n' + r.rel + '\n  ! file not found'); continue; }
  if (r.ruleDefinition) { console.log('\n' + r.rel + '\n  skipped (defines the rules — quotes every tell as an example)'); continue; }

  const issues = [];
  if (r.banned.length) issues.push('rule 2 — banned phrase: ' + r.banned.map(x => x[0] + ' x' + x[1]).join(', '));
  if (r.conn.length) issues.push('rule 2 — connector: ' + r.conn.map(x => x[0] + ' x' + x[1]).join(', '));
  if (r.closers >= 3) issues.push('rule 11 — ' + r.closers + ' section-closing verdicts');
  if (r.whyHeaders) issues.push('rule 10 — ' + r.whyHeaders + ' bolded "Why ...:" header(s)');

  const bulletPct = r.bulletsTotal ? Math.round(100 * r.bulletsPatterned / r.bulletsTotal) : 0;
  if (r.bulletsTotal >= 12 && bulletPct >= 40) {
    issues.push('rule 7 — ' + r.bulletsPatterned + '/' + r.bulletsTotal + ' bullets (' + bulletPct + '%) share one skeleton');
  }

  const per1k = r.words ? (1000 * r.emphasis / r.words) : 0;
  if (per1k > 12) issues.push('rule 6 — ' + r.emphasis + ' emphases in ' + r.words + ' words (' + per1k.toFixed(1) + '/1k)');
  if (r.shouted >= 15) issues.push('rule 6 — ' + r.shouted + ' shouted words');

  if (issues.length) {
    findings += issues.length;
    console.log('\n' + r.rel + '  (' + r.words + ' words)');
    for (const i of issues) console.log('  ! ' + i);
    for (const s of r.samples) console.log('      e.g. ' + s);
  } else {
    console.log('\n' + r.rel + '  (' + r.words + ' words)\n  clean');
  }
}

console.log('\n' + (findings ? findings + ' finding(s)' : 'no findings') + ' across ' + rows.filter(r => !r.missing).length + ' file(s)');
console.log('Rules: .claude/output-styles/nsc.md § "Prose voice"');
