#!/usr/bin/env node
// append-ai-failure.js — the ONLY writer for .claude/state/ai-failure-log.ndjson.
// The "AI failure pattern library": every time a review (self-review, CODE_REVIEW,
// or the user) catches an AI-typed error, log the TYPE of error — not just the fix.
// Over time this becomes the reviewer's "smell library" that /retro-skills mines
// alongside outcome-log.ndjson.
//
// Usage:
//   node .claude/scripts/append-ai-failure.js '<json>'
//   node .claude/scripts/append-ai-failure.js --category hallucinated-api \
//     --description "imported useCartSync which does not exist" \
//     --file engine/jobs.mjs --caught-by code_review
//
// Schema (metadata only — never transcript/PII, per kit-process.md log-sanitization):
//   { ts, category, description, file, caught_by, task }
//   category ∈ hallucinated-api | deprecated-api | wrong-edge-case |
//              confident-but-wrong | convention-violation | other
//   caught_by ∈ self_review | code_review | verify | unit_test | qa | user
// Rotation: 200KB / 500 lines (matches append-outcome.js), keeps the newest.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state'); // pinned to repo, not cwd
const LOG = path.join(STATE_DIR, 'ai-failure-log.ndjson');
const MAX_BYTES = 200 * 1024;
const KEEP_LINES = 500;
const VALID_CATEGORIES = new Set([
  'hallucinated-api',      // invented function/library/composable that does not exist
  'deprecated-api',        // API/hook deprecated or signature changed
  'wrong-edge-case',       // plausible logic but wrong edge case (null, empty, boundary)
  'confident-but-wrong',   // confident assertion that is factually wrong
  'convention-violation',  // NEVER/ALWAYS violated despite rule being in context
  'other',
]);
const VALID_CAUGHT_BY = new Set(['self_review', 'code_review', 'verify', 'unit_test', 'qa', 'user']);

function parseArgs(argv) {
  if (argv.length === 1 && argv[0].trim().startsWith('{')) {
    return JSON.parse(argv[0]);
  }
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '').replace(/-/g, '_');
    out[k] = argv[i + 1];
  }
  return out;
}

try {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    process.stderr.write('append-ai-failure: no args. Pass a JSON blob or --category/--description flags.\n');
    process.exit(1);
  }
  const a = parseArgs(raw);

  if (!a.category || !a.description) {
    process.stderr.write('append-ai-failure: "category" and "description" are required.\n');
    process.exit(1);
  }
  if (!VALID_CATEGORIES.has(a.category)) {
    process.stderr.write(`append-ai-failure: category must be one of ${[...VALID_CATEGORIES].join('|')} (got "${a.category}").\n`);
    process.exit(1);
  }
  if (a.caught_by && !VALID_CAUGHT_BY.has(a.caught_by)) {
    process.stderr.write(`append-ai-failure: caught_by must be one of ${[...VALID_CAUGHT_BY].join('|')} (got "${a.caught_by}").\n`);
    process.exit(1);
  }

  const entry = {
    ts: new Date().toISOString(),
    category: a.category,
    description: String(a.description).slice(0, 400),
    file: a.file ? String(a.file).slice(0, 200) : null,
    caught_by: a.caught_by || null,
    task: a.task ? String(a.task).slice(0, 300) : null,
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');

  try {
    if (fs.statSync(LOG).size > MAX_BYTES) {
      const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(LOG, lines.slice(-KEEP_LINES).join('\n') + '\n');
    }
  } catch (_) {}

  process.stdout.write(`✓ AI failure logged: [${entry.category}] ${entry.description.slice(0, 80)}\n`);
  process.exit(0);
} catch (e) {
  process.stderr.write(`append-ai-failure: ${e.message}\n`);
  process.exit(1);
}
