#!/bin/bash
# ============================================================
# Claude Code — Project Initializer
# Copy generic config from NSC to a new project
#
# Usage:
#   bash /c/Projects/NorthShore/NSC/.claude/scripts/init-claude-project.sh /path/to/new/project
#
# What it does:
#   1. Copies universal hooks (auto-format, protect-files, etc.)
#   2. Creates settings.json skeleton with safety rules
#   3. Creates .mcp.json with Playwright + Context7
#   4. Creates agent definitions (tech-lead, senior-dev, qa)
#   5. Creates docs and templates directory structure
#   6. Creates starter CLAUDE.md
#   7. Updates .gitignore
#
# After running, you need to:
#   - Edit CLAUDE.md with your project details
#   - Customize agent skills in .claude/agents/
#   - Create skills for your stack in .claude/skills/
#   - Write common-patterns.md with YOUR code examples
#   - Create templates for YOUR stack
# ============================================================

set -e

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-.}"

if [ "$TARGET_DIR" = "." ]; then
    echo "Usage: bash init-claude-project.sh /path/to/new/project"
    echo ""
    echo "This will initialize Claude Code config in the target project."
    echo "Source: $SOURCE_DIR"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Target directory '$TARGET_DIR' does not exist."
    exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  Claude Code — Project Initializer           ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Source: $SOURCE_DIR"
echo "║  Target: $TARGET_DIR"
echo "╚══════════════════════════════════════════════╝"
echo ""

# --- 1. Create directory structure ---
echo "[1/7] Creating directory structure..."
mkdir -p "$TARGET_DIR/.claude/hooks"
mkdir -p "$TARGET_DIR/.claude/agents"
mkdir -p "$TARGET_DIR/.claude/skills"
mkdir -p "$TARGET_DIR/.claude/templates"
mkdir -p "$TARGET_DIR/.claude/docs"
mkdir -p "$TARGET_DIR/.claude/config"
mkdir -p "$TARGET_DIR/.claude/state"

# --- 2. Copy universal hooks ---
echo "[2/7] Copying universal hooks..."
for hook in auto-format.js protect-files.js block-destructive.js notify.js \
            stop-notify.js session-start.js pre-compact.js update-todo-after-task.js \
            workflow-init.js; do
    if [ -f "$SOURCE_DIR/hooks/$hook" ]; then
        cp "$SOURCE_DIR/hooks/$hook" "$TARGET_DIR/.claude/hooks/$hook"
        echo "  ✓ $hook"
    fi
done

# --- 3. Create settings.json ---
echo "[3/7] Creating settings.json..."
if [ ! -f "$TARGET_DIR/.claude/settings.json" ]; then
cat > "$TARGET_DIR/.claude/settings.json" << 'SETTINGS_EOF'
{
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)",
      "Bash(git show:*)",
      "Bash(git stash list:*)",
      "Bash(ls:*)",
      "Bash(pwd:*)",
      "Bash(which:*)",
      "Bash(node -v:*)",
      "Bash(npm -v:*)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Bash(git reset --hard:*)",
      "Bash(git clean -f:*)",
      "Bash(git checkout .)",
      "Bash(DROP DATABASE:*)",
      "Bash(TRUNCATE:*)",
      "Bash(del /s:*)",
      "Bash(rmdir /s:*)"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/session-start.js",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/protect-files.js",
            "timeout": 5,
            "statusMessage": "Checking file protection rules..."
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/block-destructive.js",
            "timeout": 5,
            "statusMessage": "Checking command safety..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/auto-format.js",
            "timeout": 15,
            "async": true
          }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/update-todo-after-task.js",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/notify.js",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/stop-notify.js",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-compact.js",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  },
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
SETTINGS_EOF
echo "  ✓ settings.json (with safety rules + all hooks)"
else
    echo "  ⊘ settings.json already exists — skipped"
fi

