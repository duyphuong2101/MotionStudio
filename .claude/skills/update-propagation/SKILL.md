---
name: update-propagation
description: Propagate a config change across agents, skills, Cursor/Copilot mirrors and CLAUDE.md. Use when adding or modifying any rule, convention, pattern, safety rule, workflow, or hook — a config change is NOT done until propagated.
---

# Update Propagation

When **any** rule, convention, pattern, safety rule, workflow or hook is added or modified, the agents and skills that reference it **MUST** be updated in the same change:

1. **Edit the source of truth** — `.ai/docs/conventions.md` for rules; `common-patterns.md`, `architecture.md`, `file-index.md` for patterns and structure.
2. **Regenerate mirrors** — `node .claude/scripts/generate-mirrors.js` (marked blocks in `.cursor/rules/project.mdc`, `.claude/skills/project-conventions/SKILL.md`, `AGENTS.md`, `.github/copilot-instructions.md`).
3. **Update by hand** — `CLAUDE.md` (every security NEVER must appear), `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `.cursor/agents/*.md`, `.cursor/rules/*.mdc`, `.cursor/commands/*.md`, `.cursor/skills/*/`, `.ai/docs/kit-process.md`.
4. **Protected files** (`.claude/settings*.json`, `.claude/hooks/*.js`, `.claude/scripts/*.js`, `.cursor/hooks*`, `.mcp.json`) — prepare the change and hand it to the person; do not work around `protect-files.js`.
5. **Verify** — `node .claude/scripts/check-propagation.js`, `node .claude/scripts/spec-lint.js`, `bash .ai/scripts/detect-leftovers.sh`.

**A change is NOT complete until steps 1–5 are done.** This applies to changes found during review, debugging or ad-hoc sessions too.

Full details: `.ai/docs/kit-process.md` § "Mandatory Update Propagation".
