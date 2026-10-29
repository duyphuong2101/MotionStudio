# /epic — Batch loop over a plan file's Epic Backlog

Input: a plan slug (→ `.ai/plans/<slug>.md`) or a plan file path.

The plan MUST have `## Pattern` (shared recipe, written once by tech-lead) + `## Epic Backlog` (`- [ ]` checkbox items). If missing, stop and ask for tech-lead planning first — epic mode executes a recipe, it does not invent one.

Entry gate: if the backlog already has a `- [!]` blocked item, STOP and report — don't resume past a systematic failure. Risk gate: if items touch a Step 1b risk area (server boundary, job state and locks, shared code) and the Pattern declares no QA-equivalent, STOP and ask — epic runs no per-item browser QA.

Per unchecked item, top-down:
1. Implement the Pattern for this item (no per-item re-planning). **Ignore any `## Task breakdown`** — that section is `/workflow`'s ticket-level execution contract, and a template-derived epic plan may still carry its unfilled `### T1 — <title>` placeholders. Here `## Pattern` is the spec and the `## Epic Backlog` checkbox is the unit of progress.
2. Scoped review of this item's diff against Pattern + conventions (max 2 fix cycles)
3. **VERIFY gate**: `npm test` + `node engine/cli.mjs help`; a template item also `prepare` on a demo job and a look at the stills (mandatory — max 2 fix cycles)
4. Unit tests if the Pattern declares testable logic
5. On pass, IN ORDER (on-disk tick is the resume marker): (a) once the folder is a git repository, `git add <this item's files>` — never `-A`/`.` — then `git commit` (**never push**); skip this until then; (b) tick `- [x]` on disk (survives loop ticks); (c) log via `node .claude/scripts/append-outcome.js --task "<slug>: <item>" --outcome accepted --verify-cycles N --plan-file .ai/plans/<slug>.md` (the ONLY writer — never hand-edit the ndjson). Commit-before-tick means a crash leaves the item committed-but-unticked → next run re-runs it as a safe empty no-op.

Hard stops:
- Item fails after 2 cycles → mark `- [!] <item> — BLOCKED: <reason>`, run `node .claude/scripts/append-outcome.js --task "<slug>: <item>" --outcome rejected --verify-cycles 2 --plan-file .ai/plans/<slug>.md`, STOP the whole epic (systematic failures repeat)
- Max 5 items per run → checkpoint for human sampling
- `.claude/state/quota-pause.flag` at `stop` → finish the current item, end the run (not blocked); at `warn`, do not start a large item
- Anything irreversible/out-of-pattern (out-of-scope deletion, migration, dependency change, push outside the keyword-gated PUBLISH) → stop and ask
- All items checked → report DONE with totals
- PUBLISH: not configured for this project (no remote, no PR tooling).

Claude Code equivalent: `.claude/commands/epic.md`.

- Commit the item before ticking `- [x]` — `.ai/plans/` is gitignored, so a crash then re-runs the item safely.
- Anything irreversible or out-of-pattern → stop and ask.