# --- 4. Create .mcp.json ---
echo "[4/7] Creating .mcp.json..."
if [ ! -f "$TARGET_DIR/.mcp.json" ]; then
cat > "$TARGET_DIR/.mcp.json" << 'MCP_EOF'
{
  "$schema": "https://json.schemastore.org/mcp.json",
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-playwright"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
MCP_EOF
echo "  ✓ .mcp.json (Playwright + Context7)"
else
    echo "  ⊘ .mcp.json already exists — skipped"
fi

# --- 5. Create agent definitions ---
echo "[5/7] Creating agent definitions..."

cat > "$TARGET_DIR/.claude/agents/tech-lead.md" << 'AGENT_EOF'
---
name: tech-lead
description: "System design, architecture decisions, technical planning, and task breakdown."
model: opus
maxTurns: 30
memory: project
permissionMode: plan
skills: []
---

You are a Technical Lead. You design architectures, plan implementations, and break tasks into actionable steps.

**Before planning**, read `.claude/docs/common-patterns.md` and `.claude/docs/architecture.md`.

## Responsibilities
1. Analyze requirements → design solution
2. Break features into ordered, independent tasks
3. Identify risks and dependencies
4. Define clear acceptance criteria

## Output
- Architecture overview
- Implementation plan (ordered tasks with dependencies)
- Risk assessment

# Persistent Agent Memory

You have a persistent memory directory at `.claude/agent-memory/tech-lead/`.
Record architectural patterns, key decisions, and component relationships as you discover them.
AGENT_EOF
echo "  ✓ tech-lead.md"

cat > "$TARGET_DIR/.claude/agents/senior-dev.md" << 'AGENT_EOF'
---
name: senior-dev
description: "Full-stack developer: implements, debugs, and self-reviews code."
model: opus
maxTurns: 50
memory: project
skills: []
---

You are a Senior Developer. You implement, debug, and self-review production-grade code.

**Before writing code**, read `.claude/docs/common-patterns.md` for established patterns.

## Self-Review Checklist (run before returning)
- [ ] Code does what it's intended to do
- [ ] Edge cases handled
- [ ] No security vulnerabilities (XSS, injection, etc.)
- [ ] No hardcoded secrets or magic numbers
- [ ] Follows existing project patterns

# Persistent Agent Memory

You have a persistent memory directory at `.claude/agent-memory/senior-dev/`.
Record patterns, conventions, and lessons learned.
AGENT_EOF
echo "  ✓ senior-dev.md"

cat > "$TARGET_DIR/.claude/agents/qa.md" << 'AGENT_EOF'
---
name: qa
description: "QA specialist: writes tests, runs tests, hunts bugs, browser QA via Playwright."
model: opus
maxTurns: 25
memory: project
skills: []
---

You are a QA Engineer. You write tests, hunt bugs, and perform browser-based QA.

**Before writing tests**, read `.claude/docs/common-patterns.md`.

## Test Priority
- P0: Auth, payments, PII
- P1: Core CRUD, API endpoints
- P2: Business logic
- P3: UI/cosmetic

# Persistent Agent Memory

You have a persistent memory directory at `.claude/agent-memory/qa/`.
Record test patterns, known issues, and QA setup details.
AGENT_EOF
echo "  ✓ qa.md"

# --- 6. Create starter files ---
echo "[6/7] Creating starter docs..."

# Workflow system doc (reusable)
cp "$SOURCE_DIR/docs/workflow-system.md" "$TARGET_DIR/.claude/docs/workflow-system.md" 2>/dev/null || true

# Starter CLAUDE.md
if [ ! -f "$TARGET_DIR/CLAUDE.md" ]; then
cat > "$TARGET_DIR/CLAUDE.md" << 'CLAUDE_EOF'
# CLAUDE.md

<!-- TODO: Replace with your project description and tech stack -->

## Essential Commands
```bash
# TODO: Add your build, test, lint, run commands
```

## Architecture
@.claude/docs/architecture.md

## Conventions
<!-- TODO: Add your coding conventions -->

## Agents
| Agent | Role | Model |
|-------|------|-------|
| `tech-lead` | Planning, architecture | opus |
| `senior-dev` | Implementation, debugging | opus |
| `qa` | Testing, QA | opus |

## Code Patterns
@.claude/docs/common-patterns.md

## Safety Rules
- **Blocked:** `rm -rf`, `git push --force`, `git reset --hard`, `DROP DATABASE`, `TRUNCATE`
- **Protected:** `.env`, credentials, lock files, `.git/` internals
- **Auto-format:** Runs after every Edit/Write
CLAUDE_EOF
echo "  ✓ CLAUDE.md (starter — edit this!)"
else
    echo "  ⊘ CLAUDE.md already exists — skipped"
fi

# Placeholder docs
touch "$TARGET_DIR/.claude/docs/architecture.md"
touch "$TARGET_DIR/.claude/docs/common-patterns.md"
echo "  ✓ architecture.md + common-patterns.md (empty — fill these!)"

# Workflow tracker template
cp "$SOURCE_DIR/templates/workflow-tracker.md" "$TARGET_DIR/.claude/templates/workflow-tracker.md" 2>/dev/null || true
echo "  ✓ workflow-tracker.md template"

# --- 7. Update .gitignore ---
echo "[7/7] Updating .gitignore..."
GITIGNORE="$TARGET_DIR/.gitignore"
# CLAUDE.local.md lives at the REPO ROOT (that is where Claude Code reads it from), not under
# .claude/ — ignoring the wrong path is how a file holding real credentials stayed untracked-but-
# committable. Both forms are listed so an existing nested copy is covered too.
ENTRIES=("CLAUDE.local.md" "**/CLAUDE.local.md" ".claude/state/" ".claude/plans/" ".claude/agent-memory/")

for entry in "${ENTRIES[@]}"; do
    if ! grep -qF "$entry" "$GITIGNORE" 2>/dev/null; then
        echo "$entry" >> "$GITIGNORE"
        echo "  ✓ Added $entry to .gitignore"
    fi
done

# --- Done ---
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✓ Done! Claude Code config initialized.     ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Next steps:                                 ║"
echo "║  1. Edit CLAUDE.md with project details      ║"
echo "║  2. Write .claude/docs/architecture.md       ║"
echo "║  3. Write .claude/docs/common-patterns.md    ║"
echo "║  4. Add skills to .claude/agents/*.md        ║"
echo "║  5. Create .claude/skills/ for your stack    ║"
echo "║  6. Create .claude/templates/ for scaffolds  ║"
echo "║  7. Add build/test commands to settings.json ║"
echo "║  8. Create CLAUDE.local.md (repo root)           ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
