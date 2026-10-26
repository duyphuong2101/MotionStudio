---
name: running-tests-without-bash
description: How to run npm test when the senior-dev agent has no Bash tool, and how to read node:test output
metadata:
  type: reference
---

The senior-dev agent may start without a Bash/PowerShell tool. `Monitor` (loaded via ToolSearch) runs shell commands, so use it to run tests:
`cd "/c/Projects/Motion Studio" && node --test --test-reporter=tap tests/*.test.mjs 2>&1 | grep -E --line-buffered "^(not )?ok |^# (tests|pass|fail)"`

**Why:** with piped (non-TTY) output, `npm test` uses the spec reporter, which prints `ℹ tests N` and not `# tests N`. A grep for TAP lines then shows only the failures and no summary.

**How to apply:** use `--test-reporter=tap` whenever you filter test output. Tests that write fixtures use `zz-test-*` project ids under `briefs/` and `out/` and remove them in `t.after`.
