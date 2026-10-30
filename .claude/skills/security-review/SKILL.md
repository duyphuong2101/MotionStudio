---
name: security-review
description: Security-focused code review for Motion Studio — the localhost-only server, path and HTML safety, child processes, secrets, and the rule that no code path invokes Claude or a model, except the four person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key), `server/generate.mjs` (Gemini assets with the person's own key), `server/voice-cloud.mjs` (ElevenLabs voice lines with the person's own key) and `server/assistant-model.mjs` (the Assistant panel's intent pick: with `assistant.freeform` on and a model picked, one request to a connected API provider's model (never the Claude seat) with the person's own key for a line the parser does not know; the model names an intent, the person still approves the card). Use when reviewing server routes, engine changes, templates, uploads, or any new feature.
agent: Explore
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*)
---

# Security review

Motion Studio is a local tool on a company Claude seat. The two worst outcomes are (1) a code path that lets someone other than the person at the keyboard drive Claude or the machine, and (2) a path, HTML or process injection from a brief, brand file or upload.

## Checklist (run on every review)

### Claude / account boundary (Floor)
- [ ] No code in `server/`, `ui/`, `engine/` or a template calls Claude, the Anthropic API or any model, spawns `claude`, or reads the CLI token, except the four person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key), `server/generate.mjs` (Gemini assets with the person's own key), `server/voice-cloud.mjs` (ElevenLabs voice lines with the person's own key) and `server/assistant-model.mjs` (the Assistant panel's intent pick: with `assistant.freeform` on and a model picked, one request to a connected API provider's model (never the Claude seat) with the person's own key for a line the parser does not know; the model names an intent, the person still approves the card). Run Director has two Director backends, chosen once per click. The seat backend spawns native `claude.exe -p` — check it keeps the allowlist (no render/approve, no plain Bash/Edit/Write), `--permission-prompts none`, `--max-turns`, timeout, capped log, one run at a time, usage-limit pause, no bypass flags, and a child environment without any `keyEnv` variable (`directorEnv`).
- [ ] The API worker: `server/worker/` is reached only from `startDirector`; project and job bound at loop start; tools write only the draft files (source, script or outline); `fetch_page` runs `urlCheck` on every hop; the key is a header only; `maxCallsPerDay`, `maxTurnsPerJob`, `maxTokensPerJob`, timeouts, byte caps, pause on 429, no retry, no backend switch mid-run; `directorEnv` still strips every `keyEnv` from the seat child and from engine children.
- [ ] `server/generate.mjs` keeps: key from `process.env[keyEnv]` only, header not URL, host fixed, one at a time, day and month caps, timeout, body caps, pause on 429, `saveAsset`, sidecar, model ids only from the fetched list or the fallback, no caller but the routes.
- [ ] `server/voice-cloud.mjs` keeps: key from `process.env[voiceCloud.keyEnv]` only, `xi-api-key` header (never URL or body), host fixed (`api.elevenlabs.io`), one run at a time, `maxLinesPerRun`, `maxLinesPerDay`, `maxCharsPerDay`, `maxCharsPerLine`, timeout, byte cap, pause on 429 or `quota_exceeded`, no retry, every log line through `redact`, files only under `out/<project>/<job>/cloud-voice/`, no caller but the job routes (never on the review link); `engine/cloudvoice.mjs` and prepare only read the saved take.
- [ ] `server/settings.mjs` keeps: key names from the `keyEnv` list only, the value pattern (no space, quote, `#` or newline), one `NAME=` line rewritten through a temp file and a rename, the answer and every error without the value, a name the real environment sets refused; `/api/settings/*` never on the review link. `server/worker/models.mjs` (Connect) is a model-list GET only, key in a header, capped by `settings`, no retry.
- [ ] `server/assistant-model.mjs` keeps: the key from the picked provider's `keyEnv` only, in the adapter's header (never URL or body), the provider's configured host only, never the seat, refs from `assistant.models` only, one request at a time, `maxAsksPerDay`, timeout, byte cap, pause on 429, no retry, every answer typed by `pickedFrom` and then checked by the same proposal functions a typed line gets; the parser runs first and a slash command never reaches the model; the log and every error redact the key; `/api/assistant/*` never on the review link.
- [ ] No `--bare`, `--dangerously-skip-permissions` or similar flag anywhere.
- [ ] No loop, timer or scheduler that would run the director unattended.
- [ ] A provider in `config/providers.json` keeps its key in an env var (`keyEnv`); no key value in any file except the gitignored root `.env`. Only `server/keys.mjs` reads that file: fixed path `ROOT/.env`, once at server start, `keyEnv` names only, environment wins, names printed but never a value. The engine, `cli.mjs` and the Director never read it, and `directorEnv` still strips those names.

### Server boundary
- [ ] `server.listen` still uses the configured host and the startup check still refuses anything but 127.0.0.1/localhost.
- [ ] The review link (`server/review.mjs`) still binds one private IPv4, needs its access code, and `reviewRoute` allows only GET/HEAD view routes (no write route, no Director run or log, no Generate, no TTS preview).
- [ ] Host check (421) and the non-GET Origin + `X-Studio: 1` check (403) still run before routing.
- [ ] New routes take ids through `assertId`; body size capped (`readBody` / `readRaw` with a limit).
- [ ] Errors to the client are `StudioError` messages; unexpected errors return the generic 500 text, never a stack.
- [ ] A new served file path is matched by `JOB_FILE_RE`, or served with `ASSET_HEADERS` if it is user-uploaded.

### Paths and files
- [ ] Every outside id or file name goes through `assertId` / `assertFileName` and every path through `within()`.
- [ ] Upload names go through `cleanAssetName`; types limited to `ASSET_TYPES`; size limited by `maxBytesFor`.
- [ ] Deletes only inside `profiles/<project>/assets` or `out/<project>/<job>`.

### HTML and script injection
- [ ] Every brief, brand, source or script string in composition HTML goes through `escapeHtml` / `h`.
- [ ] JSON embedded in `<script>` goes through `jsonForScript`.
- [ ] Brand CSS values pass `checkBrand` (hex colours, plain font names, `googleFonts` charset).
- [ ] UI HTML built from data goes through `esc()`.

### Child processes
- [ ] `spawn` with an argument array, `shell:false`, `windowsHide:true`. No string commands, no `exec`.
- [ ] Every process has a timeout and a capped log; concurrency limited (`engine.maxConcurrentRuns`).
- [ ] Arguments built from data are validated first (ids, numbers clamped, file names from `assetPath`).

### Fetching
- [ ] The director fetches only hosts in the brand's `sources.allowedHosts`.
- [ ] The browser used for stills/render loads only the local composition server (`openComposition`), not arbitrary URLs.

### Secrets
- [ ] No secret in a committed file; `.env`, `*.local.*` stay untracked. No script, export, zip, copy or trash path includes or moves `.env`; only `.env.example` (empty values) is tracked.

## Process

1. `git diff` (or the changed files handed to you). Read only the diff and its direct callers.
2. For each checklist group that the diff touches: grep for the pattern, confirm presence or absence.
3. Report findings as **Critical / Warning / Suggestion** with `file:line`, the concrete input that breaks it, and a one-line fix. If nothing is wrong, say so.
