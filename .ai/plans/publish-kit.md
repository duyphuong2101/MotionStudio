# publish-kit — posters, chapters, subject reframe, language versions, web loops

**Status:** done
**Author:** tech-lead
**Branch:** master
**Created:** 2026-11-10
**Risk tier / auto-enabled phases:** server boundary (new run actions, one new POST route) → security review; job state → engine tests; Director context change → prompt sync.

## Intent
The user asked for the five follow-ups proposed on 2026-11-10: a thumbnail/cover export, YouTube chapters, keeping the subject in frame when footage is cropped to another size, a language version of a finished job, and a short silent web loop.
**For whom / outcome:** the person who publishes a finished video: everything a channel or a site asks for next to the MP4 comes out of the tool, and one video becomes several languages without retyping the brief.

## Options considered
| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Poster from a new Chrome render of the composition at poster size | exact frame at any size | needs clip frames and a second page per size | ❌ |
| Poster from the storyboard stills (main or a cut, nearest aspect) laid under a brand title page | one small Chrome page, stills already exist, deterministic | the frame is the still's moment, not any moment | ✅ |
| Reframe by tracking the subject over time | follows motion | a moving crop is heavy, needs per-frame inference, can jitter | ❌ |
| Reframe by one focus point per clip (subject centre over three frames, local matte model) | cheap, deterministic, no network | a subject that crosses the frame is centred on its average | ✅ |
| Translation through a new model call | one click | a fifth model path, against the floor | ❌ |
| Translation as a new job the Director writes (person clicks Run Director), with the original script in its context | no new model path, same caps, claims stay the original source's | one Director run per language | ✅ |

## Scope
- [x] Chapters (`engine/chapters.mjs`): scenes grouped into chapters of at least 10 s (YouTube's rule), named from each group's first scene title, first at 0:00, at least 3 or none; written as `chapters.txt` at render and into the editor export; `cli chapters`; the done banner shows them with a copy button.
- [x] Poster (`engine/poster.mjs`): `youtube` 1280x720, `square` 1080x1080, `story` 1080x1920, `wide` 1200x630; a scene's still from the page whose aspect is nearest (main or an extra cut), cover-fitted, with an optional brand title (escaped, 80 chars) over a scrim and the logo; `poster-<size>.png` in the job folder; `cli poster`; run action `poster` with scene, size, title; done banner form.
- [x] Web loop (`engine/loop.mjs`): 2-10 s from a scene of the rendered video, the tail crossfaded into the head so it loops without a jump; `loop.mp4` (H.264, silent, faststart) and `loop.gif` (palette, at most 640 px wide); `cli loop`; run action `loop`; done banner form.
- [x] Reframe (`brief.reframe: true`, prepare only): one focus point per clip from the local matte model (`engine/matte.mjs` `subjectFocus`); footage cropped by ffmpeg crops around it; a page that cover-fits a clip (`video[data-clip]`) gets an `object-position` per clip and per page size; without the model, prepare warns and crops centred as before. A brief without it builds byte for byte as before.
- [x] Language version (`translateJob` in `engine/jobs.mjs`, `POST /jobs/:p/:j/translate`): a new job `<id>-<lang>` with the brief copied, `lang` (and optional `voice`) set, `translateOf` naming the original, `source.json` copied; status dirty from step 3; the Director context gets the original script and a translation rule; the Director prompt says what to do. Script tab / done banner form.
- [x] Tests, docs (CLAUDE.md, file-index, director prompt synced), UI labels.

## Out of scope
A moving reframe crop; chapters for sequences; posters with any frame time other than the storyboard still; machine translation; a GIF longer than 10 s.

## Reuse & extension
- **Reused:** `openComposition`/`serveFolder` style Chrome page for the poster (`engine/media.mjs`), `escapeHtml`, brand fonts and `logoFile` (`templates/shared.mjs`), stills from `captureStills`, `ffmpeg` with `mediaTimeoutMs`, `runEngine` caps for the new actions, `validateBrief`, `saveBrief`, `directorContext`, `makeCutout`'s segmentation path.
- **Extracted:** `subjectMap` in `engine/matte.mjs` (cut-out and reframe both segment a picture).
- **Extension point:** `POSTER_SIZES` and run actions list; the brief flag is optional and absent by default.
- **Old path proven by:** `tests/templates.test.mjs` hashes and `tests/cutout*.test.mjs` (pages without `reframe` unchanged, cut-out unchanged).

## Task log
### T1 — chapters
- **Verify:** `node --test tests/publish-kit.test.mjs`
- **Result:** tests/publish-kit.test.mjs 7/7 (2026-11-10).
- [x] done
### T2 — poster
- **Verify:** `node --test tests/publish-kit.test.mjs`
- **Result:** tests/publish-kit.test.mjs 7/7, one real Chrome poster; previews looked at in 16:9 and 9:16 (the still's own text blurred under the title).
- [x] done
### T3 — web loop
- **Verify:** `node --test tests/publish-kit.test.mjs`
- **Result:** tests/publish-kit.test.mjs 7/7 (a 320x180 loop and GIF made by ffmpeg).
- [x] done
### T4 — reframe
- **Verify:** `node --test tests/publish-kit.test.mjs tests/templates.test.mjs`
- **Result:** tests/publish-kit.test.mjs 7/7; templates.test.mjs hashes unchanged (no brief sets reframe); the tests use a fake segmenter; the real model (models/matte/matte.onnx) ran by hand on two 1920x1080 interview clips: about 3 s a clip, focus 0.50/0.67 and 0.50/0.65 (centred speakers, so the 9:16 crop matched the middle one).
- [x] done
### T5 — language version
- **Verify:** `node --test tests/publish-kit.test.mjs tests/context.test.mjs`
- **Result:** tests/publish-kit.test.mjs 7/7; Director prompt synced to the Claude, Cursor and agents skills.
- [x] done
### T6 — UI, server, docs
- **Verify:** `node tests/run.mjs --changed --jobs 4 --heavy 1`
- **Result:** `node tests/run.mjs --changed --jobs 4 --heavy 1`: 99 files, 977 passed, 0 failed in 1191 s; the play-through sweeps skipped every unchanged page.
- [x] done
