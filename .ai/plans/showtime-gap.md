# showtime-gap — Close the gap to the showtime example set

**Status:** done (batches 1-3, 2026-10-15)
**Author:** claude (session 2026-10-14)
**Branch:** none (folder is not a git repo)
**Created:** 2026-10-14
**Risk tier / auto-enabled phases:** template contract → template tests; engine media (ffmpeg, new local model) → engine tests; no server boundary change unless an item says so

## Intent
The user compared Motion Studio with the examples of [showtime](https://github.com/FavioVazquez/showtime) and asked whether the tool covers them. It covers about 12 of 35. This plan lists what is missing, in the order that gives the most videos per unit of work.
**For whom / outcome:** people on the team who need explainers, release videos, data stories and social cuts without opening an editor. Each item below unlocks named showtime examples.

## What already works
Built as briefs in project `showtime-samples` (11 jobs, waiting for the Director):

| Job | Template | showtime example |
|---|---|---|
| sting-16x9 | logo-reveal | 20 brand pack (sting only) |
| launch-16x9 | feature-launch | 10 launch of the tool itself |
| tour-16x9 | app-walkthrough | 04, 21 tutorial |
| steps-9x16 | explainer | 05 vertical short |
| heat-pump-16x9 | explainer | 02 heat pump |
| waggle-dance-9x16 | explainer | 13 waggle dance |
| temperature-16x9 | data-story | 07 temperature data |
| power-mix-1x1 | data-story | 12 energy report |
| space-montage-9x16 | lifestyle | 08 space montage (no beat sync) |
| teapot-1x1 | lifestyle | 17 teapot promo |
| war-of-the-worlds-16x9 | lifestyle | 18 book trailer |

## Gap, ranked
Each item stays inside the floor: no new model calls besides the Director, every model local, no API key, every child process capped. "Unlocks" names showtime examples.

| # | Item | Unlocks | Size | Notes |
|---|---|---|---|---|
| 1 | QA receipt after render | all (showtime runs `qa` on every job) | S | ffmpeg `ebur128` loudness, `blackdetect`, `freezedetect`, caption overlap and platform spec checks → `status.outputs.qa`, shown on the done banner |
| 2 | Per-brief language and voice | 03, 14 ES, 26, 13 FR | S | `brief.lang` and optional `brief.voice` override `brand.voice`; captions and timing follow. Today a second language needs a second project |
| 3 | More cuts from one job | 06, 10, 18, 19, 21, 22, 23 (each ships a vertical or square cut) | M | "Also render" formats on the brief; the same script and timing, one page per size (templates are already size-aware through `px()`); each cut is its own `final-<fmt>.mp4` |
| 4 | Bar chart race and stripes in data-story | 07, 12 | M | `race` kind (values per period, ranks animate) and `stripes` kind (one color bar per value); limits and validation in `beats.json` |
| 5 | Code and terminal template (`code-story`) | 15, 29, `_recap`, `_repro`, part of 10 | M-L | kinds: `code` (highlighted lines), `diff` (before/after hunk), `tree` (file tree with +/- bars), `terminal` (typed output), `checklist`. Text from the brief or a pasted diff; no repo access by the engine |
| 6 | Local speech-to-text | 06, 16, 23, 24 and every footage caption | L | Whisper ONNX through the existing `onnxruntime-node`, model files in `models/whisper/` like Kokoro. Writes `transcript.json` with word times per clip. Unblocks: clip text and in/out chosen by the Director from text, caption burn-in for footage, highlight picking |
| 7 | Audiogram template | 16 | M | needs #6. Waveform drawn from audio samples computed at prepare time (deterministic), speaker names, captions |
| 8 | Beat sync for music | 08, 19 | M | onset detection on the music track at prepare time → `beats.json` per job; lifestyle `pace: beat` snaps scene cuts to beats |
| 9 | Footage inside motion templates | 04, 13, 14, 21 | L | a `clip` kind for kit templates using the talking-head clip pipeline (keyframe-dense mp4, exact seek); makes screen recordings and research footage mixable |
| 10 | Alpha export for overlays | 20 lower thirds | M | render with a transparent page background to ProRes 4444 or VP9 alpha; only for templates that declare `alpha: true` |
| 11 | Motion blur look | `_blur`, 30 | M | render N sub-frames per frame and blend with `tmix`; a render setting, the page stays deterministic |
| 12 | Self-contained HTML video | 12, 17, 25 | M | bundle `index.html`, assets and `voice.wav` into one offline file; interactive questions (25) come later |

Out of reach without a new heavy dependency, so not planned: Manim (22, Python), WebGL looks (`_looks`, 32), isometric self-building diagrams (`_diagram`), face tracking and stabilisation (06, 14), map insets from tiles (19; tile servers have usage limits).

## Options considered
| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Copy showtime's stack (Manim, Piper, WebGL) | covers more examples | Python and GPU stack, breaks "no new framework", many model downloads | ❌ too much surface for a local brand tool |
| Close the gap in Node + ffmpeg + ONNX, ranked by examples unlocked | reuses kit, Kokoro's ONNX path, ffmpeg-static | Manim-class math and WebGL stay out | ✅ |

## Scope (first batch)
Items 1-4: small to medium, no new model, unlock 10 more examples between them.
- [x] 1 QA receipt — `engine/qa.mjs`, after every job and sequence render, `cli qa`; captions re-cut into two-line cues (`tests/qa.test.mjs`)
- [x] 2 Per-brief language and voice — `brief.lang`, `brief.voice`, `voiceFor`, refused early when the voice cannot speak the language; en-gb phonemes in a worker (`tests/voice-lang.test.mjs`)
- [x] 3 More cuts — `brief.alsoFormats`, per-cut pages, stills, lint, MP4 and QA; real Chrome render test (`tests/cuts.test.mjs`)
- [x] 4 data-story `race` and `stripes` — `beats.json` data rules, renderer, Chrome rank and safe-area test in 16:9 and 9:16 (`tests/data-charts.test.mjs`)

Found on the way: Kokoro read British voices with American phonemes (fixed); the phonemizer package only has English, so Kokoro cannot speak other languages here (documented, refused with a reason).

## Batch 2 (done 2026-10-14)
- [x] 5 `code-story` template — code, diff (LCS), tree, terminal, checklist; escaped highlighter, no new dependency; data rules; Chrome test in 16:9 and 9:16 (`tests/code-story.test.mjs`)
- [x] 8 Beat sync — `brief.cutOnBeat`, `engine/beats.mjs`, built-in track beats; Preview plays the music (`tests/beats.test.mjs`)
- [x] 11 Motion blur — `brief.motionBlur`, sub-frames + `tmix`, render-only option (`tests/motion-blur.test.mjs`)
- [x] 12 Offline HTML video — `engine/htmlvideo.mjs`, `video.html` after every render, checked from disk with the network blocked (`tests/cuts.test.mjs`)

## Batch 3 (done 2026-10-15)
- [x] 6 Local speech-to-text — huggingface.co is blocked on this network; with the user's go-ahead the same Whisper base came from the sherpa-onnx GitHub release (int8 ONNX). `engine/stt/whisper.mjs` (mel, metadata, timestamp rules, windowing), `engine/stt.mjs`, `cli transcribe`, Brand tab Transcribe/Transcript, footage captions with real timing (`tests/stt.test.mjs`: WER ≤ 10% on the reference recordings, across a window edge too)
- [x] 7 Audiogram — `templates/audiogram`, sound-file clips, per-frame levels, waveform in `afterSeek` (`tests/audiogram.test.mjs`); captions come from typed clip text until item 6
- [x] 9 Footage inside motion templates — `video` kind in explainer (mixable), `sceneVideos`, kit clip seeking written only when needed; explainer pages without video byte-identical (`tests/scene-video.test.mjs`)
- [x] 10 Alpha export — `templates/lower-third`, transparent kit page, ProRes 4444 `alpha.mov` with checked transparency (`tests/alpha.test.mjs`)

## Reuse & extension
- **Reused:** `templates/kit.mjs` (size-aware layout for #3, scene kinds for #4), `engine/tts/kokoro.mjs` (ONNX loading pattern for #6), `engine/media.mjs` `ffmpeg()` with its caps (#1, #3, #8), `validateScript` limits from `beats.json` (#4).
- **Extension point:** new scene kinds are entries in `beats.json` plus a `KINDS` function; new brief fields default to today's behaviour when absent.
- **Old path proven by:** `npm test`, plus re-preparing `csr-console/data-story-16x9` and `nsc/promo-9x16` and comparing stills.
