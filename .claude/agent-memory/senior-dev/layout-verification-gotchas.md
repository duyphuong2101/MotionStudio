---
name: layout-verification-gotchas
description: How to verify template layouts per format; lintInPage misses subtitle overlap; known pre-existing overflows
metadata:
  type: project
---

`lintInPage` (engine/media.mjs) only checks that `[data-lint]` boxes sit inside the safe area. It does not see content running under the subtitle band or non-text visuals overlapping. Look at the stills for every format you touch.

Before/after stills of a real job without touching its status: rebuild `index.html` from the job's `script.json` + `timing.json` into a scratch folder (copy `vendor/`, `assets/`), `openComposition`, seek the times from `status.json` stills. Chrome screenshots are byte-identical run to run, so compare against a rebuilt "before" too; existing stills can be stale. A pixel-diff bbox per still (canvas in a page launched with `--allow-file-access-from-files`) shows where drift is. Kit stills sit at `end - 0.45`, ui-story's old ones at `end - 0.35`: compare at the times prepare will really use, or a fade starting at `start - 0.35` tints the frame. The kit pill (36 px bold) wraps a 1920-wide voice line at about 95 characters.

Lint also misses text spilling out of a box whose `overflow` is visible (explainer `.node` labels in a squeezed row passed lint on 2026-10-22 while overlapping the arrows); check `scrollWidth > clientWidth` yourself, as `tests/cinematic.test.mjs` now does for nodes. A scratchpad harness that builds pages for the award brand (`profiles/nsc-award`), runs `lintInPage` at every still and screenshots each scene is the fastest loop; validation messages that contain the word "position" get dropped by a naive `/position/` sequence-error filter, so filter on `/at position \d/`.

**Why:** in 2026-10 the 4:5 portrait layouts passed lint yet the promo price, explainer diagram and data-story donut legend sat under the subtitles.

**How to apply:** compose each template from its demo job (`out/<p>/<job>/script.json` + `timing.json`) in every format, also with every limited text field padded to its limit, then tile the stills with ffmpeg into one contact sheet per template x format and read those. Known pre-existing overflows (not caused by new formats): explainer 1:1 diagram with 4+ nodes in a row; logo-reveal tagline at its limit spans the full 1080 width in every portrait/square format; before-after square split title on 2 lines overlaps the panels.
