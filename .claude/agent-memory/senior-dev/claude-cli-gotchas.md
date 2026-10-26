---
name: claude-cli-gotchas
description: Where claude.exe lives on this machine, hidden --max-turns flag, and how to probe CLI flags without spending seat quota
metadata:
  type: reference
---

- On the owner's Windows machine `claude` is NOT on PATH (no claude.cmd either). The only native binary is the VS Code extension's: `%USERPROFILE%\.vscode\extensions\anthropic.claude-code-<ver>-win32-x64\resources\native-binary\claude.exe` (2.1.299 on 2026-10-14). `server/director.mjs` → `resolveClaude` falls back to it (highest version).
- `--max-turns` is hidden from `claude --help` but accepted (probe printed "option '--max-turns <turns>' argument missing"). Unknown flags are rejected with "unknown option", so a typo fails before any model call.
- Zero-quota flag probe: `claude.exe -p <flag-without-value> </dev/null`. It errors during argument parsing and never reaches the model.
- `--permission-prompts none` exists (2.1.x): with -p, anything not pre-allowed is denied instead of prompting.
- Project `.claude/settings.json` allow rules (e.g. `Bash(node -e *)`, `Bash(npm install*)`) also apply to a headless child, so the director run denies them with `--disallowedTools`.
- No Bash tool in this agent: run commands through Monitor (see [[tooling-gotchas]]).
