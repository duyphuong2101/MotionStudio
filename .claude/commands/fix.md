---
description: Diagnose and fix a bug
argument-hint: [description of the bug or error message]
---

## Your task

Diagnose and fix the following issue: $ARGUMENTS

## Process

1. **Reproduce understanding**: Parse the bug description or error message to understand what's failing
2. **Locate the source**: Search the codebase for relevant code — error messages, function names, file paths mentioned
3. **Root cause analysis**: Read the code, trace the execution path, identify why it fails
4. **Fix**: Make the minimal change needed to fix the root cause — do not refactor surrounding code
5. **Verify**: Check that the fix doesn't introduce new issues or break related functionality

## Rules

- Fix the root cause, not the symptom
- Make the smallest change that fixes the problem
- Do not refactor or "improve" unrelated code
- If the fix requires a choice between approaches, explain the options and ask
