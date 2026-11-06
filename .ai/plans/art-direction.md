# art-direction — From template video to directed film

**Status:** in-review (E1-E6 done in code; full test run pending)
**Author:** claude (session 2026-11-06)
**Branch:** master (the user commits straight to master)
**Created:** 2026-11-06
**Risk tier / auto-enabled phases:** engine media (ffmpeg filters on clips and pictures) → engine tests; template contract (E2-E4) → template tests + golden frames; asset upload type (E1 `.cube`) → security review of `checkContent`; no server boundary change, no model call

## Intent
The user compared Motion Studio with CapCut and asked to close the gap to an "artsy" video, one part at a time, in this order: colour grade, per-scene direction, music-led rhythm, a kinetic type film, subject cut-out, export to an editor.
**For whom / outcome:** people on the team who make brand videos without an editor. Today every video looks like its template. After this plan a video can carry one colour look, scenes with their own camera and cut, cuts and hits on the music, and a person can still finish it in an editor.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| Freeform timeline editor in the UI | Full control, like CapCut | Breaks the deterministic, brand-bound model; months of work | ❌ fights the tool's purpose |
| Extend the template model: brand and scene fields the engine applies deterministically | Keeps seek(t), locks, golden frames; each part ships alone | Less freedom than an editor | ✅ |
| Export only, finish in an editor | Cheap, unlimited freedom | No gain inside the tool | ✅ as E6, on top of the above |

## Epics (in order)

