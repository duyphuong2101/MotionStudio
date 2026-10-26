---
name: csr-console-ui-story-priority
description: The user's main project is csr-console and its videos are ui-story based; any cross-template feature must cover ui-story early, not defer it
metadata:
  type: project
---

The user's main project is `csr-console`; its videos use the ui-story renderer (a 1920x1080, non-kit template). The mixed-template plan (`.ai/plans/mixed-template.md`, 2026-10-14) chose to move ui-story onto `templates/kit.mjs` keeping raw px so it can mix in an early phase.

**Why:** The user said ui-story MUST be mixable and not be deferred indefinitely; the proof scenes they want (data-story chart, testimonial quote) go into ui-story tours.

**How to apply:** When planning template-wide changes (formats, shells, new scene features), check how ui-story is covered and put it before product-demo / app-walkthrough. product-demo, social-teaser, app-walkthrough, talking-head and logo-reveal were deliberately left out of mixing in v1.
