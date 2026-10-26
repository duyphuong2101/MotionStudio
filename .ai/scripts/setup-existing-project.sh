#!/bin/bash
# ============================================================
# AI Tools — Setup guide for a project that already installed the kit.
#
# Run this AFTER `bash .ai/export/install.sh` has extracted the config.
# It does NOT create any files — install.sh already built the structure.
# It re-detects the stack and prints the 11 customization prompts to run
# in Claude Code / Cursor (the kit ships as NSC content; these adapt it).
#
# Usage (from the target project root):
#   bash .ai/scripts/setup-existing-project.sh
# ============================================================

set -e

# Run in-place: this script lives in the TARGET project's own .ai/scripts/
# after install. Default to the current directory; accept an explicit path too.
TARGET="${1:-$(pwd)}"

if [ ! -d "$TARGET" ]; then
    echo "Error: '$TARGET' does not exist."
    exit 1
fi

if [ ! -d "$TARGET/.claude" ] || [ ! -d "$TARGET/.ai" ]; then
    echo ""
    echo "✗ '$TARGET' has no .claude/ + .ai/ — run the installer first:"
    echo "    cd $TARGET && bash .ai/export/install.sh"
    echo "  (or point this script at a project that has already been installed into)"
    echo ""
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  AI Tools — Project Setup (customize the installed kit)║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Target: $TARGET"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# Step 1: Detect tech stack (structure was already created by install.sh)
# ============================================================
echo "━━━ Step 1: Detecting tech stack... ━━━"

cd "$TARGET"

has_dotnet=false; has_node=false; has_python=false; has_go=false; has_rust=false; has_java=false; has_php=false
has_vue=false; has_react=false; has_nextjs=false; has_angular=false; has_svelte=false
has_wordpress=false; has_magento=false; has_laravel=false
has_tailwind=false; has_typescript=false

[ -f "*.sln" ] || [ -n "$(find . -maxdepth 3 -name '*.sln' 2>/dev/null | head -1)" ] && has_dotnet=true
[ -f "package.json" ] || [ -n "$(find . -maxdepth 2 -name 'package.json' 2>/dev/null | head -1)" ] && has_node=true
[ -f "requirements.txt" ] || [ -f "pyproject.toml" ] && has_python=true
[ -f "go.mod" ] && has_go=true
[ -f "Cargo.toml" ] && has_rust=true
[ -f "pom.xml" ] || [ -f "build.gradle" ] && has_java=true
[ -f "composer.json" ] && has_php=true

# Check frameworks — test grep -l's OWN exit status (piping to head loses it: head
# returns 0 on empty input, so every framework would read as "detected").
grep -rlq "vue" package.json */package.json 2>/dev/null && has_vue=true
grep -rlq "react" package.json */package.json 2>/dev/null && has_react=true
grep -rlq '"next"' package.json */package.json 2>/dev/null && has_nextjs=true
grep -rlq "angular" package.json */package.json 2>/dev/null && has_angular=true
grep -rlq "tailwindcss" package.json */package.json 2>/dev/null && has_tailwind=true
[ -f "tsconfig.json" ] || [ -n "$(find . -maxdepth 2 -name 'tsconfig.json' 2>/dev/null | head -1)" ] && has_typescript=true
{ [ -f "wp-config.php" ] || [ -d "wp-content" ]; } && has_wordpress=true
{ [ -f "bin/magento" ] || [ -f "app/etc/env.php" ]; } && has_magento=true
[ -f "artisan" ] && has_laravel=true

echo "  Detected stack:"
$has_dotnet && echo "    ✓ .NET"
$has_node && echo "    ✓ Node.js"
$has_python && echo "    ✓ Python"
$has_go && echo "    ✓ Go"
$has_rust && echo "    ✓ Rust"
$has_java && echo "    ✓ Java"
$has_php && echo "    ✓ PHP (composer)"
$has_vue && echo "    ✓ Vue"
$has_react && echo "    ✓ React"
$has_nextjs && echo "    ✓ Next.js"
$has_angular && echo "    ✓ Angular"
$has_wordpress && echo "    ✓ WordPress"
$has_magento && echo "    ✓ Magento / Adobe Commerce"
$has_laravel && echo "    ✓ Laravel"
$has_tailwind && echo "    ✓ Tailwind CSS"
$has_typescript && echo "    ✓ TypeScript"

