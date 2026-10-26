---
description: "Generate a HANDOVER.md for the next Claude session with full context"
argument-hint: "[optional: specific focus or notes for next session]"
---

# Session Handover Document

Generate a comprehensive handover document so the next Claude session can continue seamlessly with full context.

## Additional Notes from User: $ARGUMENTS

---

## Instructions

Analyze the ENTIRE conversation history and generate a `HANDOVER.md` file in the project root directory. The document must be thorough enough that a brand new Claude session can pick up exactly where this session left off.

---

## Document Structure

Generate the following sections:

### 1. Session Summary
- **Date:** [today's date]
- **Branch:** [current git branch]
- **Duration:** [approximate — based on conversation length]
- **Overall Goal:** [1-2 sentence summary of what user wanted to accomplish]

### 2. What Was Accomplished
List everything that was completed in this session, with specifics:

```markdown
## Completed Work

### [Task/Feature 1]
- **Status:** ✅ Complete / 🔄 Partial / ❌ Blocked
- **Files Created:**
  - `path/to/file.ts` — [purpose]
- **Files Modified:**
  - `path/to/file.mjs` — [what changed and why]
- **Key Implementation Details:**
  - [Important technical detail 1]
  - [Important technical detail 2]
```

### 3. What's NOT Done Yet
Equally important — what remains to be done:

```markdown
## Remaining Work

### [Pending Task 1]
- **Priority:** High/Medium/Low
- **Description:** [what needs to be done]
- **Blocked By:** [if anything]
- **Files Likely Affected:** [paths]
- **Suggested Approach:** [if discussed]
```

### 4. Architecture Decisions Made
Document every design/architecture decision made during the session:

```markdown
## Decisions

| # | Decision | Alternatives Considered | Reason |
|---|----------|------------------------|--------|
| 1 | [what was decided] | [other options] | [why this was chosen] |
```

### 5. Pitfalls & Gotchas
Things that went wrong, were tricky, or need caution:

```markdown
## Pitfalls & Gotchas

### [Issue Title]
- **What happened:** [description]
- **Root cause:** [why it happened]
- **Solution/Workaround:** [how it was resolved]
- **Watch out for:** [what to be careful about going forward]
```

### 6. Key Code Patterns Discovered
Patterns in the codebase that were discovered and are important for continuing work:

```markdown
## Codebase Patterns

### [Pattern Name]
- **Location:** `path/to/example`
- **How it works:** [explanation]
- **Important for:** [why next session needs to know this]
```

### 7. Current State Snapshot
The exact state of things right now:

```markdown
## Current State

### Git Status
- Branch: [branch name]
- Uncommitted changes: [yes/no, list files]
- Last commit: [hash + message]

### Build Status
- UI (`npm run ui`): [starts? last known state]
- Tests (`npm test`): [pass? failures?]
- Engine smoke (`node engine/cli.mjs help`): [ok?]

### Test Status
- Unit tests: [passing/failing, which ones]
- Lint: [clean/errors]

### Workflow Status (if active)
- Current Phase: [phase number and name]
- Jira Status: [emoji + status]
- TodoWrite State: [summary of todo items]
```

### 8. Files Quick Reference
A quick reference of all files that are relevant to the ongoing work:

```markdown
## Key Files

| File | Role | Status |
|------|------|--------|
| `path/to/file` | [what it does] | New/Modified/Reference |
```

### 9. Environment & Prerequisites
Anything the next session needs to know about the environment:

```markdown
## Environment Notes
- [Any special setup needed]
- [Services that need to be running]
- [Environment variables required]
- [Database state]
```

### 10. Recommended Next Steps
Ordered list of what to do next:

```markdown
## Next Steps (Recommended Order)

1. **[First priority]** — [description]
   - Start with: `path/to/file`
   - Command: `[relevant command]`

2. **[Second priority]** — [description]
   - Depends on: Step 1
   - Files: `path/to/file`

3. ...
```

### 11. User Preferences Observed
Any user preferences or working style noted during the session:

```markdown
## User Preferences
- [Language preference: Vietnamese/English/mixed]
- [Code style preferences observed]
- [Workflow preferences: detailed vs brief responses]
- [Any explicit instructions given]
```

---

## Output Rules

1. **Write the file** to the project root as `HANDOVER.md`
2. **Be specific** — Include actual file paths, function names, variable names, not vague descriptions
3. **Include code snippets** where they help explain state or decisions (keep brief)
4. **Git-aware** — Run `git status`, `git branch`, `git log --oneline -5` to capture exact state
5. **Check TodoWrite** — If there's an active todo list, capture its current state
6. **Err on the side of MORE detail** — Too much context is better than too little
7. **No secrets** — Don't include API keys, passwords, connection strings
8. **Timestamp everything** — So next session knows how fresh the information is

---

## Before Writing

Gather this information first:

```bash
# Git state
git status
git branch --show-current
git log --oneline -5

# Check for uncommitted changes
git diff --stat

# Current directory
pwd
```

Then read the conversation history thoroughly and write the HANDOVER.md.

---

## After Writing

Show a summary to the user:

```
═══════════════════════════════════════════
  📋 HANDOVER DOCUMENT GENERATED
═══════════════════════════════════════════
  📄 File: HANDOVER.md
  📊 Sections: [count]
  📁 Files referenced: [count]
  ✅ Completed tasks: [count]
  🔄 Pending tasks: [count]

  Next session: Open HANDOVER.md or paste
  its contents to give Claude full context.
═══════════════════════════════════════════
```