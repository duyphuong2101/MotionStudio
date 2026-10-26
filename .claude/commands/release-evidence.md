---
description: "Package release evidence from a plan file: PR summary + CHANGELOG entry + verification checklist"
argument-hint: "[<slug> or plan slug]"
---

# Release Evidence

## Target: $ARGUMENTS

Harness-inspired final step: turn the committed plan file into ready-to-paste PR
evidence so release facts aren't rebuilt from memory. **Read-only on source** —
this generates artifacts, it does not change feature code.

Run `/plan-sync $ARGUMENTS` first if the plan hasn't been drift-checked this
session — this command trusts the plan's Scope/AC as accurate and doesn't
re-derive drift itself (step 2 below is a lighter-weight version of the same
check, kept for when `/plan-sync` wasn't run).

## Steps

1. **Locate the plan file**
   - `.ai/plans/$ARGUMENTS.md` (accept `<slug>`, `<slug>.md`, or a slug).
   - If it doesn't exist, list `.ai/plans/*.md` and ask which one — do NOT invent evidence without a plan.

2. **Gather the real diff** (don't trust the plan's file list blindly)
   ```bash
   git diff --stat develop...HEAD
   git log --oneline develop..HEAD
   ```
   Cross-check changed files against the plan's **Scope** and **Files** table. Flag any file changed that the plan didn't list (scope creep) and any planned item with no matching change (incomplete).

3. **Confirm verification actually ran**
   - Read the plan's **Verification** section. If empty or unproven, say so explicitly in the output — never claim a build/test passed that wasn't run. Report failures with their output.

4. **Emit the evidence block** (paste-ready):

```
═══════════════════════════════════════════
  📦 RELEASE EVIDENCE — <<slug>> <title>
═══════════════════════════════════════════

  ## PR Summary (stakeholder-facing — plain business language, no jargon)
  <2–4 sentences a PM/client understands: what this delivers for the user/business and why, from plan Intent (`For whom / outcome`) + Scope. Translate technical → business ("faster checkout", not "memoized the selector"). This is the "explain a technical decision to a non-technical stakeholder" artifact.>

  ## Changes
  - <file/area> — <what>
  ...

  ## Scope check
  Planned vs actual: ✅ matches / ⚠ N extra files / ⚠ N planned items unfinished

  ## Acceptance criteria
  - [x] <criterion> — met
  - [ ] <criterion> — NOT met (why)

  ## Verification
  - Build: ✅ / ❌ / ⚠ not run
  - Unit tests: <n passed> / ⚠ not run
  - Browser QA: <result> / ⚠ not run

  ## CHANGELOG entry
  - <<slug>>: <one-line user-facing summary>
═══════════════════════════════════════════
```

5. **Append to CHANGELOG.md** (only if the user confirms — this is an outward-facing file)
   - If `CHANGELOG.md` exists at repo root, add the entry under the current `## [Unreleased]` / sprint section (keep existing style).
   - If it does NOT exist, ask before creating one — don't introduce a new convention silently.

6. **Update the plan file** — set its `Status:` to `done` and fill the Verification section with what actually ran.

## Rules
- Report outcomes faithfully. If a check was skipped, write `⚠ not run`, not `✅`.
- Do not push, tag, or open a PR unless the user explicitly asks.
- Source code is read-only here; the only writes are CHANGELOG.md (on confirm) and the plan file's status.
