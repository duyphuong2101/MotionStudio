# Workflow Tracker: [TASK_NAME]

**Task ID:** TASK-[XXX]
**Created:** [DATE]
**Assignee:** Developer
**QA Assignee:** Quinn (AI)

---

## JIRA-STYLE STATUS

| Status | Emoji | Timestamp | Notes |
|--------|-------|-----------|-------|
| 📋 TODO | ✓ | [timestamp] | Task created |
| 🔄 IN_PROGRESS | | | |
| 👀 CODE_REVIEW | | | |
| 🧪 REQUEST_FOR_TEST | | | |
| 🔍 IN_QA | | | |
| ❌ FAILED_QA | | | |
| ✅ PASSED_QA | | | |
| 🎉 DONE | | | |

**Current Status:** 📋 TODO
**Current Phase:** 0 (Not started)
**Iteration:** 1

---

## Task Description
[Paste the original task/requirement here]

---

## Status History Log

```
[TIMESTAMP] 📋 TODO → Task created
[TIMESTAMP] 🔄 IN_PROGRESS → Started development (Phase 1)
[TIMESTAMP] 👀 CODE_REVIEW → Code complete, under review (Phase 3)
[TIMESTAMP] 🔄 IN_PROGRESS → Review rejected: [reason]
[TIMESTAMP] 👀 CODE_REVIEW → Review resubmitted
[TIMESTAMP] 🧪 REQUEST_FOR_TEST → Review passed (Phase 4)
[TIMESTAMP] 🔍 IN_QA → Tests passed, QA started (Phase 5)
[TIMESTAMP] ❌ FAILED_QA → QA found bugs: [list]
[TIMESTAMP] 🔄 IN_PROGRESS → Fixing QA bugs
[TIMESTAMP] 🔍 IN_QA → Re-testing after fix
[TIMESTAMP] ✅ PASSED_QA → QA verdict: SHIP IT (Phase 6)
[TIMESTAMP] 🎉 DONE → PR merged: [url]
```

---

## Phase Progress

| Phase | Name | Jira Status | Status | Iterations |
|-------|------|-------------|--------|------------|
| 1 | Planning | IN_PROGRESS | ⏳ Pending | 0 |
| 2 | Implementation | IN_PROGRESS | ⏳ Pending | 0 |
| 3 | Code Review | CODE_REVIEW | ⏳ Pending | 0 |
| 4 | Unit Testing | REQUEST_FOR_TEST | ⏳ Pending | 0 |
| 5 | QA Testing | IN_QA | ⏳ Pending | 0 |
| 6 | Pre-Commit | PASSED_QA | ⏳ Pending | 0 |
| 7 | Commit | PASSED_QA | ⏳ Pending | 0 |

Legend: ⏳ Pending | 🔄 In Progress | ✅ Done | ❌ Failed

---

## Phase 1: PLANNING (IN_PROGRESS)

### Checklist:
- [ ] 1.1 Analyze requirements
- [ ] 1.2 Survey codebase
- [ ] 1.3 Design architecture
- [ ] 1.4 Identify files
- [ ] 1.5 Break down tasks
- [ ] 1.6 Identify risks
- [ ] 1.7 Create plan document

### Implementation Plan:
```markdown
<!-- Paste implementation plan here -->
```

### Result: PASS / FAIL
### Status Change: TODO → IN_PROGRESS

---

## Phase 2: IMPLEMENTATION (IN_PROGRESS)

### Engine / server Checklist:
- [ ] 2.1 beats.json rules / data shape
- [ ] 2.2 Validation (script.mjs, brand.mjs, validateBrief)
- [ ] 2.3 Engine step (pipeline.mjs / jobs.mjs, state via setStatus)
- [ ] 2.4 Lock coverage (SOURCE_FIELDS; scene fields listed in `beats.json` `fields`)
- [ ] 2.5 Server route (server.mjs)

### Template / UI Checklist:
- [ ] 2.6 Renderer (template.mjs or extends)
- [ ] 2.7 Layout in every listed format (16:9, 1:1, 9:16, 4:5, 2:3, 21:9)
- [ ] 2.8 UI (ui/app.js, ui/app.css)

### Files Created:
| File | Purpose |
|------|---------|
| | |

### Files Modified:
| File | Changes |
|------|---------|
| | |

### Result: PASS / FAIL
### Status Change: (stay IN_PROGRESS) → CODE_REVIEW

---

## Phase 3: CODE REVIEW (CODE_REVIEW)

### Checklist:
- [ ] 3.1 Quick review (/review)
- [ ] 3.2 Comprehensive review
- [ ] 3.3 Security review
- [ ] 3.4 Accessibility review
- [ ] 3.5 Architecture review

### Issues Found:
| # | Severity | Location | Issue | Status |
|---|----------|----------|-------|--------|
| | | | | |

### Result: PASS / FAIL (Iteration: X)
### Status Change:
- PASS → CODE_REVIEW → REQUEST_FOR_TEST
- FAIL → CODE_REVIEW → IN_PROGRESS (rejected)

