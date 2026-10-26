---
name: motion-presets-decision
description: 2026-10-23 user picked four new brand.motion presets (clean, editorial, kinetic, parallax); plan at .ai/plans/motion-presets.md; clean is the award-film candidate and keeps the cinematic "stage" layout
metadata:
  type: project
---

On 2026-10-23 the user chose four more `brand.motion` values: `clean`, `editorial`, `kinetic`, `parallax`. The plan is `.ai/plans/motion-presets.md` (status planning): a motion profile table in `engine/brand.mjs` that the kit, five templates and the pipeline read by field, never by name. Epic order clean → editorial → kinetic → parallax.

**Why:** the NSC award film (`profiles/nsc-award`, cinematic + `film: false` + `logoBug`) may switch to `clean` to lose blur, push-in and grain while keeping its tuned layout. Standard and cinematic pages must stay byte for byte the same (golden hashes; a `CINE_BASELINE` is recorded first).

**How to apply:** open questions in the plan are unanswered until the user replies (clean keeps the stage layout? film checkbox? captions for kinetic? parallax on ui-story?). The `review-fixes-2026-10-23` session edits `kit.mjs`, `pipeline.mjs` and `playcheck.mjs` in parallel: do not start the kit refactor before those land. See [[csr-console-ui-story-priority]] for why ui-story must be covered early in any template-wide change.
