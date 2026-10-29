---
name: blend-harness-gotchas
description: Checking DOM/SVG-filter transitions in real Chrome without a shell; SVG displacement and channel offsets show the frame edge
metadata:
  type: project
---

- With no shell, Playwright MCP refuses `file:` URLs and only writes screenshots under the repo. A harness page in `out/zz-<name>/<job>/index.html` is served by the running UI at `http://127.0.0.1:4780/files/zz-<name>/<job>/index.html` (inline script allowed). It can load GSAP from any existing job: `/files/csr-console/explainer-16x9/vendor/gsap.min.js`. Do not use `browser_run_code_unsafe` to stand in for a disabled shell.
- `feDisplacementMap` and `feOffset` channel splits pull transparent pixels in from beyond an element's box, which shows as a wavy or tinted strip at the frame edge. Scale the element up by the displacement margin, e.g. `1 + 0.8*d/H` (warp) or `1 + 2.4*d/W` (split), from `templates/blend.mjs`.
- A reset loop of the form "every wrapper except k and k+1" also skips wrapper 0 when k = -1. Guard it with `k < 0 ||`.

**Why:** found while building brand.blend (2026-10-29). **How to apply:** for any page-level transition that styles scene groups per frame. See [[playcheck-gotchas]].
