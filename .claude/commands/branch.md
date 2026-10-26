---
description: Create a feature branch, commit changes, and push
allowed-tools: Bash(git checkout -b:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(git branch:*), Bash(git diff:*)
argument-hint: [branch name or feature description]
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`
- Staged + unstaged diff: !`git diff HEAD`

## Your task

Create a feature branch and commit the current changes.

1. If `$ARGUMENTS` is provided, derive a branch name from it (e.g., `feature/add-user-auth`). Use kebab-case with a conventional prefix (`feature/`, `fix/`, `refactor/`, `chore/`).
2. If already on a feature branch (not main/master/develop), use the current branch.
3. Create the branch if needed.
4. Stage all changed files (but not untracked files that look like secrets or build artifacts).
5. Create a commit with a clear message summarizing the changes.
6. Push to origin with `-u` flag.

Do all steps in a single message. Report the branch name and push result when done.
