# Motion Studio — Architecture

Brief-to-video tool. A person writes a brief in a local UI. A director (Claude Code on a person's
seat, via the `studio` skill) writes `source.json` and `script.json`. A deterministic engine turns
them into an HTML + GSAP composition, storyboard stills, and an MP4. A person approves the
storyboard before anything is rendered.

## Project structure

| Folder | Role |
|---|---|
| `engine/` | Pipeline, job state, validation, locks, timing, TTS, media (ffmpeg + headless Chrome), CLI |
| `server/` | `server.mjs`: local HTTP server for the UI. Never calls a model |
| `ui/` | Static single-page UI (`index.html`, `app.js`, `app.css`), vanilla JS |
| `templates/<id>/` | `beats.json` (rules the director follows) + `template.mjs` (HTML generator) |
| `templates/kit.mjs`, `shared.mjs` | Shared page shell, brand tokens, geometry, logo helpers |
| `motion-kit/icons.mjs` | SVG paths templates morph between (`ICONS`, `ICON_NAMES`, `DECOR`): 11 hand-drawn + a generated Phosphor set (`icon-list.json` → `build-icons.mjs` → `icons-set.mjs`) |
| `profiles/<project>/` | `brand.json`, `voice.md`, `assets/` per brand |
| `briefs/<project>/<job>.json` | Input written by the UI |
| `sequences/<project>/<id>.json` | A sequence: finished jobs of one format, joined into one MP4 |
| `out/<project>/<job>/` | Everything a job or a sequence produces (gitignored) |
| `config/` | `studio.json` (caps, timing, render), `providers.json` (director options) |
| `captures/<project>/` | Optional Playwright capture scripts that redraw an app with demo data |
| `library/music/`, `models/kokoro/` | Generated music and the local TTS model (gitignored) |
| `tests/` | `node --test` suites |

## Pipeline (11 steps, `STEPS` in `engine/jobs.mjs`)

| Step | Who | What | Code |
|---|---|---|---|
| 1 Brief | human | UI posts `/api/briefs` | `validateBrief`, `saveBrief` |
| 2 Pick | director | `cli.mjs list --queued`, `context` (`urlCheck`), `claim`, or `fail --reason` when it cannot run | `pipeline.claim`, `pipeline.fail` |
| 3 Source | director | writes `source.draft.json`, `commit source` | `pipeline.commit`, `validateSource` |
| 4 Script | director | writes `script.draft.json`, `commit script` | `repairScript` (mechanical fixes, reported), `mergeRespectingLocks`, then `validateScript` against `beats.json` |
| 5 Timing | tool | recorded take, TTS or estimate → `timing.json`, `words.json`, `captions.srt` | `voicetake.recordedVoice`, `tts.speakScript`, `timing.estimateTiming` |
| 6 Compose | tool | copies GSAP + assets, runs `template.build()` → `index.html` | `pipeline.prepare` |
| 7 Stills | tool | headless Chrome seeks frames, lints safe area → `stills/*.png`, then plays the page through (play-through check), taking the review sheet's frames on the way → `review/sheet.jpg` (main format; `review/pacing.json` is written with the timing) | `media.openComposition`, `lintInPage`, `playcheck.playCheck`, `review.writeSheet` |
| 8 Review | human | UI approve only (`cli approve` refuses) | `pipeline.approve` |
| 9-11 Render | tool | frames → ffmpeg, voice + cut sounds + music mix (music ducked under speech when `brand.music.duck`) → `final.mp4` | `pipeline.render`, `pipeline.finalMixArgs`, `pipeline.mixFilter`, `media.ffmpeg` |

Statuses: `queued → scripting → scripted → preparing → awaiting_review → approved → rendering → done`,
plus `dirty` (a person edited source/script; `dirty_from` says which step must re-run) and `error`.

## Play-through check

- Stills lint only sees one frame per scene. After the stills, `captureStills` reloads the same page (one browser per page, no second launch) and `playCheck` (`engine/playcheck.mjs`) plays it forward every `playcheck.step` (1/12 s; at most `maxFrames`, sampled evenly beyond) the way the render does. Per frame it reports text over text (text-node rects narrowed to glyph extent with canvas metrics, clipped by `overflow` and `clip-path: inset()`, text flowing in one block never counts; more than 2 px each way), text of two scenes at once, a caption box (`.subt .sw`) over scene text, two captions at once and, for a brand whose motion profile has `oneScene` (every profile but standard), two scenes with text at once. Every `historyEvery` (0.5 s) it lints mid-motion and stores each id's effective opacity and own text; afterwards it seeks each of those times directly (from the end and from the start) and reports what differs from the played state.
- Findings use the lint shape (`{ level, scene, el, msg, t }`), one per problem with its time ranges (`text over text 12.40–12.63 s: …`). Errors: everything except mid-motion lint (a warning; a scene/element stills lint already flagged is skipped) and text over text lasting at most 2 frames (a transition frame, a warning). They join `lint`, so errors end prepare in `error` as before. `playcheck.enabled: false` turns it off. `cli.mjs playcheck <p> <job>` plays a prepared job's pages again and prints the findings without writing anything.

