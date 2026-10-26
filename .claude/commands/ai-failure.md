---
description: "Log an AI failure pattern (hallucinated API, deprecated hook, wrong edge case, confident-but-wrong) into the AI failure library — or review accumulated patterns"
argument-hint: "[description of the AI error just caught] | review"
---

# AI Failure Log — the AI failure pattern library

## Input: $ARGUMENTS

Build the "AI failure pattern library": every time an AI error is caught, log the **TYPE** of error, not just the one-off fix — the library accumulates so reviewers smell the same class of error faster next time. `/retro-skills` uses this log as evidence.

## Mode 1 — Log (default): `$ARGUMENTS` is an error description

1. Classify the error into the right category:
   | Category | Meaning |
   |---|---|
   | `hallucinated-api` | Invented function/library/composable that does not exist |
   | `deprecated-api` | API/hook is deprecated or its signature changed |
   | `wrong-edge-case` | Plausible logic but wrong on an edge case (null, empty, boundary) |
   | `confident-but-wrong` | Confident assertion that is factually wrong |
   | `convention-violation` | NEVER/ALWAYS rule violated despite being in context |
   | `other` | Anything else |
2. Write via the script (the ONLY writer — never hand-edit the ndjson):
   ```bash
   node .claude/scripts/append-ai-failure.js --category <category> \
     --description "<one-line description>" --file "<related file if any>" \
     --caught-by user --task "<<slug> if any>"
   ```
3. Confirm in 1 line: chosen category + why.

## Mode 2 — Review: `$ARGUMENTS` = "review"

1. Read `.claude/state/ai-failure-log.ndjson`
2. Group by `category` and by code area (`file` prefix), count frequencies
3. Report: top recurring patterns, trend over time, and recommendations — any pattern recurring ≥3 times is a candidate review-checklist/convention rule (recommend running `/retro-skills` for a formal proposal; do NOT edit conventions from here)

## Automatic logging from the workflow (no need to call this command)

- `senior-dev` self-review catches an AI-typed error → runs the script itself with `--caught-by self_review`
- CODE_REVIEW (explore agent, read-only) → **flags** under an "AI Failure Patterns" heading in its output; the orchestrator runs the script with `--caught-by code_review`
- A VERIFY/UNIT_TEST/QA failure whose root cause fits the taxonomy → the orchestrator logs it with the matching `--caught-by`