---

## Phase 4: UNIT TESTING (REQUEST_FOR_TEST)

### Checklist:
- [ ] 4.1 Engine tests (tests/engine.test.mjs)
- [ ] 4.2 Template tests (tests/templates.test.mjs)
- [ ] 4.3 Asset tests (tests/assets.test.mjs)
- [ ] 4.4 Run npm test

### Test Results:
| Suite | Total | Pass | Fail | Coverage |
|-------|-------|------|------|----------|
| Backend | | | | |
| Frontend | | | | |

### Failed Tests:
| Test | Error | Root Cause | Fix |
|------|-------|------------|-----|
| | | Code bug / Test bug | |

### Result: PASS / FAIL (Iteration: X)
### Status Change:
- PASS → REQUEST_FOR_TEST → IN_QA
- FAIL (code) → REQUEST_FOR_TEST → IN_PROGRESS
- FAIL (test) → Stay REQUEST_FOR_TEST

---

## Phase 5: QA TESTING (IN_QA)

### Pre-QA:
- [ ] 5.1 Dev server running
- [ ] 5.2 Feature accessible
- [ ] 5.3 Test data ready

### QA Execution:
- [ ] 5.4 VERIFY mode
- [ ] 5.5 EXPLORE mode
- [ ] 5.6 Mobile (375x812)
- [ ] 5.7 Accessibility
- [ ] 5.8 Console errors
- [ ] 5.9 Screenshot bugs
- [ ] 5.10 Generate tests

### QA Report Summary:
**URL:** [tested URL]
**Verdict:** SHIP IT / NEEDS FIXES / BLOCKED

### Bugs Found:
| # | Severity | Title | Status |
|---|----------|-------|--------|
| | | | |

### Mobile Results:
| Check | Status |
|-------|--------|
| No horizontal scroll | |
| Text readable | |
| Touch targets | |
| Navigation | |

### Result: SHIP IT / NEEDS FIXES / BLOCKED (Iteration: X)
### Status Change:
- SHIP IT → IN_QA → PASSED_QA
- NEEDS FIXES → IN_QA → FAILED_QA → IN_PROGRESS
- BLOCKED → IN_QA → FAILED_QA → IN_PROGRESS

---

## Phase 6: PRE-COMMIT (PASSED_QA)

### Checklist:
- [ ] 6.1 ESLint pass
- [ ] 6.2 Prettier pass
- [ ] 6.3 Build pass
- [ ] 6.4 No secrets
- [ ] 6.5 Files tracked

### Check Results:
| Check | Status |
|-------|--------|
| ESLint | |
| Prettier | |
| Build | |
| Secrets | |

### Result: PASS / FAIL
### Status Change: Stay PASSED_QA

---

## Phase 7: COMMIT (PASSED_QA → DONE)

### Checklist:
- [ ] 7.1 Feature branch
- [ ] 7.2 Stage files
- [ ] 7.3 Commit message
- [ ] 7.4 Commit
- [ ] 7.5 Push
- [ ] 7.6 Create PR

### Commit Info:
- **Branch:**
- **Commit Hash:**
- **PR URL:**

### Result: PASS / FAIL
### Status Change: PASSED_QA → DONE

---

## Workflow Summary

### Status Flow (Actual):
```
📋 TODO
    │
    ▼ [timestamp]
🔄 IN_PROGRESS (Phase 1-2)
    │
    ▼ [timestamp]
👀 CODE_REVIEW (Phase 3)
    │
    │ ◄── 🔄 IN_PROGRESS [rejected: reason]
    │
    ▼ [timestamp]
🧪 REQUEST_FOR_TEST (Phase 4)
    │
    ▼ [timestamp]
🔍 IN_QA (Phase 5)
    │
    │ ◄── ❌ FAILED_QA [bugs: list]
    │         │
    │         ▼
    │     🔄 IN_PROGRESS [fixing bugs]
    │
    ▼ [timestamp]
✅ PASSED_QA (Phase 6-7)
    │
    ▼ [timestamp]
🎉 DONE [PR: url]
```

### Timeline:
| Event | Status | Timestamp |
|-------|--------|-----------|
| Task Created | TODO | |
| Started | IN_PROGRESS | |
| Code Complete | CODE_REVIEW | |
| Review Passed | REQUEST_FOR_TEST | |
| Tests Passed | IN_QA | |
| QA Passed | PASSED_QA | |
| PR Merged | DONE | |
| **Total Time** | | |

### Iteration Log:
| # | From Status | To Status | Reason |
|---|-------------|-----------|--------|
| 1 | TODO | IN_PROGRESS | Started |
| | | | |

### Final Status: 🎉 DONE / ❌ BLOCKED

### Artifacts:
- [ ] Implementation plan
- [ ] Code review report
- [ ] Test results
- [ ] QA report
- [ ] Playwright tests
- [ ] PR link

### Lessons Learned:
-
