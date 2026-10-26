---
description: "Self-healing workflow loop for ONE ticket/epic — runs IMPLEMENT→CODE_REVIEW→VERIFY→UNIT_TEST→(QA)→check-AC, and on any gate failure escalates to tech-lead → re-implement → retries, until every Acceptance Criterion is met. Unlike /workflow it does NOT hard-stop on gate failure; it heals and continues."
argument-hint: "[<slug> | path to plan .md] — or paste the AC/goal inline"
allowed-tools: Read, Edit, Write, Grep, Glob, Task, TodoWrite, Bash(node .claude/scripts/append-outcome.js:*), Bash(node .claude/scripts/append-ai-failure.js:*), Bash(git add:*), Bash(git commit:*), Bash(git status:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git show:*), Bash(npm test:*), Bash(node --test:*), Bash(node engine/cli.mjs help:*), Bash(node engine/cli.mjs list:*), Bash(node engine/cli.mjs prepare:*)
---

# Loop-Ticket — Self-Healing Workflow for One Ticket/Epic

Run a single ticket or epic through the full workflow **and keep healing until it actually meets its Acceptance Criteria**. This is the loop the user wants for "chạy đến khi hoàn thành toàn bộ theo AC": a QA or UNIT_TEST failure does NOT stop the run — it routes back to tech-lead / implementation and tries again.

> **Difference from `/workflow` and `/epic`:** those **hard-stop** after 2 fix cycles (anti-Ralph-Wiggum). `/loop-ticket` instead **escalates and continues** — but with two mandatory safety valves (no-progress detection + high-risk hard-stop) and a hard cap of 8 iterations per run, so the loop can't become an open-ended burn of the company seat's quota.

> **`--tdd` is not yet supported here.** `/workflow --tdd` (test-first: write failing tests from AC, freeze them, then implement to green — see `.claude/commands/workflow.md` § "TDD MODE") only applies to the plain `/workflow` gate sequence. `/loop-ticket`'s heal loop assumes IMPLEMENT-then-UNIT_TEST order throughout Step 2; reordering it for test-first would need its own no-progress/journal semantics (e.g. what "healing" means when the diff is a test, not product code) and hasn't been designed. Don't combine the two until this note is updated.

## Step 0 — Entry gate + resolve the AC / goal (the loop's stop condition)

