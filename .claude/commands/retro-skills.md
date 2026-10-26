---
description: "Retrospective: mine recurring failure patterns from logs/reviews/plans and PROPOSE convention/skill/agent improvements (you approve — never auto-applies)"
argument-hint: "[optional: time window e.g. 'last 2 weeks' or a focus area]"
---

# Retro — self-review & improvement proposals

## Focus / window: $ARGUMENTS

Weakness-mining retro inspired by "harness engineering" self-review, but with the
human kept in the loop: this command **only proposes**. It reads evidence, finds
recurring failure patterns, and writes a proposal doc. It does **NOT** edit
`.ai/docs/`, skills, agents, or run the propagation chain — you decide what to adopt.

> Why proposal-only: auto-editing conventions invites reward hacking (loosening a
> rule to pass review faster), diversity collapse, and — specific to this kit — silent
> drift because conventions propagate to 7+ downstream files. See
> `.ai/docs/kit-process.md` § "Mandatory Update Propagation".

## Steps

1. **Gather evidence** (be explicit about which sources were thin/empty — never invent a pattern to fill a slot):
   - `git log --oneline --since="<window>"` and `git log --grep="fix\|revert\|hotfix" --since=...` — repeated fixes to the same area = a rule the code keeps breaking.
   - `.claude/state/subagent-log.ndjson` — which agents run most (frequency only; this log has no pass/fail signal — say so).
   - `.claude/state/outcome-log.ndjson` — workflow terminal states: `outcome` (accepted/rejected/user_reverted) + per-gate cycle counts (code_review/verify/test/qa). This IS the pass/fail signal — high cycle counts or rejected outcomes clustered on an area = a gate or convention gap. Raw data for cost-per-accepted-change.
   - `.claude/state/ai-failure-log.ndjson` — the AI failure pattern library: typed errors caught by reviews (`hallucinated-api`, `deprecated-api`, `wrong-edge-case`, `confident-but-wrong`, `convention-violation`). A category recurring ≥3 times (or clustered on one code area) = a candidate review-checklist or convention rule. Written only via `append-ai-failure.js` (`/ai-failure` command or workflow gates).
   - `.ai/plans/*.md` — plans whose Scope grew or whose Acceptance Criteria went unmet = scope-control / planning gaps.
   - Recent CODE_REVIEW output in the conversation/transcripts, if present — findings that recur across reviews.
   - `.claude/agent-memory/*/` and the user memory `MEMORY.md` — feedback already frozen into rules (don't re-propose what's already a rule).
   - `.ai/docs/conventions.md` — the current rule set, so proposals are net-new, not duplicates.

2. **Cluster into recurring patterns.** A pattern qualifies only if backed by ≥2 independent pieces of evidence (two commits, a commit + a review finding, etc.). One-off mistakes are noise — list them separately as "watch, not yet a rule."

3. **For each qualifying pattern, draft a proposal**:
   - **Pattern**: what keeps going wrong, with the evidence (commit SHAs, file paths, plan names).
   - **Proposed change**: exact NEVER/ALWAYS wording, or a new skill/agent tweak.
   - **Target files**: which of `.ai/docs/conventions.md` + downstream (per propagation chain) it would touch.
   - **Risk / cost**: could this over-constrain? false-positive rate? does it duplicate an existing rule?
   - **Confidence**: High / Medium / Low.

4. **Write the proposal doc** to `.ai/reports/retro-<YYYY-MM-DD>.md` (pass today's date in — do not fabricate it). Group by confidence. Do NOT touch any other file.

5. **Present a 3–5 line summary** and stop. If the user approves specific proposals, THEN apply them following `.ai/docs/kit-process.md` → "Mandatory Update Propagation" (source-of-truth first, then downstream, rebuild export, update guides, run `/check`).

## Rules
- Propose, don't apply. The only file this command writes is the retro report under `.ai/reports/`.
- Evidence or it didn't happen — every proposal cites concrete artifacts. No evidence → it's a "watch" item, not a proposal.
- Report thin evidence honestly ("subagent-log has no outcome data; frequency only"). Don't overstate confidence.
