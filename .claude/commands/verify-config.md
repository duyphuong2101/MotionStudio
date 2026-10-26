---
description: "Self-test the kit's judgment-layer mechanisms (spec-first, review lens, AI failure log, publish gate, architecture diagram, failure teardown, stakeholder explainer) + security guards — are they wired, runnable, referenced everywhere, and mirrored?"
allowed-tools: Bash(node .claude/scripts/verify-mechanisms.js), Bash(node .claude/scripts/check-propagation.js), Bash(node .claude/scripts/spec-lint.js), Bash(bash .claude/scripts/test-block-destructive.sh)
---

# Verify config mechanisms

Runs the self-tests that confirm the kit's mechanisms are actually in force (not just documented). Use after editing hooks, scripts, agents, skills, or the workflow — or any time you want to know the "judgment-layer" wiring is intact.

## Process

1. **Mechanism self-test** — `node .claude/scripts/verify-mechanisms.js` (50 checks, 9 groups)
   Checks, per mechanism, that it is wired + runnable + referenced in every required file + mirrored Claude↔Cursor:
   - **AI failure log** — `append-ai-failure.js` runs, accepts a valid entry, rejects a bad category / missing field; referenced in workflow, retro-skills, ai-failure, senior-dev, code-review, conventions, Cursor workflow + senior-dev.
   - **Spec-first** — plan-template has `## Options considered` + `For whom / outcome`; the "Who is this for" question is in workflow, tech-lead (both tools).
   - **Review lens** — hallucination check + product lens referenced in code-review skill, workflow, Cursor workflow + explore.
   - **Publish gate** — `create-draft-pr.js` dry-run works, narrow `git push -u origin HEAD` allow present, referenced in workflow + loop-ticket.
   - **Architecture diagram** — plan-template has `## Architecture`; tech-lead (both tools) + workflow instruct filling it for Medium/High.
   - **Failure teardown** — the covering trio is intact: `/loop-ticket` Loop Journal records failure signatures, `/retro-skills` mines both `ai-failure-log.ndjson` + `outcome-log.ndjson`.
   - **Stakeholder explainer** — release-evidence PR Summary is stakeholder-facing; `## What the loop built` leads with a plain-business-language sentence (plan-template + loop-ticket, both tools).
   - **GitHub mirror** — the condensed `.github/agents/*.agent.md` files carry the mechanisms too: spec-first + Architecture + stakeholder in tech-lead, hallucination-check + failure-log in senior-dev, AI-code lens in the qa gate. (The 3rd platform — easiest to miss in propagation.)
   - **Security guards** — block-destructive covers single-file delete + protected-file writes; protect-files guards `settings.local.json`; auto-format uses `execFileSync`; create-draft-pr confines file paths.

2. **Supporting gates** (run these too for a full picture):
   - `node .claude/scripts/check-propagation.js` — NEVER/ALWAYS rule drift.
   - `node .claude/scripts/spec-lint.js` — frontmatter / hook-event / MCP-transport spec drift.
   - `bash .claude/scripts/test-block-destructive.sh` — adversarial suite for the destructive-command hook (24 cases).

3. **Report** pass/fail per mechanism. On any failure, name the exact file + missing reference and stop — a broken mechanism means agents are giving advice the machinery no longer enforces. Fix by re-adding the reference / re-wiring the script, then re-run.

> Distinction: `check-propagation` verifies the **rule set** (NEVER/ALWAYS) reached every mirror; `verify-mechanisms` verifies the **mechanisms** (scripts + review lenses + gates) are wired and mirrored. Run both.
