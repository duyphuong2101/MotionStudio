---
name: tts-timing-gotchas
description: Kokoro clips carry ~0.3 s leading and ~0.5 s trailing silence, so config leadIn/tailOut are not the heard gaps; how to measure them
metadata:
  type: project
---

- A Kokoro clip (`speakKokoro` in `engine/tts.mjs`) has silence at both ends. With `timing.leadIn` 0.2 and `tailOut` 0.5, a real af_heart render plays about 0.5 s of silence before each line and 1.0 s after it, and about 41% of a 5-scene film sits between lines (measured 2026-10-22). The config numbers are not what you hear.
- The cinematic `tight` path (`sceneGaps` in `engine/timing.mjs`, `wavVoicedSpan` in tts.mjs) measures from `voicedSpan` of each clip. Heard gaps then come out at 0.16 / 0.40 s. A clip may start before its cut; before t=0 its leading silence is trimmed with `atrim`.
- To measure the heard gaps of a real render, slice `voice.wav` per scene and run `voicedSpan(slice, rate)` from `engine/tts/kokoro.mjs`. Seed it with a scratch script that calls `speakScript(dir, script, brand, cfg, null, null, null, tight)`. It needs no job and no Director.
- Recorded voice (`engine/voicetake.mjs`): Whisper base word times are spread by length inside a segment, and the first segment of a window often starts at 0.0 even after 1.2 s of silence. Never cut on raw word times: `cutPlan` moves each span onto the take's voiced frames. Whisper also fuses compounds ("Month end" → "Monthend"), which cost 2 of 7 words on a clean Kokoro take (0.71, just over the 0.7 threshold) until the alignment learned fused tokens (2026-10-23).

**Why:** the "0.5 s / 1 s" complaint matched no config value; only measuring the WAV explained it.

**How to apply:** before you tune timing gaps, measure the audio, not the timing.json numbers. See also [[layout-verification-gotchas]].
