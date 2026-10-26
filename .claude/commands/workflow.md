---
description: "Run the complete development workflow: TODO → IMPLEMENT → CODE_REVIEW → VERIFY → UNIT_TEST → DONE (with optional USER_REVIEW, QA)"
argument-hint: "[feature description or task]"
---

# Development Workflow

## Task: $ARGUMENTS

---

## TASK STATUS

Initialize with TodoWrite:

```javascript
// Default flow — VERIFY is a mandatory objective gate, not optional:
[
  { content: "📋 [TODO] Task: $ARGUMENTS", status: "completed", activeForm: "Task created" },
  { content: "🔄 [IMPLEMENT] Planning & Implementation", status: "in_progress", activeForm: "Implementing" },
  { content: "🔍 [CODE_REVIEW] Independent code review", status: "pending", activeForm: "Reviewing" },
  { content: "✅ [VERIFY] Tests + engine smoke", status: "pending", activeForm: "Verifying" },
  { content: "🧪 [UNIT_TEST] Write & run unit tests", status: "pending", activeForm: "Unit testing" },
  { content: "🎉 [DONE] Task complete", status: "pending", activeForm: "Complete" }
]

// With user review (user requests OR Step 1b auto-enables — new or changed template look): add between CODE_REVIEW and VERIFY:
  { content: "👤 [USER_REVIEW] User reviews implementation", status: "pending", activeForm: "Awaiting user review" },

// With QA (user requests OR Step 1b auto-enables — UI/server boundary or shared code): add between UNIT_TEST and DONE:
  { content: "🌐 [QA] Browser-based QA testing", status: "pending", activeForm: "Browser QA" },

// --tdd flag (or "làm theo TDD" / "viết test trước"): TEST_FIRST replaces IMPLEMENT's position —
// test writing happens BEFORE product code, and there's no separate UNIT_TEST phase (it merges into TEST_FIRST + the code-side pass in IMPLEMENT):
[
  { content: "📋 [TODO] Task: $ARGUMENTS", status: "completed", activeForm: "Task created" },
  { content: "🧪 [TEST_FIRST] Write failing tests from Acceptance Criteria", status: "in_progress", activeForm: "Writing tests" },
  { content: "🔄 [IMPLEMENT] Write code until tests pass (no test edits)", status: "pending", activeForm: "Implementing" },
  { content: "🔍 [CODE_REVIEW] Independent code review", status: "pending", activeForm: "Reviewing" },
  { content: "✅ [VERIFY] Tests + engine smoke", status: "pending", activeForm: "Verifying" },
  { content: "🎉 [DONE] Task complete", status: "pending", activeForm: "Complete" }
]
```

**VERIFY is the objective gate:** DONE requires the real build/typecheck output. An implementer's "compiles without errors" is a claim, not evidence, and a loop with no forced proof completes quietly on broken code.

---

## STATUS FLOW

```
Default:     📋 TODO ──► 🔄 IMPLEMENT ──► 🔍 CODE_REVIEW ──► ✅ VERIFY ──► 🧪 UNIT_TEST ──► 🎉 DONE
                              ▲               │                   │               │
                              │  Issues found  │   Build failed    │  Test failed  │
                              └───────────────┴───────────────────┴───────────────┘

Full:        📋 TODO ──► 🔄 IMPLEMENT ──► 🔍 CODE_REVIEW ──► 👤 USER_REVIEW ──► ✅ VERIFY ──► 🧪 UNIT_TEST ──► 🌐 QA ──► 🎉 DONE
                              ▲               │                    │                │               │               │
                              │  Issues/Rev.  │                    │  Build failed  │  Test failed  │   QA failed   │
                              └───────────────┴────────────────────┴────────────────┴───────────────┴───────────────┘

--tdd:      📋 TODO ──► 🧪 TEST_FIRST ──► 🔄 IMPLEMENT ──► 🔍 CODE_REVIEW ──► ✅ VERIFY ──► 🎉 DONE
                              ▲                 │                  │                 │
                              │  Test disputed   │  Tests still red │  Build failed   │
                              └─────────────────┴──────────────────┴─────────────────┘
```

VERIFY runs in every path now — USER_REVIEW is the only optional gate, not VERIFY itself. `--tdd` reorders TEST_FIRST ahead of IMPLEMENT and folds UNIT_TEST into it — see "TDD MODE (--tdd)" below for the full phase definition.

---

## TDD MODE (--tdd)

**Triggers:** `/workflow --tdd ...`, or the user says "làm theo TDD" / "viết test trước" / "test-first". Not auto-enabled by risk tier — always an explicit opt-in, since it changes phase order for the whole task.

