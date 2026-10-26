---
description: Find and fix performance bottlenecks
argument-hint: [file path, function, or description of slow behavior]
---

## Your task

Optimize: $ARGUMENTS

## Process

1. **Read the code**: Understand the current implementation and its performance characteristics
2. **Identify bottlenecks**:
   - N+1 queries or redundant database calls
   - O(n^2) or worse algorithms on large datasets
   - Sequential I/O that could be parallelized
   - Unnecessary allocations or copies
   - Missing caching for repeated expensive operations
   - Frontend: unnecessary re-renders, large bundles, layout thrashing
3. **Propose fixes**: For each bottleneck, suggest a specific optimization
4. **Implement**: Apply the optimizations that provide the most impact

## Rules

- Only optimize code with measurable impact — no micro-optimizations
- Consider actual scale: O(n^2) on 10 items is fine
- Preserve readability — a 5% speedup is not worth unreadable code
- Do not change the public API unless necessary
- Explain the expected improvement for each change
