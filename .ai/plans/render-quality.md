# render-quality — BT.709 colour, cut clip frames, render benchmark

**Status:** in-review
**Author:** tech-lead
**Branch:** none (the folder is not a git repo)
**Created:** 2026-10-26
**Risk tier / auto-enabled phases:** render output and template contract → engine tests with real Chrome and ffmpeg

## Intent
The user asked for the smoothest, most accurate render, using what well-known open-source video renderers do (Remotion, HyperFrames, Revideo), then asked to apply the suggestions.
**For whom / outcome:** people who approve and ship brand videos. Brand colours play back as designed, footage frames are exact on every machine, and render speed is set from a measurement.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| Raw CDP `Page.captureScreenshot` with `optimizeForSpeed` | HyperFrames uses it | Measured 66.6-67.1 ms/frame against 52-67 for Playwright | ❌ no gain |
| Chrome Headless Shell | Remotion default | 51-53 against 52-55 ms/frame on Windows | ❌ no gain |
| `HeadlessExperimental.beginFrame` | Frame-exact compositor | HyperFrames enables it on Linux only; this machine is Windows | ❌ |
| WebCodecs encode (Revideo) | Fast | Needs scenes drawn on canvas; ours are DOM/CSS | ❌ |
| BT.709 conversion and tags | Fixes a measured shift of up to 17/255 | One filter per encode | ✅ |
| Clip frames cut ahead (Remotion `OffthreadVideo`, HyperFrames injector) | Exact, deterministic, no 1.5 s seek timeout | Temp JPEGs on disk during a render | ✅ |
| `bench` command (as `npx remotion benchmark`) | Sets `render.concurrency` from data | About 2 minutes per run | ✅ |
| Static frame dedup | Skips captures | Grain, particles and backdrops change every frame | ❌ deferred |

## Scope
- [x] `BT709_VF` / `BT709_TAGS` in `engine/media.mjs`; the render, alpha, overlay, clip cut, footage clip and preview encodes use them. A sequence join keeps its parts' tags on its own, so its arguments stay as pinned.
- [x] `cutClipFrames` in `engine/frames.mjs`; `render()` cuts once, opens pages with the script injected, fails on a frame that could not be shown, and removes `frames/`.
- [x] `CLIP_FRAMES_JS` in `engine/frames.mjs`, served inside the page by `openComposition({ inject })`: each `clips/<clip>.mp4` `<video>` becomes an `<img class="clipframe">` with the same id, classes and data, answering `currentTime`, `duration`, `readyState`, `seeking`, `requestVideoFrameCallback`; every `video` CSS rule is copied to it; a `data-clip` clip is seeked by the script with the kit's rule.
- [x] Template and kit files unchanged: the pinned page hashes in `tests/templates.test.mjs` and `tests/cinematic.test.mjs` still hold, and a job prepared before this change gets cut frames too.
- [x] `captureSpec` shared by `render()` and `benchJob`; `node engine/cli.mjs bench`.

## Out of scope
- Static frame dedup, 60 fps renders, a config change to `render.concurrency` (4 → 6 measured only 6 % faster).
- Re-encoding videos rendered before this change.

## Reuse & extension
- **Reused:** `renderFrames`, `openWorkers`, `renderWorkers` (bench counts), `mediaTimeoutMs`, `ffmpeg`.
- **Extracted:** `captureSpec` (render, bench), `overlayArgs` (render, alpha test), `BT709_*` (seven encodes).
- **Extension point:** any page with a `clips/<clip>.mp4` `<video>` and the kit's `vendor/gsap.min.js` script gets cut frames at render time with no template change.
- **Old path proven by:** `tests/scene-video.test.mjs`, `tests/fx.test.mjs` (talking-head preview with `<video>`), `tests/frames.test.mjs` (parallel join), `tests/alpha.test.mjs`.

## Files to create / modify
| File | Change |
|------|--------|
| `engine/media.mjs` | `BT709_VF`, `BT709_TAGS`, `injectScript`; `openComposition` `inject` |
| `engine/frames.mjs` | `CLIP_FPS`, `CLIP_FRAMES_DIR`, `CLIP_FRAMES_JS`, `cutClipFrames`; `filterArgs` replaces `blurArgs` |
| `engine/pipeline.mjs` | `captureSpec`, `overlayArgs`, clip frames in `render()`, `benchJob`, `benchCounts` |
| `engine/footage.mjs`, `engine/template-preview.mjs`, `engine/transition-preview.mjs` | BT.709 |
| `engine/cli.mjs` | `bench` |
| `tests/clip-frames.test.mjs` | new |
| `tests/frames.test.mjs`, `tests/alpha.test.mjs` | colour tests added |

## Verify
- `node --test tests/clip-frames.test.mjs`: cut frames match the browser's own decode within 4/255 at five frames and the held last frame; talking-head zoom drives the stand-in; bench leaves `status.json` unchanged.
- `node --test tests/frames.test.mjs`: four colours through two Chromes and the concat join come back within 4/255.
- `node --test tests/alpha.test.mjs`: `#e63946` background comes back as itself.
- `npm test`.
