#!/usr/bin/env node
// Stop hook: nudge (never block) when a session committed feature work but the
// outcome-log didn't grow. Enforcement half of the outcome-log pipeline —
// append-outcome.js writes, this catches a forgotten write.
//
// Heuristic v2 — count REFLOG "commit" entries, not history advance.
// v1 compared ancestry (merge-base --is-ancestor prev..HEAD): a checkout from a
// detached/old commit to a descendant tip passes that test, so external history
// movement (checkout to tip, pull --ff) counted as "commits landed this session"
// (false-fired 2026-07-29: 33 pulled commits, session made zero). Reflog subjects
// distinguish the cases: only entries starting with "commit" (commit:,
// commit (amend):, commit (initial):, commit (merge):) are work committed in
// THIS workspace; checkout:/pull:/merge:/rebase:/reset: entries never count.
// Accepted gaps: cherry-pick/revert subjects don't start with "commit" (rare in
// a workflow turn); an amend of a pre-session commit counts (it IS a new
// committed state worth logging).
//
// Emits hookSpecificOutput.additionalContext so the model actually sees it
// (plain Stop stdout only reaches the transcript). Must stay SYNC — async Stop
// output is not processed for additionalContext.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Pin state AND git to THIS repo, not process.cwd() — a Stop fired from a subdir
// must not scatter stray .claude/state dirs or read another repo's reflog.
// __OG_STATE / __OG_REPO exist for the adversarial test harness only.
const STATE_DIR = process.env.__OG_STATE || path.join(__dirname, '..', 'state');
const REPO_DIR = process.env.__OG_REPO || path.join(__dirname, '..', '..');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return {}; }
}
function lineCount(f) {
  try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}
function git(args) {
  try { return execSync(`git ${args}`, { cwd: REPO_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
function emit(msg) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: msg },
  }));
}
// Best-effort litter control: drop marker files older than 7 days (one per session).
function sweepOldMarkers() {
  try {
    const cutoff = Date.parse(process.env.__OG_NOW || '') || Date.now();
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.startsWith('.outcome-guard-')) continue;
      const p = path.join(STATE_DIR, f);
      try { if (cutoff - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

try {
  const data = readInput();
  const sessionId = (data.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  sweepOldMarkers();

  const markerFile = path.join(STATE_DIR, `.outcome-guard-${sessionId}.json`);
  const logFile = path.join(STATE_DIR, 'outcome-log.ndjson');
  const reflog = git('reflog --format=%gs');
  const subjects = reflog ? reflog.split('\n') : [];
  const now = { reflogCount: subjects.length, logLines: lineCount(logFile) };

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch {}
  fs.writeFileSync(markerFile, JSON.stringify(now));

  // New reflog entries since the previous Stop are the newest N lines (reflog is
  // newest-first, append-at-top). A negative delta means the reflog was pruned
  // or gc'd mid-session — skip rather than guess. A pre-v2 marker (no
  // reflogCount) also yields no baseline: first v2 Stop just records one.
  const newEntries = prev && Number.isInteger(prev.reflogCount)
    ? subjects.slice(0, Math.max(0, now.reflogCount - prev.reflogCount))
    : [];
  const committed = newEntries.filter((s) => /^commit\b/.test(s)).length;

  if (committed > 0 && now.logLines <= prev.logLines) {
    emit(
      `⚠ ${committed} commit(s) were created in this workspace since the last Stop but outcome-log.ndjson did not grow. ` +
      `If this was a /workflow, /epic, or /loop-ticket completion, append the outcome now:\n` +
      `  node .claude/scripts/append-outcome.js --task "<id: summary>" --outcome accepted|rejected|user_reverted ` +
      `--verify-cycles N --plan-file .ai/plans/<id>.md\n` +
      `(This is the only signal /retro-skills learns from — skip it and the improvement loop goes blind.)`
    );
  }
  process.exit(0);
} catch (e) {
  process.exit(0); // never block Stop
}
