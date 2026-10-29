---
description: "Compare an approved plan file against the code actually implemented — catch scope drift, unmet AC, and stale plan state"
argument-hint: "[<slug> or plan slug]"
---

# Plan Sync

## Target: $ARGUMENTS

Harness-inspired (`/harness-sync`) drift check: verdict on whether the code on
this branch still matches the plan that was approved for it. **Read-only on
source** — this reports drift, it does not fix code or edit the plan's
content (only `Status:`/`Verification:` bookkeeping, and only on confirm).

Distinct from `/check`'s `check-propagation.js` (which compares AI-config
rules against their mirrors) — this compares ONE plan file against the
actual diff on the branch.

## Steps

1. **Locate the plan file**
   - `.ai/plans/$ARGUMENTS.md` (accept `<slug>`, `<slug>.md`, or a slug).
   - If it doesn't exist, list `.ai/plans/*.md` and ask which one — do NOT
     guess or fabricate a plan from the diff.

2. **Gather the real diff**
   ```bash
   git diff --stat master...HEAD
   git log --oneline master..HEAD
   ```
   If the branch has no plan-relevant commits yet, say so and stop — nothing
   to sync.

3. **Scope drift** — cross-check the diff's file list against the plan's
   **Scope** and **Files to create / modify** table:
   - Files changed but NOT in the plan → flag as **scope creep** (list them;
     note if they look accidental — e.g. formatter-only diffs — vs a real
     unplanned addition).
   - Files planned but with NO matching change → flag as **incomplete**.
   - Files in the plan's **Out of scope** section that WERE touched anyway →
     flag as a **contract violation** (highest severity — this is the one
     the plan explicitly promised not to do).

4. **Acceptance criteria drift** — for each `## Acceptance criteria` checkbox:
   - Read the actual code/behavior for that item (don't trust the checkbox
     state alone — a stale plan may say `[x]` for something later reverted,
     or `[ ]` for something actually done in a later commit).
   - Classify: ✅ met and reflected correctly · ⚠ met but checkbox stale ·
     ❌ unmet despite `[x]` · ⏳ genuinely not yet done.
   - For any user-facing AC, don't accept an API/unit-level check alone as
     proof — note if the AC needs a real UI verification pass that hasn't
     happened (a template change is checked by reading its stills, not by
     an API or unit check alone).

4b. **Task breakdown drift** (only if the plan has `## Task breakdown` AND is not an epic plan —
   an epic's unit of progress is `## Epic Backlog`, and its template-derived Task breakdown may
   still hold unfilled `### T1 — <title>` placeholders that are not real work) — for each task:
   - Does the diff contain that task's changes? A `- [x] done` with no matching
     code is the exact lie this command exists to catch.
   - Does the task carry a stated Verify result, or just a tick? An unproven
     tick is worth flagging even when the code is there.
   - Conversely: shipped code under a `- [ ]` task means the tick was skipped —
     the work happened but the contract does not record it.
   - A tick with an explicit deviation note ("unnecessary because…") is fine.

5. **External system contract drift** (only if the plan has this section) —
   check whether endpoints/config actually used in code still match what the
   plan recorded (wire casing, config-vs-code split, propagation steps). This
   section rots fastest since it documents a system this repo doesn't own.

6. **Architecture drift** (only if the plan has a `## Architecture` section
   and the task was Medium/High) — does the actual data flow still match the
   diagram, or did implementation take a different seam than planned? Note
   drift, don't require a perfect match — flag only if the seam materially
   differs (affects the Risks & impact analysis).

7. **Emit the sync report** (paste-ready):

```
═══════════════════════════════════════════
  🔄 PLAN SYNC — <<slug>> <title>
═══════════════════════════════════════════

  Plan status: <Status: field>          Branch: <branch>
  Plan commits on branch: <n>            Last plan edit: <if determinable>

  ## Scope drift
  ✅ matches / ⚠ <n> unplanned files / ❌ <n> Out-of-scope files touched
  - <file> — <planned | unplanned | out-of-scope-violation>

  ## Acceptance criteria drift
  - [x] <criterion> — ✅ met, verified <how>
  - [x] <criterion> — ⚠ checkbox stale: <what actually changed>
  - [ ] <criterion> — ⏳ not yet done

  ## External system contract drift
  - <endpoint/field> — ⚠ plan says X, code does Y

  ## Architecture drift
  - <seam> — plan vs actual, if materially different

  ## Verdict
  <one of:>
  - IN SYNC — plan accurately describes the code as of <sha>
  - DRIFTED — <n> discrepancies above; plan needs updating OR code needs
    to catch up to scope before merge
  - STALE — plan predates a since-changed approach; recommend re-planning
    rather than patching the plan post-hoc
═══════════════════════════════════════════
```

8. **If drift found, ask the user which direction to reconcile**:
   - "Update the plan to match the code" (scope/AC genuinely evolved,
     document the new reality) — only edit the plan's checkboxes/Scope
     table/Status on explicit confirm, never silently.
   - "Flag for the implementer to bring code back into scope" — no file
     edits, just the report.
   - "Just show me the drift" — report only, no edits either way.

## Rules
- Report drift faithfully — a "DRIFTED" verdict is a normal, useful outcome,
  not a failure to hide.
- Never mark an Acceptance criterion `[x]` based on your own inference alone
  — only flip a checkbox when the user confirms the reconciliation direction.
- Do not touch feature code. This command produces a report (and, on
  confirm, plan-file bookkeeping) only.
- If the plan uses `/loop-ticket`'s `## Loop Journal`, read the last few
  entries first — they may already explain a drift (e.g. a documented
  deliberate deviation) rather than it being an oversight.
