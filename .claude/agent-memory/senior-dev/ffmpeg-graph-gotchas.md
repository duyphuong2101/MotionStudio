---
name: ffmpeg-graph-gotchas
description: ffmpeg filter_complex traps — asplit into atrim + chained acrossfade yields silent copies; a blur before a crop bleeds letterbox bars; geq negative constants; loudness method/channel differences; aselect quoting
metadata:
  type: project
---

- One audio input split with `asplit=N`, each branch `atrim`-ed, then chained with `acrossfade`, gives silence after the first copy. Every later branch arrives empty: a 200 s bed over a 120 s library track went to 0 RMS at 115 s, and a 7-copy test was silent from the start (ffmpeg-static, Lavf 60.16, 2026-10-22). Fix used in `loopMusic` (`engine/sequences.mjs`): one `-i` of the same file per copy.
- To check what an audio graph really produces, write the mix to a mono `pcm_s16le` WAV and compute RMS per second in JS. Find the `data` chunk with `buf.indexOf('data') + 8`; ffmpeg writes a LIST chunk before it. A graph that runs without error can still be silent.
- Video: a `boxblur` (or any blur) that runs before a crop samples the pixels the crop drops later. Letterbox bars (white on the NSC footage) then bleed into the blurred edge as a pale fringe. In `engine/footage.mjs` the crop rect runs first and the blur mask is drawn in the cropped frame (`maskFrame`). Seen only in a preview frame in the browser (2026-10-23); string tests could not show it.
- Loudness numbers depend on the method and the channels. The NSC WTMJ clips are stereo AAC. footage.wav is mono (`-ac 1`). Over the same spans, `king` read −24.0 LUFS (ebur128, mono) but −26.1 dB (volumedetect, mono). The hand fix was measured another way, at about −23.2 dB after the −4.5 dB cut. Measure the mono 48 kHz signal footage.wav gets (`measureFilter` in `engine/loudness.mjs`) and confirm on a scratch footage.wav. For aselect span lists, quote the expression (`aselect='between(t,a,b)+…'`) so its commas are not read as filter separators.
- `new URL(import.meta.url).pathname` on Windows keeps `~` as `%7E` (`PHUONG~1`), and ffmpeg then cannot open the output. Use `fileURLToPath`.
- `volumedetect` converts to s16 first, so a float signal over full scale reads `max_volume: 0.0 dB` and a peak-normalise pass computed from it is wrong (the `hit` cut sound came out at −0.3 dBFS instead of −4, 2026-10-23). For float peaks use `astats=metadata=0` and take the last `Peak level dB:` (the Overall block), as `ensureSfx` in `engine/library.mjs` does.
- geq expressions: a negative constant written as `X--40` is risky. Emit `X+40` instead (`minus` in `engine/footage.mjs`).

**Why:** the pure graph-string test passed while the real output was silent. Only the real-ffmpeg level check caught it. The blur fringe was the same pattern: correct graph strings, wrong pixels.

**How to apply:** any new audio graph that duplicates a stream (loops, layering) gets a real-ffmpeg level check, not only a string test. See also [[tts-timing-gotchas]].
