# scene-script — a person's scene script plus their clips and pictures become a storyboard, and Generate makes the clips

**Status:** approved (user, 2026-10-29: "apply 1-3 in order")
**Author:** main session
**Branch:** master
**Created:** 2026-10-29
**Risk tier:** job state + locks → engine tests; a model call path (`server/generate.mjs`) → security review; UI (brief area, Brand tab Generate) → QA

## Intent

A person writes a short film the way they already do: a text file with `SCENE n — TITLE (a–b seconds)` blocks, a character sheet, and one clip or picture per scene. Today Motion Studio needs the Director to turn that into `script.json`, and it cannot make the clips at all.

Outcome:
1. **Scene import (part A):** the person's script and media become a job with `source.json` and `script.json` and no model call. The person then builds the storyboard, reviews, approves and renders as usual.
2. **Clip generation (part B):** the Brand tab's Generate button makes one clip per click from a prompt plus 1-3 of the brand's pictures as subject references, so one character stays the same person across clips.

The worked example is `C:\Users\phuong.nguyen6\Downloads\video` (HUY-DRILL-001: 45 s, 9:16, 6 scenes, one character). Its clip prompts, written by hand for step 1, are in that folder's `clip-prompts.md`, and its reference crops are in `ref/`.

## Decisions made by the user (2026-10-29)

- Steps 1-3 in order. Step 1 (clips made by hand, prompts and reference crops prepared) is done.
- Generate may make a clip from pictures. This lifts the "no reference images, no image-to-video" exclusion of `.ai/plans/gemini-asset-worker.md` for clips.

## Facts found on 2026-10-29 (ai.google.dev)

- `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview` and `veo-3.1-lite-generate-preview` were shut down on 2026-10-22. Phase 2 of the gemini-asset-worker plan, built on `:predictLongRunning`, is dead as written. `FALLBACK_MODELS.video` in `server/generate.mjs` names a dead model.
- The replacement is `gemini-omni-1.1-flash`. It uses `POST /v1beta/interactions`, the endpoint the image path already calls, with the key in `x-goog-api-key`.
- Input is an `input` array of parts: `{"type":"image","data":"<base64>","mime_type":"image/png"}` and `{"type":"text","text":"…"}`. Subject reference uses several image parts plus the text. `generation_config.video_config.task` is one of `text_to_video`, `image_to_video`, `reference_to_video`, `edit`, `extend`.
- Output options: `response_format: {"type":"video","aspect_ratio":"9:16"|"16:9","resolution":"720p", "delivery":"uri"?}`. Inline output sits at `steps[].content[]` with `type: "video"`, `mime_type: "video/mp4"`, `data`. With `delivery: "uri"` it carries a `uri`, downloaded through `files/{id}:download?alt=media`.
- Not settled by the docs, so they need the spike (B0): base clip length, whether there is a length setting, output size, and the largest number of reference images.
- No free tier. About $0.10 per second at 720p (5,792 tokens per second at $17.50 per 1M output tokens).
- Clips carry SynthID. Pictures of recognisable real people are refused. Huy is a made-up character.

## Part A — scene import

**Input:** the script text (pasted or uploaded as .txt/.md) and the brand assets it names. The format is the one in the example, plus three optional lines the person adds per scene:

```
SCENE 3 — DIAGNOSTIC TEST (10–19 seconds)
CLIP: c3a.mp4 0:00-0:04, c3b.mp4 0:00-0:05
VOICE: Huy đo điện áp pin khi có tải.
ON SCREEN: Voltage drops under load
…free description lines (action, camera) are kept as notes, never shown…
```

- `CLIP:` takes one or more asset names, each with an optional in-out range. Several clips make several scenes that share the scene's title. `IMAGE:` takes one picture, `IMAGES:` 2-4 pictures.
- A scene with no `CLIP` or `IMAGE` is an error that names the scene. A missing asset is an error that names the scene and the file.
- `Optional Vietnamese dialogue:` followed by a quoted line counts as the scene's VOICE. `End card:` followed by a line is the closing card.
- Header lines read: `TITLE`, `DURATION`, `FORMAT` (`Vertical 9:16` → `9:16`). The `(a–b seconds)` span sets the scene length.