**Entry gate (check FIRST, every tick — this is what makes `/loop /loop-ticket` safe across fresh-context ticks):** read the plan file if it exists and check, in order:
- `**Status:** done` OR every `## Acceptance criteria` box is `- [x]` AND the latest `## Verification` line's `@ <HEAD>` equals current `git rev-parse HEAD` → the ticket is COMPLETE. Report DONE and **end the loop — do NOT reschedule** (if invoked under `/loop`, this is the terminal state). Do not re-enter Step 1.
- `**Status:** blocked` OR the `## Loop Journal` shows a prior safety-valve STOP as its last entry, OR the same failure-signature appears in the two most recent Journal entries → the loop is thrashing / was blocked. Report BLOCKED with the stuck reason and **end the loop — do NOT reschedule.** A human must intervene. (Mirrors `/epic`'s `- [!]` entry gate, which is proven.)

- A partly-ticked `## Task breakdown` (some `- [x]`, some `- [ ]`) is NOT a terminal condition — it is a resumable walk. Continue at the first un-ticked task and treat this as a first-iteration walk, not a heal iteration: there is no handed-over failure to target. Do not re-run tasks already ticked with a Verify result.

Only if neither terminal condition holds, resolve the AC (the DONE condition), in priority order:

1. **Plan file** — `$ARGUMENTS` is `<slug>` → `.ai/plans/<slug>.md`, or a path to a `.md`. Read its `## Acceptance criteria` checklist. Preferred source (checkboxes are objective, persist on disk across ticks).
2. *(No ticket system is connected to this project.)*
3. **Inline** — the user pasted the AC/goal. Use it verbatim.

**If no AC can be resolved → STOP and ask.** A loop with no stop condition must never run. If AC came inline, WRITE them into `.ai/plans/<slug>.md` `## Acceptance criteria` (create from `plan-template.md`) first, so the checklist + `## Loop Journal` are durable across ticks.

## Step 1 — Plan (tech-lead), once up front

If the plan file has no `## Scope` / `## Files to create / modify` yet, invoke `tech-lead` to produce them from the AC (architecture, file list, risk tier per `/workflow` Step 1b, complexity call). Determine risk-enabled phases now: server boundary / job state and locks / shared code → QA enabled; new or changed template look → USER_REVIEW with stills.


## Step 2 — The heal loop

Repeat until the DONE condition (Step 3) or a safety valve (Step 4) fires. **The orchestrator (this command's own context) runs VERIFY/UNIT_TEST/QA and reads their output — it does NOT delegate the build to the implementer** (senior-dev's checklist forbids auto-build; the command context has the `npm test` / `node engine/cli.mjs` allows for exactly this). Implementation is delegated to agents; gate execution is the orchestrator's.

1. **IMPLEMENT** — Task → `dev-quick` (mechanical) or `senior-dev` (logic/multi-file/debugging), with `model:` set from `.claude/state/model-tier.json` per `/workflow` Step 2 (Model tier) — re-read it before every spawn and every gate; every spawn passes a project `subagent_type`, never `general-purpose`. A heal iteration on `senior-dev` passes `model: "fable"` at tier `full` (debugging is where the extra depth pays). On a heal iteration, pass the **specific failure** (failing test id + message, QA repro, review finding) + the relevant diff so implementation targets it, not the whole ticket again.
   **If the plan has a `## Task breakdown`, the FIRST iteration walks it task-by-task** per `/workflow` Step 2b (one task → its own `**Verify:**` → report → tick `- [x]` → next). **Heal iterations do NOT re-walk it** — they fix only the handed-over failure, then untick any task whose Verify that fix invalidated so the plan stops asserting something false. Unlike `## Acceptance criteria` and `## Scope` (durable, never reset), task boxes are **re-openable** — a failed re-run unticks. Newly ticked task boxes count as **progress** for the Step-4 no-progress detector.
2. **CODE_REVIEW** — Task → independent `explore` agent reviews the diff vs conventions + AC. Critical/Warning → feed back into IMPLEMENT.
3. **VERIFY (mandatory, orchestrator runs it).** `npm test` + `node engine/cli.mjs help`. If a template or the render path changed, also `node engine/cli.mjs prepare <project> <job>` on a demo job and read the stills.
   - Failure → capture the error signature → back to IMPLEMENT.
4. **UNIT_TEST (orchestrator runs it)** — run the suite for the touched area (delegate WRITING new tests to qa/senior-dev; RUN them here). Failure → capture failing test id(s) → back to IMPLEMENT.
5. **QA (if risk-enabled).** The UI must already be running at http://127.0.0.1:4780 (`npm run ui`, started by the person). Probe it; if it does not answer, STOP and ask the person to start or restart it. Never start, restart or kill the server from the loop.
   - **Latest code served:** the server does not reload itself. After a server or engine change, ask the person to restart `npm run ui` before QA.
   - Then Task → `qa` agent, browser QA against the AC. Failure → capture repro → back to IMPLEMENT.
   - **Motion Studio smoke opens every browser-QA pass:** 0 uncaught console errors, job list loads, job status matches `status.json`, writes carry `X-Studio: 1` (qa-test skill).
   - **Visual ACs on templates:** read every storyboard still in each changed format; text readable, nothing clipped, icon matches meaning. Save the stills paths as evidence.
   - **Drive the real UI early, per item:** for any UI or route item, a live Playwright smoke at that item catches wrong routes and wrong data that unit tests miss.
   - **When observed behaviour contradicts a "verified"/`[x]` claim, distrust the claim and re-observe live.**
   - Leave the UI running for later items; never stop it.
6. **CHECK AC** — re-evaluate each `## Acceptance criteria` box against observable behavior; tick `- [x]` the newly-met ones.
7. **JOURNAL (every iteration, mandatory)** — append one line to the plan file's `## Loop Journal`: `<iso-ts> | iter N | <gate that ran> | <failure-signature or "green"> | <action: implement/re-plan/tick AC k>`. **This is the loop's only cross-tick memory** — without it the no-progress detector (Step 4) is blind after a `/loop` tick. The failure-signature must be stable+comparable (e.g. `UNIT_TEST:engine.test.mjs:locked field survives:deepEqual` — test id + assertion, not a full stack trace).
8. **COMPREHENSION EXPLAINER (only on a GREEN iteration that changed product code — the anti-cognitive-debt gate)** — an autonomous loop writes far more code than a human reads; without a deliberate step, the human loses the conceptual thread and can no longer steer (Geoffrey Litt, *Understanding is the New Bottleneck*, 2026). So on each iteration where all gates went green AND product code changed, write a short **explainer of THAT iteration's change** to `.claude/state/loop-explainers/<slug>-iterN.md` — prose, not a diff dump. Structure it as: (a) **What changed & why** — 2-4 sentences of intent + the problem it solved, in plain language before any code; (b) **Where** — the touched files as a narrative (`X calls Y which now …`), not an alphabetical list; (c) **What to know to review it** — the one non-obvious thing a reviewer needs (a hidden constraint, a shared consumer affected, a convention applied), linking related memories with `[[name]]` where relevant; (d) **Open questions** — anything the loop decided reversibly and a human might want to revisit (mirrors the Loop-Journal note). Skip this step for a green iteration that only touched tests/docs/config — nothing changed on the product's runtime surface, so there is no behaviour for a human to re-enter. Append the explainer path to the Loop Journal line so it is discoverable. This is the durable "understanding trail" a human reads to re-enter the loop without diffing every commit — the practical, unattended-loop form of Litt's comprehension quiz (a quiz needs a human in the seat; an explainer trail does not).

**On any gate failure, escalate correctly:**
- *Local bug* (wrong selector, off-by-one, missing null-check) → back to IMPLEMENT directly (cheaper).
- *Structural* (wrong approach, AC unreachable with current design, repeated cross-cutting breakage) → re-invoke **tech-lead to REVISE the existing plan in place** (edit `## Scope`/`## Files`/`## Risks` only; preserve all `- [x]` AC/Scope states — never recreate from template), then IMPLEMENT against the revision. Include the failing diff in the revision prompt (tech-lead can't see it otherwise). This is the "tự khắc quay lại tech-lead" the user asked for.

## Step 3 — DONE condition

DONE only when **every** `## Acceptance criteria` box is `- [x]` AND, in the SAME final iteration, VERIFY + UNIT_TEST (+ QA if enabled) were all green (never trust a green ticked in an earlier iteration — the "same iteration" rule defeats stale-green). Then, in order:
- Commit remaining changes on the current branch with an explicit file list, once this folder is a git repository (never push).
- `node .claude/scripts/append-outcome.js --task "<slug>: <title>" --outcome accepted --code-review-cycles N --verify-cycles N --test-cycles N --qa-cycles N --plan-file .ai/plans/<slug>.md`
- Set plan `**Status:** done`; write the green-pass line into `## Verification` including `@ <git rev-parse HEAD>` (the entry gate uses this to recognize completion on a later tick without re-running everything).
- **Consolidate the understanding trail into the plan file (shared space).** The per-iteration explainers live in `.claude/state/loop-explainers/` which is **git-ignored** — they help *you* but never reach the team. So on DONE, distill them into a `## What the loop built` section **in the plan file** (`.ai/plans/<slug>.md`, which IS tracked + shared): **open with one plain-business-language sentence** (the stakeholder explainer — what it delivers for the user/business, no jargon), then 3-6 sentences of prose covering the shape of the change, the non-obvious decisions, and anything a reviewer/teammate must know — NOT a re-listing of diffs. This is the durable team-readable artifact (Litt's "shared spaces": build a common mental model, not private notes). Keep the raw per-iter files as the detailed backing trail; the plan section is the summary the next human actually reads.
- Report the run summary, and in it link the explainer trail so the human's first action after a hands-off loop is *reading to understand*, not *diffing to reconstruct*. **This is the loop's terminal state: do NOT reschedule / end any enclosing `/loop`.**

### PUBLISH

Not configured for this project (no remote, no PR tooling). If the invocation asks for a PR, say so in the report.

## Step 4 — Safety valves (STOP and ask — non-negotiable even with "no iteration limit")

These valves, plus the 8-iteration cap, keep the loop bounded: the seat and its quota are company-owned. **Every safety-valve stop does ALL THREE: (a) append the reason to `## Loop Journal` and set `**Status:** blocked`, (b) log `--outcome rejected` via append-outcome.js, (c) report and END the loop — do NOT reschedule any enclosing `/loop`.** The Step 0 entry gate then keeps a later tick from re-entering.

- **No-progress detector** — compare the current failure-signature against the `## Loop Journal` (NOT just in-context memory — a `/loop` tick starts fresh; the Journal is the only cross-tick record). If the same signature appears in the two most recent iterations with **neither a new AC box nor a net-new `## Task breakdown` box** ticked between them, STOP: thrashing, not healing. Record task ticks in the Journal line (`tick T3`) or the detector cannot see them — an iteration that verified five tasks but could not yet tick an AC is real progress, and stopping it discards proven work. "Net-new" matters: an untick/re-tick of the SAME task is not progress, and a third untick of one task is itself a thrash signature.
- **AC unreachable** — if tech-lead concludes an AC can't be met without new scope, a product decision, or missing info, STOP and surface it. Loops don't invent requirements.
- **Iteration cap** — 8 iterations per invocation. On the 8th without DONE, STOP, journal it and report; a person decides whether to run again.
- **High-risk / irreversible** — anything touching the server boundary, secrets, or a Claude/model call that would ship without human review, or any irreversible op (migration, dependency change, `git push` outside the keyword-gated PUBLISH step, deletion outside scope) → STOP and ask. Never auto-proceed past these regardless of AC pressure.

## Step 4b — Autonomous decision policy (don't ask for ordinary choices)

Outside the three Step-4 valves above, **the loop runs fully autonomously and MUST NOT stop to ask the user how to proceed** — it picks the most optimal path itself and continues until every AC is met. Specifically:

- **Item ordering / "do X first?"** — decide by the plan's dependency order + lowest-risk-first; don't ask. (e.g. do independent cleanup items whenever convenient; never pause to ask which item to do next.)
- **Gate failures (VERIFY/UNIT_TEST/QA)** — heal automatically (local fix, else tech-lead re-plan) and retry; never ask.
- **"Pause to let me review?"** — do NOT offer this for items outside the high-risk areas. Only the high-risk valve pauses.
- **Ambiguous-but-reversible choices** — pick the option that best satisfies the AC + conventions, note the choice in the Loop Journal, and continue. A reversible wrong choice is caught by a later gate; asking is more expensive than healing.

The ONLY interactive stops permitted are the Step-4 valves (no-progress, AC-unreachable, iteration cap, high-risk/irreversible). Everything else = decide + proceed. For a high-risk item (e.g. a change to the server's host/origin checks): do ALL of code + review + VERIFY + UNIT_TEST + QA autonomously, tick the observable AC, append a Loop Journal `ready-for-commit` line, then STOP **only** at the commit step for human diff review — do not ask anything before that point.

**Non-negotiable process invariants (every loop, every item):**
- **Full gate per item** — IMPLEMENT → CODE_REVIEW → VERIFY (`npm test`, mandatory) → UNIT_TEST → QA (when enabled). Never skip a gate to move faster; a red gate heals, it does not get bypassed.
- **QA everything** — when the loop runs with QA enabled, every UI-bearing item gets real browser QA; the final item runs an end-to-end QA pass. No "assumed passing".
- **Commit per item, incrementally** — after an item's gates are all green, commit THAT item on the current branch with an explicit file list (`git add <this item's files>`, never `git add -A`/`.`), so progress is durable and each commit is one reviewable unit. (High-risk items stop at the commit step for human review instead.)
- **No `git push`.** The loop commits locally only, and only once this folder is a git repository.

## Usage

```
/loop-ticket quote-scene                 # read AC from .ai/plans/quote-scene.md, heal until all AC met (max 8 iterations)
/loop /loop-ticket quote-scene           # same, but survive compact/context boundaries WITHIN one quota window
/loop-ticket "Goal: <paste AC here>"    # inline AC — will be written into a plan file first
```

> **Quota reset ≠ compact boundary.** `/loop` survives context compaction inside one session, but when you hit the **session usage limit** ("resets <time>"), the process is API-blocked and NOTHING in-session (including `/loop`) resumes automatically. After the reset, manually re-run the loop command (or `claude --continue`) in the same chat — it reads the plan's AC checkboxes + `## Loop Journal` and continues from the first un-`[x]` item. See the plan template's `## Resume across quota reset`.

Design rationale: the stop condition is **objective AC**, not "the model thinks it's done" (anti-Ralph-Wiggum). Healing replaces hard-stop so the user's "quay lại tech-lead rồi tiếp tục" happens automatically; the no-progress and high-risk valves plus the 8-iteration cap keep it bounded. State lives in the plan file's AC checkboxes + outcome-log, so it survives `/loop` ticks and sessions.
