---
description: Layer 2 of the upstream-currency watcher — WebFetch the current Claude Code + Cursor docs/changelogs, diff against the local spec snapshot, report new/renamed/deprecated fields, and refresh the snapshot. Run manually, or schedule with /schedule | /loop.
argument-hint: [claude|cursor|all] [--report-only]
allowed-tools: WebFetch, Read, Edit, Write, Bash(node .claude/scripts/spec-lint.js:*), Bash(node .claude/scripts/check-propagation.js:*)
---

## Goal

Keep `.ai/snapshots/upstream-spec.json` (and therefore the whole config) current with the evolving Claude Code / Cursor platforms. This is the **network** layer; the offline `spec-lint.js` enforces the snapshot on every `/check`.

> **Hard rule:** Do NOT trust training data about the spec — your knowledge may be stale. Base every conclusion on the **fetched** doc text. If a fetch fails, say so and mark that area "unverified — fetch failed"; do not guess. Note the legacy documentation subdomains now redirect (301/308) to the canonical hosts `code.claude.com/docs` (Claude Code) and `cursor.com/docs` (Cursor) — fetch those.

Scope from `$ARGUMENTS` (default `all`): `claude`, `cursor`, or `all`.

**Report-only mode (`--report-only`, or ANY non-interactive / scheduled `/loop` / `claude -p` run — assume it when nobody is watching):** do steps 1-3 and 6 but **SKIP step 4 (do NOT touch `.ai/snapshots/upstream-spec.json`)**. Unattended snapshot edits are dangerous — an LLM misreading a docs page corrupts the offline gate that `/check` and pre-commit depend on (see `feedback_verify_specs_before_removing`). Instead of the transcript (which nobody reads in a scheduled run), write the digest to `.ai/reports/upstream-check-<YYYY-MM-DD>.md`. Snapshot refresh stays a human-reviewed, interactive-only action.

## Process

1. **Read the current snapshot**: `.ai/snapshots/upstream-spec.json`. Note its `lastVerifiedAgainst.date`.

2. **WebFetch the canonical docs** for the in-scope platform(s) and extract the CURRENT field/event/model sets:
   - Claude Code: `code.claude.com/docs/en/skills` (skill frontmatter table), `…/sub-agents` (agent frontmatter), `…/hooks` (event list + matcher/output contract), `…/settings` (keys + deprecated), `…/mcp` (transport `type` enum), `…/slash-commands` + `…/output-styles` (command frontmatter, removed commands), `…/changelog` (last ~5 releases).
   - Cursor: `cursor.com/docs` → rules (`.mdc` frontmatter), agent/modes, hooks, mcp, models; plus `cursor.com/changelog` (current Composer version + pricing).
   - Models: `platform.claude.com` models page → current Claude model IDs/aliases.

3. **Diff fetched-vs-snapshot** and classify each delta:
   - **DEPRECATED/REMOVED** — a field/event/command/model in the snapshot the docs no longer list → the config may be using it; high priority.
   - **RENAMED** — same concept, new name.
   - **NEW (adoption candidate)** — a field/event/capability the docs added that the snapshot (and config) don't have yet.
   - **STALE VALUE** — model ID / Composer version / pricing changed.

4. **Refresh the snapshot** *(INTERACTIVE MODE ONLY — skip entirely in report-only/scheduled mode)*: update the affected arrays (`skillFields`, `agentFields`, `hookEvents`, `mcpTypes`, `removedCommands`, `models.*`, `staleStrings`) to match the docs, and bump `lastVerifiedAgainst.date` to today + record the doc URLs you actually fetched. For a newly-**removed** command or **retired** model, add a `staleStrings` entry so the offline lint starts catching it.

5. **Re-run the gates**: `node .claude/scripts/spec-lint.js` then `node .claude/scripts/check-propagation.js`. Report any new errors the refreshed snapshot now surfaces in the live config.

6. **Report** (concise): a table of deltas by class (deprecated / renamed / new / stale), which config files each affects, and a punch-list of follow-up edits. Do NOT mass-edit config here — surface the work; the user decides what to adopt (esp. behavior-changing items). If you applied snapshot edits, say exactly what changed.

## Scheduling (turn this into a standing watcher)

- Recurring: `/schedule` → a weekly/monthly routine that runs `/upstream-check all` and opens a digest/PR when deltas appear.
- Or interval: `/loop 1w /upstream-check all`.
- The offline `spec-lint.js` already runs on every `/check` and pre-commit, so day-to-day drift is caught for free; the schedule only needs to refresh the snapshot when the platforms ship changes.