### E1 — Colour grade (brand `grade`)
One look over every clip and photo of a video: a preset (`warm`, `cool`, `teal-orange`, `mono`, `faded`, `vivid`) or the brand's own `.cube` LUT, with `amount` 0.1-1.
- Applied by prepare with ffmpeg: in `cutClips` (every footage and scene clip) and when copying scene pictures (`asset`, `image`, `photos[].asset`; raster only) into the job. Preview and render both see the graded files.
- Never graded: logos and other brand assets, ui-story `shots` (app screens keep their true colours), SVG, 3D models, Lottie, the text and shapes the page draws (brand colours stay exact).
- Clips are graded in RGB between explicit BT.709 conversions (`scale=in_color_matrix=bt709…,format=gbrp` … `scale=out_color_matrix=bt709…`); without them an identity LUT shifts #d04020 to 218/71/26. Measured: with them it stays 206/60/30 (the codec's own loss).
- Presets use RGB filters only (`colortemperature`, `colorbalance`, `curves`, `vibrance`, `colorchannelmixer`); `eq` and `hue` are YUV filters and would convert back through BT.601.
- `amount` < 1 mixes the graded copy over the original (`split` + `blend=all_expr`), alpha included.
- `.cube` becomes an asset type: text, `LUT_3D_SIZE` 2-65, exactly size³ rows of three numbers, nothing else.
- Brand tab: Colour grade select (None, presets, the brand's `.cube` files) and Amount.

### E2 — Per-scene direction
A scene may set `cut` (its entrance: a wipe or blend name, overriding the brand's for that cut), `camera` (from/to framing of its picture or clip: zoom 1-1.6 and x/y focus), and `grade` (`none` or another preset for that scene's pictures).

### E3 — Music-led rhythm
On top of `cutOnBeat`: `hit` moments (a scale punch or flash on the beat grid), drop detection on the brand track, and a music-first mode where scene lengths follow musical phrases.

### E4 — Kinetic type film (template `type-film`)
A video built from large words driven by the word times prepare already has (TTS, cloud voice or a recorded take).

### E5 — Subject cut-out
A local ONNX segmentation model (like Whisper and Kokoro, no network) gives a matte per picture or clip, so text can sit behind a person.

### E6 — Export for an editor
Per-scene clips, voice, music and SFX stems, and an FCPXML timeline that DaVinci Resolve and Premiere open. CapCut takes the clips and stems, not the timeline.

## E1 scope
- [ ] `engine/grade.mjs`: `GRADES`, `gradeChain(grade, lutFile)`, `videoGradeVf`, `imageGradeArgs`, `isCube`, `gradeOf` (brand check)
- [ ] `engine/assets.mjs`: `.cube` asset type checked by `isCube`
- [ ] `engine/brand.mjs`: `grade` validated and kept
- [ ] `engine/pipeline.mjs`: grade in `cutClips` and in the scene-picture copy
- [ ] `ui/app.js`: Brand tab Colour grade + Amount
- [ ] tests: `tests/grade.test.mjs` (chains, cube check, brand check, ffmpeg on a picture with alpha and on a clip)
- [ ] CLAUDE.md line for `grade`

## Out of scope (E1)
A grade on the page's own drawing, per-scene grade (E2), the Templates tab samples, the Assistant's brand fields.

## Reuse & extension
- **Reused:** `ffmpeg` and `BT709_TAGS` (`engine/media.mjs`), `assetPath`, `within`, the asset `checkContent` switch, `validateBrand`'s field pattern.
- **Extracted:** `engine/grade.mjs`, used by `cutClips` and the picture copy (and E2's per-scene grade).
- **Extension point:** `GRADES` is a table; a new preset is one row. A brand without `grade` produces byte-identical clips and pictures.
- **Old path proven by:** golden frames (no template sample sets `grade`) and the existing footage tests.

## Task breakdown (E1)
### T1 — grade module and tests
- **Files:** `engine/grade.mjs`, `tests/grade.test.mjs`
- **Verify:** `node --test tests/grade.test.mjs`
- [x] done — `node --test tests/grade.test.mjs` → 8/8 pass (identity LUT on a BT.709 clip within 2 levels, alpha kept, jpg/webp mono grey)

### T2 — asset type, brand field, prepare
- **Files:** `engine/assets.mjs`, `engine/brand.mjs`, `engine/pipeline.mjs`
- **Verify:** `npm run test:changed`
- [x] done — `npm run test:changed` → every file ok except looks.test.mjs, cut by the run's own 590 s limit; alone it gives 23/23 pass

### T3 — Brand tab control
- **Files:** `ui/app.js`
- **Verify:** Brand tab shows Colour grade; saving `warm` at 0.6 writes `grade: { look: "warm", amount: 0.6 }`
- [ ] code done, `node --check ui/app.js` ok; not yet checked in the browser

## E2 scope (done in code)
- [x] `engine/direction.mjs`: `CUT_KINDS`, `CAMERA_MOVES`, `cameraOf`, `directionProblems`, `pictureCopies`
- [x] `templates/blend.mjs`: `cutPlan`, `cutPlanData`, `cutPlanHtml`, `cutPlanJs` (a brand blend alone keeps its old single drawing)
- [x] `templates/camera.mjs`: `cameraData`, `CAM_JS` (CSS `scale`/`translate`, composes with GSAP transforms)
- [x] `templates/kit.mjs`: the plan replaces the blend type; the brand wipe draws only over the cuts that keep it; camFind/drawCam
- [x] `engine/script.mjs`: the three fields allowed on every scene and checked; a cut on the first scene warns
- [x] `engine/pipeline.mjs`: per-scene grade for clips (`clipGrade`) and pictures (`pictureCopies` → `pageScript`)
- [x] `engine/context.mjs`: `directionRule` for the Director; studio skill and worker prompt name it
- [x] Script tab: a Direction row per scene (Cut into this scene, Camera, Colour grade)
- Verify: `node --test tests/direction.test.mjs` → 6/6 pass (Chrome: the whip shows both scenes at its cut, the hard cut never does, the pan goes 24 px → -24 px and gives the same framing from the end)

Known trade-off: once one scene sets a cut, the page's other cuts lose the motion profile's own cut (the cinematic veil, the editorial panel) and become the brand blend, the brand wipe or a crossfade.

## E3 scope (done in code)
- [x] `engine/beats.mjs`: `analyseMusic` (one decode: grid + drops), `findDrops`, `dropShift`, `pulseTimes`
- [x] Brief `beatPulse` (jobs.mjs validation, flags, prepare-only); the brief form's "Pulse on the beat"
- [x] Scene `drop: true` (one per script); the Direction row's checkbox
- [x] Prepare: `musicInfo` replaces `musicBeat`; the drop shift (re-timed on the moved grid with cut on the beat); `timing.pulse`, `timing.music.shift`, `timing.drop`; warnings when a pulse or drop cannot happen
- [x] `finalMixArgs` `musicShift`; the preview's sound sync reads the shift
- [x] `templates/pulse.mjs` + kit: `drawPulse` through the CSS `scale` property and a white `#pulsefx` flash on a drop
- Verify: `node --test tests/music-rhythm.test.mjs` → 6/6 pass (a drop found at 8 s and snapped to the beat, none in a steady track; shift choices; pulse times; the three mix shapes; brief and script checks; Chrome: beat 1.012, drop 1.045 with a 0.45 flash, gone before the next beat, the same from the end)

Dropped from the first idea: a "music-first" mode where scene lengths follow 4- or 8-bar phrases. At 120 BPM a phrase is 8-16 s, far longer than a voice line, so scenes would hold in silence; the drop placement and the existing cut on the beat cover the useful part. Not verified end to end: a real prepare and render with a `drop` scene (the mix arguments are unit-tested, the prepare flow is not).
Sequences with a music bed ignore a part's drop shift (the bed is one track under the whole film).

## E4 scope (done in code)
- [x] `templates/type-film/beats.json`: `title` (0-1), `line` (1-12; `style` punch|stack|build, `accent`, `theme`), `cta` (0-1); 24 voice words a line; help for every kind and field
- [x] `templates/type-film/template.mjs`: the words come from `timing.words` of the scene (the line's own words when there are none); `punchGroups` (short words ride with the next), `stackLines` (11 characters portrait, 18 otherwise; the column rises to centre each new line, older lines dim), `buildSize` (largest size whose wrap fits); the first word lands with the cut when the voice starts within 0.6 s; `subtitles: false`
- [x] Golden frames `tests/golden/type-film-*` (looked at: title card, an empty-start frame fixed, stack mid-line)
- [x] Docs: CLAUDE.md, `.ai/docs/file-index.md`
- Verify: `node --test tests/type-film.test.mjs` → 4/4; `tests/templates.test.mjs` 53/53; contact sheets of all three styles in 9:16 and 16:9 looked at (the build style overflowed 9:16 before `buildSize`)

Not done: type-film is not mixable (its page turns subtitles off, which a mix cannot do per template).

## Task log
- 2026-11-06 plan written; E1 started.
- 2026-11-06 E1 done in code; E2 done in code.
- 2026-11-06 E3 done in code.
- 2026-11-06 E4 done in code.

## E5 scope (done in code)
- [x] `engine/matte.mjs`: `matteStatus` (model file inside the project, never downloaded), `toTensorData`, `toAlpha`, `applyMatteArgs`, `makeCutout` (a `segment` stand-in for tests); `config/studio.json` → `matte`
- [x] Scene `cutout: true` (`directionProblems`, `cutoutPicture`); prepare writes `assets/cut-<scene>.png` and passes `cutoutFile` in the page script; a warning per scene when the model is missing or the per-job cap is reached
- [x] `templates/cutout.mjs` + kit: `cutFind` after every scene's tweens, `drawCutout` each seek over the picture's on-screen box, above the text
- [x] Script tab: "Subject in front of the text"; the Director's `directionRule`
- Verify: `tests/cutout.test.mjs`

Not done: no model ships with the tool (the person saves a U²-Net family ONNX file as `models/matte/matte.onnx`); clips are not cut out, only still pictures; the end-to-end prepare with a real model is unverified.

## E6 scope (done in code)
- [x] `engine/export.mjs`: `sceneFrames`, `sceneClipArgs`, `timelineXml` (FCP 7 XML), `exportJob` (status `outputs.export`, `exportError`)
- [x] `engine/pipeline.mjs`: `musicSource` shared by the final mix and `musicStemArgs`; a new prepare deletes `export/`
- [x] CLI `export`; server `run` takes `action: export` on a done job; the done banner's "Export for editor"
- Verify: `tests/export.test.mjs`

- 2026-11-06 E5 and E6 done in code.
