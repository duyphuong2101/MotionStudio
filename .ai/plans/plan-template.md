# <slug> — <short title>

**Status:** planning | in-progress | in-review | done
**Author:** tech-lead
**Branch:** <branch>
**Created:** <YYYY-MM-DD>
**Risk tier / auto-enabled phases:** <e.g. server boundary → security review | job state → engine test | template look → USER_REVIEW with stills | default — per /workflow Step 1b>

## Intent
<One or two sentences: what the user actually asked for and why.>
**For whom / outcome:** <MANDATORY answer before any design: who is this feature for (persona/user segment) and what user/business OUTCOME does it create? If unanswerable from the ticket → ask the user, never invent it.>

## Options considered
<2–3 options + trade-offs, chosen option + why. CODE_REVIEW's product lens checks the diff against the chosen option. Skip only for Low-complexity mechanical tasks.>
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| ... | ... | ... | ✅ / ❌ because ... |

## Scope
<Bulleted list of exactly what will change. This is the contract — implementation must not exceed it without updating this file first.>

- [ ] ...
- [ ] ...

## Out of scope
<What is explicitly NOT being done, so review doesn't flag it and scope doesn't creep.>

## Reuse & extension
<REQUIRED for Medium/High. Written before any code; CODE_REVIEW checks the diff against it. Rules: conventions.md § "Reusability & DRY" + § "Extensibility without regressions".>
- **Reused:** <existing helper by path (`engine/core.mjs`, `templates/kit.mjs`, …) and how this change uses it. Include the "twin" of any rule you touch — e.g. a `beats.json` limit ↔ the renderer layout, a validator ↔ the UI editor.>
- **Extracted:** <new shared piece + the 2+ real consumers that justify it, or "none".>
- **Extension point:** <how the next variant plugs in (optional prop/param with a default, slot, union member, config entry) and which existing behaviour stays byte-for-byte the same.>
- **Old path proven by:** <the Verify that exercises an EXISTING consumer, not only the new one.>

## Architecture
<REQUIRED for Medium/High tasks (skip for Low mechanical). How the pieces fit + where the data flows — a mermaid diagram or a text description of components and their interactions. Name the seam the change touches (which component calls which, where state lives, where it can break). This is the "system thinking" artifact CODE_REVIEW's product/impact lens reads against.>
```mermaid
%% e.g. flowchart LR; UI-->Server-->CLI-->Pipeline-->Template-->Chrome-->ffmpeg
```

## Files to create / modify
| File | Change |
|------|--------|
| `path/to/file` | new / modified — what |

## Task breakdown
<REQUIRED for Medium/High. The execution contract: the implementer does ONE task, runs THAT task's
Verify, reports the result, and only then starts the next. A failing Verify is fixed before moving
on — never deferred to the final gate.

**How to size a task: the smallest change that can still be verified on its own — no more, no less.**
File count is not the measure. A one-line fix with its own test is a task. Renaming a type and
updating its six consumers is ALSO one task, because the build only goes green once every consumer
is updated — splitting it would leave a task whose Verify cannot pass, which is worse than a big one.

Two failure modes to avoid, in this order of danger:
- **Too big** — several independent ideas under one Verify. When it fails you cannot tell which idea
  broke, and a wrong assumption made early has already spread through the later files. Split it.
- **Too small** — a task whose Verify cannot run until a later task lands (`- [ ] done` that can only
  be ticked retroactively). That is not verification, it is bookkeeping. Merge it into the task that
  makes it verifiable.

Sanity check before committing to a split: *if this task's Verify fails, is it obvious which decision
was wrong?* If yes the size is right. If the answer is "could be any of three things", split further.

Verify must be a command or an observation someone else can repeat — `npm test`,
`node --test --test-name-pattern "<name>" tests/engine.test.mjs`, `node engine/cli.mjs prepare <p> <j>`, "still 2 shows the quote". Never
"looks right". If a task genuinely cannot be verified alone even after merging, say so explicitly
and name the task whose Verify covers it — do not leave a silent gap.

Tick a task by writing its Verify RESULT next to the box — `- [x] done — <command> → <outcome>`.
A bare `- [x] done` proves nothing: review runs as a fresh read-only agent that never sees the
implementer's transcript, so the plan file is the only place the evidence survives.>

### T1 — <short imperative title>
- **Files:** `path/a`, `path/b`
- **Verify:** <exact command or observable check>
- [ ] done <!-- on tick: - [x] done — npm test → 42/42 pass -->

### T2 — <title>
- **Depends:** T1
- **Files:** `path/c`
- **Verify:** <exact command or observable check>
- [ ] done

## Acceptance criteria
<Observable, testable conditions. CODE_REVIEW and QA check against these.>
<For any USER-FACING outcome, the AC must name the SURFACE that proves it (UI screen, storyboard still, rendered MP4) — NOT an API/unit probe alone. "The API returns X" ≠ "the user sees X"; verify through the real UI. (OP-8521: a "10 facets verified via API ✅" AC hid that only 2 rendered on the storefront.)>

- [ ] ...
- [ ] ...

