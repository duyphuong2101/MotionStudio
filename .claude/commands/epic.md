---
description: "Epic mode: batch-loop /workflow over a plan file's Epic Backlog — one item at a time, objective gates per item, hard stops on failure"
argument-hint: "[<slug> or path to plan file]"
---

# Epic Mode — Batch Loop over a Plan Backlog

Run repetitive batch work (Type B: many similar, independent items — e.g. add `srcset` to N blocks, fix N convention violations, migrate N Redesign blocks) as a gated loop. NOT for one large interconnected feature — that stays plan-file-driven with USER_REVIEW checkpoints between phases.

## Input: $ARGUMENTS

Resolve to a plan file: a slug → `.ai/plans/<slug>.md`; otherwise treat as a path. The plan MUST contain an `## Epic Backlog` section with `- [ ]` checkbox items and a `## Pattern` section describing the shared recipe (what to change per item, which conventions apply, how to verify). If either section is missing, stop and ask the user to run tech-lead planning first — epic mode executes a recipe, it does not invent one.

**Entry gate (check FIRST, before any item):** if the backlog already contains a `- [!]` blocked item, STOP and report BLOCKED — do NOT process remaining items. A blocked item means a previous run hit a systematic failure; resuming past it (on the next `/epic` run or `/loop` tick) would just repeat the failure across the rest of the backlog. The user must resolve or delete the `- [!]` item before the epic can continue.

**Risk-routing gate:** if the backlog items touch a Step 1b risk area (server boundary, job state and locks, shared code) and the `## Pattern` declares no QA-equivalent check, STOP and ask — epic mode runs no per-item browser QA, so an unguarded risky batch must not proceed silently.

## Per-Item Cycle

For each unchecked `- [ ]` item, in order:

1. **IMPLEMENT** — apply the Pattern to this item. Route by the epic's complexity call (stated in the plan): `dev-quick` for mechanical edits, `senior-dev` if the pattern involves logic; set `model:` from `.claude/state/model-tier.json` per `/workflow` Step 2 (Model tier), re-read before every item; every spawn passes a project `subagent_type`, never `general-purpose`. No per-item tech-lead planning — the Pattern section IS the plan. **Ignore any `## Task breakdown` in the plan file**: that section is the ticket-level execution contract for `/workflow`, and an epic plan created from the template may still carry its placeholders. Here the `## Pattern` is the per-item spec, and the `## Epic Backlog` checkbox is the unit of progress.
2. **CODE_REVIEW (scoped)** — `explore` agent reviews ONLY this item's diff against the Pattern + conventions. Critical/Warning → fix → re-review (max 2 cycles).
3. **VERIFY (mandatory, never skipped).** `npm test` + `node engine/cli.mjs help` after every item. If the item changed a template, also `node engine/cli.mjs prepare <project> <job>` on the demo job the Pattern names and look at the stills. Max 2 fix cycles.
   The UI server is never started or restarted by the epic; a person does that.
4. **UNIT_TEST** — only if the Pattern declares testable logic; mechanical/markup-only items may skip (state so in the log).
5. **On pass**: complete these three steps IN ORDER (the order is the crash-safety mechanism; the tick on disk is the resume marker):
   1. **Commit the item's code** — only once this folder is a git repository: `git add <the item's files>` (never `git add -A`/`.`), then `git commit`. Never push. Until then, skip this step and say so in the report.
   2. **Tick the checkbox** `- [x]` in the plan file (on disk; survives `/loop` ticks because the working tree persists). Because commit precedes tick, a crash between them leaves the item committed-but-unticked → the next tick re-runs it and the re-commit is an empty no-op (safe), never a lost item or a double-applied change.
   3. **Log the outcome** by running the writer script (never hand-edit the file):

   ```bash
   node .claude/scripts/append-outcome.js --task "<slug>: <item text>" --outcome accepted \
     --code-review-cycles N --verify-cycles N --test-cycles N --qa-cycles 0 --plan-file .ai/plans/<slug>.md
   ```

**Risk routing note:** epic mode does NOT run per-item QA even when `/workflow` Step 1b would auto-enable it (e.g. shared-code epics) — per-item browser QA across N items is the Pattern's job to address. If the epic touches a Step 1b risk area, the Pattern MUST declare the equivalent check (e.g. one QA pass on a sample item at the start, then per-item VERIFY only), or the plan should not use epic mode.

## Hard Stops (the loop must be stoppable, not just startable)

- **Item fails VERIFY or UNIT_TEST after 2 fix cycles** → mark it `- [!] <item> — BLOCKED: <one-line reason>`, run `node .claude/scripts/append-outcome.js --task "<slug>: <item>" --outcome rejected --verify-cycles 2 --plan-file .ai/plans/<slug>.md` (the strongest `/retro-skills` signal — don't let epic failures go unlogged), then **STOP the entire epic** and report. Do NOT continue to the next item — with homogeneous items, a systematic failure would just repeat N more times.
- **Per-item CODE_REVIEW after 2 cycles** → proceed and log remaining findings (same as `/workflow`); only VERIFY/UNIT_TEST failures hard-stop the epic.
- **Per-run cap: 5 items** → stop after 5 completed items even if more remain. This is the checkpoint where a human can sample the commits. Under `/loop`, the next tick resumes automatically.
- **Anything irreversible or out-of-pattern** (deletion outside the item's scope, migration, dependency change, push) → stop and ask. Epic mode never widens its own scope.
- **All items checked** → report DONE with totals. If running under `/loop`, do NOT reschedule — the loop ends here.
- **PUBLISH:** not configured for this project (no remote, no PR tooling). If the invocation asks for a PR, say so in the report.

## Report (end of every run)

```
═══════════════════════════════════════════
  🔁 EPIC RUN — <slug>
═══════════════════════════════════════════
  Completed this run: N items (list)
  Remaining: N | Blocked: N (reasons)
  Commits: N (on <branch>, not pushed)
  Gates: VERIFY N/N passed, tests N/N
  Next: [resume via /epic or /loop | DONE | BLOCKED — needs user]
═══════════════════════════════════════════
```

## Usage

```
/epic template-copy-pass             # one batch (≤5 items)
/loop /epic template-copy-pass       # keep running batches until DONE or BLOCKED
```

Design rationale: objective gate per item (VERIFY), state lives in the plan file's checkboxes + outcome-log (survives sessions), hard stops prevent the silent-completion failure mode ("Ralph Wiggum loop" — completes quietly because nothing forces it to prove itself).