# ============================================================
# Step 2: Print the customization prompts
# ============================================================
echo ""
echo "━━━ Step 2: Now adapt the installed config with AI. ━━━"
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║  Structure created! Now fill docs using Claude or Cursor.    ║"
echo "║                                                              ║"
echo "║  Open the project in Claude Code or Cursor, then paste       ║"
echo "║  these prompts IN ORDER:                                     ║"
echo "║                                                              ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  PROMPT 1 — Architecture:                                    ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Scan this codebase and fill .ai/docs/architecture.md   │  ║"
echo "║  │ with: project structure, DI/IoC, data flow, database,  │  ║"
echo "║  │ frontend/backend stack, build system, CI/CD.           │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 2 — File Index:                                      ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Scan all source files and fill .ai/docs/file-index.md  │  ║"
echo "║  │ with: all components, controllers, services, stores,   │  ║"
echo "║  │ types, config files grouped by category with paths.    │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 3 — Code Patterns:                                   ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Read 3-5 representative files in this codebase and     │  ║"
echo "║  │ fill .ai/docs/common-patterns.md with real code        │  ║"
echo "║  │ examples for: component, API endpoint, data model,     │  ║"
echo "║  │ test, and any project-specific patterns.               │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 4 — Conventions:                                     ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Analyze the codebase style and fill                    │  ║"
echo "║  │ .ai/docs/conventions.md with: naming conventions,      │  ║"
echo "║  │ NEVER/ALWAYS rules, design tokens, import aliases,     │  ║"
echo "║  │ and gotchas you discover. HEADING CONTRACT (required): │  ║"
echo "║  │ the rule sections MUST be exactly '## NEVER Do' and    │  ║"
echo "║  │ '## ALWAYS Do' — generate-mirrors.js and               │  ║"
echo "║  │ check-propagation.js match those headings verbatim;    │  ║"
echo "║  │ different headings silently break all generated        │  ║"
echo "║  │ mirrors (project.mdc, copilot-instructions, AGENTS.md).│  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 5 — Customize agents:                                ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Based on the docs you just created, customize          │  ║"
echo "║  │ .claude/agents/ and .cursor/agents/ with proper        │  ║"
echo "║  │ skills, competencies, and instructions for this stack. │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 6 — Customize Cursor rules + memory:                 ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Update ALL .cursor/rules/*.mdc (project.mdc header —   │  ║"
echo "║  │ the NEVER/ALWAYS block auto-syncs but the stack        │  ║"
echo "║  │ description + Commands section above the markers do    │  ║"
echo "║  │ NOT; workflow.mdc Phase 2-4 + build gates; new-        │  ║"
echo "║  │ feature.mdc; token-optimization.mdc) for this stack.   │  ║"
echo "║  │ RESET .cursor/memory/*.md to empty templates — they    │  ║"
echo "║  │ ship with the SOURCE project's learned knowledge       │  ║"
echo "║  │ (initiatives, decisions, gotchas) which is WRONG for   │  ║"
echo "║  │ a new project; memory must start empty.                │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  ──────  REQUIRED: Clean NSC tarball noise  ──────           ║"
echo "║                                                              ║"
echo "║  PROMPT 7 — Clean skills + commands + settings:              ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Based on .ai/docs/architecture.md and conventions.md,  │  ║"
echo "║  │ inspect .claude/skills/, .claude/commands/,            │  ║"
echo "║  │ .ai/templates/, .claude/settings.json (allow list),    │  ║"
echo "║  │ .cursor/skills/, .cursor/mcp.json, and                 │  ║"
echo "║  │ .claude/hooks/auto-format.js. Remove EVERY skill /     │  ║"
echo "║  │ command / template / permission / formatter-branch /  │  ║"
echo "║  │ MCP-server that doesn't match this project's actual    │  ║"
echo "║  │ tech stack. Then create new skills + commands matching │  ║"
echo "║  │ the patterns in this codebase. CRITICAL — rewrite the  │  ║"
echo "║  │ stack-specific COMMANDS inside the workflow files:     │  ║"
echo "║  │ the VERIFY build-gate blocks in                        │  ║"
echo "║  │ .claude/commands/workflow.md + epic.md,                │  ║"
echo "║  │ .cursor/rules/workflow.mdc (Phase 5.5) +               │  ║"
echo "║  │ new-feature.mdc (step 8.5), and .claude/commands/      │  ║"
echo "║  │ check.md + build.md + build-fe.md + deploy-check.md +  │  ║"
echo "║  │ loop-ticket.md — replace NSC paths/commands with       │  ║"
echo "║  │ THIS project's real ones (e.g. Next.js: npx tsc        │  ║"
echo "║  │ --noEmit && npm run build; WordPress/Magento:          │  ║"
echo "║  │ vendor/bin/phpcs + vendor/bin/phpstan analyse +        │  ║"
echo "║  │ vendor/bin/phpunit; Magento also bin/magento           │  ║"
echo "║  │ setup:di:compile). Also: replace .claude/config/       │  ║"
echo "║  │ qa-urls.json URLs; DELETE .claude/config/design-repo.  │  ║"
echo "║  │ json + v0-integration.md + .ai/docs/design-            │  ║"
echo "║  │ integration.md if the project has no Figma/v0 design   │  ║"
echo "║  │ workflow; clean .cursor/skills/* (whole folders for    │  ║"
echo "║  │ frameworks the project doesn't use, rewrite the rest); │  ║"
echo "║  │ fix .claude/templates/workflow-tracker.md checklists.  │  ║"
echo "║  │ For .ai/docs/accessibility-ux.md (large, framework-    │  ║"
echo "║  │ specific): either rewrite for this stack or flag its   │  ║"
echo "║  │ top with 'NOT YET ADAPTED'. Finally check .claude/     │  ║"
echo "║  │ agents/*.md for skill refs to removed skills.          │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 8 — Verify hooks + output style:                     ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ The kit ships .claude/hooks/package.json AND           │  ║"
echo "║  │ .claude/scripts/package.json ({\"type\":\"commonjs\"}) so  │  ║"
echo "║  │ hooks + check-propagation/spec-lint/generate-mirrors   │  ║"
echo "║  │ run even when the root package.json is \"type\":         │  ║"
echo "║  │ \"module\" (Vite/Next). Confirm both shims survived      │  ║"
echo "║  │ install; then quick-test: printf '{}' | node           │  ║"
echo "║  │ .claude/hooks/session-start.js (exit 0) and node       │  ║"
echo "║  │ .claude/scripts/check-propagation.js (runs, not a      │  ║"
echo "║  │ 'require is not defined' crash). Update inject-        │  ║"
echo "║  │ context.js codingTriggers for the stack vocabulary,    │  ║"
echo "║  │ propagation-reminder.js propagationMap, create         │  ║"
echo "║  │ .claude/output-styles/<project>.md + set outputStyle   │  ║"
echo "║  │ in settings.json (check-propagation resolves the style │  ║"
echo "║  │ file from that setting — keep them in sync).           │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 9 — Copilot / open-standard mirrors:                 ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Run node .claude/scripts/generate-mirrors.js so        │  ║"
echo "║  │ .github/copilot-instructions.md + AGENTS.md carry THIS │  ║"
echo "║  │ project's NEVER/ALWAYS (never hand-edit the marked     │  ║"
echo "║  │ blocks). Then rewrite by hand: (a) the headers of both │  ║"
echo "║  │ files (stack, build commands); (b) .github/            │  ║"
echo "║  │ instructions/*.instructions.md — applyTo globs AND     │  ║"
echo "║  │ rule content for this stack (e.g. WordPress:           │  ║"
echo "║  │ wp-content/**/*.php with nonce/sanitize/escape rules;  │  ║"
echo "║  │ Magento: app/code/**/*.php with DI/plugin/ACL rules);  │  ║"
echo "║  │ (c) .github/prompts/*.prompt.md and .github/agents/    │  ║"
echo "║  │ *.agent.md — replace NSC references (composables,      │  ║"
echo "║  │ paths, commands) with this project's. Update .vscode/  │  ║"
echo "║  │ mcp.json servers. Also patch the HTML guides           │  ║"
echo "║  │ (.ai/docs/agents-skills-update-guide.html skill        │  ║"
echo "║  │ inventory + examples). COMMIT .github/ + AGENTS.md —   │  ║"
echo "║  │ Copilot on github.com only reads committed files.      │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 10 — Slim CLAUDE.md (token cost, every turn):       ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ CLAUDE.md is injected into the system prompt on EVERY  │  ║"
echo "║  │ Claude turn — keep it lean. The kit ships a slim one   │  ║"
echo "║  │ (~10KB) with process/reference detail moved to         │  ║"
echo "║  │ .ai/docs/kit-process.md (Update Propagation, Hooks     │  ║"
echo "║  │ inventory, Quick Reference, Agent Teams, Worktree) +   │  ║"
echo "║  │ one-line pointers. Preserve that structure when you    │  ║"
echo "║  │ rewrite CLAUDE.md for this stack: keep the curated     │  ║"
echo "║  │ everyday rules + the FULL Security NEVER resident       │  ║"
echo "║  │ (inject-context only injects security on keyword match)│  ║"
echo "║  │ and keep the bulky process sections in kit-process.md, │  ║"
echo "║  │ not back in CLAUDE.md. Target: CLAUDE.md under ~11KB.  │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  PROMPT 11 — Verify no residue:                             ║"
echo "║  ┌────────────────────────────────────────────────────────┐  ║"
echo "║  │ Run: bash .ai/scripts/detect-leftovers.sh              │  ║"
echo "║  │ It greps the whole config for source-project residue   │  ║"
echo "║  │ (NorthShore, vue3/, UI/src, @UIUtils, dotnet build     │  ║"
echo "║  │ NorthShore, CRO/, etc.) and prints a per-file          │  ║"
echo "║  │ checklist. Fix each real hit, re-run until it exits 0. │  ║"
echo "║  │ Then: node .claude/scripts/check-propagation.js +      │  ║"
echo "║  │ spec-lint.js must also pass.                           │  ║"
echo "║  └────────────────────────────────────────────────────────┘  ║"
echo "║                                                              ║"
echo "║  Estimated: ~65 min with AI auto-scanning                    ║"
echo "║                                                              ║"
echo "║  ⚠ Why 7-11 are required: install.sh extracts the entire    ║"
echo "║    NSC tarball as-is (skills/commands/templates for .NET +  ║"
echo "║    Vue + EPiServer) — it does NOT filter by detected stack. ║"
echo "║    Steps 1-6 only rewrite .ai/docs/*; junk in skills/       ║"
echo "║    commands/templates/memory/config stays unless 7-9 run,   ║"
echo "║    step 10 keeps CLAUDE.md's per-turn token cost down, and  ║"
echo "║    step 11 catches whatever the manual passes missed.       ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
