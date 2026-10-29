# Motion Studio — Conventions

Single source of truth for coding rules. The NEVER/ALWAYS blocks below are mirrored by
`node .claude/scripts/generate-mirrors.js` into `.cursor/rules/project.mdc`,
`.claude/skills/project-conventions/SKILL.md`, `AGENTS.md` and `.github/copilot-instructions.md`.
Edit here, then regenerate. Never hand-edit the generated blocks.

## Stack at a glance

- Node 22.23.4+ / 24.22.1+ / 26.12.1+ (security-patched lines, `engine/runtime.mjs`), ES modules (`"type": "module"`, `.mjs`), no framework, no build step, no TypeScript.
- Server: `node:http` in `server/server.mjs`, bound to 127.0.0.1:4780. Opt-in read-only review link on a private LAN address (`npm run ui:review`, port 4781).
- UI: one static page (`ui/index.html`, `ui/app.js`, `ui/app.css`), vanilla JS, no bundler.
- Rendering: `playwright-core` drives installed Chrome; `ffmpeg-static` encodes. GSAP 3 animates compositions.
- Voice: Kokoro (ONNX, local) or Windows SAPI via PowerShell. No cloud TTS.
- Tests: `node:test` + `node:assert/strict` in `tests/*.test.mjs`. `npm test` runs them all through `tests/run.mjs` (one process per file, slowest first, at most 4 Chrome-heavy files at once, times kept in `out/_test-times.json`); `npm run test:changed` runs only the files the working-tree changes can affect (`tests/impact.mjs`); `node tests/run.mjs <file...>` runs what those files affect.

## Naming

- Files: lower-case kebab or single word, `.mjs` for ESM (`engine/pipeline.mjs`). The one CommonJS script is `captures/<project>/capture.cjs`.
- Functions and variables: camelCase. Constants and lookup tables: UPPER_SNAKE (`STEPS`, `MAX_ASSET_BYTES`).
- Ids (project, job, template, scene): `^[a-z0-9][a-z0-9-]*$` (`ID_RE` in `engine/core.mjs`). Scene ids max 32 chars.
- Template folder name = template id = `beats.json` → `id`.
- Job statuses come only from `STATUSES` in `engine/jobs.mjs`. Steps come only from `STEPS`.

## Gotchas

- `within(base, ...parts)` is the only safe path join for anything derived from input. `path.join` on an id is a traversal bug.
- `writeJson` writes a temp file then renames: use it for every state file so a crash never leaves half a JSON.
- A human edit in the UI adds `locks`. `mergeRespectingLocks` keeps them on the next director commit; never bypass it.
- `prepare` deletes `video.mp4`, `final.mp4`, `voice.wav`, `footage.wav`: a new storyboard makes an old render stale.
- A template that `extends` another reuses that template's `template.mjs`; only `beats.json` differs.
- `geometry()` layout flags: 4:5 is `square` (it has the 1:1 width and more height), 2:3 is `port` + `short` (shrink stacked visuals), 21:9 is `land` and `padX(n)` adds a gutter that keeps content in a centred 16:9 area.
- `.claude/hooks`, `.claude/scripts` and `.ai/scripts` carry their own `package.json` with `"type": "commonjs"` because the root is ESM.
- A mixed brief's script keeps lead kinds bare and namespaces extra kinds as `<template>.<kind>`; their limits and enums come from `sources[<template>]` in the composed rules (`loadBriefTemplate`), never from the lead's `limits`.
- A brief's `mix`, like its `template`, is fixed once `script.json` exists (`updateBrief` answers 409): duplicate the brief to change it.
- A brief whose `url` host is not in the brand's `sources.allowedHosts` is refused when it is saved or edited (`saveBrief` / `updateBrief`), never when it is read. An empty host list follows `site` on every brand save (`validateBrand`); a list the person typed stays.
- The Director never edits `status.json`: a job it cannot do goes to `error` through `cli fail --reason` (only from `queued`, `scripting`, `scripted`, `dirty`). The person recovers with Run Director again on the error banner.