<!-- REQUIRED for any ticket integrating a third-party engine/service (Hawksearch, Find, ODP, Stripe, carriers, SmartyStreets, Delivra/Klaviyo, GTM…). Delete only for pure-internal work. -->
## External system contract
<The seam with the external system — the #1 source of surprise/thrash on integration tickets. Fill in what you actually verified, and mark unknowns as spikes:>
- **Endpoints:** exact method + URL/route (incl. controller-name suffix quirks — EPiServer keeps the `Api` suffix, e.g. `/api/searchTrackingApi/...`) + auth header.
- **Wire conventions:** field-name casing/format the system expects (e.g. Hawksearch stores doc keys lowercase; FacetSelections keys/values are case-sensitive), and how our indexed/sent names must match.
- **Config split:** what is configured in THEIR dashboard/admin (manual, no API) vs OUR code/repo. (e.g. Hawksearch Facets are a manual Dashboard step the connector has NO write API for.)
- **Propagation:** what must run for a change to take effect — rebuild / reindex / cache-clear / "push to live" — and how to trigger it (endpoint + payload). Treat this as a distinct gate with its own wait + re-probe, separate from our code build.
- **Human-only gates:** steps the loop CANNOT do itself (SSO logins that don't persist through automation, engine reindex, credentials, dashboard config). Mark these HARD and up front — do not assume "the QA agent can just do it in the UI".

## Risks & impact
<Shared code touched → list ALL consumers. Unknowns / spikes needed. Convention or security implications. For an external-engine SPIKE, budget an explicit "live-QA hardening" pass — defects like crashes, wrong routes, unfiltered data, and mis-bound config are invisible to build+unit tests and only surface by driving the real UI.>

## Verification
<How this was proven end-to-end: build result, tests, browser QA, manual steps. Under /loop-ticket, record each full green pass here: `<YYYY-MM-DDThh:mm> — all AC met, VERIFY+UNIT_TEST(+QA) green @ <git rev-parse HEAD>`. A resumed loop tick may treat the ticket as DONE only if HEAD is unchanged since that line; otherwise it re-verifies once.>

<!-- Standard for any loop-run plan. -->
## Loop autonomy & process invariants
- **No pop-up questions.** The loop runs fully autonomously — it does NOT stop to ask "which item first / pause to review / how to proceed". On any ambiguous-but-reversible choice, pick the **most optimal option** (best satisfies AC + conventions, lowest risk), note it in the Loop Journal, and continue. Only the 3 safety valves (no-progress, AC-unreachable, high-risk/irreversible) may stop the loop.
- **Full gate per item, no skipping** — IMPLEMENT → CODE_REVIEW → VERIFY (mandatory build of the touched layer) → UNIT_TEST → QA (when enabled). A red gate heals + retries; it is never bypassed.
- **QA everything** — every UI-bearing item gets real browser QA; a final end-to-end QA pass before DONE.
- **Commit per item** — once the folder is a git repository: after an item's gates are green, commit that item with an explicit file list (`git add <files>`, never `-A`/`.`). High-risk items (server boundary, secrets, model calls) stop at the commit step for human diff review instead.
- **No `git push`.** Commit locally only. There is no remote or PR tooling for this project.

## Resume across quota reset
This loop runs in an interactive session. When you see **"You've hit your session limit · resets <time>"**, the in-session loop CANNOT self-resume — the process is API-blocked, and `/loop` wrapping does not bypass it (confirmed against Claude Code docs). To continue after the reset:
1. At/after the reset time, come back to this chat and either **re-run the same loop command** (`/loop /loop-ticket <this-plan.md> chạy QA`) or run **`claude --continue`**.
2. The loop reads this plan's `## Acceptance criteria` checkboxes + `## Loop Journal` to know where it left off, and continues from the first un-`[x]` item — no work is lost.
3. Keep the local UI (`npm run ui`) running so the QA gate can run when the loop reaches a UI item.

Resume manually. Do not schedule `claude -p` jobs or other unattended runs: the seat and its quota are company-owned.

<!-- OPTIONAL — /loop-ticket writes here so state survives fresh-context loop ticks. Delete if not using /loop-ticket. -->
## Loop Journal
<One line per heal iteration, appended by /loop-ticket. Format: `<iso-ts> | iter N | <gate> | <failure-signature or "green"> | <action taken>`. This is the ONLY memory the no-progress detector has across `/loop` ticks — a fresh tick reads the last entries to decide whether the loop is healing or thrashing.>

<!-- OPTIONAL — /loop-ticket links its per-iteration explainers here (anti-cognitive-debt). Delete if not using /loop-ticket. -->
## Understanding trail
<`.claude/state/loop-explainers/<slug>-iterN.md` files written by /loop-ticket on green product-code iterations — prose explainers of what each change did and why. Read these to re-enter an autonomously-built ticket without diffing every commit (Litt, *Understanding is the New Bottleneck*).>

<!-- Written by /loop-ticket on DONE — the team-readable (git-tracked) distillation of the git-ignored per-iter explainers above. -->
## What the loop built
<3-6 sentences of prose: the shape of the change, the non-obvious decisions, what a reviewer/teammate must know. NOT a diff re-listing. This is the "shared space" — the summary the next human actually reads (Litt). **Lead with one plain-business-language sentence** (the stakeholder explainer: what this delivers for the user/business, no jargon — "customers see sizes faster", not "lazy-loaded the variant store") before the technical prose; `/release-evidence` lifts this into the PR Summary.>


<!-- OPTIONAL — only for Type B batch work driven by /epic. Delete both sections otherwise. -->
## Pattern
<The shared recipe /epic applies to every backlog item: what to change, which conventions apply, complexity call (dev-quick vs senior-dev), how VERIFY/tests prove each item. Written ONCE by tech-lead; epic mode executes it without re-planning per item.>

## Epic Backlog
<One checkbox per independent item. /epic processes top-down: `- [x]` done, `- [!]` blocked (stops the epic).>

- [ ] ...
- [ ] ...
