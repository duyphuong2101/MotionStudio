# Motion Studio

Turn a short brief into a finished brand video on your own computer.

You write a brief in a local web page. Claude Code (the Director, running on your own seat) reads it and writes the facts and the script. A template then draws every frame in a browser page, and you review a storyboard with the voice-over before anything is rendered. Once you approve it, the tool renders an MP4 with captions.

Nothing leaves your machine except the Director's own Claude Code session. The web page only listens on `127.0.0.1`. To let people on the same network watch storyboards and renders, start it with `npm run ui:review` and send them the printed link: it is read-only and its code changes every start.

## What you need

- Node.js 20+ and Google Chrome. ffmpeg ships with the npm packages. The tool is built and used on Windows.
- Claude Code, signed in with your own seat. On Windows you need the native `claude.exe` (`claude install`), not the `claude.cmd` shim.
- A voice is optional: see [Voice](#voice). Without one, timing is estimated from word count and the video has music only.

## Start

```bash
npm install
npm run ui
```

Open http://127.0.0.1:4780. If the port is busy, Motion Studio is probably running already in another terminal. Close that terminal or change `server.port` in `config/studio.json`.

After you update the code, restart `npm run ui`. The page reloads its own files, but the server only reads its code once at start.

## Make a video

1. Pick a project. One project per brand. Use **+ New project**, then set the logo, colors, fonts, voice and music on the **Brand** tab.
2. Write a brief. Click **+ New brief** (or **Use this template** on the Templates tab). Pick a template, platform, format and length. Write the key message, and either a reference page or a few facts. The Director puts a claim on screen only if it comes from that page or those facts.
   - **Also make** renders the same script at up to 3 more sizes, e.g. a 9:16 cut of a 16:9 video.
   - **Language** and **Voice** override the brand's voice for this one video.
   - **Cut scenes on the music beat** stretches each scene a little so it ends on a beat of the brand's music.
   - **Motion blur on fast moves** renders about 4 times slower; the storyboard does not change.
3. Run the Director. Click **Save and run Director**, or **Run Director** on the job. You can also type `/studio run` in Claude Code in this folder. The Director writes `source.json` (the facts) and `script.json` (the scenes), then builds the storyboard.
4. Review. On the job's **Preview** tab, press Play. The composition plays with the voice-over, so you hear what you will get. Click a still to jump to that scene, or **Edit in Script** to change it.
5. Edit if needed.
   - Script tab: change a scene's text, order, pace or image. Click a scene's thumbnail to see it in Preview. To ask for a new scene in words, use **Draft for Director**.
   - Source tab: change the facts. This sends the job back to the Director.
   - Fields you edit are locked, so the Director never overwrites them.
6. Approve, then render. The MP4 (one per size) and an `.srt` caption file appear under **Download** when the render is done. A QA line under the banner says whether loudness, length, black or frozen picture and captions look right; open it for the details. **Download HTML video** gives one file that plays in any browser with no server.

To join finished videos into one MP4 (say a logo sting, a demo and a testimonial), switch the job list to **Sequences** and click **+ New sequence**. Every part must be a rendered job in the same format.

To clean up, **Delete…** on a job moves its brief and output to `trash/`. Delete a whole project from the bottom of the Brand tab.

## Templates

All 17 are built in. Mixable templates can lend their scenes to another lead template in one video (tick them under "Mix in scenes from").

| Template | Formats | Length | Mixable |
|---|---|---|---|
| App walkthrough | 16:9 | 20-120 s | |
| Audiogram / podcast clip (waveform from the real sound) | 1:1, 9:16, 16:9, 4:5 | 6-180 s | |
| Before / after | all six | 10-60 s | |
| Code story (code, diffs, changed files, terminal, checklists) | 16:9, 1:1, 9:16, 4:5 | 10-120 s | yes |
| Data story (incl. bar chart race and warming stripes) | all six | 10-120 s | yes |
| Event / webinar | all six | 8-60 s | yes |
| Explainer (steps, diagrams, footage in a window) | all six | 15-150 s | yes |
| Feature launch | 16:9 | 15-60 s | yes |
| Lifestyle slideshow | all six | 8-60 s | |
| Logo reveal / sting | all six | 3-10 s | |
| Lower third / overlay (renders a .mov with transparency) | 16:9, 9:16, 1:1, 4:5 | 3-30 s | |
| Product demo | 9:16 | 10-40 s | |
| Promo / sale | 9:16, 1:1, 4:5, 2:3 | 6-40 s | |
| Social teaser | 9:16 | 6-15 s | |
| Talking head / UGC | all six | 6-180 s | |
| Testimonial | all six | 10-60 s | yes |
| UI story | 16:9 | 20-180 s | yes |

"All six" means 16:9, 1:1, 9:16, 4:5, 2:3 and 21:9. The Templates tab shows what each one draws.

## Voice

Pick the engine on the Brand tab, under Voice-over. **▶ Preview voice** plays a sample.

- Kokoro (natural, offline, US and UK English) needs model files in `models/kokoro/`:
  - `kokoro-v1.0.onnx`
  - `config.json`
  - `voices/<voice>.bin`, one file per voice

  The folder is not shared through the repo. Copy it from a teammate's machine. The model comes from the kokoro-onnx release (Apache-2.0).
- Windows voices use the speech voices installed in Windows. They give exact word timing for captions, and they are how you get other languages: add a voice in Windows Settings → Time & language → Speech, then pick it as the brief's **Voice**. Kokoro's other-language voices need a phonemizer this setup does not have, so they are greyed out.
- No voice-over gives a music-only video. Timing is then estimated from word count.

Background music: pick a built-in track, or upload an `.mp3`/`.wav` under Brand → Assets.

## Speech to text

On the Brand tab, a video or sound asset has a **Transcribe** button. It runs Whisper on this computer (no upload, no API) and keeps the transcript with the asset; **Transcript** shows it with times. The Director reads transcripts to set clip in/out points and copy what is said word for word. A footage clip (Talking head, Audiogram) whose text is left empty is captioned from speech recognition at prepare, with real word timing, and the storyboard asks you to read those captions before you approve.

It needs `models/whisper/`: `encoder.int8.onnx`, `decoder.int8.onnx` and `tokens.txt` from `sherpa-onnx-whisper-base.tar.bz2` in the [sherpa-onnx `asr-models` release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) (Whisper weights MIT, export by k2-fsa). The folder is not shared through the repo. `test_wavs/` from the same archive (LibriSpeech, CC BY 4.0) lets `npm test` check the model; without the folder those tests skip. Whisper base can mishear names and numbers, and transcripts are capped at 40 minutes per file.

## Rules for the Director

The Claude seat is company-owned, so the Director is kept on a short leash:

- It runs only when a person starts it: a Run Director button, or `/studio run` typed in Claude Code. Nothing runs it on a timer or on save.
- It is the native `claude.exe` on your own login. No token is read and no API key is added. It gets a fixed list of tools (`config/studio.json` → `director`).
- Caps: one run at a time, at most 5 jobs per run, 20 runs per day and 15 minutes per job.
- It never renders and never approves. A person does both.
- If Claude reports a usage limit, runs pause (60 minutes by default). **Clear pause** on the Jobs tab lifts it.
- It may only read pages on hosts listed in the brand's allowed hosts (Brand → Sources and tone → Allowed data hosts).

Do not expose the UI to the network, and do not add flags that skip permissions. `CLAUDE.md` has the full list.

## Folders

| Folder | What is in it |
|---|---|
| `profiles/<project>/` | `brand.json`, `voice.md` (tone of voice), `assets/` (logos, images, clips, music), `icons.json`, `transcripts/` |
| `briefs/<project>/<job>.json` | The brief the UI wrote |
| `out/<project>/<job>/` | Everything a job makes: `source.json`, `script.json`, `timing.json`, `voice.wav`, `index.html`, `stills/`, `final.mp4`, `captions.srt` |
| `sequences/<project>/<id>.json` | A sequence; its video lands in `out/<project>/<id>/` |
| `trash/` | Deleted projects, jobs and sequences. Move a folder back to restore it; delete it to free the space |
| `templates/<id>/` | `beats.json` (the rules the Director follows) and `template.mjs` (the renderer) |
| `engine/`, `server/`, `ui/` | Pipeline and CLI, local web server, web page |
| `config/studio.json` | Port, Director caps, render quality, timing |
| `captures/<project>/` | Optional scripts that screenshot an app with demo data for walkthrough videos |

`out/`, `trash/`, `models/` (Kokoro voice, Whisper speech-to-text) and `library/music/` are not shared through the repo.

## Command line

The UI covers everything. The CLI is for scripting and for the Director:

```bash
node engine/cli.mjs help                         # all commands
node engine/cli.mjs list --queued                # jobs waiting for the Director
node engine/cli.mjs fail <project> <job> --reason "<text>"  # the Director stops a job before review (status error)
node engine/cli.mjs prepare <project> <job>      # rebuild timing, page and stills (steps 5-7)
node engine/cli.mjs render <project> <job>       # render an approved job
node engine/cli.mjs status <project> <job>
node engine/cli.mjs qa <project> <job>           # check a finished MP4 again
node engine/cli.mjs transcribe <project> <asset> # speech to text for a video or sound asset
```

## Troubleshooting

- "Claude Code was not found" or "Only a claude.cmd shim was found": install the native build (`claude install`), or set `director.claudePath` in `config/studio.json` to the full path of `claude.exe`.
- A tab looks broken after an update: the server is still running old code. Restart `npm run ui`.
- Kokoro shows "unavailable": a file is missing from `models/kokoro/`. The message names it.
- Render fails to start Chrome: install Google Chrome, or change `engine.chromeChannel` in `config/studio.json`.
- A job is stuck in error: read the message in its banner and the **History** tab. Then run the Director again, or fix the script and click **Re-run from step 5**.

## For developers

```bash
npm test          # node --test, about 20 seconds (two tests drive Chrome; they skip without it)
```

How the pieces fit is in `.ai/docs/architecture.md`, and the coding rules are in `.ai/docs/conventions.md`. The AI tooling kit's own installer notes moved to `.ai/ai-config-kit.md`.