**Mapping (engine, deterministic):**
- Template: explainer. Clip scenes map to the `video` kind (`in`, `out`, `hold`), picture scenes to lifestyle `photo` or `gallery` through the mix. The closing card maps to the kind that fits it without a voice line. If none does, the import says which field it needs. The implementer checks this against `templates/*/beats.json` with the template-authoring skill. Changing a template contract is out of scope unless a test proves no other template changes.
- Words are never rewritten: an over-limit field is an error naming the scene, the field and how much to cut, like `engine/quick.mjs`.
- `source.json`: one fact per scene, holding that scene's VOICE and ON SCREEN text, with the source named as the script file. `script.json`: `generated: "scene-script"`, and every field locked as the person's own (`humanEdit`), so a later Director run never overwrites it.
- Scene length follows the span. A clip shorter than its span holds its last frame (`hold`), and a longer one is cut at `out`. A voice line longer than its span is a warning in the pacing review, not an error.
- The job goes to `scripted`. Build storyboard, review, approve and render are unchanged.

**Surfaces:**
- `engine/scenescript.mjs` holds `parseSceneScript(text)` and `sceneScriptToJob(parsed, { project, assets, beats })`. Pure, with no file system access in the parser.
- `node engine/cli.mjs import-script <project> <file> [--job <id>] [--by name]`, a person's tool like `import-remotion`. It is not in the Director's allowlist.
- UI: a **New from script** button beside **New brief** opens a form where the person pastes the text, uploads the media through the existing asset upload, and sees each scene with the asset it found or the error it raised. **Create job** then calls one new route, `POST /api/projects/:p/scene-script` (127.0.0.1 only, the usual Host, Origin and `X-Studio` checks, refused on the review link).

**Tests:**
- The parser on the HUY example text, with the CLIP lines added.
- Each error names its scene.
- Locks hold across a Director run (`mergeRespectingLocks`).
- A two-scene import builds a storyboard with Chrome (gated like the other Chrome tests).

**Built (2026-10-29), and where it differs from the text above:**
- The explainer contract decides three things the script format did not say. Explainer opens on a `title` scene with a required voice line, so the TITLE needs a `VOICE:` line before SCENE 1 and must fit 44 characters (the HUY title is 47: the import says "cut 3"). No closing kind takes a card without a voice line, so `End card:` maps to `cta` and needs its own `VOICE:` and `BUTTON:` lines. No template contract changed.
- `IMAGE:` (one picture) is an error naming the scene: lifestyle `photo` is not mixable, and no mixable kind shows one picture. `IMAGES:` (2-4) maps to `lifestyle.gallery` and needs a VOICE line; the brief then mixes lifestyle.
- A clip scene is a `video` scene with `sound: true`: only a clip that plays its own sound sets its scene's length (prepare's `fixed` lengths, `engine/timing.mjs`). A silent clip's scene follows its voice line (or `minScene`), so its span cannot hold without an engine change (a fixed length for a muted clip); the import warns and sets no `hold`. A clip with sound and no VOICE gets captions from speech recognition, as any such `video` scene does.
- The shown title is ON SCREEN when given, else the SCENE title (`video` requires a title). The VOICE of a scene with several clips goes on its first clip. A voice line longer than its clip is an import warning (prepare grows that scene), not a pacing-review flag.
- The brief's duration is the estimated length (title card and end card included), within the template's range; DURATION only warns when it differs by more than 1 s.
- Locks cover every field of each scene's kind (set or not), the scene order, each kind and the look. A field outside the kind is not locked; the renderer ignores it.

## Part B — clip generation (Omni)

