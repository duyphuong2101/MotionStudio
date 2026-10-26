---
description: Deep codebase search for a concept, pattern, or implementation
argument-hint: [what to search for]
---

## Your task

Search the codebase for: $ARGUMENTS

## Process

1. **Interpret the query**: Determine if the user is looking for:
   - A specific function, class, or variable
   - Where a feature is implemented
   - How a pattern is used across the codebase
   - All references to a concept
2. **Search broadly first**: Use Glob for file patterns, Grep for content patterns
3. **Narrow down**: Read the most relevant files to understand context
4. **Report findings**: List all relevant locations with file:line references and brief descriptions

## Output Format

Group results by relevance:

### Primary (direct matches)
- `file:line` — description of what's there

### Related (indirect references)
- `file:line` — description of how it relates

### Summary
Brief explanation of how the pieces connect.
