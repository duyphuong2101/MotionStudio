# Motion Studio — File Index

## Engine (`engine/`)

| File | Purpose |
|---|---|
| `core.mjs` | `ROOT`, `DIRS`, `StudioError`, `assertId`, `assertFileName`, `within`, `readJson`, `writeJson`, `escapeHtml`, `jsonForScript`, `loadStudioConfig` |
| `jobs.mjs` | `STEPS`, `STATUSES`, brief/brand/asset loaders, `validateBrief` (incl. `mix`), `saveBrief`/`updateBrief` (a template or mix change after a script moves it to `script.prev.json`, dirty from 3), `loadBriefTemplate` (composed rules for a mixed brief), `getStatus`/`setStatus`, locks (`diffLocks`, `humanEdit`, `mergeRespectingLocks`; scene fields from every `beats.json`; draft scenes), `editDirtyFrom`, `sequenceFile`/`sequenceIds` |
| `mix.mjs` | Mixed briefs: `MAX_MIX_EXTRAS`, `splitKind`, `isMixable`, `composeBeats` (lead + extras rules), `scopeCss`, `buildMixed` (one page from several renderers' `parts()`) |
| `pipeline.mjs` | `claim`, `fail` (Director stops a job before review), `commit`, `prepare` (passes `tight` for a cinematic brand; stills, lint and the play-through check), `playJob` (read-only play-through check of a prepared job), `approve`, `render`, `describe`, `sizeFor`, footage clip cutting, `footageArgs` (footage.wav graph, per-clip `gainDb`), `finalMixArgs` (final mux args and audio label), `mixFilter` (final audio graph; `offsets`/`fadeIn`/`fadeOut` for a sequence music bed; `sfx`/`sfxOffsets` cut sounds after the duck), `brandMusic`, `SPEECH_FILES` |
| `sfx.mjs` | Cut sounds: `SFX_FILE`, `cutSound` (scene `sfx` over brand `sfx.cut`), `placeSound` (peak on the cut), `sfxPlacements` (every scene start but the first), `sfxArgs`/`writeSfxTrack` (sfx.wav graph), `jobSfx` (prepare: `sfx.wav` + `timing.sfx`) |
| `sequences.mjs` | Sequences (finished videos joined into one MP4): `validateSequence` (optional `targetDuration`), `checkParts` (render and preview: every part done), `checkDraftParts` (create and edit: parts may be unrendered), `sequenceBudget` (each part's length from render, storyboard or brief estimate, transition overlaps, total vs target, parts not ready), `create`/`update`/`deleteSequence`, `getSequenceStatus`/`setSequenceStatus`, `sequencePlan` (ffmpeg args), `musicBedPlan` (one music track under the joined film, `musicBed`; parts' `sfx.wav` and join sounds), `joinSfx` (cut sounds at the joins), `loopMusic` (crossfaded loop of a track shorter than the film), `joinCaptions`, `previewSequence`, `renderSequence`; `dip-black`/`dip-white` are custom xfade expressions (down over the first half, up over the second); `luma-fade` has a 0.6 soft edge so an evenly dark part still turns over gradually |
| `cli.mjs` | Engine CLI: `list`, `context` (incl. `urlCheck`), `claim`, `fail`, `commit`, `prepare`, `playcheck`, `review`, `approve`, `render`, `status`, `transcribe`, `shots`, `find`, `clip`, `qa`, `sequence`, `evidence git|csv` (`--json` prints errors as `{ error, code }`) |
| `evidence.mjs` | Evidence import (person-run, read-only): `evidenceConfig`, `repoAliases`, `resolveRepo` (alias → folder from `evidence.repos`), `aliasForPath` (CLI `--repo-path`), `gitSearch` (ticket/grep/date validation, commit cap), `gitEvidence` (commits, merging PR, first release branch, fact lines), `releaseBranches`, `changeTitle`; CSV: `decodeCsv`, `readCsvFile`, `csvName`, `csvRecords`, `csvTables`, `csvColumns`, `parseNumber`, `parseDate`, `parseRange`, `growth`, `csvEvidence` (range sums, groups, growth, fact lines); `MAX_CSV_BYTES`, `MAX_TICKETS`, `MAX_RANGES` |
| `playcheck.mjs` | Play-through check in an open composition: `playCheck` (text over text, caption over text, two captions / scenes at once, played vs jumped, mid-motion lint; `shots` + `onShot` take frames on the way), `freshLoad`, `playFrames` (frame times and history marks), `groupHits` (one finding per problem with time ranges), `PLAY_DEFAULTS` |
| `review.mjs` | Review sheet and pacing table: `pacing` (per scene length, words, words per second, head, tail, silence share, clip `gainDb`, flags `fast`/`slowTail`/`dead`/`repeat` (a third scene of one kind in a row, footage aside, `sameKindRun`); job `silence`), `sheetShots` (in, middle, before the cut), `cutShots` (`CUT_FRAMES` around every cut), `tileSize`, `writeSheet` / `writeCutSheet` (label column in a new tab of the open browser + ffmpeg `tile`/`hstack` → `review/sheet.jpg`, `review/cuts.jpg`), `reviewOf` (what the UI and `cli review` show), `pacingTable` |
| `qa.mjs` | Checks a finished MP4: `runQa` (one decode pass: loudness, black, freeze, `scdet` hard cuts), `judge` (findings; a hard cut over `QA_RULES.cutJump` warns), `parseLoudness`/`parseBlack`/`parseFreeze`/`parseJumps`, `checkCaptions`, `QA_RULES` |
| `notes.mjs` | Notes pinned to a moment of a job's preview (`notes.json`): `loadNotes`, `addNote` (scene from timing.json, `MAX_NOTES`, `NOTE_CHARS`), `deleteNote`, `notesForDirector` (none for a queued job) |
| `context.mjs` | `directorContext`: brief, status, brand, voice notes, URL check, assets, template rules, `marksRule`, `layoutRule`, pinned `notes` + `notesRule`, `referenceRhythm` + `rhythmRule`, transcripts, icons, screenshots, drafts |
| `script.mjs` | `validateScript` (against `beats.json`; draft scenes, placeholder voice warning), `assertValidScript`, `validateSource` (bullet `asset` screenshots against the project assets), `bulletScreenshots`, `wordsOf`, `draftScenes`, `assertNoDrafts`, `DRAFT_NOTE_MAX` |
| `help.mjs` | Script tab help: `FIELD_HELP` (shared field hints), `sceneHelp(beats)` (kind + field help per kind, mixed briefs included) |
| `templates.mjs` | `hasRenderer`, `isBuiltIn`, `readTemplate`, `rendererDir` (handles `extends`) |
| `transition-preview.mjs` | `transitionPreview`, `transitionPreviewFile`: a sequence transition demo clip per project (two brand-coloured scenes joined by the preset) in `out/_preview/transitions/` |
| `timing.mjs` | `estimateTiming` (words per second), `sceneGaps` (lead-in and tail per scene; `tight` for a motion profile with `tight`: cinematic, clean, kinetic), `resolvePace` (pace table per scene, `byKind` for a mix), `toSrt`, `srtTime` |
| `tts.mjs` | `listVoices`, `previewVoice`, `ttsProvider`, `spokenLine` (brand `voice.say`: TTS text only, timing mapped back to the script's words), `speakScript` (Kokoro or SAPI, or a recorded take's cuts via `take`; `tight` measures gaps from the voiced span of each clip) |
| `voicetake.mjs` | Recorded voice (`brief.voiceTake`): `spokenTokens`/`numberWords` (words as heard), `alignTake` (Needleman–Wunsch over tokens with free ends and fused words, script words timed on the take; low match → error naming the scene), `voicedFrames`, `cutPlan`, `takeGain`, `recordedVoice` (transcribe, align, cut `take/<scene>.wav`), `TAKE_DEFAULTS` |
| `tts/kokoro.mjs` | Local Kokoro ONNX synthesis |
| `tts/sapi.ps1` | Windows SAPI synthesis script |
| `loudness.mjs` | Loudness match for clip sound: `LOUDNESS_DEFAULTS`, `voicedSpans` (words → spans), `measureFilter`, `parseEbur128`, `measureLoudness` (ebur128 on voiced spans), `matchGains` (gain toward the voice-over or the clips' median; tolerance, clamp, peak headroom), `clipGains` |
| `media.mjs` | `BT709_VF` / `BT709_TAGS` (colour for every encode), `ffmpeg`, `ffmpegReport`, `probeMedia` (duration, sound, `width`/`height`/`fps` via `videoInfo`), `openComposition` (headless Chrome; SwiftShader for a page with `data-gl`, `usesGl`; `inject` serves a render script inside the page, `injectScript`), `lintInPage` |
| `glb.mjs` | `sampleGlb` (a torus as a glTF 2.0 binary, for previews and tests), `isGlb` (upload check) |
| `vendor.mjs` | `copyThree`: three.js and its GLTFLoader into a job's `vendor/`, flat, imports pointed at the same folder |
| `frames.mjs` | Parallel render: `openWorkers` (one Chrome per worker), `renderWorkers`, `splitFrames`, `renderFrames` (one ffmpeg segment per worker, joined by the concat demuxer), `cutClipFrames` (clips cut into `frames/` for a render, returns the `CLIP_FRAMES_JS` script to inject; `CLIP_FPS`) |
| `footage.mjs` | Footage import and shot finder: `analyseFootage` (scene cuts, thumbnails, letterbox bars → `out/_footage/<p>/<asset>/`), `loadShots` (with `rhythm`), `rhythmOf` (shots, average and median shot, cuts a minute), `assetRhythms` (every analysed video asset, for the Director), `findWords`/`searchWords` (transcript search), `validateClipOptions`, `clipGraph`/`clipArgs`/`maskExpr` (pure ffmpeg graphs), `previewFrame`, `makeClip` (new asset + `profiles/<p>/clips/<name>.clip.json`), `forgetFootage` |
| `stt.mjs` | `transcribeAsset`, `loadTranscript`, `clipWords`, `decode` (asset → 16 kHz mono floats), `stamp` (size + mtime fingerprint for caches) |
| `assets.mjs` | `ASSET_TYPES`, size caps, `cleanAssetName`, `saveAsset`, `deleteAsset` |
| `brand.mjs` | `validateBrand` (empty `allowedHosts` filled from `site`; `sfx`; `motion` stored unless standard, `film: false` only for a grain profile), `MOTION_PROFILES` (one row per motion: entrance, cut, push, bg, caps, layout, tight, oneScene, layers, carrier), `carry` kept only for a profile with `carrier`, `motionProfile(brand)` (absent or unknown → standard), `MOTIONS`, `hostsFromSite`, `urlCheck` (brief URL host vs allowed hosts), `CUT_SOUNDS`, `SFX_GAIN_DB` |
| `library.mjs` | Built-in music and cut sounds synthesised with ffmpeg: `MUSIC` (`calm-pad`, `soft-pulse`, `steady-tech`, `bright-drive`; `beat`, `cycle` per track), `ensureMusic`, `musicPath`; `SFX` (`seconds`, `peak`, `peakDb`), `ensureSfx` (peak-normalised, `library/sfx/`), `sfxPath` |

## Server and UI

| File | Purpose |
|---|---|
| `server/server.mjs` | Local HTTP server: `/api/*` routes, `/files/*` job outputs, `/assets/*` brand assets, `runEngine` |
| `server/director.mjs` | Run Director (the one Claude call site, person-clicked): `directorArgs` (allowlist, `--permission-mode dontAsk`, `--max-turns`), `resolveClaude` (`claude.exe`, never a `.cmd`), `startDirector`/`cancelDirector`, `directorState`, usage-limit pause (`detectPause`, `readPause`, `clearPause`), logs in `logs/director/` |
| `ui/index.html`, `ui/app.js`, `ui/app.css` | Single-page UI: briefs, storyboard review, source/script editing, brand editor |
| `ui/shots.js` | Bullet screenshots in the Script tab: `bulletShot`, `shotField`, `shotAction` (set / offer), `applyShot`; the Brand tab's `MOTION_OPTIONS` (twin of `MOTIONS`) and `motionOpt`; imported by `app.js` and `tests/bullet-screenshots.test.mjs` |

## Templates (`templates/`)

| Template | Renderer |
|---|---|
| `app-walkthrough` | own `template.mjs` (screenshots in a browser frame) |
| `before-after` | own; `stat` arrow only for a `change`; `stat` takes `theme` |
| `code-story` | own, `parts()`, mixable |
| `data-story` | own, `parts()`, mixable; `stat`/`bars`/`line` take `theme` and `tone`; `bars` takes `series` and `layout: columns`; `line` takes `band` and `ref` |
| `event` | own, `parts()`, mixable |
| `explainer` | own, `parts()`, mixable; `title`/`step`/`diagram`/`flash` take `theme`; `flash` is full-frame kinetic type, each item on the word that starts it |
| `feature-launch` | extends `ui-story`, mixable |
| `lifestyle` | own |
| `logo-reveal` | own |
| `product-demo` | own |
| `promo` | own |
| `social-teaser` | extends `product-demo` |
| `talking-head` | own (footage clips) |
| `testimonial` | own, `parts()`, mixable |
| `ui-story` | own on the kit, `parts()`, mixable, lead subtitle style (animated UI redrawn as HTML/SVG, raw 1920×1080 px) |
| `gl.mjs` | WebGL layers for `page`: `brand.backdrop` (mesh, aurora, flow, 3D shapes) behind the scenes and `brand.wipe` (liquid) over the cuts, each a pure function of `seek(t)` |
| `model3d.mjs` | 3D model scenes: `modelCanvas`, the importmap and the module that loads each `.glb` with three.js and draws it at every seek |
| `kit.mjs` | Shared shell: `page` (incl. `tpl` lookups for a mix, `particles`, lead `subs` style, per-scene `dark`, the motion profile: `ENTRANCE` rows through `entranceJs`, `CINE_HELPERS`, `EDITORIAL_HELPERS`, `CUTS` (fade, blur, panel, zoom), the `#cutpanel` sweep, the `#cutveil` (`VEIL_JS`: a blur cut between two colours or to/from a full-frame picture turns through the new scene's colour), the `#carrier` (`CARRY_JS`, `brand.carry`: an accent bar glides from anchor to anchor over every cut), the parallax `CAMERA` and `layerDrift`; `layers: false` keeps a renderer out of the drift), `geometry`, `checkBrand`, `asset`, `camera` (screenshot focus framing), `num`, `h`, `hasLogoBug`, `UNDER_BUG`, `contentArea` (block clear of the corner logo and subtitles), `themeClass` + `ACCENT_CSS` (scene themes); in `page`, text marks (drawn at the spoken word), `brand.shine` on `.btn` and the `pill`/`pop` subtitle presets |
| `../engine/marks.mjs` | Text marks: `MARK_STYLES`, `MARK_FIELDS`, `stripMarks` (limits count on-screen text), `markErrors`, `marksToHtml` (kit; plain words inside attributes) |
| `shared.mjs` | `paletteCss`, `logoFile`, `logoHtml`, `brandAssets` |

## Motion kit

| File | Purpose |
|---|---|
| `motion-kit/icons.mjs` | `ICONS` (= `BASE_ICONS` + the generated set), `ICON_NAMES`, `TICK`, `DECOR` SVG paths |
| `motion-kit/icon-list.json` | The built-in set: motion-kit name → Phosphor fill icon, by group |
| `motion-kit/build-icons.mjs` | Dev-only generator: `node motion-kit/build-icons.mjs <extracted @phosphor-icons/core>` writes `icons-set.mjs` |
| `motion-kit/icons-set.mjs` | Generated `SET_ICONS` paths. Do not edit; rerun the generator |
| `motion-kit/LICENSE-phosphor.txt` | MIT notice for the Phosphor icons |

## Config and data

| Path | Purpose |
|---|---|
| `config/studio.json` | Server host/port, director caps, engine caps, render, timing (incl. `tight` gaps for cinematic brands), lint, `playcheck` (`enabled`, `step`, `maxFrames`, `historyEvery`, `opacity`), `review` (`fastWps`, `slowTail`, `maxSilence`, sheet frame times `frameIn`/`frameOut`/`minOut`, `tile`), `loudness` (`match`, `toleranceDb`, `maxGainDb`), `voiceTake` (`minMatch`, `padding`, `maxExtend`, `targetLufs`, `maxGainDb`), `evidence` (`repos` alias → folder, `releasePattern`, `maxCommits`, `timeoutSeconds`) |
| `config/providers.json` | Director options; API keys referenced by env var name only |
| `profiles/<project>/brand.json` | Colors, fonts, logo, voice, music (`file`, `gainDb`, optional `duck`), optional `sfx` (`cut`, `gainDb`), optional `motion` (`cinematic`, `clean`, `editorial`, `kinetic`, `parallax`; absent = standard), optional `film: false` (cinematic without grain and vignette), `sources.allowedHosts` |
| `profiles/<project>/icons.json` | Brand icons `{ name: path }`, written by `engine/icons.mjs` from an uploaded SVG |
| `profiles/<project>/voice.md` | Tone notes for the director |
| `briefs/<project>/<job>.json` | Brief written by the UI |
| `sequences/<project>/<id>.json` | Sequence written by the UI: `title`, `format`, `parts` (job ids, 2-12), `transition` (the default preset id) and `transitions` (one preset id per join, between part i and i + 1; see `TRANSITIONS`), `musicBed` (only when on: one brand music track under the whole film; the UI ticks it for a new sequence), `targetDuration` (optional seconds, 10-1200). Parts may be unrendered jobs (a draft) |
| `out/<project>/<job>/` | `status.json`, `source.json`, `script.json` (`script.prev.json` after a template change), `timing.json`, `voice.wav`, `footage.wav`, `sfx.wav` (cut sounds), `index.html`, `stills/`, `review/` (`sheet.jpg`, `pacing.json`), `final.mp4`, `engine.log` |
| `out/_footage/<project>/<asset>/` | `shots.json` (shots, bars, size, fps), `thumbs/<n>.jpg`, `preview.jpg`, `analyse.log` |
| `profiles/<project>/clips/<name>.clip.json` | Provenance of a clip cut from a video asset: source, in/out, operations |
| `out/<project>/<sequence>/` | `status.json` (`draft`/`rendering`/`done`/`error`), `final.mp4`, `captions.srt`, `engine.log` |
| `captures/csr-console/` | `capture.cjs` + `csr-shots.json`: demo-data UI capture |

## Tests

| File | Covers |
|---|---|
| `tests/engine.test.mjs` | ids/paths, escaping, script/source validation, locks, timing, brand validation |
| `tests/templates.test.mjs` | Every template builds a valid sample script in every format; `PARTS_BASELINE` hashes; `build() === page(parts())`; kit subtitle style and per-scene `dark` |
| `tests/scene-captions.test.mjs` | Captions for a motion scene's clip that plays its own sound: `typedWords` (typed `caption` timed on heard speech), `heardWords`, the explainer `caption` limit |
| `tests/mix.test.mjs` | Mixed briefs: `composeBeats`, `scopeCss`, per-source script rules, pace per kind, brief `mix` rules, `buildMixed` page shape, ui-story as lead |
| `tests/ui-story-shot.test.mjs` | ui-story `shot` scenes: missing asset, bad focus, shot count, `ui-story.shot` in a mix, screenshot markup and camera |
| `tests/director.test.mjs` | Run Director: no bypass flags, allowlist never renders or approves (may `fail`), max turns, allowed hosts, `claude.exe` lookup, usage-limit pause, one run at a time, queue |
| `tests/assets.test.mjs` | Asset names, types and size caps |
| `tests/footage.test.mjs` | Clip option validation, clip names, shot/bar parsing, mask and clip graphs, transcript search, path checks, rotation; real ffmpeg: cut found at 2 s, white bars, blur-fill 1080×1920 → 1920×1080, sidecar, masked clip, preview frame |
| `tests/server-footage.test.mjs` | Footage routes on a live server: traversal and bad image names refused, no write without `X-Studio`, missing asset 404; the review link reaches none of them |
| `tests/help.test.mjs` | Every kind and field of every template has help text; kind overrides; mixed-brief help |
| `tests/drafts.test.mjs` | Draft scenes: validation, `dirty_from` 4 + Director queue, lock semantics, prepare/render refusal, commit rejects leftovers |
| `tests/bullet-screenshots.test.mjs` | Bullet `asset`: validation, asset-only edit keeps status (`editDirtyFrom` null) and locks per bullet, merge keeps the person's choice, commit refuses an invented file, `cli context` lists screenshots, `ui/shots.js` prefill rules |
| `tests/brief-host.test.mjs` | Brief URL host check on save/edit (not on read), hosts filled from site, `cli context` `urlCheck`, `cli fail` statuses and reason cleaning, recovery by `claim` |
| `tests/sequences.test.mjs` | Sequence validation, id namespace, edit/delete, ffmpeg arguments (cut, fade, silent parts), caption joining |
| `tests/sequences-music-bed.test.mjs` | `musicBed` validation and staleness, `musicBedPlan` graph (speech offsets, one music input, duck), `loopMusic` (200 s film over a 120 s track, chord cycles, too short / long enough), unchanged join args when off, real-ffmpeg loop level check, preview + render |
| `tests/playcheck.test.mjs` | Play-through check: frame sampling and history marks, grouping into one finding with time ranges, short overlaps as warnings; broken kit pages in Chrome for text over text, glyph boxes (no line-box false hit), caption over text, two captions, two scenes (`oneScene`), text of two scenes, played vs jumped |
| `tests/playcheck-templates.test.mjs` | Every template's sample in every format plays through with no play-through error, one test per motion profile (`--test-name-pattern <motion>`) |
| `tests/motion-presets.test.mjs` | Motion profiles: the table, `motionProfile`, brand validation, the Brand tab twin (`MOTION_OPTIONS`), page strings per profile, and per profile a Chrome block (lint at stills, one scene and one caption line at a time, one lit word after a jump back, the profile's own check) |
| `tests/helpers/chrome-folder.mjs` | `chromeFolder(t)` (a temp folder with GSAP, three.js and sample assets and clips for every page written into it), `hasChrome` |
| `tests/review-sheet.test.mjs` | Pacing maths (wps, head, tail, silence, flags incl. "same layout", clip sound), sheet and cut sheet frame times, tile size, aligned CLI table, review link allowlist; live server: review data, the three review files only, traversal refused; real prepare writes `review/sheet.jpg` (label column + 3 tiles per row), `review/cuts.jpg` (8 tiles per row, one row per cut) and `pacing.json`, old review files cleared |
| `tests/notes.test.mjs` | Pinned notes: scene from timing, time order, numbers never reused, bad notes refused, the Director's `notes` (none for a queued job) and `layoutRule`; live server: add, list, delete; the review link reaches none of the routes |
| `tests/film-budget.test.mjs` | Sequence `targetDuration` validation (target edit keeps the render), draft sequences (unrendered parts saved, render refused naming them), `sequenceBudget` maths against `sequencePlan` (fade and cut, render / storyboard / brief lengths, missing job), template change: `script.prev.json`, dirty from 3, source kept, earlier step kept, refused while busy, part not ready in its sequence |
| `tests/loudness.test.mjs` | Loudness match: voiced spans, measure chain, ebur128 summary parsing, gain maths (tolerance, clamp, peak headroom, no-voice median, one clip), no measurement when off, unchanged `footageArgs` without a gain; real ffmpeg: a +10 dB clip lands within 1 dB of the voice-over in footage.wav |
| `tests/voice-take.test.mjs` | Recorded voice: alignment (exact read, slip, missing scene → error naming it, numbers written differently, repeated phrase, count-in and extra line), threshold from config, cut planning (widen, narrow, midpoint), voiced frames, take gain, brief `voiceTake` validation and prepare-only edit; real Whisper + Kokoro: a 3-scene prepare from a generated take, then the take without its middle line fails naming that scene |
| `tests/sfx.test.mjs` | Cut sounds: brand `sfx` validation, placement (whoosh peak / riser end on the cut, hit and click start on it, none on the first scene, scene override, head trim), scene `sfx` enum, sfx.wav graph, final mix args unchanged without sfx and with sfx after the duck, music bed inputs and join sounds; real ffmpeg: library levels and whoosh peak; real render: a hit at both cuts of a 3-scene job, silence at the start |
| `tests/evidence.test.mjs` | Evidence: a temporary git repo and its clone (first release in natural order from remote and local branches, PR title and merge date, OP-2 not OP-20, no release, not found, grep, since/until, commit cap), alias-only repos and `--repo-path`, ticket/grep/date validation, ref parsing, titles; CSV parsing (comments, quotes, several tables, `;`), column guesses, numbers, dates, range labels, growth, sums and fact lines, groups, partial rows, errors, file checks |
| `tests/server-evidence.test.mjs` | Evidence routes on a live server: none on the review link, aliases only, no `X-Studio` 403, unknown alias and bad ticket 400 before any child, `.csv` only (415), 5 MB cap (413), columns and computed lines |
| `tests/timing-tight.test.mjs` | Cinematic `tight` gaps (0.15 s / 0.4 s, last scene holds), standard timing unchanged, pace minimums, beat snap after |

## Claude Code integration

| Path | Purpose |
|---|---|
| `.claude/skills/studio/SKILL.md` | The `/studio run` director |
| `CLAUDE.md` | Project rules loaded every turn |