- **B0 is the person's first real click, not a separate script.** No spike script reads the key: the only code that may load `.env` is the UI server through `server/keys.mjs`. B1 is therefore built from the documented shape, unit-tested on mocked answers, and tolerant of both deliveries. Every clip run writes a redacted shape line to the generate log: top-level keys, step and content types, `mime_type`, the byte length, uri or inline, the elapsed seconds, and the probed duration and size. It never writes base64 or the key. After the person's first clip, the main session reads that line, records the facts here, and sets `requestTimeoutSeconds` and `maxVideoSeconds`.
- **Click model (user, 2026-10-29): one click makes one clip.** There is no "Generate all": a batch is a loop calling a model, which the NEVER rules forbid.
- **B3: Generate from the scene form.** In New from script, each scene shows a **Generate clip** button, whether or not it has a CLIP yet.
  - The prompt is the brand's clip brief, then `SCENE:` (the scene title), then `ACTION:` (the scene's description lines, the notes the parser keeps, camera lines included), then the aspect from FORMAT. It is shown in an editable box before the click.
  - The clip brief is the shared character and style block, like `script-2.txt` without its placeholders. It is stored as a brand field, `clipBrief` (text, at most 1,500 characters), with `clipRefs`, the default reference pictures (1-3 brand image names). Both are edited in the Brand tab next to Generate and validated by `validateBrand`.
  - The whole prompt must fit `MAX_PROMPT_CHARS` (2,000). Past that, the box says how much to cut and the click is refused.
  - When the clip lands, the saved asset name (`<job or script id>-<scene id>.mp4`, deduplicated) goes into that scene's CLIP line in the text box. The person then checks the scene and makes the next one. Nothing starts on its own.
- `server/generate.mjs`:
  - `kind: video` goes through `/v1beta/interactions` with `task: reference_to_video` when pictures are picked, `text_to_video` when none are.
  - The pictures are 1-3 brand image assets (`assertFileName` + `within()`), each up to 8 MB, read as base64.
  - Output: `aspect_ratio` from the request, `resolution: 720p`. Inline under `maxResponseBytes`, otherwise `delivery: uri` and a download from the same host only.
  - Saved as `.mp4` through the existing asset path and sidecar, which records the prompt, the model and the reference names.
  - `FALLBACK_MODELS.video` becomes `gemini-omni-1.1-flash`. `filterModels` keeps an id matching `/omni/` as `video`. The `veo-*` handling goes.
- Caps in `config/studio.json` → `generate`, set by the user on 2026-10-29: `maxVideosPerDay` 100, `maxVideosPerMonth` 300, `maxResponseBytes` 100 MB, `maxVideoBytes` 500 MB, `maxVideoSeconds` 600. One run at a time, a pause on 429, no retry.
- Two delivery paths, because a JSON answer is read whole into one string (V8 caps a string near 512 MB):
  - A short clip comes inline when its answer fits `maxResponseBytes`.
  - A longer clip uses `delivery: uri` and is streamed to a temp file with `fetch` + a byte counter, aborted past `maxVideoBytes`, then moved into the assets. Nothing that size ever sits in memory.
  - The user asked for 1024 MB for long clips. That needs `maxVideoBytes` at 1024 MB, which is still open (see the reply of 2026-10-29).