**What changes vs default flow:** test-writing moves from Phase 5 (UNIT_TEST, after code) to a new **Phase 0.5: TEST_FIRST** (after planning, before code exists). There is no separate UNIT_TEST phase in `--tdd` — the tests written in TEST_FIRST are the same tests IMPLEMENT must turn green; nothing is written twice.

### Phase 0.5: TEST_FIRST
**Status:** 🧪 `TEST_FIRST`
**Agent:** `qa`
**Runs:** immediately after tech-lead's plan (Step 1 below), before any implementer touches product code.

1. Read the plan file's `## Acceptance criteria` (Medium/High) or the task description directly (Low — `--tdd` on a Low task still gets a plan file section for this, since there's nothing to derive tests from otherwise).
2. Write tests that encode each Acceptance Criterion as an assertion — one test (or a small group) per criterion, not a vague catch-all. Follow the `testing-patterns` skill for framework/structure as usual.
3. **Run the tests and confirm they FAIL** (Red) — a test that passes against nonexistent/unchanged code is testing nothing (a tautology or a leftover from copy-paste). This confirmation is part of the phase's output, not optional.
4. Report the test files + the Red confirmation to the user/orchestrator before IMPLEMENT starts.
5. **Report the individual test NAMES back** (the strings a runner's `-t` filter matches), grouped by the AC each belongs to. tech-lead binds them to tasks in step 6 below.

**Exit criteria:** every AC has a corresponding test; all new tests confirmed Red; test intent matches the AC wording (a reviewer could read the test and recover the criterion); the test-name list has been reported.

### `--tdd` × `## Task breakdown`

The two mechanisms need one rule or they contradict each other: a task's `**Verify:**` normally runs a test file, but under `--tdd` that whole file stays Red until the LAST task lands — so every earlier task would be unverifiable, which the template forbids.

6. **A task's Verify names the specific frozen tests that task is responsible for**, not the file:
   `**Verify:** node --test --test-name-pattern "locked field survives" tests/engine.test.mjs` — never a bare `npm test` that is guaranteed red.
   tech-lead writes the `## Task breakdown` AFTER TEST_FIRST reports its test names (step 5), so each task can cite the subset it must turn green. A task whose Verify can only be satisfied once a later task lands is the template's "too small" case — merge them.
   A non-test observable check ("prepare demo job → still 2 shows the quote") is still a valid Verify; the prohibition is only on a bare test-file path that is guaranteed red.
   Writing a `-t` filter is NOT editing a frozen test — the test-lock rule concerns the test's content, not how it is selected.

**→ Always:** Proceed to Phase 1 (IMPLEMENT), test files now frozen inputs to it.

---

## PHASE 1: IMPLEMENT
**Status:** 🔄 `IMPLEMENT`
**Agents:** `tech-lead` (planning) → `dev-quick` OR `senior-dev` for implementation + self-review (`dev-quick` = sonnet for Low; `senior-dev` = opus for Medium/High and fable for high-risk areas and debugging — Step 1b/Step 2)

**Under `--tdd`, this phase's job is narrower: make the frozen tests from TEST_FIRST pass (Green) — nothing more, nothing that requires changing them.** If the plan also has a `## Task breakdown`, the two compose: still walk it one task at a time per Step 2b, but each task's Verify is the `-t`-filtered subset of frozen tests bound to it in TEST_FIRST step 6. A task is done when ITS tests are green; the whole file goes green only after the last task.

**Test-lock rule (mandatory under `--tdd`):** the implementer MUST NOT edit, delete, weaken, or `.skip` any test written in TEST_FIRST to make it pass — same principle as `qa`'s gate-integrity rule in UNIT_TEST/QA, applied to the implementer instead. If a test appears wrong, contradicts the spec as the implementer understands it, or seems to encode a misunderstood requirement:
1. **STOP implementing that criterion.** Do not silently code around the test or "interpret" it loosely to pass.
2. Report the specific mismatch (test file:line, what it asserts, why the implementer believes it's wrong) as a finding — surface it at CODE_REVIEW (or immediately to the user if working solo/Low-complexity, no CODE_REVIEW gate to route through).
3. The user (or CODE_REVIEW acting on the plan's Intent) decides: fix the test (rare — means TEST_FIRST misread the AC) or fix the implementer's understanding. Only whoever owns that decision edits the test; the implementer resumes coding once it's resolved.
4. Never resolve the dispute by making the code match a *different* behavior than either the test or the AC states — that's a third, unreviewed outcome.

Disputes about test correctness are a CODE_REVIEW/user decision, not a unilateral implementer fix — the same boundary that already prevents `qa` from editing tests to turn a red gate green (see `.claude/agents/qa.md` § Gate integrity) now applies symmetrically to the implementer under `--tdd`.

### Step 1: Planning (tech-lead)
- **Spec-first — answer BEFORE designing anything:** "Who is this for, and what user/business outcome does it create?" If unanswerable from the ticket, ask the user — do not invent it. Then list **2–3 options + trade-offs** and state the chosen one + why (goes into the plan file's `## Options considered`). Skip the options step only for Low-complexity mechanical tasks.
- Analyze requirements
- Survey existing codebase patterns
- Design architecture and identify files to create/modify — for Medium/High tasks, capture it as the plan file's `## Architecture` section (mermaid or text: components, data flow, the seam the change touches). Skip for Low mechanical.
- Fill the plan's `## Reuse & extension` for Medium/High (conventions.md § "Extensibility without regressions").
- Break down into ordered tasks — for Medium/High, write them into the plan's `## Task breakdown`, every task carrying its own `**Verify:**` command or observable check. Size each as **the smallest change that can still be verified on its own** (not a file count: one line can be a task, and a type rename plus its six consumers is also one task, because the build only goes green once they all land). Equally, never bundle independent ideas under one Verify — when it fails you cannot tell which broke. Sanity check each split: *if this Verify fails, is it obvious which decision was wrong?* "Could be any of three things" means split further. Step 2 executes them one at a time against those Verify lines.
- **Estimate complexity (Low / Medium / High)** — this routes the implementer in Step 2
- **Assess risk tier** — this routes the phase set in Step 1b (Risk-Based Phase Routing below)
- **Write the plan to a file** (Medium/High only): create `.ai/plans/<slug>.md` from `.ai/plans/plan-template.md`. This repo-local contract is what CODE_REVIEW checks against and what `/release-evidence` consumes. Skip for trivial `dev-quick` tasks. See `.ai/plans/README.md`.

### Step 1b: Risk-Based Phase Routing

tech-lead's risk assessment auto-enables optional phases — no user keyword needed. **User keywords always override** this table (both directions: "skip QA" disables an auto-enabled QA; "chạy QA" enables it regardless of tier).

| Ticket signal (any match, highest wins) | Auto-enabled phases | Implementer model (tier `full`) | Rationale |
|---|---|---|---|
| Touches the **server boundary** (host/origin checks, uploads, file serving), **secrets**, or **anything that calls Claude or a model provider** | + security-review skill on the diff | `senior-dev` with `model: "fable"` | A mistake here exposes the machine or the company seat; unit tests alone don't prove the boundary |
| Touches **job state, locks, render/TTS process control** | + engine test for the state change | `senior-dev` with `model: "fable"` | Lost human edits and runaway processes are the expensive failures |
| **Debugging / root-cause task** (unclear cause, blank stills, timing drift) | Default | `senior-dev` with `model: "fable"` | Diagnosis quality compounds |
| Modifies **shared code** (`core.mjs`, `jobs.mjs`, `kit.mjs`, `shared.mjs`, `icons.mjs`) | + QA | `senior-dev` (opus) | Regression risk spans every template and route |
| **New or changed template look** | + USER_REVIEW (before VERIFY) with stills from `prepare` | `senior-dev` (opus) | Visual acceptance is the user's call |
| Copy/CSS only (Low, no logic) | Default; UNIT_TEST may be skipped | `dev-quick` (sonnet) | Nothing to unit-test; VERIFY still runs (never skippable) |
| Everything else (Medium/High, no signals above) | Default flow | `senior-dev` (opus) | CODE_REVIEW + VERIFY + UNIT_TEST already cover it |

The model column is the tier-`full` default; the quota tier (Step 2) only ever steps it down. **User keywords override the model too**: "dùng fable" / "use fable" pins `model: "fable"` for every implementer spawn of this ticket, "dùng sonnet" / "cheap" pins sonnet; `tech-lead` planning stays on fable unless the tier says otherwise. Announce the routing decision in the plan output (e.g. "Risk tier: server boundary → security review, implementer fable") so the user can override before implementation starts.

### Step 2: Implementation
Route by tech-lead's complexity estimate:

| Complexity | Implementer | Model | Typical work |
|------------|-------------|-------|--------------|
| **Low** | `dev-quick` | sonnet (agent default) | Single-file edits, CSS tweaks, copy changes, a `beats.json` limit, obvious one-line bug fixes |
| **Medium / High** | `senior-dev` | opus (agent default); `model: "fable"` on a debugging task or a `/loop-ticket` heal iteration | Multi-file changes, new templates/routes/engine steps, architecture, real debugging |

**Every spawn names a project agent.** Each `Agent()` call in this workflow passes `subagent_type` from the table in `CLAUDE.md` (`tech-lead`, `senior-dev`, `dev-quick`, `qa`, `explore`). The built-in `general-purpose` and `Explore` types and un-typed spawns carry no effort pin, no `project-conventions` skill and no MCP scope, and they fall outside the model tier — the subagent log showed 78% of runs there, at the lead's effort. The one exception: a broad read-only sweep across many files may use the built-in `Explore`, outside the CODE_REVIEW phase.

**One agent in flight at a time.** The phases run as a chain — tech-lead → senior-dev → explore → qa — and each spawn waits for the previous one's result and receives only that result, not a fresh read of the whole ticket. Never split IMPLEMENT into several agents per slice, never run reviewers in parallel, and no agent spawns a child: `senior-dev` has the Agent tool disallowed, so builds and tests run through its own Bash. Parallel spawns happen only when the user asks for them ("song song", "parallel", "agent teams"). The seat and its 5-hour quota are company-owned: every extra agent is spend the team shares.

**Model tier.** Before every Agent spawn read `.claude/state/model-tier.json` (written by `statusline.js` from the worse of the 5-hour and 7-day quota windows; `source` names which one is binding). `full` → agent defaults (tech-lead fable, senior-dev opus, qa opus, explore/dev-quick sonnet), plus `model: "fable"` for senior-dev on debugging/heal work. `reduced` → `"opus"` for senior-dev/qa/tech-lead (no fable anywhere), `"sonnet"` for explore/dev-quick. `minimal` → `"sonnet"` for all but tech-lead (`"opus"`). `stop` → finish the current item per the QUOTA GUARD and end. No file, or a manual file past its `expires_at`, means no quota signal — run at `full`. The statusline only gets that signal in the CLI on a Pro/Max plan; in the VS Code extension or on a Team/Enterprise plan, set the tier by hand for a long run: `node .ai/scripts/set-model-tier.js reduced --hours 5` (also `minimal`, `full`). Re-read at each gate so a long run steps down mid-loop; the tier never steps a spawn *up* above the agent's own default.

**Effort and thinking follow the task, not a fixed setting.** Subagent effort is the agent type's frontmatter (`tech-lead` xhigh, `senior-dev` high, `qa` medium, `dev-quick`/`explore` low) — the Agent tool's `effort` parameter (v2.1.292) can override that pin, but it is passed only on an explicit user, CLAUDE.md or skill instruction, so by default choosing the agent *is* choosing the effort: route a mechanical edit to `dev-quick` even inside a High ticket, and a debugging heal iteration to `senior-dev`. The lead's effort is set only by the user via `/effort`; ask for `xhigh` while planning or debugging a P0/architecture ticket, `medium` for review/verify/bookkeeping turns, `low` at tier `minimal`. Thinking: Fable 5.1 always thinks and is steered by effort alone; on an Opus/Sonnet fallback keep thinking on (`alwaysThinkingEnabled: true` in user settings) — Opus 5 with thinking off can write a tool call into visible text and the loop silently loses it.

If `dev-quick` hits its STOP rule (task turns out to touch 3+ files, change architecture, or need real debugging), it escalates back to `senior-dev`.

The chosen implementer then:
- Implements the plan's `## Task breakdown` **one task at a time** (see Step 2b). Only when the plan has no such section does it work in one pass — and if the task was called Medium/High, say so out loud first, because the section was required and its absence means the mechanism is being skipped silently
- Self-reviews: correctness, security, performance, accessibility, architecture
- Fixes any issues found during self-review

### Step 2b: Task-at-a-time execution (Medium/High)

When the plan has a `## Task breakdown`, work it in order — never open all the files at once:

1. **Implement ONE task.** Touch only the files that task lists. If the work turns out to need a file the task doesn't list, stop and say so — either the task was mis-scoped (fix the plan first) or you are drifting into the next task.
2. **Run that task's `**Verify:**` immediately.** Not the full suite, not the final gate — the specific command or observable check the plan names for this task.
3. **Report the result in one line** before moving on: `T3 — keep locks on re-commit | Verify: node --test tests/engine.test.mjs → 14/14 pass ✓`. A failing Verify is fixed NOW, inside the same task; it is never carried into the next one or deferred to VERIFY.
4. **Tick the task in the plan file, carrying the evidence with it** — `- [x] done — node --test tests/engine.test.mjs → 14/14 pass`. The chat line in step 3 is ephemeral; CODE_REVIEW runs as a fresh read-only agent that never sees this transcript, so a bare `- [x] done` is indistinguishable from a box ticked without running anything. Write the result on disk or the exit criterion below is unverifiable. Then start the next task.

Why: a mistake surfaces one task after it was made, while the context is still small enough to see it. Batching ten changes and running one gate at the end is what turns a single wrong field name into three review rounds.

**When a Verify fails, fix the cause — then re-check the tasks already ticked.** A wrong assumption (a field name, a serialized shape, a helper's contract) rarely lives in one file. Before moving on, ask whether any earlier task was built on the same assumption; if so re-run its Verify too. This is the difference between one correction and rediscovering the same bug three tasks later.

**Do not reorder or merge tasks** to save time — the order encodes dependencies the plan already reasoned about. Two legitimate deviations, both stated out loud rather than done silently:
- A task turns out unnecessary → tick it with a one-line note saying why, don't skip it quietly.
- A task cannot be verified alone (its Verify only passes once a later task lands) → say so and merge the two into one task, rather than ticking a box nothing actually proved.

### Exit Criteria:
- [ ] All planned files created/modified
- [ ] **Medium/High:** every `## Task breakdown` item ticked, each with its own Verify reported as passing
- [ ] Self-review passed (no critical issues)
- [ ] Code compiles without errors
- [ ] **Under `--tdd` only:** every test written in TEST_FIRST now passes (Green), unedited from what TEST_FIRST produced — re-run them, don't just claim it

**→ Always:** Proceed to Phase 2 (CODE_REVIEW)

---

## PHASE 2: CODE_REVIEW
**Status:** 🔍 `CODE_REVIEW`
**Agent:** `explore` (project agent, lowercase — independent reviewer, NOT the same agent that wrote the code; loads the `code-review` skill)

After `senior-dev` finishes implementation, an independent review is run automatically using the `code-review` skill approach:

### Review Process
1. Read all changed/created files (via `git diff HEAD` or file list from IMPLEMENT phase)
2. **If a plan file exists** (`.ai/plans/<slug>.md`): verify the diff stays within its Scope (flag scope creep) and satisfies each Acceptance Criterion. A criterion not met = Critical finding.
2b. **Under `--tdd` only — test-lock check:** diff the TEST_FIRST-authored test files against their state at the end of TEST_FIRST. Any edit/deletion/`.skip` NOT flagged and routed through this review (per the IMPLEMENT test-lock rule) = Critical finding, regardless of whether the surrounding code otherwise looks correct — an unreviewed test edit defeats the entire point of writing tests first.
3. Review against checklist:
   - **Correctness**: Logic errors, off-by-one, null/undefined handling, race conditions
   - **Security**: Injection, auth issues, data exposure, hardcoded secrets
   - **Performance**: unbounded loops, repeated file reads, a child process per item where one would do, per-frame work that could run once
   - **Project conventions** (`.ai/docs/conventions.md`): no model call from server/engine/UI, except the two person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key) and `server/generate.mjs` (Gemini assets with the person's own key); localhost-only checks intact; `assertId`/`within()`; `escapeHtml`/`jsonForScript`; capped `spawn`; deterministic templates; English product text
   - **Duplicate code (DRY)**: helpers already in `engine/core.mjs`, `engine/jobs.mjs`, `engine/media.mjs`, `templates/kit.mjs`, `templates/shared.mjs`, `motion-kit/icons.mjs`. Flag any new code that duplicates them.
   - **Reusability**: logic shared by 2+ templates or modules → extract. Diff vs the plan's `## Reuse & extension`; a rule changed on one side only (`beats.json` vs renderer, validator vs UI editor, new scene field missing from its template's `beats.json` `fields`, which is all locks read) is Critical.
   - **Impact analysis**: for ANY modified shared code, grep all imports across `engine/`, `server/`, `templates/`, `tests/`; for `kit.mjs` that is every template.
   - **Extensibility without regressions**: a shared contract (signature, default, `beats.json` field meaning, `status.json` shape) changed in place, a caller-specific `if` in shared code, or an existing test edited to pass → Critical unless `## Risks & impact` lists every consumer updated.
   - **Accessibility (if UI changed)**: buttons for actions, visible focus, keyboard reachable, status not by colour alone
   - **AI-generated code lens**: hallucination check (grep every NEW imported symbol, API or field — invented identifier = Critical), deprecated API check (signature matches THIS repo's version), and mark every "looks right but suspicious" spot (plausible but unverifiable from the diff — unchecked edge case, confident claim without proof)
   - **Product lens**: change serves the plan's Intent / user outcome; flag no-value additions and silently-dropped requirements
4. Report findings grouped by severity:
   - **Critical**: Bugs, security issues, data loss risks, duplicate code that should reuse existing, broken impact on consumers → MUST fix
   - **Warning**: Performance issues, convention violations, missed reuse opportunities → SHOULD fix
   - **Suggestion**: Style improvements, minor optimizations → log only, no action needed

### Actions Based on Findings
- **Critical or Warning found** → return to IMPLEMENT (`senior-dev` fixes) → re-run CODE_REVIEW
- **Only Suggestions or clean** → proceed to next phase
- **Max review cycles:** 2 (after 2 rounds, proceed regardless and log remaining items)
- Track the number of CODE_REVIEW rounds this run — needed for `code_review_cycles` in the DONE-phase outcome log

### Output Format
```
═══════════════════════════════════════════
  🔍 CODE REVIEW COMPLETE
═══════════════════════════════════════════
  Status: ✅ PASSED / ⚠️ FIXES NEEDED

  Critical: [count] — [brief list if any]
  Warning:  [count] — [brief list if any]
  Suggestion: [count] — [brief list if any]

  Reuse: [existing code reused / duplicates found / extraction needed]
  Extension: [seam used / existing behaviour changed in place: none | list]
  Impact: [shared files modified → N consumers checked → regressions]
  AI failures: [none / list of [category] file — description]

  Action: [Proceeding to VERIFY / Proceeding to USER_REVIEW (if enabled) / Returning to IMPLEMENT for fixes]
═══════════════════════════════════════════
```

**AI failure logging (orchestrator does this — the reviewer is read-only):** for every finding the review flags under "AI Failure Patterns", run `node .claude/scripts/append-ai-failure.js --category <cat> --description "..." --file <path> --caught-by code_review --task "$ARGUMENTS"`. Same applies later: a VERIFY/UNIT_TEST/QA failure whose root cause fits the taxonomy gets logged with the matching `--caught-by`. This is the AI failure pattern library (`/ai-failure review` + `/retro-skills` mine it).

**→ Default:** Proceed to Phase 4 (VERIFY)
**→ If USER_REVIEW enabled (user keyword or Step 1b):** Proceed to Phase 3 (USER_REVIEW)

---

## PHASE 3: USER_REVIEW — OPTIONAL (PAUSE)
**Status:** 👤 `USER_REVIEW`
**Runs when user requests** ("review first", "need review", "let me preview") **or Step 1b auto-enables it** (new or changed template look — show the stills from `prepare`)

Claude pauses and presents an **explainer first, diff second** (Litt, *Understanding is the New Bottleneck* — understanding is the bottleneck, so lead with intent, not code):
```
═══════════════════════════════════════════
  👤 USER REVIEW — Please review the implementation
═══════════════════════════════════════════
  What & why: [2-4 sentences of intent + the problem solved, plain language BEFORE code]
  Where:      [touched files as a narrative — "X calls Y which now …", not an alphabetical list]
  Watch for:  [the one non-obvious thing — a hidden constraint, a shared consumer affected, a convention applied]

  Code review: [PASSED / N issues fixed]
  Files changed: [list of files]

  Please review and respond with:
  ✅ "ok" / "lgtm" / "continue" → Continue to verification
  🔁 "revise [details]" → Describe what needs to change
  ❌ "stop" → Stop workflow
═══════════════════════════════════════════
```

**Comprehension quiz (speed regulator) — only for a change large or subtle enough that "looks good" isn't real review** (multi-file, shared-code, logic-bearing; skip for a one-line copy/token tweak). After the explainer, pose **3 short questions about the *decisions*** in this change — not trivia, not "what does line 42 do", but "why was X done this way / what breaks if Y / which consumer does this affect". This is Litt's speed regulator: it keeps the human's understanding from lagging the AI's output. The user may answer them, or reply "skip quiz" to waive it. Purpose is to surface a misunderstanding *before* it ships, not to gate mechanically — if an answer reveals the user expected something different, treat it like a "revise". Never auto-answer the quiz yourself; an unanswered quiz you filled in defeats its entire purpose.

**Responses:**
| User says | Action |
|-----------|--------|
| "ok", "lgtm", "continue", "looks good" | Proceed to Phase 4 (VERIFY) |
| "revise...", "change...", "fix...", "update..." | Fix issues, re-present for review |
| "stop", "cancel" | Stop workflow |

---

## PHASE 4: VERIFY — MANDATORY
**Status:** ✅ `VERIFY`
**Always runs** — this is the objective gate before DONE. A self-review claim ("compiles fine") is not sufficient; DONE requires this phase's actual command output. This is an explicit exception to the general "don't auto-build" preference ([[feedback_no_auto_build]]) — scoped to the workflow gate (applies in `/workflow`, `/loop-ticket`, `/epic`); the "don't auto-build" rule still holds for ordinary non-gated work. (When QA runs, Phase 6 re-confirms this build is current right before driving the browser.)

There is no compile or bundle step. The gate is the full test suite plus an engine smoke run, for every change:

```bash
npm test
node engine/cli.mjs help
```

When a template or the render path changed, also build a storyboard for one demo job that uses it, then look at the stills (needs Chrome; tell the user it takes a minute):

```bash
node engine/cli.mjs prepare <project> <job>
```

- If errors → fix automatically → re-run checks
- **If the fix touches a file belonging to an already-ticked `## Task breakdown` task, untick that task, re-run ITS Verify, and re-tick with the new result** — same rule as `/loop-ticket` Step 2.1. A per-task Verify can pass while the full suite fails (a filtered `node --test` run covers one case), so a stale `- [x]` would leave the plan asserting a result that no longer describes the shipped code — and CODE_REVIEW, which only reads the boxes, cannot tell.
- If fix changes logic → back to Phase 2 (CODE_REVIEW)
- **Max fix cycles: 2.** After 2 failed rounds, STOP and report the failure to the user — do NOT proceed to DONE with a failing build (this is the hard stop the Ralph Wiggum failure mode requires; an open-ended retry loop is itself a failure mode). If this triggers, log `outcome: "rejected"` per the Outcome logging section under Phase 7.
- Track the number of VERIFY rounds this run — needed for `verify_cycles` in the DONE-phase outcome log
- **Under `--tdd`:** the gate already runs the full suite, which includes the TEST_FIRST tests — VERIFY is the last objective checkpoint before DONE, and `--tdd` has no separate UNIT_TEST phase to catch a regression introduced during CODE_REVIEW fixes.

**→ On pass (default flow):** Proceed to Phase 5 (UNIT_TEST)
**→ On pass (`--tdd`):** Skip Phase 5 (UNIT_TEST) — its job was already done by TEST_FIRST + IMPLEMENT. Proceed to Phase 7 (DONE), or Phase 6 (QA) if enabled.

---

## PHASE 5: UNIT_TEST
**Status:** 🧪 `UNIT_TEST`
**Agent:** `qa`

The `qa` agent writes and runs **unit tests only** for the implemented feature:

### What to Test
- **Engine**: validation, locks, status transitions, timing — `tests/engine.test.mjs`
- **Templates**: covered for every template by `tests/templates.test.mjs`; add focused cases for template-specific logic
- **Assets**: names, types, size caps — `tests/assets.test.mjs`
- Follow the `testing-patterns` skill (`node:test` + `node:assert/strict`)

### Process
1. Identify all new/changed files from IMPLEMENT phase
2. Write unit tests covering:
   - Happy path for each function
   - Edge cases (bad id, path escape, locked field, wrong status, limit overflow)
   - Error handling paths (`StudioError` messages and codes)
3. Run tests: `npm test`
4. Ensure ALL tests pass

### On Failure → Back to IMPLEMENT
When tests fail:
1. `qa` identifies the failure and root cause
2. Return to IMPLEMENT: `senior-dev` fixes the code
3. Return to UNIT_TEST: `qa` re-runs tests
4. Max 2 fix cycles, then ask user — if unresolved after asking, log `outcome: "rejected"` per the Outcome logging section under Phase 7
5. Track the number of UNIT_TEST rounds this run — needed for `test_cycles` in the DONE-phase outcome log

### Output Format
```
═══════════════════════════════════════════
  🧪 UNIT TEST COMPLETE
═══════════════════════════════════════════
  Status: ✅ ALL PASSED / ❌ FAILURES

  Tests written: [count]
  Tests passed:  [count]
  Tests failed:  [count]

  Files tested:
    - [engine/jobs.mjs] → [tests/engine.test.mjs] (N tests)
═══════════════════════════════════════════
```

**→ Default:** Proceed to Phase 7 (DONE)
**→ If QA enabled (user keyword or Step 1b):** Proceed to Phase 6 (QA)
**→ On fail:** Back to IMPLEMENT (senior-dev fix) → re-UNIT_TEST (max 2 cycles)

---

## PHASE 6: QA — OPTIONAL
**Status:** 🌐 `QA`
**Agent:** `qa`
**Runs when user requests** ("chạy QA", "test browser", "run QA") **or Step 1b auto-enables it** (shared-code changes, UI or server changes)

> **Precondition:** the UI must be running the latest code. Ask the user to restart `npm run ui` after server or engine changes (the server does not reload itself); never start or kill it yourself.

Browser-based testing with Playwright against http://127.0.0.1:4780:
- **Motion Studio smoke (always, before feature checks):** 0 uncaught console errors; job list loads; job status matches `status.json`; writes carry `X-Studio: 1` — see qa-test skill.
- Navigate to relevant page
- Verify requirements are met visually
- **Template changes:** look at every storyboard still in each changed format; text readable, nothing clipped, icon matches meaning
- Test edge cases and mobile viewport
- Check for console errors

**→ On pass:** Proceed to Phase 7 (DONE)
**→ On fail:** Back to IMPLEMENT (senior-dev fix) → re-QA (max 2 cycles, then stop and report; track rounds for `qa_cycles` in the outcome log)

---

## PHASE 7: DONE

**Commit:** this folder is not a git repository yet. Once it is: after VERIFY + UNIT_TEST pass, Claude may commit on the current branch without asking; never push without an explicit ask; force-push is always denied. If VERIFY or UNIT_TEST failed or was skipped, do not commit.

**PUBLISH:** not configured — there is no remote and no PR tooling for this project. If the user asks for a PR, say so and stop.

Update all TodoWrite items to "completed" and show summary:

```
═══════════════════════════════════════════
  🎉 TASK COMPLETE
═══════════════════════════════════════════
  📁 Files changed:
     - [engine/file.mjs] (new/modified)
     - [templates/<id>/template.mjs] (new/modified)

  📝 Summary:
     [Brief description of what was implemented]

  ✅ Checks passed:
     - npm test: ✅ (X passed)
     - Engine smoke: ✅
     - Storyboard: ✅ (if a template changed)
     - Browser QA: ✅ (if applicable)

  🧪 How to test manually:
     1. [Step 1]
     2. [Step 2]
═══════════════════════════════════════════
```

**→ For PR / release:** run `/release-evidence <slug>` to generate the PR summary + CHANGELOG entry from the plan file.

### Outcome logging (cost-per-accepted-change) — MANDATORY, via script

Whenever the workflow reaches a terminal state (DONE, or a stop after failed cycles), append the outcome by RUNNING the writer script — do not hand-edit the file:

```bash
node .claude/scripts/append-outcome.js --task "$ARGUMENTS" --outcome accepted \
  --code-review-cycles 1 --verify-cycles 0 --test-cycles 0 --qa-cycles 0 \
  --plan-file .ai/plans/<slug>.md
```

- `--outcome`: `accepted` (reached DONE with VERIFY passing) | `rejected` (stopped after max fix cycles / user said "stop") | `user_reverted` (user asked to undo after review)
- `*-cycles`: how many fix-loops each gate took — a proxy for how much rework a "green" result actually cost
- The script stamps `ts`, validates `outcome`, and rotates at 200KB/500 lines. It is the ONLY writer — the `outcome-guard` Stop hook nags if a session commits work without the log growing.
- This is the raw data for the "cost per accepted change" metric — the sole signal `/retro-skills` learns from. Skip it and the improvement loop goes blind.

---

## ENABLE OPTIONAL PHASES

| User Says | Action |
|-----------|--------|
| `"review first"` / `"need review"` / `"let me preview"` | Enable USER_REVIEW (pauses before VERIFY) |
| `"chạy QA"` / `"test browser"` / `"run QA"` | Enable QA phase after UNIT_TEST |
| `--tdd` / `"làm theo TDD"` / `"viết test trước"` | Reorder to TEST_FIRST → IMPLEMENT (tests written before code, frozen once Red-confirmed) — see "TDD MODE (--tdd)" |

## SKIP/PASS COMMANDS

| User Says | Action |
|-----------|--------|
| `"skip review"` / `"bỏ review"` | Skip CODE_REVIEW → VERIFY |
| `"skip test"` / `"bỏ test"` | Skip UNIT_TEST → DONE (VERIFY still runs — it is not skippable) |
| `"skip to done"` / `"done"` / `"xong"` | Skip CODE_REVIEW/USER_REVIEW/UNIT_TEST/QA → still run VERIFY → DONE |
| `"pass"` / `"continue"` / `"next"` / `"ok"` | Pass current paused step → next |

**VERIFY cannot be skipped** — it's the objective gate that stops silent completion (Ralph Wiggum failure mode). If the user explicitly insists on skipping it too (e.g. "skip verify", "no build"), comply but flag in the DONE summary that the change was not build-verified.

On skip: Mark step as `(⏭️ skipped)` in TodoWrite, activate next step.

---

## BEGIN WORKFLOW

Initialize the todo list and start with Phase 1 (IMPLEMENT).
