# model-tour — a product pack in 3D: pack-glb, camera path, explode, product-tour template

**Status:** done
**Author:** tech-lead
**Branch:** master
**Created:** 2026-10-27
**Risk tier / auto-enabled phases:** template look → USER_REVIEW with stills; engine test for the script check

## Intent
NorthShore relaunched MegaMax Classic. The person wants product videos "as 3D and as smooth" as Quân's
three.js tour page (`megamax-lite-tour.html`: six camera steps, lerped camera, exploded layers) and the
web animations on Dribbble, without a 3D artist for every pack.
**For whom / outcome:** the person directing brand videos in Motion Studio: a pack picture becomes a
turning 3D pack, and a model scene can glide through several camera poses and pull its layers apart
while the voice explains them, so a product film reads as a 3D tour rather than a flat pack shot.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| Import Quân's tour page as a template as is | the look is there | interactive (Back/Next), per-frame lerps, one product's geometry in code | ❌ not deterministic, not reusable |
| Extend the model scene (camera path, explode) and add a product-tour template over one canvas | every .glb benefits, pure functions of seek(t), reuses model3d.mjs | the pack box from pictures has only three layers | ✅ |
| Lottie / VAT layers | designer-authored motion | needs AE or a Blender bake per video | ❌ later, on demand |

## Scope
- [x] `engine/pack-glb.mjs` + `pack-glb` CLI: a .glb box from a pack's front and back pictures (ffmpeg cropdetect trims the margins, pictures embedded as textures, edges in the brand primary); `.glb` listed by `listAssets`.
- [x] Camera path: model scene `path` (2-4 poses in `VIEW_RANGE`), the camera glides pose to pose on a smooth step inside the scene; `view` stays the start pose. Script check, help, test.
- [x] Explode: model scene `explode` (named nodes of the .glb, 1-6, plus `gap`): those nodes move out along their own offset from the model centre on an expo ease, from a word cue or 30% in. pack-glb names its nodes `front`, `back`, `edges`. Script check, help, test.
- [x] `product-tour` template: one model canvas full frame for the whole video, scenes `title`, `step` (pose + caption + optional explode), `cta`; the camera glides between steps with no cut; the model shifts beside the caption (`offset` per stop); a step with its own `view`/`explode` is no "same layout" in the pacing review.
- [x] A model canvas draws the clamped time outside its scene, so a jump and a play-through agree (the playcheck caught the tour's cta).

- [x] Review fixes (2026-10-27): clamped eases (parts were flung before a move), gap eased per step, picture faces MASK + two-sided, work folder per run under `within()` and removed in `finally`, `engine/model-rules.mjs` so the engine imports no template, a model scene is no "same layout".
- [x] `env: "brand"`: a PMREM room from panels in the brand primary and secondary.
- [x] `decal`: a brand or built-in icon on a canvas texture stamped on the front face, riding on a named part.
- [x] Lottie: `.json` assets checked on upload, the explainer `anim` kind over lottie-web (SVG), seeked by `goToAndStop`; the kit adds the player only to pages with one.

## Out of scope
Vertex animation textures (a Blender bake per video; not built).

## Reuse & extension
- **Reused:** `templates/model3d.mjs` (`modelCanvas`, `MODEL_JS`, `VIEW_RANGE`) for the path and the explode; `engine/glb.mjs` writer pattern for pack-glb; `saveAsset` for the model file; `validateScript` `data.model` block for the new fields; kit `page()` for the new template.
- **Extracted:** `poseAt(poses, k)` in model3d.mjs, used by the explainer model scene and the product-tour canvas.
- **Extension point:** `path`, `explode` are optional; a script without them renders byte for byte as before (`tests/model3d.test.mjs` keeps the old stills).
- **Old path proven by:** `tests/model3d.test.mjs` existing cases.

## Architecture
brief → Director script (model scene with path/explode) → `validateScript` (data.model ranges) → explainer / product-tour template → `modelCanvas` data attributes → `MODEL_JS` draw(t) → frames.

## Files to create / modify
| File | Change |
|------|--------|
| `engine/pack-glb.mjs`, `engine/cli.mjs`, `engine/jobs.mjs`, `tests/pack-glb.test.mjs` | done |
| `templates/model3d.mjs` | path + explode in draw(t), node naming |
| `engine/script.mjs`, `templates/explainer/beats.json` | `path`, `explode` fields, ranges, help |
| `templates/product-tour/beats.json`, `template.mjs` | new template |
| `tests/model3d.test.mjs`, `tests/product-tour.test.mjs` | tests |
| `CLAUDE.md` | one line each |

## Task breakdown
1. Camera path. Verify: `node --test tests/model3d.test.mjs`.
2. Explode + pack-glb node names. Verify: `node --test tests/model3d.test.mjs tests/pack-glb.test.mjs`.
3. product-tour template. Verify: `node --test tests/product-tour.test.mjs tests/beats.test.mjs tests/help.test.mjs`, a storyboard of `nsc/megamax-classic-tour-16x9`.
