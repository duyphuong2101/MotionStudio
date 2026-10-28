# motion-polish — slow clips, voice cleanup, GSAP plugins, motion rules

**Status:** in-review
**Author:** tech-lead
**Branch:** worktree-motion-polish (worktree, from f0ca8b2)
**Created:** 2026-10-28
**Risk tier / auto-enabled phases:** template look and brand fields → Chrome tests with stills; media filters → real ffmpeg tests

## Intent
The user asked to apply the best findings from the 20 GitHub repos reviewed on 2026-10-28 (GSAP, Remotion, Motion, FFmpeg and others).
**For whom / outcome:** people making brand videos. Slow footage plays smoothly, home-recorded voice sounds cleaner, and a brand gets its own heading reveal, movement curve and a celebration burst, all opt-in.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| `minterpolate` blend for slow clips | 3.1 s against 2.8 s for repeated frames (6 s 1080p) | Light ghosting | ✅ default |
| `minterpolate` mci | Real in-between frames | 78.7 s for the same clip | ✅ opt-in, 20 s cap |
| Voice cleanup on by default | Every take improves | A studio take gets processed for nothing | ❌ opt-in per brand |
| SplitText, CustomEase, Physics2D from the installed gsap | No new dependency, free licence | One more script per page that uses them | ✅ opt-in brand fields |
| ScrambleText, CustomWiggle random | — | `Math.random`, breaks seek | ❌ |
| Auto-fit text in the kit | Fewer Director rounds | Changes every page (pinned hashes) or needs a prepare re-layout | ❌ follow-up |
| dotLottie, Rive, postprocessing, Rapier | See the research reply | Need benchmarks or a product need | ❌ later |

## Scope
- [x] `engine/footage.mjs`: `smooth` (blend default, motion, none) for a slower clip; CLI `--smooth`.
- [x] `engine/voicetake.mjs` `takeFilter`; brand `voice.cleanup`; Brand tab checkbox.
- [x] `engine/brand.mjs` `REVEALS`, `EASES` (sampled spring), `brandEase`; brand `reveal`, `ease`, `confetti`; Brand tab controls.
- [x] `templates/kit.mjs`: `revealHelpers` (SplitText), brand curve as `X` (CustomEase), `CONFETTI_JS` (Physics2D), `revealable`; plugins written only when asked.
- [x] `engine/vendor.mjs` `GSAP_FILES` / `copyGsap` replaces three copies of the list.
- [x] `.claude/skills/template-authoring/SKILL.md`: tween, ease, plugin and text-fitting rules.
- [x] Shots dialog: Speed select and a Slow motion choice (shown under 1×), clip length shown after the speed change.
- [x] Code-story in-line diff (user decision 2026-10-28: the default): `tokenDiff`, `pairChanges`; a changed line shows its old text, then its removed tokens close and its added tokens open. Cinematic code-story baseline re-recorded.
- [ ] 3D look, after the model-tour work is on master: pack-glb `--finish matte|satin|gloss` (clearcoat via `KHR_materials_clearcoat`), model scene `bloom` (UnrealBloomPass, alpha-safe in r186) and `focus` (BokehPass with the alpha line dropped from the vendored shader), measured on SwiftShader.

## Out of scope
- Auto-fit text, dotLottie, Rive, postprocessing, Rapier, token-level code diffs.
- A speed or smooth control in the Shots dialog (speed is CLI and API only today).

## Reuse & extension
- **Reused:** the `shine` pattern (`shownBy`, `.btn`), the profile helpers, `PARTS`-style sine hash, `validateBrand` boolean pattern.
- **Extracted:** `copyGsap` (pipeline, template preview, test helper), `takeFilter`, `revealable` (kit, Brand tab test).
- **Extension point:** another opt-in plugin is one entry in `GSAP_FILES` and one in the kit's `plugins` list.
- **Old path proven by:** pinned page hashes in `tests/templates.test.mjs` and `tests/cinematic.test.mjs` (pages without the new fields unchanged), `tests/footage.test.mjs` stored-shape test, the take chain string test.

## Verify
- `node --test tests/gsap-plugins.test.mjs`: 4/4 (validation, sync, plugin tags, Chrome: chars and lines, spring overshoot, confetti same after a jump, lint, play-through).
- `node --test tests/footage.test.mjs`: slow clip graph and a real ffmpeg run (more than 50 of 60 frames distinct).
- `node --test tests/voice-take.test.mjs`: 30 Hz rumble down more than 12 dB, a 1 kHz tone within 6 dB.
- `npm test`.
