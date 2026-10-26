---
name: agent-teams-workflow
description: Use Claude Code agent teams (multi-agent parallel coordination) for cross-cutting Motion Studio work — parallel review, debugging with competing hypotheses, cross-layer changes (engine + template + UI + tests). USE WHEN user asks for "song song", "parallel", "multi-agent", "agent teams", or task spans 3+ independent areas. SKIP for sequential tasks, single-file edits, or simple bugs (use a single session or subagents instead).
---

# Agent Teams — Motion Studio Workflow Patterns

Agent teams are off by default in this project (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0` in `.claude/settings.json`) because, while on, every named subagent becomes a teammate and loses its skills/MCP scope. Enable for one session when a team is wanted: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude`, or set it in `.claude/settings.local.json`. Agent teams let multiple Claude Code instances work in parallel with shared task list + direct teammate-to-teammate messaging. Different from subagents (which only report back to main).

## When to use teams vs subagents vs single session

| Situation | Use |
|-----------|-----|
| Single feature, sequential edits | **Single session** |
| Need quick parallel research/lookup, results return to caller | **Subagents** (Agent tool) |
| 3+ independent workers needing to communicate, debate, or claim work | **Agent teams** |
| Same-file edits or many dependencies | **Single session** (avoid file conflicts) |

## Motion Studio team patterns

The seat is company-owned and the 5-hour quota is shared. A team multiplies token spend by its size, so use one only when the work is truly parallel, and keep it to 3 teammates.

### Pattern 1 — Cross-layer feature (engine + template + UI)

```text
Create a team to add a "quote" scene kind to the testimonial template:
- Teammate 1: rules + engine (templates/testimonial/beats.json `fields`, which locks read through sceneFieldNames() in engine/jobs.mjs, validation)
- Teammate 2: renderer (templates/testimonial/template.mjs, KINDS entry, every format in beats.json)
- Teammate 3: tests (tests/engine.test.mjs, tests/templates.test.mjs)
Teammate 2 waits for teammate 1's field names before using them.
```

### Pattern 2 — Parallel review

```text
Create a team to review the current diff:
- Reviewer 1: security (security-review skill: server boundary, paths, HTML, child processes, Claude boundary)
- Reviewer 2: correctness of job state and locks
- Reviewer 3: template determinism and layout in every format (16:9, 1:1, 9:16, 4:5, 2:3, 21:9)
Each reports Critical/Warning/Suggestion with file:line.
```

### Pattern 3 — Competing hypotheses

When the cause is unclear (e.g. "stills are blank for one template"):
- Teammate 1: composition HTML (open `out/<project>/<job>/index.html`, check `__ready`, console errors)
- Teammate 2: timing (`timing.json` scene starts/ends, `seek(t)` range)
- Teammate 3: assets (copied into `assets/`, names, fonts loading)
They message each other to rule hypotheses out.

## Spawn rules

- **Spawn from the existing agent types** (`senior-dev`, `qa`, `tech-lead`). An in-process teammate does NOT get the definition's `skills` or `mcpServers`, so put the conventions into the spawn prompt: "read `.ai/docs/conventions.md` and `common-patterns.md` first".
- **Cap team size at 3.**
- **No teammate runs `/studio run`, `render` or `approve`.** The director runs once, started by a person; renders are slow and approval is human.
- **Plan approval is not a gate** — the lead auto-approves a teammate's plan. For risky work put the lead in plan mode first, or give the teammate `isolation: "worktree"`.

## File ownership — avoid conflicts

| Layer | Directory boundary |
|-------|-------------------|
| Engine | `engine/` |
| Server | `server/` |
| UI | `ui/` |
| One template | `templates/<id>/` |
| Shared template code | `templates/kit.mjs`, `templates/shared.mjs`, `motion-kit/` (one owner only) |
| Tests | `tests/` |

Two teammates editing `templates/kit.mjs` or `engine/jobs.mjs` is the most likely conflict: give each file one owner.

## Display mode

Default is `in-process` (up/down arrows select a teammate, Enter opens its transcript, `x` stops it, Ctrl+T toggles the task list). Split panes need tmux or iTerm2 and are unavailable in VS Code's terminal on Windows; opt in with `teammateMode: "auto"` in `~/.claude/settings.json` only on a machine that has tmux.

## Cleanup

Teammates are cleaned up automatically on session exit (no `TeamCreate`/`TeamDelete` step — removed in 2.1.178; every session has one implicit team). To wind a team down early, tell the **lead** (not a teammate): `Clean up the team`.

## Hooks for quality gates

Already wired in `.claude/settings.json`:
- `SubagentStop` → `subagent-log.js` logs subagent runs; whether it fires for in-process teammates is unverified — check `.claude/state/subagent-log.ndjson` after the first team run.
- `TeammateIdle` (exit 2 keeps the teammate working), `TaskCreated`, `TaskCompleted` (exit 2 blocks completion) are the team events. Wire `TaskCompleted` to `npm test` when a team ships product code.

## Limitations to remember

- No `/resume` for in-process teammates → new session = new team
- One team per session
- Can't promote teammate to lead
- Token cost scales linearly with team size — don't spawn 10 when 3 will do
- Split panes require tmux/iTerm2 — VSCode terminal can't render them
- Teammates cannot spawn their own teammates, and an in-process teammate's subagents run in the foreground (`run_in_background` fails).
- While the flag is on, any `Agent` call that passes a `name` launches a teammate — pass `name` only when a team is intended.
- Teammate requests use a 5-minute prompt-cache TTL; `subagentPromptCacheTtl: "1h"` in project settings extends it for long runs.
