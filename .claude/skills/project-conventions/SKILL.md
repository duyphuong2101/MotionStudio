---
name: project-conventions
description: Code style, naming conventions, and architectural patterns for Motion Studio. Apply when writing or modifying code (implementing, scaffolding, refactoring) — not for read-only review.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

## Motion Studio — Source of Truth

**Always read `.ai/docs/conventions.md` for full rules.** This skill is a quick summary. Patterns with real excerpts: `.ai/docs/common-patterns.md`.

## Safety Tiers

**Floor** (never override, ask the user instead): the Claude/seat rules, the localhost-only server, secrets, child-process caps, path and HTML safety. **Guardrails** (can be consciously overridden with a documented reason): everything else below.

## NEVER Do
<!-- BEGIN:NEVER (generated from conventions.md — do not edit) -->
- NEVER use `Math.random`, `Date.now`, `setTimeout` or `setInterval` to drive what a template shows → everything visible is a function of `seek(t)`
- NEVER invent a claim in a script → every on-screen claim traces to `source.json` bullets/facts via `source`
- NEVER let the director run `render`, `approve` or `sequence` → a person approves and renders in the UI. Approval is UI-only: `node engine/cli.mjs approve` refuses for everyone, and render needs that approval, so no coding agent (named or not) can pass the review from a shell. Copilot (`.vscode/settings.json`) and Cursor (`.cursor/hooks/ask-before-render.js`) also ask before `render` or `sequence`
- NEVER add an npm dependency or a framework for something Node's standard library does
- NEVER show non-English text in product chrome (UI labels, server errors, CLI output, template chrome) → video copy follows `brand.voice.lang`
**Security (NEVER — the Floor; never override, ask the user instead):**
- NEVER invoke Claude or any model from `server/`, the UI, the engine, a cron or a loop → one exception: `server/director.mjs`. A person clicks Run Director and the local server runs one of two Director backends, chosen once at click time and shown in the log: the Claude seat (Claude Code headless, `claude.exe -p "/studio run …"`, never a `.cmd` through a shell, on that person's own logged-in seat, with the `--allowedTools` allowlist in `config/studio.json` → `director` (never render or approve), `--permission-mode dontAsk`, `--max-turns`, a key-free child environment) or the API worker (`server/worker/`, only when `config/providers.json` → `default` names a provider whose `keyEnv` is set: a tool-calling loop over that provider's HTTP API with Node `fetch`, the key in a request header only, tools bound to one project and job that write only the draft files (source, script or outline), `fetch_page` on the brand's allowed hosts only, caps in `director.api`: turns, tokens, calls per day, timeouts, byte caps, `maxPrepareRounds`, `maxFetchesPerJob`, a pause file per provider on 429, no retry, no backend switch during a run). Both share a timeout of `jobTimeoutMinutes` × jobs, a capped log, one run at a time, a daily cap (`maxRunsPerDay`), and never render or approve. The second exception is `server/generate.mjs`: a person clicks Generate (or Refresh models) in the Brand tab; the local server makes one request to `generativelanguage.googleapis.com` with Node `fetch` and the person's own `GEMINI_API_KEY` (read from the environment variable named by `keyEnv`, never written, logged or sent to the UI, stripped from the Director child's environment together with every other `keyEnv`), capped by `config/studio.json` → `generate` (one request at a time, `maxImagesPerDay`, `maxImagesPerMonth`, `maxVideosPerDay`, `maxVideosPerMonth`, `maxRefreshesPerDay`, a timeout, response and download byte caps, a poll limit, a pause on 429), with model ids only from the list the person fetched or the first-run fallback, and saves one asset with `saveAsset` plus a `generated/<asset>.json` sidecar. `engine/`, `engine/cli.mjs`, prepare, render and the Director have no path to it. No other call site, no auto-start, no retries
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
<!-- END:NEVER -->

## ALWAYS Do
<!-- BEGIN:ALWAYS (generated from conventions.md — do not edit) -->
- ALWAYS throw `StudioError(message, httpCode)` for expected failures → the server maps it to a JSON `{ error }` with that code
- ALWAYS write state with `writeJson` (atomic temp + rename) and read with `readJson(file, fallback)`
- ALWAYS change job state through `setStatus` so `history` records who did what
- ALWAYS validate input at the boundary: `validateBrief`, `validateBrand`, `validateSource`, `validateScript`
- ALWAYS keep director runs and asset generation capped by `config/studio.json` → `director` (max jobs per run, minutes per job, runs per day) and `director.api` (turns and tokens per job, calls per day, timeouts, bytes, prepare rounds, page fetches per job) and `generate` (requests per day and per month: `maxImagesPerDay`, `maxImagesPerMonth`, `maxVideosPerDay`, `maxVideosPerMonth`, `maxRefreshesPerDay`; timeout, bytes)
- ALWAYS add or update a `tests/*.test.mjs` case when you change engine validation, locks, timing or a template contract
- ALWAYS run `npm test` before calling a change done
- ALWAYS describe a new template with `beats.json` (sequence, fields, limits, enums, defaults) and test it through `tests/templates.test.mjs`
- ALWAYS draw template sizes in units of a 1080 short side via `geometry(size).px()` (side padding via `padX()`) so every format (16:9, 1:1, 9:16, 4:5, 2:3, 21:9) shares one layout
- ALWAYS mark text that must fit the safe area with `data-lint` so `lintInPage` checks it
- ALWAYS keep user-facing strings short, plain English and specific about the fix ("Approve the storyboard first")
- ALWAYS log an AI-typed error you caught (hallucinated API, confident-but-wrong, convention violation) with `node .claude/scripts/append-ai-failure.js`
<!-- END:ALWAYS -->

## Reuse before writing

| Need | Use |
|---|---|
| Validate an id / file name | `assertId`, `assertFileName` (`engine/core.mjs`) |
| Build a path from input | `within(base, ...parts)` |
| Read / write state | `readJson(file, fallback)`, `writeJson(file, data)` |
| Expected error | `StudioError(message, httpCode)` |
| Escape for HTML / `<script>` | `escapeHtml` (`h` in templates), `jsonForScript` |
| Change job status | `setStatus(project, id, patch, event, by)` |
| Respect human edits | `humanEdit`, `mergeRespectingLocks` |
| Template page shell, sizes | `page`, `geometry().px` (`templates/kit.mjs`) |
| Logo, palette | `logoHtml`, `paletteCss` (`templates/shared.mjs`) |
| Icons | `ICONS`, `ICON_NAMES` (`motion-kit/icons.mjs`) |
| ffmpeg, headless Chrome, lint | `ffmpeg`, `openComposition`, `lintInPage` (`engine/media.mjs`) |

## Extensibility without regressions

- Shared code (`core.mjs`, `jobs.mjs`, `kit.mjs`, `shared.mjs`) changes additively: a new optional parameter or field whose default keeps today's output.
- A `beats.json` rule and its renderer change together; a validator and the UI editor change together.
- Existing tests pass unedited. A test that must change is a finding to report, not a silent edit.

## Code Quality (in the same change, not a later cleanup)

- Standard library before hand-rolling or adding a dependency.
- No dead code: no export without a real consumer; remove what the change made unused.
- A literal used 2+ times becomes a named constant; caps live in `config/studio.json`.
- Simplify after green: re-read the diff for a shorter form and stale comments.
- Comments: default none. One short line where the WHY is not obvious.

## Naming

| Thing | Style | Example |
|---|---|---|
| Files | lower-case, `.mjs` | `engine/pipeline.mjs` |
| Functions, variables | camelCase | `mergeRespectingLocks` |
| Constants, tables | UPPER_SNAKE | `MAX_ASSET_BYTES`, `STEPS` |
| Ids (project, job, template, scene) | `a-z0-9-` | `megamax-9x16` |
| Template DOM ids | `g-<scene>`, `<scene>-<part>` | `g-hero`, `hero-btn` |

## Prose Voice (plan files, commit bodies, docs)

Source of truth: `.claude/output-styles/motion-studio.md` § "Prose voice". Short sentences, no filler, take a position and cite a real file or number. Check with `node .ai/scripts/prose-audit.js <file>`.

## Scope of a Change

The request sets the scope. Implement every behaviour asked for, completely. A pre-existing problem the task does not mention is a follow-up you report.

## Editing Files (token cost)

Prefer a targeted edit over rewriting a whole file.

## Update Propagation

A new or changed rule goes into `.ai/docs/conventions.md` first, then `node .claude/scripts/generate-mirrors.js`, then the affected agents and skills, then `node .claude/scripts/check-propagation.js`. Details: `.ai/docs/kit-process.md` → "Mandatory Update Propagation".