- `maxVideoSeconds` is a ceiling: a clip longer than it is refused after the download. It does not stop the spend: the model bills what it made. When a model takes a length in the request, the UI offers lengths up to this cap.
- UI, Brand tab → Generate:
  - The kind select gains "Clip (Gemini Omni, with sound)".
  - With a clip picked, an aspect select (9:16 / 16:9) and a "Reference pictures" picker (up to 3 of the brand's images, thumbnails) appear.
  - The status line shows clips today and this month.
  - While running: "Making a clip, usually 1-3 minutes…".
- Docs: `CLAUDE.md` (the sentence "Veo clips are phase 2 …", and the NEVER bullet's generate clause), `README.md` (Generate, with prices), `.ai/plans/gemini-asset-worker.md` (phase 2 superseded by this plan).
- Tests: the request builder (URL is exactly `…/v1beta/interactions`, key only in the header, parts in order, `task` set), the response parser (inline, uri, no video → 502, over cap → 413), the reference picker refusing a non-image or a path outside the brand, the caps.

**Built (B1-B4, 2026-10-29), and where it differs from the text above:**
- One call per click asks for the clip inline. A `uri` answer (a `files/<id>` name or a URL on `generativelanguage.googleapis.com`, anything else refused unfetched) streams to `profiles/<p>/generated/<name>.part` under `maxVideoBytes` (`fetchToFile` in `server/http.mjs`), with the key header and no redirect. An inline answer past `maxResponseBytes` stops at 413: the tool never asks again with `delivery: "uri"`, since that would be a second paid call. B0's shape line shows whether that cap needs to move.
- The clip call and its download wait `maxPollMinutes`, not `requestTimeoutSeconds`.
- The part file is probed (`probeMedia`) before it reaches the assets. Past `maxVideoSeconds` it is deleted with a 422, and the paid call still counts. `moveAssetFile` (`engine/assets.mjs`) renames it in with saveAsset's name, type and size checks, capped at `maxVideoBytes` (500 MB) rather than the 400 MB upload cap.
- A request may set `unique: true` to take the first free asset name instead of a 409. The scene form sends `<job id>-scene-<n>.mp4` with it.
- The prompt is composed in the engine (`clipPrompt`, `clipAspect` in `engine/scenescript.mjs`). The script check returns `scenes` (n, title, ids, notes, prompt) and `clip` (aspect, the brand's `clipRefs`, whether a brief is set). A 4:5 or 2:3 format gets a 9:16 clip, and a 1:1 or 21:9 format a 16:9 one.
- A saved clip is added to its scene's `CLIP:` line (`insertClip` in `ui/shots.js`). The line's other clips stay, and a missing line goes under the SCENE line.

## Order

A1 parser, A2 mapper and job writer, A3 CLI, A4 route and UI, A5 tests (done). Then B1 generate.mjs, B2 Brand tab UI with `clipBrief` and `clipRefs`, B3 Generate clip in the scene form, B4 docs and tests, then B0 (the person's first clip) and the cap tuning. `npm test` passes before each part is called done. Commit only when the person asks.

## Part C — prompt-style scripts and the clip reel (user decision 2026-10-30)

The person's own episode scripts (`SCRIPT 1 – LINH.txt`) are Veo-style prompts: a `Cảnh n – Title` line, then `Create an 8-second photorealistic cinematic video, vertical 9:16.` and capital sections (`ACTION:`, `CAMERA:`, `AUDIO:`) with the text on the lines below, `No dialogue. No subtitles.`, no TITLE and no End card. Part A refused them on five counts. Part C reads them as they are and makes a film of clips only.

- Parser (`parseSceneScript`): `Cảnh n`, `Scene n` and `SCENE n` all open a scene; a scene with no `(a–b seconds)` takes its length from an `N-second` phrase in its own lines, laid after the scene before it; a capital label with nothing after the colon inside a scene (`ACTION:`) is a note line of that scene, not a trailing section (a section still starts after the End card, where the HUY example has its rule); with no `FORMAT:` line the first `vertical 9:16`-style phrase in a scene's lines sets the format.
- Reel (`mapSceneScript`): a script with no `TITLE` line and no `End card` maps onto the new `clip-reel` template (`templates/clip-reel/beats.json`, `extends: "explainer"`, 1-12 `video` scenes, 3-150 s, `captions: false`): no title card, no closing card, no lower third unless a scene has `ON SCREEN:`, no subtitles. `IMAGES` in a reel is an error that says how to get an explainer instead (add a TITLE line). The clips' seconds and the Generate flow are Part A and B unchanged.
- Renderer: the explainer draws a reel's clips full frame (`script.template === 'clip-reel'`, the stage video block without the shade when there is no text) and asks the kit for no subtitle band. Prepare skips the heard captions on a `captions: false` template (`sceneVideos`).
- `insertClip` (`ui/shots.js`) finds a `Cảnh n` scene and no longer stops at a bare capital label.
- Golden frames for `clip-reel` in 16:9 and 9:16; the template count in the docs goes to 19.
