#!/usr/bin/env node
// append-outcome.js — the ONLY writer for .claude/state/outcome-log.ndjson.
// Called from /workflow Phase 7 and /epic per-item completion so the outcome
// datum is written by code, not by the model remembering to. Without this the
// improvement loop (outcomes -> /retro-skills -> convention updates) has no data.
//
// Usage:
//   node .claude/scripts/append-outcome.js '<json>'
//   node .claude/scripts/append-outcome.js --task "OP-x: item" --outcome accepted --plan-file .ai/plans/OP-x.md
//
// Schema (metadata only — never transcript/PII, per kit-process.md log-sanitization):
//   { ts, task, outcome, code_review_cycles, verify_cycles, test_cycles, qa_cycles, plan_file }
//   outcome ∈ accepted | rejected | user_reverted
// Rotation: 200KB / 500 lines (matches subagent-log.js), keeps the newest.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state'); // pinned to repo, not cwd
const LOG = path.join(STATE_DIR, 'outcome-log.ndjson');
const MAX_BYTES = 200 * 1024;
const KEEP_LINES = 500;
const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'user_reverted']);

function parseArgs(argv) {
  // Single JSON blob form
  if (argv.length === 1 && argv[0].trim().startsWith('{')) {
    return JSON.parse(argv[0]);
  }
  // --flag value form
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '').replace(/-/g, '_');
    out[k] = argv[i + 1];
  }
  return out;
}

function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

try {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    process.stderr.write('append-outcome: no args. Pass a JSON blob or --task/--outcome flags.\n');
    process.exit(1);
  }
  const a = parseArgs(raw);

  if (!a.task || !a.outcome) {
    process.stderr.write('append-outcome: "task" and "outcome" are required.\n');
    process.exit(1);
  }
  if (!VALID_OUTCOMES.has(a.outcome)) {
    process.stderr.write(`append-outcome: outcome must be one of ${[...VALID_OUTCOMES].join('|')} (got "${a.outcome}").\n`);
    process.exit(1);
  }

  const entry = {
    ts: new Date().toISOString(),
    task: String(a.task).slice(0, 300),
    outcome: a.outcome,
    code_review_cycles: toInt(a.code_review_cycles),
    verify_cycles: toInt(a.verify_cycles),
    test_cycles: toInt(a.test_cycles),
    qa_cycles: toInt(a.qa_cycles),
    plan_file: a.plan_file ? String(a.plan_file).slice(0, 200) : null,
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');

  // Rotate: keep the newest KEEP_LINES if oversized.
  try {
    if (fs.statSync(LOG).size > MAX_BYTES) {
      const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(LOG, lines.slice(-KEEP_LINES).join('\n') + '\n');
    }
  } catch (_) {}

  process.stdout.write(`✓ outcome logged: ${entry.task} → ${entry.outcome}\n`);
  process.exit(0);
} catch (e) {
  process.stderr.write(`append-outcome: ${e.message}\n`);
  process.exit(1);
}