## Render outputs and QA

- `render` writes `final.mp4`, then runs `engine/qa.mjs` on it: one ffmpeg pass with `ebur128` (loudness, true peak), `blackdetect` and `freezedetect`, plus length, audio, platform format and caption checks (`checkCaptions`). The receipt is `qa.json`; `status.outputs.qa` keeps the verdict and up to 20 findings. QA never undoes a render: errors and warnings are shown on the done banner. `cli.mjs qa <p> <job>` re-checks an older render. Sequences get the same receipt.
- Captions: `toSrt` cuts each scene's words into cues of at most two 42-character lines (`cuesOf`, `wrapCue`), breaking after a sentence; a scene with no voice line adds no cue.
- Extra cuts: `brief.alsoFormats` (up to 3 other formats the template or mix makes; not footage templates). `prepare` writes `index-<WxH>.html` and `stills/<WxH>/` per cut and lints each; `render` writes `final-<WxH>.mp4` and `qa-<WxH>.json` from the same timing, voice and music. `status.cuts` and `status.outputs.cuts` list them.

- Offline HTML: after the main render, `engine/htmlvideo.mjs` writes `video.html`: the composition page with vendor scripts, assets, clips and the final audio (copied out of `final.mp4`) inlined as data URIs, plus a player that scales the stage and drives `seek()` from the audio clock. Capped at 200 MB; a failure is reported in `outputs.html.reason` and never fails the render.
- Parallel render (`engine/frames.mjs`): `render.concurrency` headless Chromes (default 4, at most 8, half the CPU threads, one second of video each; tabs of one Chrome screenshot one at a time, so it is one Chrome per worker) each capture a contiguous run of frames into their own ffmpeg segment; the segments are joined with the concat demuxer, no re-encode. Every ffmpeg child is capped by `engine.runTimeoutMinutes`. Footage is not seeked as `<video>` during a render: `cutClipFrames` has ffmpeg cut each `clips/<clip>.mp4` into `frames/<clip>/*.jpg` (removed when the render ends) and `openComposition(…, { inject })` serves the page with a script (`CLIP_FRAMES_JS` in `engine/frames.mjs`, placed by `injectScript` before `vendor/gsap.min.js`) that swaps each clip `<video>` for an `<img>` answering the same calls, as Remotion's `OffthreadVideo` and HyperFrames do. The page file stays byte for byte as approved, so a job prepared earlier gets cut frames too; previews and prepare keep the `<video>`. Colour: screenshots and lavfi sources are converted with `BT709_VF` and every encode that makes new pixels carries `BT709_TAGS` (`engine/media.mjs`), since ffmpeg defaults to BT.601 while players read HD as BT.709 (brand colours were off by up to 17/255); a YUV clip only gets the tags, and a sequence join keeps its parts' tags without being told. `node engine/cli.mjs bench <project> <job>` times the first seconds with 2, 4, 6 and 8 Chromes to pick `render.concurrency` (2026-10-26 on a 16-thread machine: 4 → 28 s, 6 → 26.4 s, 8 → 28.7 s for 10 s of video).
- Motion blur: `brief.motionBlur` renders `render.motionBlurSamples` sub-frames per frame inside a `render.shutter` (180° = 0.5) and averages them with `tmix`; the page stays a pure function of `t`. Changing only this field keeps the approved storyboard.
- Cut on the beat: `brief.cutOnBeat` passes `beatSnap(grid)` into `speakScript` / `estimateTiming`, so each scene ends on the next beat (it only grows, at most 0.75 s; fixed footage lengths stay). Built-in tracks declare `beat` in `engine/library.mjs`; an uploaded track is analysed by `engine/beats.mjs` (onset envelope, autocorrelation tempo, per-beat regression). `timing.beat` records the grid. The Preview plays the brand music under the voice.
- Recorded voice: `brief.voiceTake` names one audio asset (.wav, .mp3, .m4a) that reads every voice line in order. Prepare (`engine/voicetake.mjs` `recordedVoice`) transcribes it with the local Whisper path (`clipWords`, cached in the job's `stt/`), normalises words on both sides (lower case, no punctuation, English numbers and symbols as heard: "2026" = "twenty twenty-six"), and aligns them with one Needleman–Wunsch pass (heard words before the first line and after the last are free; a close spelling counts, and so do two words heard as one, "month end" / "Monthend"; on a tie the later copy of a repeated phrase wins). A scene under `voiceTake.minMatch` (0.7) of its words fails prepare naming the scene and quoting what the take says there. Each scene's word span is moved onto the voiced frames of the take, padded (`padding`, never past the midpoint to the next scene), brought to `targetLufs` (one gain for the whole take, under a −1 dBFS peak) and cut to `take/<scene>.wav`. `speakScript(…, take)` then places those cuts exactly where it places TTS clips, so lead/tail, tight gaps, pace minimums and beat snapping all apply; caption words are the script's own, timed on their heard words, unmatched ones spread between neighbours. `timing.source` is `take`, `timing.take` keeps the cut and match per scene. The TTS voice's language check is skipped (a person can read any language). Changing only `voiceTake` is prepare-only.
- Scene gaps: `sceneGaps` (`engine/timing.mjs`) gives each scene's pause before the voice (`timing.leadIn`, 0.2 s) and after it (`tailOut` 0.5 s or the pace's `tail`; the last scene holds `lastSceneHold`). A brand whose motion profile has `tight` (`cinematic`, `clean`, `kinetic`; `motionProfile` in `engine/brand.mjs`) makes prepare pass `tight`: `timing.tight` (0.15 s before, 0.4 s after; a pace tail may only shorten it, the last scene keeps its hold). `speakScript` then measures the gaps from where the voice is heard in each clip (`voicedSpan` on the WAV), not from the clip edges, so the TTS engine's own silence does not widen them; a clip may start before its cut (before 0, its leading silence is trimmed). Pace minimums and beat snapping apply after. Without `tight` the numbers are the ones every render used before.

