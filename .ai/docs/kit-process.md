# Motion Studio — AI kit process

Process and reference detail moved out of `CLAUDE.md` (which loads on every turn). Read this when you change the AI config itself, not for everyday coding.

## Mandatory Update Propagation

A rule, convention, pattern, safety rule, workflow or hook change is not done until it is propagated.

1. Edit the source of truth: `.ai/docs/conventions.md` (rules), `.ai/docs/common-patterns.md` (patterns), `.ai/docs/architecture.md` / `file-index.md` (structure).
2. Regenerate the rule mirrors: `node .claude/scripts/generate-mirrors.js`. It rewrites only the marked NEVER/ALWAYS blocks in `.cursor/rules/project.mdc`, `.claude/skills/project-conventions/SKILL.md`, `AGENTS.md` and `.github/copilot-instructions.md`.
3. Update by hand what references the change: `CLAUDE.md` (every security NEVER must appear there), `.claude/agents/*.md`, `.cursor/agents/*.md`, `.claude/skills/*/SKILL.md`, `.cursor/rules/*.mdc`, `.claude/commands/*.md`, `.cursor/commands/*.md`, `.agents/rules/motion-studio.md` (Antigravity). A change to the studio skill is made in `.claude/skills/studio/SKILL.md` only, then `node .ai/scripts/sync-director-prompt.js` copies it to `.cursor/skills/studio/` and `.agents/skills/studio/`.
4. Verify:
   ```bash
   node .claude/scripts/check-propagation.js
   node .claude/scripts/spec-lint.js
   bash .ai/scripts/detect-leftovers.sh
   ```

The `propagation-reminder.js` hook prints the downstream list whenever a file in `.ai/docs/` is edited.

## Safety tiers

- **Floor** (never override; ask the user): the security NEVER block in `conventions.md`, blocked commands (`block-destructive.js`) and protected files (`protect-files.js`).
- **Guardrails**: every other NEVER/ALWAYS. Can be overridden for a specific change with a written reason.

Protected files (`.claude/settings*.json`, `.claude/hooks/*.js`, `.claude/scripts/*.js`, `.cursor/hooks*`, `.mcp.json`, secrets, lock files) are edited by a person. For a deliberate config session a person may set `NSC_ALLOW_CONFIG_EDIT=1` (the kit's variable name) in their own environment; it does not unlock `.mcp.json`, secrets or lock files.

## Claude usage limits (company seat)

- Claude runs only inside Claude Code, started by a person. No project code, cron, scheduler or `claude -p` job runs it unattended.
- Director runs are capped by `config/studio.json` → `director`.
- `/loop-ticket` stops after 8 iterations per invocation; `/epic` after 5 items per run; `/workflow` hard-stops after 2 fix cycles per gate.
- Agent teams are off (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`); a team is capped at 3 teammates.
- One subagent in flight at a time in the workflow commands; the model tier (`.claude/state/model-tier.json`) only steps models down.

## Agents

| Agent | Model | Use |
|---|---|---|
| `tech-lead` | fable | Planning, architecture, task breakdown |
| `senior-dev` | opus (fable for high-risk/debugging) | Medium/High implementation |
| `dev-quick` | sonnet | Low-complexity edits |
| `qa` | opus | Tests, browser QA of the local UI |
| `explore` | sonnet, read-only | Codebase Q&A, independent CODE_REVIEW |

Cursor mirrors them in `.cursor/agents/` (plus `senior-dev-deep`).

## Skills

| Skill | Purpose |
|---|---|
| `studio` | The `/studio run` director (also `/studio` in Cursor, Copilot and Antigravity, see below) |
| `project-conventions` | Rule summary (generated NEVER/ALWAYS) |
| `template-authoring` | Create or change a video template |
| `server-route` | Add or change a UI server route |
| `testing-patterns`, `gen-test` | `node:test` conventions |
| `code-review`, `security-review` | Review checklists |
| `frontend-design` | UI and template layout planning |
| `qa-test` | Browser QA persona and report |
| `explain-code`, `refactor-guide`, `update-propagation`, `agent-teams-workflow` | General |

## Other coding agents

The Director runs in any agent a person types `/studio run` into. Each one reads the same skill and its own entry file:

Approval is UI-only for every agent: `node engine/cli.mjs approve` refuses (`tests/cli-approve.test.mjs`), and render needs that approval. The last column is the extra check before `render` or `sequence`.

| Agent | Always-on rules | `/studio` | Skill copy | Asks before render/sequence |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` | skill `studio` | `.claude/skills/studio/` (the source) | seat allowlist (`director.allowedTools`) refuses them |
| Cursor | `AGENTS.md`, `.cursor/rules/` | `.cursor/commands/studio.md` | `.cursor/skills/studio/` | `.cursor/hooks/ask-before-render.js` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/prompts/studio.prompt.md` | `.agents/skills/studio/` | `.vscode/settings.json` → `chat.tools.terminal.autoApprove` |
| Google Antigravity | `.agents/rules/motion-studio.md` (+ `AGENTS.md` on versions that read it) | `.agents/workflows/studio.md` | `.agents/skills/studio/` | none in the repo (optional: the terminal deny list in Antigravity's settings) |

Outside the seat the Director runs on that tool's own model and account; the caps are the ones the skill states (`director.maxJobsPerRun` through `list --queued`, two fix rounds, one run at a time). `tests/worker-prompt.test.mjs` fails when a skill copy drifts.

## Commands

`/workflow` (full gated flow), `/epic` (batch), `/loop-ticket` (self-healing, capped), `/qa`, `/review`, `/test`, `/scaffold` (new template), `/check`, `/build` (runtime readiness — there is no build step), `/deploy-check`, `/fix`, `/refactor`, `/explain`, `/search`, `/doc`, `/optimize`, `/handover`, `/plan-sync`, `/release-evidence`, `/status`, `/ai-failure`, `/retro-skills`, `/verify-config`, `/upstream-check`, `/skip-workflow`, `/branch`.

## Hooks (`.claude/settings.json`)

| Event | Hook | Does |
|---|---|---|
| SessionStart | `session-start.js` | Session housekeeping |
| UserPromptSubmit | `inject-context.js` | Injects NEVER/ALWAYS from `conventions.md` on coding or security prompts |
| PreToolUse Edit/Write | `protect-files.js` | Blocks edits to secrets, lock files and the kit's own guards |
| PreToolUse Bash | `block-destructive.js` | Blocks destructive commands and secret dumps |
| PostToolUse Edit/Write | `auto-format.js` | Prettier when configured (no-op here) |
| PostToolUse Edit/Write | `propagation-reminder.js` | Lists downstreams after a `.ai/docs/` edit |
| PostToolUse Edit/Write | `security-lint.js` | Flags injection/secret patterns |
| PostToolUse Edit/Write | `plan-guard.js` | Nudges for a plan file on multi-file work |
| PostToolUse Task | `update-todo-after-task.js` | Keeps the workflow todo list in step |
| Stop | `outcome-guard.js`, `stop-notify.js` | Outcome log reminder, notification |
| SubagentStop | `subagent-log.js` | Logs subagent runs |
| PreCompact | `pre-compact.js` | Saves context before compaction |
| Notification | `notify.js` | Desktop notifications |

## Logs

- Outcomes: `node .claude/scripts/append-outcome.js ...` → `.claude/state/`
- AI failure patterns: `node .claude/scripts/append-ai-failure.js ...` → `.claude/state/ai-failure-log.ndjson`; reviewed by `/ai-failure review` and `/retro-skills`.
