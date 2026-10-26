---
name: playcheck-gotchas
description: Play-through check (engine/playcheck.mjs) quirks: GSAP t=0 seeks, stale text in hidden scenes, cinematic push-in moving bottom labels, cost numbers, kit id collisions, GSAP translate folding, float text in hashed pages
metadata:
  type: project
---

- GSAP skips `tl.seek(0)` when the timeline already sits at 0, so a `set` at 0 never runs on the render's first frame. The kit forces `tl.render(0, false, true)`; product-demo had its own seek without it (fixed 2026-10-23). app-walkthrough still uses plain `tl.seek` but showed no finding.
- Seeking 0 twice in a row flips zero-time sets with the direction: the checker skips "jumped from the start" at t = 0 for that reason, not a template bug.
- Templates that update text in `afterSeek` only inside a time window (audiogram timer) keep stale text while their scene is hidden. Played vs jumped compares text only when the element shows.
- Cinematic pages scale every scene group to 1.03 around its centre: a label near the bottom edge moves ~13 px down by the scene end and can meet the caption line (ui-story `.ui-cap`, fixed with `CINE_PUSH`). Cinematic captions are `sub-<scene>-<k>`, never `sub-<scene>`.
- Cost: ~3 s for a 44.5 s job at 1/12 s (535 frames); the whole 17-template sweep at 1/6 s is ~80-95 s per motion profile (`tests/playcheck-templates.test.mjs` runs one test per profile).
- Kit-level DOM ids must not collide with a renderer's own: ui-story already has `#panel`, so the editorial cut sheet is `#cutpanel` (a duplicate id restyled ui-story's assistant panel and showed up as "sb Search × span All customers" text over text, 2026-10-23).
- GSAP folds an element's CSS `translate` into its own transform the first time it tweens a transform there, then pins `translate: none`: a CSS-variable-driven `translate` layer does not compose with GSAP entrances. Parallax drift is an `x` tween per element instead (`layerDrift` in kit.mjs).
- Motion profile pages: never compute a float like `1.03 - 1` into page text (0.030000000000000027 moves pinned hashes); round first (ui-story `PUSH_LIFT`).

**Why:** found while building E2 (production-toolkit plan) on 2026-10-23.

**How to apply:** when a play-through finding appears on a new template, check these first before calling it a checker false positive. See [[layout-verification-gotchas]].
