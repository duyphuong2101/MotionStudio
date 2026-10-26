---
name: threejs-gotchas
description: three r186 quirks for the model scene (templates/model3d.mjs) — PCFSoftShadowMap removed, PCF radius, vendor map keys pinned by a test
metadata:
  type: project
---

- three 0.186 removed `PCFSoftShadowMap`: setting it only warns and falls back to `PCFShadowMap`. Soft shadows = `PCFShadowMap` + `light.shadow.radius` (Vogel disk with interleaved gradient noise on gl_FragCoord, so still deterministic).
- Every vendor file added to `THREE_FILES` (engine/vendor.mjs) changes the import-map key list asserted in `tests/fix-templates-pure.test.mjs` (inlinePage test); `engine/htmlvideo.mjs` picks new modules up on its own.
- `RoomEnvironment` (examples/jsm/environments) imports only `'three'`, so it vendors flat without the `../utils/` rewrite.
- Any MODEL_JS change moves the explainer `PARTS_BASELINE` hashes in tests/templates.test.mjs (the sample has a model scene); NO_MODEL_BASELINE must not move.

**Why:** found while adding studio IBL + contact shadow (2026-10-26).
**How to apply:** check the installed three version's changelog-style warnings before using a shadow/tone-mapping constant; see [[layout-verification-gotchas]] for still checks.