## NEVER Do

- NEVER use `Math.random`, `Date.now`, `setTimeout` or `setInterval` to drive what a template shows → everything visible is a function of `seek(t)`
- NEVER invent a claim in a script → every on-screen claim traces to `source.json` bullets/facts via `source`
- NEVER let the director run `render`, `approve` or `sequence` → a person approves and renders in the UI. Approval is UI-only: `node engine/cli.mjs approve` refuses for everyone, and render needs that approval. Every agent asks the person before `render`, `approve` or `sequence` however it is started, and Claude Code also before inline `node -e`: Claude Code (`.claude/settings.json` ask rules, `.claude/hooks/block-destructive.js`), Copilot (`.vscode/settings.json`) and Cursor (`.cursor/hooks/ask-before-render.js`)
- NEVER add an npm dependency or a framework for something Node's standard library does
- NEVER show non-English text in product chrome (UI labels, server errors, CLI output, template chrome) → video copy follows `brand.voice.lang`
**Security (NEVER — the Floor; never override, ask the user instead):**
- NEVER invoke Claude or any model from `server/`, the UI, the engine, a cron or a loop → one exception: `server/director.mjs`. A person clicks Run Director and the local server runs one of two Director backends, chosen once at click time and shown in the log: the Claude seat (Claude Code headless, `claude.exe -p "/studio run …"`, never a `.cmd` through a shell, on that person's own logged-in seat, with the `--allowedTools` allowlist in `config/studio.json` → `director` (never render or approve), `--permission-mode dontAsk`, `--max-turns`, a key-free child environment) or the API worker (`server/worker/`, only when `config/providers.json` → `default` names a provider whose `keyEnv` is set: a tool-calling loop over that provider's HTTP API with Node `fetch`, the key in a request header only, tools bound to one project and job that write only the draft files (source, script or outline), `fetch_page` on the brand's allowed hosts only, caps in `director.api`: turns, tokens, calls per day, timeouts, byte caps, `maxPrepareRounds`, `maxFetchesPerJob`, a pause file per provider on 429, no retry, no backend switch during a run). Both share a timeout of `jobTimeoutMinutes` × jobs, a capped log, one run at a time, a daily cap (`maxRunsPerDay`), and never render or approve. The second exception is `server/generate.mjs`: a person clicks Generate (or Refresh models) in the Brand tab; the local server makes one request to `generativelanguage.googleapis.com` with Node `fetch` and the person's own `GEMINI_API_KEY` (read from the environment variable named by `keyEnv`, never written, logged or sent to the UI, stripped from the Director child's environment together with every other `keyEnv`), capped by `config/studio.json` → `generate` (one request at a time, `maxImagesPerDay`, `maxImagesPerMonth`, `maxVideosPerDay`, `maxVideosPerMonth`, `maxRefreshesPerDay`, a timeout, response and download byte caps, a poll limit, a pause on 429), with model ids only from the list the person fetched or the first-run fallback, and saves one asset with `saveAsset` plus a `generated/<asset>.json` sidecar. `engine/`, `engine/cli.mjs`, prepare, render and the Director have no path to it. The third exception is `server/voice-cloud.mjs` (user decision 2026-10-29): a person clicks Make cloud voice in a job's Script tab; the local server sends each missing voice line once to `api.elevenlabs.io` (`with-timestamps`) with Node `fetch` and the person's own key (the variable named by `config/studio.json` → `voiceCloud.keyEnv`, header only, redacted from every log), capped by `voiceCloud` (one run at a time, `maxLinesPerRun`, `maxLinesPerDay`, `maxCharsPerDay`, `maxCharsPerLine`, a timeout, a byte cap, a pause on 429 or a spent quota), and saves the audio and word times in `out/<project>/<job>/cloud-voice/`; prepare only reads them (`engine/cloudvoice.mjs`) and the Director has no path to it. No other call site, no auto-start, no retries
- NEVER reuse or extract the Claude Code CLI OAuth token, or proxy/share seat access → company seat; one abuse pattern cuts off the whole team
- NEVER use `--bare`, `--dangerously-skip-permissions` or any flag that disables auth or permission checks
- NEVER bind the UI server to anything but 127.0.0.1 or relax the Host / Origin / `X-Studio` checks → it is a local tool. One exception: the read-only review link (`npm run ui:review`, `server/review.mjs`), started by the person, bound to one private IPv4 of the machine (never 0.0.0.0), GET/HEAD only on a fixed allowlist (the normal UI flagged read-only, and the reads it needs), behind a random access code per start; it never runs the Director, Generate or TTS, never shows the Director log, and has no approve, render or any write
- NEVER put an API key or secret in a file → keys live in environment variables named by `keyEnv` in `config/providers.json`. One exception: the gitignored `.env` at the repo root, read by `server/keys.mjs` once at server start for the `keyEnv` names only (the environment wins; no value is logged, returned or stored); never commit, copy, zip, print or read it any other way (the secret-file hooks stay)
- NEVER dump a secret file (`.env`, `*.local.md`, `*.local.json`, `*.pem`, `*.key`) with `cat`/`head`/`cp` → use the Read tool for the one value you need
- NEVER commit or share a file holding a key, token or password → stage explicit paths, never `git add -A`
- NEVER `spawn` with `shell: true` or a command string → `spawn(cmd, [args], { shell: false, windowsHide: true })` only
- NEVER start a child process without a timeout and a capped log → see `runEngine` in `server/server.mjs` and `config/studio.json` → `engine`
- NEVER build a path from an outside id or file name with `path.join` → `assertId` / `assertFileName` + `within()`
- NEVER write brief, brand or script text into composition HTML unescaped → `escapeHtml`; JSON into `<script>` → `jsonForScript`
- NEVER fetch a brief URL whose host is not in the brand's `sources.allowedHosts`

## ALWAYS Do

- ALWAYS throw `StudioError(message, httpCode)` for expected failures → the server maps it to a JSON `{ error }` with that code
- ALWAYS write state with `writeJson` (atomic temp + rename) and read with `readJson(file, fallback)`
- ALWAYS change job state through `setStatus` so `history` records who did what
- ALWAYS validate input at the boundary: `validateBrief`, `validateBrand`, `validateSource`, `validateScript`
- ALWAYS keep director runs and asset generation capped by `config/studio.json` → `director` (max jobs per run, minutes per job, runs per day) and `director.api` (turns and tokens per job, calls per day, timeouts, bytes, prepare rounds, page fetches per job) and `generate` (requests per day and per month: `maxImagesPerDay`, `maxImagesPerMonth`, `maxVideosPerDay`, `maxVideosPerMonth`, `maxRefreshesPerDay`; timeout, bytes)
- ALWAYS add or update a `tests/*.test.mjs` case when you change engine validation, locks, timing or a template contract
- ALWAYS run the tests a change can affect while you work (`npm run test:changed`: `tests/run.mjs` picks them from the changed functions and their callers, `--list` shows why), and the full `npm test` before calling a change done or committing
- ALWAYS describe a new template with `beats.json` (sequence, fields, limits, enums, defaults) and test it through `tests/templates.test.mjs`
- ALWAYS draw template sizes in units of a 1080 short side via `geometry(size).px()` (side padding via `padX()`) so every format (16:9, 1:1, 9:16, 4:5, 2:3, 21:9) shares one layout
- ALWAYS mark text that must fit the safe area with `data-lint` so `lintInPage` checks it
- ALWAYS keep user-facing strings short, plain English and specific about the fix ("Approve the storyboard first")
- ALWAYS log an AI-typed error you caught (hallucinated API, confident-but-wrong, convention violation) with `node .claude/scripts/append-ai-failure.js`
