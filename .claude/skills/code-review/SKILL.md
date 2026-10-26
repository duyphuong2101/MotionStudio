---
name: code-review
description: Perform code quality review on changed files — quality + correctness + DRY review; for security-only deep audits use security-review. Use when reviewing diffs, PRs, or after significant code changes.
argument-hint: [file-or-path]
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git show:*)
---

Review the code at $ARGUMENTS for quality issues.

## Review Checklist

0. **Plan-file contract (if a plan exists)**: if `.ai/plans/<slug>.md` covers this change, verify the diff stays within its Scope (flag scope creep) and satisfies every Acceptance Criterion — an unmet criterion is a **Critical** finding. If the plan is Medium/High and has NO `## Task breakdown` at all, that is a **Warning** — the section is required and its absence skips the whole per-task verification mechanism. If it does have one, check every task box: shipped code under an unticked task, or a `- [x]` with no Verify result written beside it (`- [x] done — <command> → <outcome>`), is **Critical** — that exit criterion is otherwise self-attested by the implementer with nothing checking it. A task ticked with a deviation note ("unnecessary because…") is fine. In `/epic` mode, review each item's diff against the plan's `## Pattern` recipe instead — epic plans have no Task breakdown.
1. **Correctness**: Logic errors, off-by-one errors, null/undefined handling, race conditions
2. **Security**: Injection, auth issues, data exposure, hardcoded secrets
3. **Performance**: unbounded loops, repeated file reads in a loop, a child process per item where one would do, frame-by-frame work that could be done once, memory held across renders
4. **Project conventions** (see `.ai/docs/conventions.md`): no model call from server/engine/UI, except the two person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key) and `server/generate.mjs` (Gemini assets with the person's own key); localhost-only server checks intact; `assertId`/`within()` on outside ids; `escapeHtml`/`jsonForScript` in compositions; `spawn` with args array, `shell:false`, timeout, capped log; templates deterministic (`seek(t)` only); `StudioError` for expected failures; English product text
5. **Duplicate code (DRY)**: Flag new code that duplicates an existing helper.
   - Check: `engine/core.mjs` (`assertId`, `within`, `readJson`, `writeJson`, `escapeHtml`, `jsonForScript`, `StudioError`)
   - Check: `templates/kit.mjs` (`page`, `geometry`, `checkBrand`, `asset`, `num`), `templates/shared.mjs`, `motion-kit/icons.mjs`
   - Check: `engine/media.mjs` (`ffmpeg`, `probeMedia`, `openComposition`, `lintInPage`), `engine/jobs.mjs` (`setStatus`, locks)
   - Check the diff against the plan's `## Reuse & extension`. A rule changed on one side only (`beats.json` limit vs renderer layout, server validation vs UI editor, a new script field missing from its template's `beats.json` `fields`, which is all locks read) is Critical.
6. **Reusability**: If 2+ templates or modules share the same logic → extract it into `kit.mjs`, `shared.mjs` or `core.mjs`.
7. **Impact analysis**: For ANY modified shared code (`core.mjs`, `jobs.mjs`, `kit.mjs`, `shared.mjs`, `icons.mjs`), grep all imports across `engine/`, `server/`, `templates/`, `tests/`. List every impacted file; for `kit.mjs` that means every template.
8. **Extensibility without regressions**: shared code changed only additively (optional param or field whose default keeps today's output). A changed signature, return shape, default, `beats.json` field meaning or `status.json` shape, a caller-specific `if` inside shared code, or an existing test edited so it passes → Critical unless the plan lists every consumer updated.
9. **Accessibility (if UI changed)**: buttons for actions, visible focus, keyboard reachable, status not conveyed by colour alone, readable contrast in `ui/app.css`
10. **Testing**: Are changes covered by tests? Are edge cases addressed?
11. **Comments**: Default is none — allowed only on genuinely hard-to-understand code where the WHY is non-obvious; one short line max. Flag any comment that restates WHAT the code does (well-named identifiers should convey that), any multi-line comment block that could be reduced, or a comment on straightforward code.
12. **AI-generated code lens** (mandatory when the diff was AI-implemented — i.e. every workflow run):
   - **Hallucination check**: every NEW imported function, API or field referenced in the diff actually exists — grep each symbol; an invented identifier is a Critical finding (`hallucinated-api`)
   - **Deprecated API check**: hooks/APIs used match the CURRENT signature in this repo (not an older/newer version of the library) (`deprecated-api`)
   - **"Looks right but suspicious"**: mark every spot that reads plausibly but you cannot verify from the code alone — plausible logic with an unchecked edge case (null/empty/boundary), or a confident claim the diff doesn't prove (`wrong-edge-case` / `confident-but-wrong`). Do not let plausibility substitute for verification.
13. **Product lens**: does the change serve the plan's stated Intent / user outcome? Flag work that adds no user or business value (gold-plating, speculative options), and requirements from the Intent that the diff silently dropped.
14. **Job state and locks** (diff touches `engine/jobs.mjs`, `engine/pipeline.mjs` or a `PUT` route): a status change that bypasses `setStatus`, a director commit that bypasses `mergeRespectingLocks`, or a UI edit that bypasses `humanEdit` is **Critical**.

## Process

1. Read the changed files or diff
2. Understand the intent of the changes
3. Check each item in the review checklist
4. **For DRY check**: Search the codebase for similar patterns to the new code
5. **For impact check**: If shared files were modified, run grep to find ALL consumers
6. Report findings grouped by severity:
   - **Critical**: Bugs, security issues, data loss risks, duplicate code that should reuse existing, broken impact on other files
   - **Warning**: Performance issues, convention violations, missed reuse opportunities
   - **Suggestion**: Style improvements, minor optimizations

## Output Format

For each finding:
- File and line reference
- Severity level
- Description of the issue
- Suggested fix (if applicable)

### Reuse & Impact Section (always include)
```
## Reuse Analysis
- Existing code reused: [list or "none applicable"]
- New code that could be extracted: [list or "none needed"]
- Duplicate code found: [list or "none"]
- Extension point: [the default-preserving seam used, or "n/a"]

## Impact Analysis
- Shared files modified: [list or "none"]
- Consumers checked: [list of files grep'd]
- Regressions found: [list or "none"]
- Existing behaviour changed in place: [list or "none"]
```

### AI Failure Patterns (include when any finding is an AI-typed error)
For each finding that matches the failure taxonomy — `hallucinated-api`, `deprecated-api`, `wrong-edge-case`, `confident-but-wrong`, `convention-violation` (rule was in context yet violated) — list it here so the orchestrator can log it (this skill runs read-only; the orchestrator or `senior-dev` runs `node .claude/scripts/append-ai-failure.js --category <cat> --description "..." --file <path> --caught-by code_review`):
```
## AI Failure Patterns
- [category] file:line — one-line description
```

## Update Propagation

If this review discovers a **new rule, convention, pattern, or security issue** that should be codified (e.g., a new NEVER rule, a reusable pattern worth documenting, a QA gotcha):

**Flag it in the review output under a "New Rules / Conventions Discovered" heading** — that is the reviewer's whole job here. This skill runs read-only (the workflow CODE_REVIEW reviewer is the `explore` agent, which has no write tools), so do NOT edit files from the review. The orchestrator or `senior-dev` then applies the propagation chain: update `.ai/docs/conventions.md`, run `node .claude/scripts/generate-mirrors.js`, update affected agents/skills/Cursor mirrors, rebuild export, update HTML guides, and verify with `node .claude/scripts/check-propagation.js`.

See `.ai/docs/kit-process.md` → "Mandatory Update Propagation" for the full chain.
