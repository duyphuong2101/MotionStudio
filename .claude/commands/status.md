---
description: "Show current workflow status"
---

# Workflow Status Check

Read the current todo list and determine:
1. **Current Phase** (IMPLEMENT / CODE_REVIEW / USER_REVIEW / VERIFY / UNIT_TEST / QA / DONE)
2. **What's been completed**
3. **What's next**

---

## Status Detection

| Todo Contains | Phase | Next Action |
|---------------|-------|-------------|
| `[IMPLEMENT]` active | IMPLEMENT | Complete planning & implementation |
| `[CODE_REVIEW]` active | CODE_REVIEW | Independent review of changed files |
| `[USER_REVIEW]` active | USER_REVIEW (optional) | Wait for user approval |
| `[VERIFY]` active | VERIFY (mandatory) | Run `npm test` + engine smoke — objective gate |
| `[UNIT_TEST]` active | UNIT_TEST | Write & run unit tests, fix if failing |
| `[QA]` active | QA (optional) | Browser-based Playwright QA |
| `[DONE]` active | DONE | Workflow complete |

---

## Generate Status Report

```
===================================
  WORKFLOW STATUS
===================================
  Task: [task name from todo]
  Current Phase: [phase name]
  Status: [in progress / paused / complete]

  Progress:
    [IMPLEMENT]   [completed/in_progress/pending]
    [CODE_REVIEW] [completed/in_progress/pending]
    [VERIFY]      [completed/in_progress/pending]
    [UNIT_TEST]   [completed/in_progress/pending]
    [DONE]        [completed/pending]
    (+ [USER_REVIEW] / [QA] rows when enabled — by user keyword or Step 1b risk routing)

  Next: [what to do next]
===================================
```

Read the current todo list and generate the status report.
