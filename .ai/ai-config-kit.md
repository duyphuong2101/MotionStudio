# AI Config Export

Portable installer for the Claude Code + Cursor + GitHub Copilot AI config kit (NSC project).

> **Distribution policy (verified 2026-09-03 with `git ls-files`):** the AI config is **NOT committed** — `.gitignore` lines 7 and 168 ignore `.claude/`, `.ai/`, `.cursor/` and `CLAUDE.md` entirely. The zip built by `build-export.sh` is the only way config moves between machines, NSC or not. Never re-include these paths in `.gitignore`.
>
> **Second NSC machine:** copy the newest `nsc-ai-config-*.zip`, `unzip` it, run `bash <unzipped>/install.sh` from the NSC repo root (UPDATE scenario: overwrites shipped config, preserves `CLAUDE.local.md` / `settings.local.json`). The installer then runs `node .ai/scripts/apply-user-settings.js`, which merges the recommended user-scope keys into `~/.claude/settings.json` (`fallbackModel`, `alwaysThinkingEnabled`, `effortLevel`, per-model `modelSettings`, `teammateMode`; idempotent, touches nothing else, no secrets). Fill the per-machine local files, restart Claude Code (model/effort settings are startup-only), then `node .claude/scripts/check-propagation.js && node .claude/scripts/verify-mechanisms.js`. Agent teams are off at project scope; enable per session with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude`. Put `"env": {"NSC_ALLOW_CONFIG_EDIT": "1"}` in `.claude/settings.local.json` only while a human is doing config work — it lets the assistant edit hooks and settings.

## What you just got (TL;DR)

After running `install.sh`, your project has:

| Layer | What | Where |
|-------|------|-------|
| **5 specialist agents** | tech-lead (opus/high), senior-dev (opus/medium), dev-quick (sonnet/low), qa (sonnet/low), explore (sonnet/low, read-only reviewer) | `.claude/agents/`, `.cursor/agents/` |
| **19 skills** | conventions, code-review, gen-test, frontend-design, agent-teams-workflow, NSC patterns (vue, pinia, mediatr, episerver, tailwind), … | `.claude/skills/` |
| **15 hooks** | safety (block-destructive, protect-files w/ self-protection), auto-format, conventions auto-inject, propagation-reminder, outcome-guard, status line, subagent log | `.claude/hooks/` |
| **26 slash commands** | `/workflow`, `/epic`, `/loop-ticket`, `/qa`, `/review`, `/test`, `/scaffold`, `/build`, `/fix`, … | `.claude/commands/` |
| **Loop modes** | `/epic` (batch, hard-stop) + `/loop-ticket` (self-healing until AC met) + `append-outcome.js`/`outcome-guard` outcome pipeline | `.claude/commands/`, `.claude/scripts/` |

> Exact counts always in `MANIFEST.txt` (build-generated). The numbers above are indicative.
| **Output style "NSC"** | Vietnamese mirror, concise responses, NEVER/ALWAYS auto-injected | `.claude/output-styles/nsc.md` |
| **5 MCP servers** | playwright, context7, deepwiki, figma, v0 (scoped per agent) | `.claude/settings.json`, `.cursor/mcp.json` |
| **Source-of-truth docs** | conventions, file-index, common-patterns, architecture, accessibility, workflow | `.ai/docs/` |
| **Cursor parallel** | rules (project, workflow, new-feature, token-optimization), skills (vue-best-practices, nsc-dotnet, nsc-tailwind), hooks (afterFileEdit, beforeShellExecution, beforeReadFile, stop) | `.cursor/` |
| **Copilot / open-standard mirrors** | copilot-instructions.md + AGENTS.md (GENERATED from conventions.md), path-scoped `.instructions.md` (backend-security, frontend-vue), prompt files (`/review`, `/fix`, `/qa` for VS Code + Visual Studio), custom agents for the cloud coding agent (senior-dev, qa, tech-lead — `target: github-copilot`), VS Code MCP | `.github/`, `AGENTS.md`, `.vscode/mcp.json` |
| **HTML guides** | claude-code-guide, cursor-guide, cursor-ai-guide, qa-tests-guide (VI + EN) | project root |

**Total**: see `MANIFEST.txt` in the zip (file list + count + sha256, generated at build time). Full NSC project content as-is.

After install: open a `*-guide.html` in browser, or jump straight into Claude Code / Cursor — agents auto-load conventions on coding-trigger prompts.

## Usage

```bash
# Re-deploy / update on a fresh checkout of NSC
cd /path/to/NSC
bash .ai/export/install.sh

