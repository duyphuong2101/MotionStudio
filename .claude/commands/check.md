---
description: Run all project checks (tests, engine smoke, AI config propagation)
allowed-tools: Bash(npm test:*), Bash(node --test:*), Bash(node engine/cli.mjs help:*), Bash(node engine/cli.mjs list:*), Bash(node .claude/scripts/check-propagation.js:*), Bash(node .claude/scripts/spec-lint.js:*), Bash(bash .ai/scripts/detect-leftovers.sh:*)
---

## Your task

Run every available check and report results.

1. **Tests**: `npm test`
2. **Engine smoke**: `node engine/cli.mjs help` and `node engine/cli.mjs list`
3. **AI config**: `node .claude/scripts/check-propagation.js`, `node .claude/scripts/spec-lint.js`, `bash .ai/scripts/detect-leftovers.sh`

There is no linter, type checker or build step in this repo; do not invent one.

**Report results**: pass/fail per check, with details only for failures.
