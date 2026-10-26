---
description: Review current code changes for quality issues
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git branch --show-current:*)
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`
- Staged + unstaged diff: !`git diff HEAD`

## Your task

Apply the `code-review` skill (.claude/skills/code-review/SKILL.md) checklist to the diff above — it is the single source of the review checklist (correctness, security, performance, conventions, DRY/reuse, impact analysis, testing, comments, update-propagation). Report findings by severity (Critical/Warning/Suggestion).
