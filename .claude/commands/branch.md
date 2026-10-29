---
description: Create a feature branch and commit the changes (push only on an explicit "push" in the request)
allowed-tools: Bash(git switch -c:*), Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git branch:*), Bash(git diff:*), Bash(git push -u origin HEAD)
argument-hint: [branch name or feature description]
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`
- Staged + unstaged diff: !`git diff HEAD`

## Your task

Create a feature branch and commit the current changes.

1. If `$ARGUMENTS` is provided, derive a branch name from it (e.g., `feature/add-user-auth`). Use kebab-case with a conventional prefix (`feature/`, `fix/`, `refactor/`, `chore/`).
2. If already on a feature branch (not main/master), use the current branch.
3. Otherwise create it with `git switch -c <name>` — from the current HEAD, never by resetting anything.
4. Stage only the change's files by explicit path (`git add <path> <path>`). Never `git add -A` / `git add .`; leave incidentally-dirty files unstaged and list them in the report.
5. Commit with a clear message summarizing the changes.
6. Push only when the request said "push": exactly `git push -u origin HEAD`. Otherwise stop after the commit.

Report the branch name, the committed files, any files left unstaged, and the push result if one ran.
