---
description: Refactor code while preserving behavior
argument-hint: [file path or description of what to refactor]
---

## Your task

Refactor: $ARGUMENTS

## Process

1. **Read the code**: Understand the current implementation completely
2. **Check test coverage**: Find existing tests. If coverage is insufficient, write tests FIRST
3. **Plan the refactoring**: Identify the specific smell and the appropriate refactoring pattern
4. **Execute in small steps**: One structural change at a time
5. **Verify**: Ensure the refactoring is purely structural — no behavior changes

## Common Refactoring Patterns

Pattern catalog (smells → refactorings): see the `refactor-guide` skill — single source of truth.

## Rules

- Preserve all existing behavior — refactoring is not feature work
- If tests don't exist, add them before refactoring
- One refactoring pattern per step
- Do not change formatting, naming conventions, or style of untouched code