# Deploy to another project (NSC content ships as-is — adapt after install)
cd /path/to/other/project
bash /path/to/NSC/.ai/export/install.sh
```

The installer:
- Detects existing config and **backs it up** to `.ai-backup-YYYYMMDD-HHMMSS/`
- Extracts new files but **preserves** `.claude/CLAUDE.local.md` and `.claude/settings.local.json` (per-machine)
- Detects tech stack and generates a stack-aware `.claude/settings.local.json` if absent
- Generates `.editorconfig` if absent

## ⚠ Deploying to non-NSC projects: run the 11-step setup

`install.sh` extracts the full NSC tarball **as-is** — it does NOT filter by detected tech stack. So a Next.js / WordPress / Magento / Python project will receive Vue components, Pinia stores, MediatR/EPiServer skills, FluentMigrator templates, `dotnet *` permissions, etc.

After install on a non-NSC stack, run all **11 setup prompts** (not just the first 6) in Claude Code or Cursor:

| Step | What it covers | Files touched |
|---|---|---|
| 1–4 | `.ai/docs/*` rewrite (architecture, file-index, common-patterns, conventions). **Prompt 4 heading contract**: rule sections must be exactly `## NEVER Do` / `## ALWAYS Do` — generate-mirrors.js + check-propagation.js match them verbatim | `.ai/docs/` |
| 5–6 | Customize agents + Cursor rules; **RESET `.cursor/memory/*.md` to empty** (they ship with the source project's learned knowledge, wrong for a new project) | `.claude/agents/`, `.cursor/rules/`, `.cursor/memory/` |
| **7** | **Clean up skills/commands/templates/permissions/auto-format** — remove every NSC-only entry, create stack-correct skills + commands. **Includes rewriting the VERIFY build-gate commands** in `workflow.md`/`epic.md`/`loop-ticket.md`/`workflow.mdc` (Phase 5.5)/`new-feature.mdc` (8.5)/`check.md`/`build.md`/`build-fe.md`/**`deploy-check.md`** with the new project's real build/lint/test commands (these files ship with NSC's `dotnet` .NET-Core commands — a .NET **Framework** target needs `nuget restore` + `msbuild` + `vstest.console` instead; each file carries a "Stack note" pointing here) (Next.js: `npx tsc --noEmit && npm run build`; WordPress/Magento: `vendor/bin/phpcs` + `vendor/bin/phpstan analyse` + `vendor/bin/phpunit`, Magento also `bin/magento setup:di:compile`), **and replacing `.claude/config/qa-urls.json`** with the project's real URLs | `.claude/skills/`, `.claude/commands/`, `.ai/templates/`, `.claude/settings.json`, `.claude/hooks/auto-format.js`, `.claude/config/qa-urls.json`, `.cursor/skills/`, `.cursor/rules/`, `.cursor/mcp.json` |
| **8** | **Verify hooks + output style** — ESM vs CommonJS shim (`.claude/hooks/package.json`), rewrite `inject-context.js` triggers + `propagation-reminder.js` map for the new stack, create custom `output-styles/<project>.md` + set `outputStyle` in settings.json (check-propagation resolves the style file from that setting) | `.claude/hooks/`, `.cursor/hooks.json`, `.claude/output-styles/`, `.claude/settings.json` |
| **9** | **Regenerate Copilot/open-standard mirrors** — after rewriting `conventions.md` (step 4), run `node .claude/scripts/generate-mirrors.js` so `.github/copilot-instructions.md` + `AGENTS.md` carry the NEW project's NEVER/ALWAYS (not NSC's); rewrite the hand-written headers in both files (stack, build commands); rewrite `.github/instructions/*.instructions.md` — applyTo globs AND rule content for the stack (WordPress: `wp-content/**/*.php` with nonce/sanitize/escape rules; Magento: `app/code/**/*.php` with DI/plugin/ACL rules); rewrite `.github/prompts/*.prompt.md` + `.github/agents/*.agent.md` (NSC composables/paths/commands → this project's); patch HTML guides (`.ai/docs/agents-skills-update-guide.html` skill inventory); update `.vscode/mcp.json` servers. **COMMIT these files** — Copilot on github.com (code review, coding agent) only reads committed files, unlike `.claude/`/`.cursor/` which are typically gitignored | `.github/`, `AGENTS.md`, `.vscode/mcp.json` |
| **10** | **Slim `CLAUDE.md`** — it loads on EVERY Claude turn (system prompt), so it's the dominant per-turn token cost. Keep it under ~11KB: everyday NEVER/ALWAYS + the FULL Security NEVER list stay resident; move process detail (Update Propagation chain, full hooks inventory, Quick Reference) to `.ai/docs/kit-process.md` with a one-line pointer. `check-propagation.js` asserts the Security NEVER list is still present in `CLAUDE.md` (ERROR if missing); general rules may live in kit-process.md | `CLAUDE.md`, `.ai/docs/kit-process.md` |
| **11** | **Verify no residue** — run `bash .ai/scripts/detect-leftovers.sh` (greps the whole config for NSC residue → per-file checklist; must exit 0), then `node .claude/scripts/check-propagation.js` + `spec-lint.js`. This catches whatever the manual passes missed (it's how the AEI setup found a leftover HTML guide + settings.local git-push allow). | verification only |

**Canonical prompt source**: `bash .ai/scripts/setup-existing-project.sh` — prints all 11 prompts in order.
(The HTML guides' setup sections may lag behind the script; when they disagree, the script wins.)

**If you skip 7-11:** the project will *work*, but every session will load NSC-stack skills (cqrs-mediatr, episerver-content-types, pinia-store, vue-component-*, etc.) and slash commands (`/migrate` for FluentMigrator, `/build-fe` for vue3+UI) that don't fit the codebase; the workflow VERIFY gate will run NSC build commands that fail on every task (hard-stopping the workflow); Cursor agents inherit the source project's memory (wrong initiatives/decisions); Copilot surfaces serve NSC rules with nonexistent paths; and `CLAUDE.md` carries ~11KB of NSC process detail on every turn. Expect 50KB+ of irrelevant context per subagent run, false guidance from auto-loaded skills, broken slash commands, and permission prompts on every `npm run typecheck`.

**Also cleaned in steps 7-10** (easy to miss — the detect-leftovers script in step 11 is the safety net): `.cursor/skills/*` (delete framework folders the project doesn't use, e.g. `vue-best-practices`, `nsc-tailwind`; rewrite the rest), `.cursor/memory/*.md` (reset to empty), `.claude/config/design-repo.json` + `v0-integration.md` + `.ai/docs/design-integration.md` (delete if no Figma/v0 workflow), `.claude/templates/workflow-tracker.md` checklists, `.ai/docs/accessibility-ux.md` (rewrite or flag `NOT YET ADAPTED`), and `.claude/settings.local.json` (installer no longer adds a `git push` allow, but an older install may have one — remove it).

## GitHub Copilot / other AI IDEs — what you get per surface

| Surface | Reads what | Coverage |
|---|---|---|
| **VS Code Copilot** | `CLAUDE.md`, `.claude/agents`, `.claude/skills`, `.claude/rules` NATIVELY + all `.github/` files | ~70-75% of the kit's value with zero extra work |
| Visual Studio / JetBrains / Xcode | `.github/copilot-instructions.md` only | Conventions only |
| github.com Copilot code review | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md` — only if a project chooses to commit them; under the default no-commit policy github.com Copilot does not see these files (VS Code Copilot still reads them locally) | Conventions + path rules — the security NEVER list enforced at PR review |
| Copilot coding agent (cloud) | `AGENTS.md` + instructions files + skills; Playwright MCP default-on | Conventions + skills |
| OpenAI Codex / Zed / Jules / Cursor | `AGENTS.md` (open standard) | Conventions |

**What does NOT port to any Copilot surface**: deterministic enforcement (protect-files, block-destructive, permission deny lists, auto-format guards, conventions auto-inject) and orchestration (auto-workflow gates, complexity routing, agent teams, per-agent MCP scoping). Those stay Claude Code/Cursor-only; the CI-runnable backstop is `node .claude/scripts/check-propagation.js` + `spec-lint.js` in a pre-commit hook or pipeline.

## What's in the tarball

`ai-config.tar.gz` — full NSC content (exact file list + count: `MANIFEST.txt`):

- `CLAUDE.md` — project README
- `AGENTS.md` — open agent standard mirror (generated NEVER/ALWAYS)
- `.claude/` — agents, skills, hooks, commands, settings
- `.cursor/` — agents, commands (epic, loop-ticket), rules, skills, hooks, mcp
- `.github/` — copilot-instructions.md (generated) + instructions/*.instructions.md
- `.vscode/mcp.json` — VS Code Copilot MCP servers
- `.ai/docs/` — conventions, architecture, file-index, common-patterns, accessibility-ux, workflow-system, kit-process (Update Propagation chain + full hooks inventory + Quick Reference, split out of CLAUDE.md to keep its per-turn token cost down)
- `.ai/templates/` — scaffold templates
- `.ai/scripts/` — `setup-existing-project.sh` (the 11-step prompts) + `detect-leftovers.sh` (residue scanner)
- `.ai/snapshots/` — upstream-spec snapshot (spec-lint offline gate)
- `.github/prompts/` + `.github/agents/` — Copilot prompt files + cloud coding-agent definitions
- `.mcp.json` — project-scope Claude Code MCP servers
- All HTML guides — `claude-code-guide.html`, `cursor-guide.html`, `cursor-ai-guide.html` (VI + EN) + `qa-tests-guide.html` (VI only)

## What is NEVER exported

| File / Dir | Reason |
|---|---|
| `.claude/CLAUDE.local.md` | Per-machine, contains personal credentials |
| `.claude/settings.local.json` | Per-machine permissions |
| `.claude/state/` | Runtime state (logs, scheduled tasks) |
| `.claude/agent-memory/` | Per-machine memory |
| `.claude/plans/` | Session-specific work plans |
| `.claude/tmp/` | Scratch dirs |
| `.cursor/memory/` | NSC's learned per-project memory (install.sh creates an empty dir instead) |
| `.claude/v0-nsc-trangdien/` | Local NSC design repo clone |
| `.claude/worktrees/` | Git worktrees |
| `.claude/HANDOVER-*.md` | Session handover notes (transient) |
| `.claude/new-resource-keys-*.md` | Session task notes |
| `*.bak`, `*.patch` | Backups |
| `CMS13_UPGRADE_REPORT.html` | NSC-specific report |

## Building the tarball

After any config change in the source repo:

```bash
bash .ai/export/scripts/build-export.sh
```

This rebuilds `ai-config.tar.gz` with the current state of `.claude/`, `.cursor/`, `.ai/`, `CLAUDE.md`, and HTML guides.

## File layout

```
.ai/export/
├── README.md                          # this file
├── install.sh                         # installer (run on target project)
├── ai-config.tar.gz                   # built tarball
├── MANIFEST.txt                       # file list + count + sha256 (build-generated)
├── gitignore.recommended              # commit-vs-ignore policy for the kit
├── nsc-ai-config-YYYYMMDD-HHMM.zip    # portable bundle (install.sh + tarball + README + manifest + gitignore)
└── scripts/
    └── build-export.sh                # rebuilds tarball + bundle from current repo
```

`build-export.sh` keeps only the **newest** bundle zip — older `nsc-ai-config-*.zip` and the legacy `export.7z` / `export.zip` are auto-removed on each build.

### Two delivery modes

| Mode | When | How |
|------|------|-----|
| **Direct** | Target machine has a checkout of NSC | `cd /path/to/target && bash /path/to/NSC/.ai/export/install.sh` |
| **Portable** | Target machine does NOT have NSC repo | Copy `nsc-ai-config-*.zip` → `unzip -d ai-config` → `bash ai-config/install.sh` |

## Updating from upstream

Re-running `install.sh` on a project that already has the kit (any one of `.ai/`, `.claude/`, `.cursor/` present → `UPDATE`) will:
1. Back up **everything the tarball can touch** to `.ai-backup-YYYYMMDD-HHMMSS/` (the backup list is derived from the tarball listing itself, so it can't drift)
2. Extract shipped config with `--overwrite` (so upstream bug-fixes + new hooks land), EXCEPT:
   - `.claude/CLAUDE.local.md` + `.claude/settings.local.json` — per-machine, always preserved
   - `.ai/docs/` + root `CLAUDE.md` — your stack-customized files (prompts 1-4, 10)
   - `.github/` + `AGENTS.md` — regenerated from YOUR conventions (prompt 9), kept local under the no-commit policy; NSC's must never land on your GitHub surface
   - `.claude/output-styles/` + `.claude/config/qa-urls.json` — your project's style + QA URLs (prompts 7-8)

**Caveat:** everything else under `.claude/` and `.cursor/` (agents, skills, commands, rules, hooks, mcp.json) IS overwritten on update — if you customized those for your stack, they revert to the shipped NSC versions and you must re-run the relevant setup prompts (5-7). They're in the backup dir if you need to diff. This is the tradeoff for getting upstream fixes; there is no per-file merge.

## Git policy (no AI config in git)

The AI config is never committed — `.claude/`, `.ai/`, `.cursor/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json` and the `.github/` Copilot files all stay ignored, and the export zip is the only way config moves between machines. Append `gitignore.recommended` (shipped in the zip) to the project's `.gitignore`. Trade-off, stated once: github.com Copilot (PR review, coding agent) reads only committed files, so it will not see these rules; Copilot inside VS Code, Claude Code and Cursor read them locally and are unaffected. Verify nothing leaked:

```bash
git ls-files .claude .ai .cursor .github/copilot-instructions.md AGENTS.md CLAUDE.md   # must print NOTHING
bash .ai/scripts/detect-leftovers.sh                                   # must exit 0 (after setup)
node .claude/scripts/check-propagation.js && node .claude/scripts/spec-lint.js
```

## Maintenance

- After ANY change to `.claude/`, `.cursor/`, `.ai/docs/`, or `CLAUDE.md` → re-run `bash .ai/export/scripts/build-export.sh`
- The `propagation-reminder` hook in `.claude/hooks/propagation-reminder.js` warns when you edit `.ai/docs/*.md` to update downstream files
- See `.ai/docs/agents-skills-update-guide.html` for the full propagation chain
