#!/usr/bin/env node
/**
 * PostToolUse hook for Edit/Write — plan-as-file guardrail.
 *
 * Non-blocking nudge (Harness-inspired): once a change touches ENOUGH source
 * files that it clearly isn't a trivial dev-quick edit, and NO plan file under
 * .ai/plans/ has been touched this session, remind that a plan file (repo-local contract)
 * is the contract CODE_REVIEW and /release-evidence rely on.
 *
 * Deliberately soft: prints a one-time reminder, never exits non-zero. Trivial
 * single-file fixes stay frictionless; only real multi-file work is nudged.
 *
 * Stdin JSON: { tool_name, tool_input: { file_path }, ... }
 * State: .claude/.plan-guard-state.json (session-local, gitignored dir)
 */

const fs = require("fs");
const path = require("path");

const SOURCE_RE = /\.(mjs|cjs|js|css|html)$/i;
const PLAN_RE = /(^|\/)\.ai\/plans\/.+\.md$/;
// Paths that are tooling/config/tests, not feature source — don't count toward the threshold.
const IGNORE_RE = /(^|\/)(\.claude|\.cursor|\.ai\/docs|\.ai\/plans|qa-tests|node_modules)\/|\/Temp\/claude\//i;
const THRESHOLD = 2; // distinct source files before we nudge

let chunks = "";
process.stdin.on("data", (c) => (chunks += c));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(chunks || "{}");
  } catch {
    process.exit(0);
  }

  const raw = (data.tool_input?.file_path || "").replace(/\\/g, "/");
  if (!raw) process.exit(0);

  const stateFile = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".claude", ".plan-guard-state.json");
  let state = { files: [], planTouched: false, nudged: false };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
  } catch {
    /* first write this session */
  }

  if (PLAN_RE.test(raw)) {
    state.planTouched = true;
  } else if (SOURCE_RE.test(raw) && !IGNORE_RE.test(raw)) {
    if (!state.files.includes(raw)) state.files.push(raw);
  }

  try {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    /* best-effort; never block on state I/O */
  }

  const shouldNudge =
    !state.planTouched && !state.nudged && state.files.length >= THRESHOLD;

  if (shouldNudge) {
    state.nudged = true;
    try {
      fs.writeFileSync(stateFile, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    const msg = [
      `⚠ ${state.files.length} source files changed with no plan file in .ai/plans/.`,
      "  Multi-file work should have a plan file (the repo-local contract CODE_REVIEW",
      "  and /release-evidence read). Create one from .ai/plans/plan-template.md,",
      "  or ignore this if it's a trivial fix. See .ai/plans/README.md.",
    ].join("\n");
    // Plain PostToolUse stdout never reaches Claude — use additionalContext.
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
      })
    );
  }
  process.exit(0);
});