- Footage everywhere: `beats.audio: "footage"` templates cut every `clip` scene (`footageClips`; `beats.footage: "audio"` also takes .wav/.mp3 and makes no video). `beats.levels` stores per-frame loudness in `timing.footage[].levels` (`levelsOf`, 30 a second) for the audiogram waveform. Other templates may give any scene a `video` (`sceneVideos`): cut to `clips/<id>.mp4`, played muted under the voice, or with `sound: true` its sound joins `footage.wav` and the clip sets the scene length. The kit writes clip seeking (`video[data-clip]`, `seekClips`) only into pages that have such a clip.
- Loudness match (`engine/loudness.mjs`, config `loudness`): before `footage.wav` is mixed, prepare measures each clip that plays its own sound and the voice-over with ffmpeg `ebur128` (integrated loudness and true peak, mono 48 kHz as footage.wav mixes it) over voiced spans only (the clip's heard or typed words, the voice-over's words; `aselect` keeps those spans, ebur128's gate drops the pauses inside them). A clip more than `toleranceDb` (1 dB) away from the voice-over gets a `volume` gain to it, clamped to ±`maxGainDb` (12 dB); a raise stops at −1 dBFS true peak. With no voice-over (talking-head, audiogram) two or more clips meet at their median; one clip alone keeps its level. `timing.loudness` (`against`, `target`) and per clip `gainDb`, `lufs`, `peak` in `timing.videos` / `timing.footage`; `review/pacing.json` carries the scene's `gainDb`. `match: false` (or every gain 0) leaves the `footage.wav` graph exactly as before (`footageArgs`). The final mix still applies one `loudnorm` to everything.
- Cut sounds (`engine/sfx.mjs`, library in `engine/library.mjs` `SFX`): `whoosh`, `hit`, `riser`, `click`, synthesised once per machine into `library/sfx/` (seeded `anoisesrc` and `aevalsrc` sweeps shaped by `afade`, mono 48 kHz, 0.3–1.2 s; a second pass measures the float peak with `astats` and sets it to the sound's `peakDb`, −4 to −9 dBFS). Brand `sfx: { cut, gainDb }` (−30..0, default −12; absent or `none` = no sound) and a scene's own `sfx` (in `beats.json` of explainer, data-story, before-after, code-story, logo-reveal, event, testimonial; `none` silences one cut). Prepare (`jobSfx`) places one sound at each scene start but the first (`sfxPlacements`): each sound's `peak` lands on the cut, so a whoosh swells into it, a riser ends on it, a hit or click starts on it (a run-up longer than the time before the cut loses its head). It writes `sfx.wav` (one library input per sound, `adelay`, `volume=gainDb`, padded to the video) and `timing.sfx` (`gainDb`, `cuts`); the Preview plays it with the voice. The final mix (`finalMixArgs` → `mixFilter({ sfx })`) adds it after the duck: it never dips the music and is never the sidechain, so speech does not hide it, while its level stays the brand's `gainDb` under the voice (cuts sit in the gaps between lines). Without `sfx.wav` the final args are the ones every render used before. Cut sounds alone (no voice, no music) skip `loudnorm`.
- Overlays: `beats.alpha` (lower-third) builds a transparent page (`page({ transparent: true })`), screenshots PNG with `omitBackground`, encodes `alpha.mov` (ProRes 4444, `yuva444p10le`) and composites `video.mp4` over the brand background for the MP4, QA and preview.

## Speech to text

- `engine/stt/whisper.mjs`: Whisper base, int8 ONNX from the sherpa-onnx release (`models/whisper/`), on the existing `onnxruntime-node`. Log-mel computed in JS as Whisper does (Hann 400, hop 160, Slaney mel); model constants read from the ONNX `metadata_props`; greedy decoding with Whisper's timestamp rules gives timed segments; words are spread inside each segment. Windows of 29.5 s; after each window decoding restarts at the end of the last finished segment, so words at an edge or after an early stop are heard once. Near-silent windows are skipped. Runs locally on CPU, no network.
- `engine/stt.mjs`: `transcribeAsset` (whole file → `profiles/<p>/transcripts/<asset>.json`, keyed by size and mtime, 40 min cap), `clipWords` (the stored transcript, or just that stretch, cached in the job's `stt/`).
- Prepare: a footage clip with sound and empty `text` gets words with real times; lint adds a warning asking the person to read them. `cli context` lists stored transcripts for the Director (who cannot run `transcribe`: it is not in the director allowlist). The Brand tab's Transcribe button runs `cli.mjs transcribe` through `runTranscribe` (one engine slot, kill timer, capped log next to the transcript).

## Footage import and shot finder

- `engine/footage.mjs`, ffmpeg only (no model). `analyseFootage` runs one `select='gt(scene,0.28)',showinfo` pass for cuts (`cutTimes`; a cut under `footage.minShotSeconds` after the last one is ignored by `shotsFromCuts`), two `cropdetect` passes on a few seconds in the middle (plain for black bars, `negate,` first for white bars; `barsFrom` keeps the one that removes more) and one thumbnail per shot at its middle. It writes `out/_footage/<project>/<asset>/shots.json` + `thumbs/<n>.jpg`, cached by the file's size and mtime (`stamp` from `engine/stt.mjs`). `probeMedia` now also reports `width`, `height` (upright when the stream carries a 90° rotation) and `fps`.
- `findWords` searches the stored transcript (`loadTranscript`): consecutive words, accents and punctuation ignored, the last word may be a prefix; each hit carries its segment. No transcript: a 404 that says to click Transcribe.
- `makeClip` checks the options (`validateClipOptions`: in/out inside the file, at most `footage.maxClipSeconds`, crop rect and blur rects inside the source frame, band 0-45 %, `fill` `cover` | `blur-fill`, gain −24..+12 dB, even output size), builds one filter graph (`clipGraph`: masked blur → crop rect → band → cover or blur-fill → `setsar=1,format=yuv420p`; `[0:a:0]volume`), encodes H.264 30 fps + AAC 48 kHz, saves through `saveAsset` (never overwrites without `replace`) and writes `profiles/<project>/clips/<name>.clip.json` (source, its stamp, in/out, operations). The blur mask is a one-frame gray PNG drawn by `geq` (`maskExpr`: feathered rects, no fade on a frame edge, times the kept ellipse). `previewFrame` renders one JPEG at the in point with the same graph.
- Server (127.0.0.1 only): `GET /api/projects/<p>/footage/<asset>` (analysis, transcript availability, busy, last error), `GET …/images/<n>.jpg|preview.jpg`, `GET …/find?q=`, `POST …/analyse` (`cli.mjs shots` through `runAssetTask`: one engine slot, `footage.analyseTimeoutMinutes`, capped `analyse.log`), `POST …/preview` (one at a time), `POST …/clip` (holds an engine slot while ffmpeg runs). Deleting an asset drops its clip sidecar and shots folder; an upload over a clip drops the sidecar. The review link reaches none of these.
- Brand tab: a Shots button on each video asset opens the dialog (thumbnail strip, transcript search, in/out, preset, bars crop, output size, gain, mute, preview frame, Make clip). Hidden in review mode.

## Evidence import

- `engine/evidence.mjs`, no model, no network, no credentials. A person gathers facts with their source for a brief's Facts box; the Director only reads the brief (`evidence` is not in its allowlist, and its `dontAsk` mode refuses anything unlisted).
- git: `gitEvidence(alias, { since, until, tickets, grep, max })`. A repo is only an alias in `config/studio.json` → `evidence.repos` (alias → folder); the CLI's `--repo-path` is accepted only when it equals one of those folders. Read-only git through `spawn('git', [...])` (`--no-pager --no-optional-locks`, `core.fsmonitor=false`, `GIT_TERMINAL_PROMPT=0`), one time budget of `evidence.timeoutSeconds` for the whole search, stdout capped at 8 MB. Per ticket (`[A-Z]+-\d+`) or one fixed-string grep: `git log --all --fixed-strings --grep`, whole ticket ids only (OP-2 is not OP-20), at most `evidence.maxCommits` commits examined in all. The title comes from the first merging PR (`Merged PR n:` or `Merge pull request #n`), else the first own commit naming the ticket (a "Merge develop into …" sync is skipped). `git branch -a --contains` on the first commit (else the title commit) gives the release branches: local and remote, names starting with `evidence.releasePattern`, natural order (sprint-109 before sprint-110). The fact line: `- <title>: merged|committed <date>, first released in <branch> | not in any release branch (<ALIAS> repo, git).`
- CSV: `csvEvidence(text, { dateCol, valueCols, groupCol, ranges, prefix })`. Parses `#` comment lines and blank-line separated tables (GA4 puts several in one file), quoted fields, `,` `;` or tab, thousands separators, currency signs, `YYYYMMDD`, `YYYYMM`, ISO dates. Sums each value column per range (1 or 2 ranges like `2025-01..2025-09`), per group too, growth from the first range to the second to one decimal; a month row only partly inside a day range is left out and counted. A sign in the cells is kept; a given `prefix` goes only on money-named columns (revenue, value, price, sales…), never on sessions or users. The fact line names the file, column and ranges: `- <column> Jan-Sep 2026 vs Jan-Sep 2025: $12,258,510 vs $11,178,103, up 9.7% (<file>, column <column>).`
- CLI `evidence git|csv` (`--json` for the server). Server (127.0.0.1 only, none of it on the review link): `GET /api/evidence` (aliases, never folders), `POST /api/evidence/git` (validates, then one `cli.mjs evidence git … --json` child at a time: key-free env, `timeoutSeconds` + 15 s kill timer, stdout capped at 2 MB), `POST /api/evidence/csv?name=&date=&value=&group=&range=&prefix=` (raw body ≤ 5 MB, `.csv` only, parsed in memory and never stored; without `date` it answers the columns). The brief form's "Add evidence" panel shows the rows and a ticked list of fact lines; Insert appends them to Facts (2000-character cap) and the person saves the brief.

## Language and voice per brief

- `brief.lang` (e.g. `es`, `en-gb`) and `brief.voice` (`kokoro:<id>`, `sapi:<name>` or `none:`) override `brand.voice` for one video (`voiceFor` in `engine/tts.mjs`). The Director writes the script in `brief.lang`.
- Kokoro here speaks English only: the `phonemizer` package bundles English espeak data. `kokoroLang` maps `a*` voices to en-us and `b*` to en-gb; any other voice or language is refused with a reason (`voiceProblem`), on brief save and on prepare. Windows voices speak their own culture; a mismatch is a lint warning.
- `phonemizer` keeps the first language it is asked for, so en-gb runs in its own worker thread (`engine/tts/phoneme-worker.mjs`).
- Changing only `voice` or `alsoFormats` after a script exists sets `dirty_from: 5` (re-prepare, no Director); changing `lang` sends the job back to the Director.
- Changing the template or the mix after a script exists (the UI confirms first; refused while the job is busy) moves `script.json` to `script.prev.json` (an older one is overwritten) and sets `dirty_from: 3`: the Director keeps `source.json` and its locks and writes a new script; the old script's locks do not carry over. Changing `url`, `subject`, `message` or `facts` at the same time makes it `dirty_from: 1`. A brief edit never raises a `dirty_from` the Director has not handled yet.

## Sequences

A brief has one lead template (plus mixed-in scenes, see below). To play finished videos as one MP4, a person
builds a sequence in the UI (`sequences/<project>/<id>.json`): 2-12 job ids, a format and a
transition (a preset from `TRANSITIONS` in `engine/sequences.mjs`: `cut`, an ffmpeg xfade such as `fade` 0.4 s, `dip-black`, `wipe-left`, `slide-up`, `zoom-in`, or a custom xfade expression such as `flash`, `zoom-punch`, `whip-left`, `spin`, `luma-fade`; each has its own length). Each join (between part i and i + 1) may take its own preset (`transitions`); `transition` is the default. A quick low-resolution `preview.mp4` of the same joins (`previewSequence`, 360 px short side) can be made before the render. The same job may appear twice. Save (`checkDraftParts`) needs each part to be a job of the project whose
brief makes the sequence's frame size; it may be unrendered, so the order, joins and music are set up early
(a draft). Preview and render (`checkParts`) need every part `done` with a `final.mp4` of that size and name
the parts that are not. An optional `targetDuration` (whole seconds, 10-1200; editing it keeps the render) is
the film's goal: `sequenceBudget` gives each part's length now (render, else storyboard `status.duration`,
else the brief duration marked as an estimate while the script is queued or being rewritten), its start after
the transition overlaps (`joinList`, the same joins as `sequencePlan`), the total, the delta to the target and
the parts not ready. Both sequence GET routes carry it, so the review link shows it read-only. A job used by a
sequence may change template; it reads as not ready until it is rendered again.
`POST /api/sequences/:p/:id/render` runs `cli.mjs sequence` through `runEngine`; `renderSequence`
probes each part, builds one `filter_complex` (`sequencePlan`: concat, or xfade + acrossfade at
offsets from the probed lengths; `anullsrc` for a part without sound), re-encodes with the render
settings (`render.crf`, `render.fps`, yuv420p, AAC 48 kHz) and joins the parts' `captions.srt`.
Each part's `final.mp4` already carries the brand music, so by default the music restarts at every part.
`musicBed: true` (stored only when on; changing it makes the render stale) keeps the joined picture and
replaces its sound in a second ffmpeg pass (`musicBedPlan`, video copied): each part's own speech files
(`voice.wav`, `footage.wav` from its job folder, `SPEECH_FILES`) delayed to the part's start in `plan.starts`,
over one brand track (`brandMusic`, `library:` tracks included) at `music.gainDb`, ducked with `music.duck`,
0.5 s fade-in, 2 s fade-out, then loudnorm. It is `mixFilter` with `offsets`, `fadeIn` and `fadeOut`. A part
without speech files is music only. Each part's `sfx.wav` is laid at its start the same way, and a cut sound
plays at each join (`joinSfx`: the brand's `sfx.cut`, or the next part's first scene's own `sfx`, centred on the
transition's overlap, on the join for a cut) from a scratch `<out>.joins-sfx.wav`; all of them enter the graph
after the duck (`mixFilter` `sfx`, `sfxOffsets`), before the music inputs. Both passes share one time budget; the preview uses the same bed.
A track shorter than the film (length from `probeMedia`) loops (`loopMusic`; one `-i` per copy, because `asplit`
into chained `acrossfade` gave silent later copies): each copy stops 4 s before
the track's end, past where a built-in track starts fading out, and crossfades (`acrossfade` 2 s) into the next copy.
That copy starts after the 2 s fade-in. For a built-in track it jumps back a whole chord progression (`cycle` in
`MUSIC`), so the join lands on the same chord. Gain, duck and the bed fades apply to the looped track. Single-job
renders never loop.
No director, no model. A sequence id shares the namespace of job ids in its project, because both
write to `out/<project>/<id>/`.

## Mixed briefs

One brief, one script, one voice track, one MP4, with body scenes from up to three other templates
(`MAX_MIX_EXTRAS` in `engine/mix.mjs`). The brief keeps `template` as the lead and adds
`mix: [ids]`. The lead owns size, durations, title, cta and the subtitle style.

- **Who can mix:** a template whose `beats.json` lists `mixable` body kinds and whose renderer
  exports `parts()`. v1: explainer, data-story, testimonial, event, ui-story, feature-launch. Two
  templates drawn by one renderer (feature-launch + ui-story) cannot share a page.
- **Brief:** `validateBrief` checks the mix and that `format` sits in the intersection of every
  template's `formats` (ui-story makes it 16:9 only). A changed `mix` once
  `script.json` exists asks for a new script (see the template change below).
- **Rules:** `loadBriefTemplate(brief)` returns `composeBeats(lead, extras)` for a mixed brief.
  Lead kinds stay bare; extra kinds are `<template>.<kind>` and are allowed only in the lead's body
  slots. `fields`/`defaults` are keyed by that kind; limits and enums stay per source template in
  `sources[<template>]`, and `validateScript` reads them from there. `pace.byKind` gives each
  extra scene its own template's pace (`resolvePace`). `cli.mjs context` prints this composed object.
- **Page:** `prepare` calls `buildMixed`: each renderer's `parts()` gets only its own scenes (bare
  kinds); its css is prefixed `.t-<id>` (`scopeCss`, flat rules only), its markup sits in a
  `display:contents` wrapper and its js runs in a function scope whose `D` shows other templates'
  scenes as `<id>.<kind>`. `page()` runs once: one timeline, one `seek(t)`, one subtitle track.
  An extra template with no scenes in the script is left out, so its chrome (ui-story's app window) never shows.
- Footage templates (talking-head) and the non-kit renderers (product-demo, app-walkthrough) are
  not mixable yet.

## Data flow and state

- All state is JSON on disk. No database. `status.json` per job holds status, step, lint, outputs and a capped `history`.
- Writes go through `writeJson` (temp file + rename). Reads go through `readJson(file, fallback)`.
- The Director's model is `director.model` in `config/studio.json`: `auto` (default), `claude-opus-5-5` or `claude-sonnet-5-5` (`DIRECTOR_MODELS` in `server/director.mjs`; Haiku, Fable and the account default are refused, by the user's decision of 2026-10-23). `directorArgs` always passes a pinned `--model`. Under `auto`, `jobModel` gives each job `director.routing.standard` (Sonnet 5.5), or `routing.strong` (Opus 5.5) when the job is hard: a template in `routing.strongTemplates` (exact numbers, verbatim code or screenshot coordinates), a mixed brief, copy not in English (`brief.lang`, else `brand.voice.lang`), or a retry of a job in `error`. One run uses one model: `pickRun` takes the first queued job's model and the queued jobs that share it, up to `maxJobsPerRun`; the others wait for the next click. `GET /api/director?project=` returns that plan as `next` for the Run button, and the log lists each job's model and reason. A typed `/studio run` runs on the Claude Code session's own model. The Run Director panel has a Model select that saves through `PUT /api/director/model` (`setDirectorModel`), refused while a run is active and absent from the review link; the new model applies from the next run.
- Human edits in the UI (`PUT /api/jobs/:p/:j/source|script`) add `locks`; `mergeRespectingLocks` keeps locked fields on the next director commit.
- Every script commit, from any Director, first runs `repairScript` (`engine/repair.mjs`) on the draft: an unknown icon becomes the nearest one (`nearestIcon`, `engine/icon-match.mjs`), an off-list enum value is removed so the default applies, scenes past a slot's `max` that no later slot takes are dropped, and a missing, invalid or repeated scene id becomes `<kind>-<n>`. It never changes words (it only trims the ends of text) and skips anything a person locked, so the lock merge that follows still decides those fields. Each repair is one line in the commit result (`cli commit` JSON, the API worker's `commit` tool result and log line) and in the `status.history` event (`repaired: …`). Limit errors end with the cut (`title is 50 chars, limit 44: cut 6`).
- Looks (`engine/looks.mjs`): `script.look` names one row of `LOOKS` (`calm`, `energetic`, `premium`, `bold`) or `brand`; absent behaves like `brand`. Each row uses only brand features that exist already (`motion`, `backdrop`, `wipe`, `leaks`, `shine`, `sfx`, and a built-in `library:` track with `duck`). `lookBrand(look, brand)` lays it over the brand: a field the brand sets wins, the look fills the rest, and music is filled whole only when the brand has no track (user decision, 2026-10-28). Because `validateBrand` drops `motion: standard`, `backdrop`/`wipe: none` and `shine`/`leaks: false`, "the brand sets it" means the field is present in `brand.json`; a brand that wants none of a look's extras picks `brand`. `prepare` (stills, timing gaps, cut sounds, the play-through check), `playJob` and `render` (the final mix's music) all read the job's brand through `jobBrand` in `engine/pipeline.mjs`, and the job route's preview music follows it too; templates never see the look's name. `validateScript` refuses any other value. A person's look edit locks the top-level key `look` (`diffLocks`), re-prepares from step 5, survives the next Director commit (`mergeRespectingLocks`, a cleared look stays cleared) and carries over a template change. The Script tab's Look select (above the scenes, hidden on the review link) saves through the script route; the job route lists `looks`. Sequences keep the brand's own music and cut sound for a music bed.
- Draft scenes: a person can leave a scene for the Director (`draft: { note, by, at }` on a placeholder scene in `script.json`). `humanEdit` locks its kind, source and the scene order but never its content fields; saving sets `dirty_from: 4` (`editDirtyFrom`), so the job joins the Director queue. `prepare`, `render` and the run route refuse while a draft is left (`assertNoDrafts`, 409); `commit` refuses a script that still has one. `cli context` lists the drafts. Nothing runs the Director on save: a person clicks Run Director.
- Script tab help: each `beats.json` carries `help.kinds[kind]` and `help.fields[field | "kind.field"]`; `sceneHelp` (`engine/help.mjs`) adds shared `FIELD_HELP` and resolves extras' kinds in a mix. The job detail carries it as `help`.

## Composition contract

A template's `build({ brief, brand, script, timing, size })` returns one HTML page. The page
exposes `seek(t)` and sets `window.__ready = true`; the engine seeks frame by frame. Everything
visible is a pure function of `t`. Text passes through `escapeHtml`; data into `<script>` through
`jsonForScript`. `templates/kit.mjs` provides the shell (brand CSS variables, size-aware `px()`,
subtitles synced to `words.json`).

A kit renderer exports `parts(args)` → `{ css, body, scenes, js, extra?, particles?, subs? }` and
`build(args) = page({ ...args, title: '<id>', ...parts(args) })`. `subs` is the lead's subtitle
style (ui-story's compact line; absent = the kit pill). A scene drawn on a dark frame carries
`dark: true` in its own `parts()` scenes, so subtitles over it switch to the style's dark colours
whichever template leads. `dark` reaches the page only when a `subs` style is set.

## Server

- `node:http`, no framework. Refuses to start on any host but 127.0.0.1/localhost.
- `server/review.mjs`: opt-in read-only review link (`npm run ui:review`) on one private LAN IPv4, port `server.reviewPort` (4781), random access code per start (cookie), GET/HEAD allowlist only. It serves the normal UI with `<html data-review="1">`: `app.js` locks every field and `app.css` hides every edit control.
- Rejects requests whose Host is not the local origin (421). Non-GET requests need a same-origin `Origin` and the header `X-Studio: 1` (403 otherwise).
- Body limit 256 KB for JSON; asset uploads 25 MB (400 MB for video).
- `runEngine` spawns `node engine/cli.mjs prepare|render|sequence` with `shell:false`, at most `engine.maxConcurrentRuns` at once, a `runTimeoutMinutes` kill timer and a `maxLogBytes`-capped `engine.log`.
- Uploaded assets are served with a sandboxing CSP and `nosniff`.
- Evidence routes (`/api/evidence`, `…/git`, `…/csv`): see "Evidence import". Local only; never on the review link.
- `/files/<project>/<job>/` serves only the names in `JOB_FILE_RE`, including `voice.wav` and `footage.wav` so the Composition preview plays the voice in sync (Range requests for video and audio).
- `DELETE /api/jobs/:p/:j` → `deleteJob`: moves the brief and `out/` folder to `trash/<project>-<id>-<time>/`; refused while the engine or the Director has the job, or while a sequence plays it.

## UI

- Sidebar: Jobs, Templates, Brand, Guide. The job column switches between Jobs (filter All / To do / Done) and Sequences, and scrolls on its own.
- The brief form does not ask for a director: `validateBrief` fills `providers.default`, and `updateBrief` keeps the stored one. `config/providers.json` stays for a future worker; the UI no longer lists it.
- Scenes and stills link both ways (`goSub(sub, jump)` in `ui/app.js`): a scene's thumbnail in Script opens Preview at its still time; "Edit in Script" in Preview's timing table scrolls Script to that scene. Stills are matched by scene id; the scene under the playhead is marked.
- Script, Source and Brand keep their Save button in a sticky bar. Leaving a job, sub-tab or project with unsaved edits asks first; closing the page warns.

## Director (LLM) boundary

- Two Director backends behind one button: the seat (Claude Code started by a person) and the API worker (`server/worker/`, plan `.ai/plans/api-director.md`), chosen once per click by `config/providers.json` → `default` and whether that provider's `keyEnv` is set. Keys live in env vars or the gitignored root `.env` only.
- Caps: `director.maxJobsPerRun`, `director.jobTimeoutMinutes`. The director never renders or approves.

## Build, run, CI

- No build step. `npm install` once (Node 20+, Chrome installed; ffmpeg from `ffmpeg-static`).
- `npm run ui` → http://127.0.0.1:4780. `node engine/cli.mjs help` for the engine. `npm test` for tests.
- No CI pipeline. The folder is not a git repository yet.
