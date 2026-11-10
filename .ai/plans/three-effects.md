# three-effects — ten more three.js effects: solid type, 3D logo, device mockup, particle forms, photo cards, globe, 3D bars, model clip, paint, swap, materials

**Status:** done
**Author:** tech-lead
**Branch:** master
**Created:** 2026-11-10
**Risk tier / auto-enabled phases:** template look → USER_REVIEW with stills; engine test for the script check; golden frames for explainer, data-story and logo-reveal

## Intent
The person asked which other video effects three.js can make, then said "apply them all". Ten were proposed in two
tiers (cheap, medium); three were advised against (true 3D scene transitions, physics, heavy post) and stay out.
**For whom / outcome:** the person directing brand videos: a title, a number, the logo, an app screen, a photo set,
a list of places or a ranking can each become a lit 3D shot in the brand's colours, from assets the brand already
has, with no 3D tool and no extra model call.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| One new template per effect | each effect has its own page | ten templates, none mixable, the explainer and data-story never get them | ❌ |
| New "subjects" drawn by the existing model canvas (`MODEL_JS`), surfaced as mixable explainer kinds plus a few fields on data-story `bars`, logo-reveal and the model scene | one canvas contract: spin, view, path, env, bloom, focus, shadow, SwiftShader and the clamped seek come for free; any brief can mix them in | MODEL_JS grows; subject code must be written only into pages that use it | ✅ |
| Text and logo outlines from font files in Node (opentype.js) | exact outlines | a new dependency; Google Fonts brands have no file; the page and the 3D type would use different glyphs | ❌ trace the page's own rendering instead |

## Scope
- [x] `templates/model3d.mjs`: a subject registry. A canvas with `data-m3="<subject>"` is built by `window.__m3[subject]` (written only into pages that use it) instead of loading a .glb; pictures ride as hidden `<img>` in the window (so the preview copier, the HTML-video inliner and the server see them); flat subjects fit their box, not their sphere; `hasModels` covers both.
- [x] Shared page library (`M3_LIB_JS`): trace a canvas's alpha into shapes (marching squares, Douglas-Peucker, holes by nesting), extrude it as a slab whose front shows the picture, label sprites, a hash for deterministic scatter.
- [x] Solid type: explainer kind `type3d` (`word`, up to 16 characters, in the brand display font and heading weight), letters rising in one by one.
- [x] 3D logo: logo-reveal `style: "3d"`, the brand logo (SVG or PNG, or the brand name) extruded, its pieces assembling.
- [x] Device mockup: explainer kind `device` (`device` phone, tablet or laptop; `screen` image; a tall screen scrolls; a laptop lid opens).
- [x] Particle form: explainer kind `swarm` (`form` logo, word or icon): points fly in and settle into the form.
- [x] Photo cards: explainer kind `cards` (2-6 `photos` with captions, `arrange` row, fan or ring).
- [x] Globe: explainer kind `globe` (1-8 `points` with lat, lon, label; `arcs` hub, chain or none), land dots from Natural Earth 110 m (public domain) as a 1° bitmap in `templates/globe-land.mjs`.
- [x] 3D bars: data-story `bars` with `depth: true`: lit columns on a floor, values counting on top, labels under, tone and two series kept.
- [x] Model scene: `clip` (one named animation of the .glb), `paints` (1-4 colour changes on a word cue), `swap` (a second .glb takes over on a word cue), `material` (glass, chrome, gold or clay on named parts or all).
- [x] Script check for every new field (limits in `engine/model-rules.mjs`, shared with beats.json by a test), beats help and defaults, UI labels, picture copies (`screen` ungraded, `swap` model copied), pipeline vendors three from the page HTML, review pacing treats the new kinds as posed, HTML-video inliner follows `data-swap`.
- [x] Tests: markup and clamping, script check, a Chrome run that draws every subject twice with the same frames; golden frames updated and looked at; CLAUDE.md.

## Out of scope
- True 3D transitions between scenes (a page cannot sample its own scenes), physics or fluid simulation, SSAO, motion blur, god rays: advised against, not built.
- A video on a device screen or a photo card (the render swaps `<video>` for cut frames; a texture would need its own frame wait). Pictures only.
- Morphing one mesh into another (needs matching topology); `swap` is a turntable hand-over.

## Reuse & extension
- **Reused:** `MODEL_JS` (camera, spin, view, path, env, bloom, focus, shadow, clamped seek), `modelCanvas` attribute helpers, the explainer `.mod`/`.mwin` window and `KINDS.model` entrance, `validateScript` enum, limit and photo checks (gallery photos check widened to cards), `pictureCopies`, `copyThree`, `chartColors` and `valueText` in data-story, `logoFile` in shared.mjs.
- **Extracted:** `M3_LIB_JS` (trace, slab, label sprite, hash) used by type3d, logo, cards, globe and bars; `cueTime` used by paints and swap.
- **Extension point:** a new subject is one `window.__m3.<name>` module plus a canvas helper; a page without one is byte for byte as before (`tests/model3d.test.mjs` plain markup cases).
- **Old path proven by:** the existing model3d Chrome test and the golden frames of every template.

## Architecture
script scene → `validateScript` (model-rules limits) → template (`m3Canvas(subject, t, opts)` + hidden pictures) → kit `page()` writes `MODEL_HEAD`, `M3_LIB_JS` and the used `SUBJECT_JS` modules before `MODEL_JS` → `MODEL_JS` builds each canvas: `.glb` loader or `__m3[subject]` → fit, light, camera → `draw(t)` runs the spin and the subject's `tick` → frames.

## Task breakdown
### T1 — subject registry, box fit, model clip/paints/swap/material
- **Verify:** `node --test tests/model3d.test.mjs`
- **Result:** tests/model3d.test.mjs 8/8 (2026-11-10).
- [x] done

### T2 — trace + slab library, type3d, logo-reveal 3d
- **Verify:** `node --test tests/three-effects.test.mjs tests/logo-reveal.test.mjs`
- **Result:** tests/three-effects.test.mjs 11/11, tests/logo-reveal.test.mjs pass (2026-11-10).
- [x] done

### T3 — device, swarm, cards, globe subjects and explainer kinds
- **Verify:** `node --test tests/three-effects.test.mjs`
- **Result:** tests/three-effects.test.mjs 11/11 (2026-11-10).
- [x] done

### T4 — data-story 3D bars
- **Verify:** `node --test tests/three-effects.test.mjs tests/data-charts.test.mjs`
- **Result:** tests/three-effects.test.mjs 11/11, tests/data-charts.test.mjs pass (2026-11-10).
- [x] done

### T5 — script check, beats, UI labels, pipeline, review, docs, golden frames
- **Verify:** `npm test`
- **Result:** affected run `node tests/run.mjs --changed --jobs 4 --heavy 1`: 103 of 116 files, 970 passed, 9 failed; all 9 fixed and their files rerun green (templates, help, cinematic, transitions, motion-presets), then three-effects, logo-reveal, data-charts, golden and model3d 62/62. The full suite and the three play-through files were not rerun after the last CSS-gating edits. Golden references needed no update (their frames come from the first two scenes).
- [x] done
