# api-director — Run Director on an API provider (second Director backend)

**Status:** T1–T10 done 2026-10-23; T11 (live, paid) and T12 (docs) open
**Author:** tech-lead
**Branch:** none (folder is not a git repo)
**Created:** 2026-10-23
**Risk tier / auto-enabled phases:** calls model providers + secrets + server boundary → security-review skill on every diff; implementer `senior-dev` with `model: "opus"` (user, 2026-10-23: no Fable); shared code (`engine/cli.mjs`, `server/director.mjs`, `server/generate.mjs`, `server/server.mjs`) → engine tests must stay green unedited; new UI controls → browser QA. T11 spends the person's money and is a human-only gate.

## Intent
Run Director gets a second backend. When `config/providers.json` → `default` names an API provider and that provider's key is set, the click runs a tool-calling agent loop over that provider's HTTP API with the person's own key. Otherwise the click runs the Claude Code seat exactly as today. The API worker does everything the seat Director does for every job and template: read the context, claim, write the two drafts, commit, prepare, fix lint (two rounds), look at stills, fail with a reason, fetch the brief URL from the brand's allowed hosts. It never renders or approves.

**For whom / outcome:** the person who builds briefs (today: the user, csr-console first). Outcome: storyboards keep coming when the company seat is paused, busy or a bad fit for the job, paid from the person's own provider account, with the same caps and the same review gate. The seat stays the default and the fallback for anyone without a key.

## Decisions from the user (2026-10-23, final)
1. Both backends stay. Selection happens once, at click time: `default` is a provider with an adapter and `process.env[keyEnv]` is non-empty → API loop; anything else → the seat. The Run button and the log say which ("on OpenAI gpt-5.6" or "on the Claude seat (Sonnet 5.5)").
2. No fallback mid-run. An API error, a 429 or a key that vanishes fails or pauses that run. The run never restarts on the seat. The seat child keeps receiving no `keyEnv` variable (`directorEnv` unchanged).
3. Providers: OpenAI, Grok (xAI), Gemini text, Claude API (Anthropic Messages with `ANTHROPIC_API_KEY`, never the Claude Code OAuth token), Qwen (DashScope compatible mode). Keys are the person's own, from `keyEnv` variables or the gitignored root `.env` through `server/keys.mjs`. The person confirmed brief and brand text may go to these providers.
4. The docs say "two Director backends", not "seat removed". The typed `/studio run` skill stays.
5. Per-brief `director` override: not in this plan (see "Out of scope" for why). Confirmed by the user on 2026-10-23: later.
6. The Responses API adapter (`openai-responses.mjs`, for GPT-6 and xAI's primary API) is phase 2. Phase 1 ships chat completions only (user, 2026-10-23).
7. No automatic retry. A 5xx or 529 fails that job with the provider's message (user, 2026-10-23).
8. Qwen `baseUrl` keeps the `dashscope-intl.aliyuncs.com` default until the person gives a workspace host.

## Options considered
Skills read for this plan: `server-route`, `testing-patterns`, `security-review`, `project-conventions`. No template changes, so `template-authoring` was not needed.

| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| One loop in `server/worker/` + thin adapters, started from `startDirector` | one entry point, one `current` slot, one daily run count, one log, one panel | `director.mjs` grows a branch | ✅ |
| A separate `server/api-director.mjs` with its own routes and state | no change to the seat file | two "running" states, two pause files the UI must merge, a second model call site to defend in every rule | ❌ |
| Adapter A: OpenAI chat completions with tools, shared by OpenAI, xAI, Qwen (DashScope compatible mode), Gemini (OpenAI-compatible endpoint) | one wire shape, one parser, 4 providers | OpenAI's newest models (GPT-6 Astra, GPT-6.1 Sol) need the Responses API for tool calling; xAI's docs now lead with Responses | ✅ phase 1, with the Responses adapter as phase 2 |
| Adapter B: Anthropic Messages | documented tool_use / tool_result, images as base64 blocks | thinking blocks must be echoed back verbatim; forced tool choice is refused on 5.5 models | ✅ phase 1 |
| Adapter C: OpenAI Responses API | required for GPT-6 and xAI's primary interface | a third wire shape (`input` items, `function_call_output`, `previous_response_id`) | ❌ phase 2, after the live check tells which OpenAI/xAI models the person wants |
| Native Gemini `generateContent` adapter | not beta | a fourth parser for one provider | ❌ the OpenAI-compatible endpoint covers it; revisit if the beta breaks tool calls |
| Any provider SDK (`openai`, `@anthropic-ai/sdk`) | typed | a dependency for two POST shapes; conventions say no dependency for what `fetch` does; SDKs retry on their own, which the rules forbid | ❌ plain `fetch`, `AbortSignal.timeout`, capped body read |
| Tools run as `spawn node engine/cli.mjs …` | mirrors the seat's allowlist | a child per call, text output to re-parse, no job binding (the model could pass another job id) | ❌ except `prepare` |
| Tools run in-process through `engine/pipeline.mjs` with project and job bound at loop start | no ids from the model, structured results, `StudioError` text comes back as a tool error | the server process does the director's bookkeeping (it already does for every route) | ✅; `prepare` alone spawns through `runEngine` (Chrome, TTS, the engine slot, the kill timer) |
| Prompt: a second copy of the studio skill for the API | nothing to generate | two copies drift on the first rule change | ❌ |
| Prompt: one shared rules file, mirrored into the skill by a script and pinned by a test | one place to edit; `npm test` catches drift | a generated block inside `SKILL.md` | ✅ |
| Model picked per job from a fetched list | like Generate | five `/models` endpoints with five shapes, for ids the person already knows | ❌ the person types the id; the live check proves it |

## Scope
- [ ] Rule change, narrow: the Director path gains a second backend under `server/worker/`, selected at click time, same caps, same single call site; propagated to every file in "Rule changes".
- [ ] `config/studio.json` → `director.api` caps; `config/providers.json` → `kind`, `baseUrl`, `model`, `strongModel`, `vision` per provider, `default` as the selector, notes rewritten.
- [ ] `engine/context.mjs`: `directorContext(project, job)` extracted from `cli.mjs` `context`; the CLI prints it, the worker sends it.
- [ ] `server/http.mjs`: capped, redirect-free, redacting `fetch` helper extracted from `generate.mjs`, used by both.
- [ ] `server/worker/`: `run.mjs`, `loop.mjs`, `tools.mjs`, `fetch-page.mjs`, `prompt.mjs`, `director-prompt.md`, `adapters/openai-chat.mjs`, `adapters/anthropic.mjs`.
- [ ] `server/director.mjs`: `pickBackend`, `hardJob` (the routing predicate shared by both backends), `startDirector` branching, per-provider pause and call counters, `publicRun` with `backend`, `provider`, `usage`.
- [ ] `server/server.mjs`: `GET /api/director` gains `backend`, `providers`, `default`; new `PUT /api/director/provider`; `DELETE /api/director/pause` clears every pause file; `runEngine` returns a `done` promise and a `kill`, and its children get a key-free environment.
- [ ] UI: Director select (seat or a provider), model fields for a provider, run label and status line naming the backend, log lines with usage.
- [ ] Prompt: `.claude/skills/studio/SKILL.md` carries the shared rules in a generated block written by `.ai/scripts/sync-director-prompt.js`; `tests/worker-prompt.test.mjs` pins it.
- [ ] Tests: `tests/worker.test.mjs` with injected `fetch` and a scripted adapter; `npm test` makes no network call.
- [ ] README, architecture, file-index.

## Out of scope
- Removing or disabling the seat path. It stays byte-for-byte except the move into `startSeatRun`.
- A per-brief `director` override. `validateBrief` fills `brief.director` with `providers.default` at save time, so every existing brief already says `seat`; honouring it would pin old briefs to the seat the day a provider is chosen. It would also split one run across backends, which `pickRun` (one run, one model) does not model. A later change can treat an empty `brief.director` as "follow the default" and add a select to the brief form; this plan ignores the field for selection and keeps filling it as today.
- The OpenAI Responses adapter (phase 2) and with it GPT-6 Astra / GPT-6.1 Sol tool calling and xAI's primary interface.
- Fetching model lists per provider; prompt caching tuning beyond one `cache_control` marker; streaming (DashScope refuses tools with streaming; nothing here needs it).
- Retries of any kind. A failed call fails that job with the provider's message; the person clicks again.
- Any automatic start: no timer, no "run on save", no queue drain after a pause ends.
- The review link: it keeps answering the Director stub and never lists providers.
- Image generation or the Generate panel: unchanged.

## Reuse & extension
- **Reused:** `startDirector`'s caps, log writer, `current`/`last`, `assertCanStart`, `planRun`/`pickRun`, `jobModel`'s routing reasons, `directorEnv`, `killTree`, the `finish` rule that puts a job left in `scripting` into `error` (`server/director.mjs`); `runsToday`/`countRun`, `usage`/`countUse`, `readPause`/`clearPause` (`server/caps.mjs`); `readCapped`, `redact`, `CONTROL_RE`, the `AbortSignal.timeout` + `redirect: 'error'` call shape (`server/generate.mjs`, moved to `server/http.mjs`); `keyEnvNames` (`server/keys.mjs`); `claim`, `commit`, `fail`, `prepare` (`engine/pipeline.mjs`); `urlCheck` (`engine/brand.mjs`); `jobFile`, `getStatus`, `loadBrand`, `loadBrief`, `listAssets`, `profileDir` (`engine/jobs.mjs`); `assertId`, `assertFileName`, `within`, `readJson`, `writeJson`, `StudioError`, `nowIso`, `loadStudioConfig` (`engine/core.mjs`); `runEngine`'s slot, timer and capped `engine.log` (`server/server.mjs`); `providersPublic`'s `hasKey` booleans; the panel's `busy()`, `toast()`, `esc()` and the 3 s poll (`ui/app.js`). Twins kept together: the prepare-round limit lives once in `director.api.maxPrepareRounds` and reaches the prompt text and the tool guard from the same config object; the host allowlist is `brand.sources.allowedHosts` for both backends (`urlCheck`).
- **Extracted:** `engine/context.mjs` → `directorContext` (consumers: `engine/cli.mjs`, `server/worker/prompt.mjs`); `server/http.mjs` → `fetchJson`, `readCapped`, `redact`, `flatLine` (consumers: `server/generate.mjs`, `server/worker/adapters/*`, `server/worker/fetch-page.mjs`); `hardJob` in `server/director.mjs` (consumers: `jobModel` for the seat, `workerModel` for the API); `director-prompt.md` (consumers: the skill mirror, `prompt.mjs`).
- **Extension point:** a provider is one entry in `config/providers.json` with a `kind` that names an adapter module in `ADAPTERS` (`server/worker/run.mjs`); a new wire shape is one file under `adapters/` exporting `request(state)` and `parse(json)`; a new tool is one entry in `TOOLS` (`server/worker/tools.mjs`) with a schema and an executor. Seat behaviour, `directorArgs`, `resolveClaude`, `detectPause`, `eventText` stay as they are.
- **Old path proven by:** `node --test tests/director.test.mjs tests/generate.test.mjs tests/brief-host.test.mjs tests/bullet-screenshots.test.mjs tests/drafts.test.mjs` passing unedited after T2, T3, T4 and T9.

## Architecture
```mermaid
flowchart LR
  UI[Run Director panel] -- "POST /api/director/run · PUT /api/director/provider" --> R[server.mjs routes]
  R --> D[server/director.mjs<br/>startDirector · pickBackend · planRun · current/last · log]
  D -- "seat" --> S[startSeatRun<br/>claude.exe -p, allowlist, directorEnv]
  D -- "api" --> W[server/worker/run.mjs<br/>one job at a time · timers · counters · pause]
  W --> L[loop.mjs<br/>messages · tool dispatch · turn/token/time budget]
  L --> A[adapters/openai-chat.mjs · adapters/anthropic.mjs<br/>request(state) → fetchJson → parse(json)]
  A -- "Authorization: Bearer / x-api-key, AbortSignal, byte cap, redirect: error" --> P[(provider host)]
  L --> T[tools.mjs<br/>claim · fetch_page · read_job_file · write_draft · commit · prepare · read_image · fail · done]
  T --> E[engine/pipeline.mjs claim/commit/fail · engine/context.mjs]
  T -- "prepare" --> RE[runEngine: node engine/cli.mjs prepare<br/>engine slot, kill timer, key-free env]
  T -- "fetch_page" --> FP[fetch-page.mjs<br/>urlCheck on every hop · byte cap · HTML→text]
  T --> J[(out/p/job: *.draft.json, status.json, stills)]
  W --> LOGS[(logs/director: p.log · runs.json · calls-provider.json · pause-provider.json)]
```

The seam that can break is `loop.mjs` ↔ adapter ↔ provider. Everything below the tools line is the existing engine. The key crosses one line, `process.env[keyEnv]` → one request header, and is never in a URL, a log, a tool result, a status file or the UI. The model never names a project, a job or a path: those are bound when the loop starts, and the only writes it can cause are `source.draft.json` and `script.draft.json` (plus the state changes `claim`, `commit`, `fail` and `prepare` already make for the seat). Two kinds of request leave the machine: provider calls (paid, counted per provider per day) and brief-page fetches (allowlisted hosts only, as for the seat's WebFetch).

## Component design

### Selection (`server/director.mjs`)
`pickBackend(providers, env)` → `{ kind: 'seat' }` or `{ kind: 'api', provider: '<id>', label, keyEnv }`. Rules, in order: `providers.default` missing or `seat` → seat; the named provider has no `kind` in `ADAPTERS` → seat with `reason: 'openai has no adapter'`; `env[keyEnv]` empty → seat with `reason: 'OPENAI_API_KEY is not set'`; else api. `startDirector` calls it once, writes the choice as the first log line and into `run.backend`, and never calls it again during the run. `nextRun` returns it as `backend` so the Run button can say where the next click goes.

`hardJob(d, { brief, brand, status })` → `{ hard, why }` is the predicate inside today's `jobModel` (error retry, mixed brief, `routing.strongTemplates`, non-English copy). `jobModel` keeps its signature and results. `workerModel(provider, hard)` → `{ model: hard && provider.strongModel ? provider.strongModel : provider.model, why }`. `planRun` takes the backend and uses one or the other, so `pickRun` keeps grouping one run under one model.

### Run (`server/worker/run.mjs`)
`startApiRun(d, providers, { backend, plan, project, by, engineBusy, runPrepare, fetch, env, now, files, log })` returns the same `run` object shape the seat makes (`project`, `jobs`, `prompt`, `model`, `by`, `startedAt`, `status`, `stop`) plus `backend: 'api'`, `provider`, `usage: { calls, inputTokens, outputTokens }`. Before the first call: `assertApiConfig(d.api)`, key present, pause file for the provider absent, `usage(files.calls(provider)).day < maxCallsPerDay`. Then, one job after another: `runJob` (the loop) under a per-job deadline of `jobTimeoutMinutes`, with the whole run also under `jobTimeoutMinutes × jobs` as today. After each job, if its status is still `scripting` or `scripted`, `fail(project, job, 'The director stopped before the storyboard: <reason>. Click Run Director again.', by)`. A 429 from the provider writes `pause-<provider>.json` and stops the run as `paused`; the jobs not started stay queued. `run.stop()` aborts the in-flight fetch through an `AbortController` and kills a running prepare child through `runEngine`'s `kill`. The run's `by` string for `setStatus` is `director-<provider>` (the seat uses `claude-seat`).

### Loop (`server/worker/loop.mjs`)
`runJob({ adapter, tools, system, context, budget, log, signal })` → `{ outcome: 'done' | 'failed' | 'turns' | 'tokens' | 'time' | 'cancelled' | 'error', turns, usage, summary }`. State: `messages` (provider-neutral: `{ role, content, calls?, callId? }` turned into wire shape by the adapter), `turns`, `usage`. Each turn: count the call (`countUse(files.calls(provider))`), `adapter.request(state)` → `fetchJson` → `adapter.parse(json)` → `{ text, calls: [{ id, name, args }], usage, stop }`. Tool calls run one after another in the order given, each answered with a result message carrying the same id. A text answer with no call gets one nudge (`"Call done when the job is in awaiting_review, or fail with a reason."`); the second text-only answer ends the job as `failed`. The loop ends on `done`, `fail`, `turns ≥ maxTurnsPerJob`, `usage.inputTokens + usage.outputTokens ≥ maxTokensPerJob`, the deadline, or the abort signal. A `StudioError` from a tool becomes `{ error: message }` in the tool result; any other exception ends the job as `error` with a redacted message. Unknown tool name or arguments that fail the schema check → `{ error: 'Unknown tool x' }` / `{ error: 'write_draft needs kind and content' }`, counted as a turn.

### Tools (`server/worker/tools.mjs`)
`toolsFor(ctx)` where `ctx = { project, job, by, brand, hosts, g: d.api, runPrepare, fetch, vision, counters }` returns `[{ name, description, schema, run(args) }]`. Nothing takes a project or job id. JSON schemas are plain objects (`type: 'object'`, `properties`, `required`, `additionalProperties: false`); `checkArgs(schema, args)` is a 30-line checker for the types this table uses (string, enum, object, integer), not a JSON Schema library.

| Tool | Args | Runs | Returns |
|---|---|---|---|
| `claim` | none | `pipeline.claim(project, job, by)` | `{ status }` |
| `fetch_page` | `{ url }` | `fetchPage` (below) | `{ url, finalUrl, title, text, images: [{ src, alt }] }`, `text` ≤ `maxPageChars` |
| `read_job_file` | `{ name }` enum `source.json`, `script.json`, `status.json`, `source.draft.json`, `script.draft.json`, `timing.json` | `readJson(jobFile(project, job, name), null)` | the JSON, or `{ error: 'No source.json yet' }` |
| `write_draft` | `{ kind: 'source' \| 'script', content: object }` | `writeJson(jobFile(project, job, kind + '.draft.json'), content)` after a `maxDraftBytes` check | `{ bytes }` |
| `commit` | `{ kind }` | `pipeline.commit(project, job, kind, by)` | `{ status, kept }` or `{ error: '<validation text>' }` |
| `prepare` | none | `runPrepare(project, job)` through `runEngine`, awaiting `done`, at most `maxPrepareRounds` per job | `{ status, duration, lint: { errors, warnings, findings }, stills: [{ id, t, file }] }` read from `status.json` |
| `read_image` | `{ kind: 'still' \| 'asset', name }` | `assertFileName(name)`, `within(jobDir/stills, name)` or `within(profileDir/assets, name)`, PNG/JPEG/WebP only, ≤ `maxImageBytes`, ≤ `maxImagesPerJob` per job | an image part (base64) plus `{ width, height }` from the PNG/JPEG header; offered only when `provider.vision` is true |
| `fail` | `{ reason }` | `pipeline.fail(project, job, reason, by)` | `{ status: 'error' }` and ends the loop |
| `done` | `{ summary }` | nothing | ends the loop; the run checks the status |

`fetchPage(url, { hosts, fetch, g })` (`server/worker/fetch-page.mjs`): `urlCheck(url, hosts).allowed` or `{ error }`; `fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(requestTimeoutSeconds * 1000), headers: { accept: 'text/html,*/*' } })`; on 301/302/303/307/308 resolve `Location` against the current URL, run `urlCheck` on the new host, at most 3 hops; read through `readCapped(res, maxFetchBytes)`; `text/html` → `pageText(html)` (drop `script`, `style`, `noscript`, `svg`; keep `title`; `<img>` becomes a list of up to 40 `{ src, alt }` resolved against `finalUrl`; headings and list items get a line break; entities decoded for `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`; whitespace collapsed); `text/plain` and JSON pass through; anything else → `{ error: 'Not a text page (image/png)' }`. The result is cut at `maxPageChars` with a `truncated: true` flag. No cookie, no auth header, no key ever reaches this fetch.

### Adapters (`server/worker/adapters/`)
Each exports `request(state)` → `{ url, init }` and `parse(json, res)` → `{ text, calls, usage, stop }`, plus `imagePart(buf, mime)` and `toolResult(id, content)`. The loop keeps provider-neutral messages; the adapter renders them on every request, so the Anthropic adapter can echo assistant content blocks (thinking included) exactly as received.

`openai-chat.mjs` (`kind: 'openai'`, `'openai-compatible'`): `POST <baseUrl>/chat/completions`, `Authorization: Bearer <key>`, body `{ model, messages, tools: [{ type: 'function', function: { name, description, parameters } }], tool_choice: 'auto', parallel_tool_calls: false, stream: false, max_completion_tokens | max_tokens }` (`max_completion_tokens` for `kind: 'openai'`, `max_tokens` for the others). Assistant messages are stored as the wire `message` object and sent back verbatim (that carries `tool_calls`, and `reasoning_content` on Qwen thinking models). Tool results: `{ role: 'tool', tool_call_id, content }`. Images: `{ type: 'image_url', image_url: { url: 'data:image/png;base64,…', detail: 'auto' } }`. Parse: `choices[0].message.content` and `.tool_calls[].function.{name, arguments}` (`arguments` is a JSON string; a parse failure is a tool error for that call), `finish_reason` (`length` → the loop asks for a shorter answer once), `usage.prompt_tokens` / `completion_tokens`. A call without an `id` (seen on some compatible endpoints) gets `call_<turn>_<n>`.

`anthropic.mjs` (`kind: 'anthropic'`): `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, body `{ model, max_tokens, system: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }], tools: [{ name, description, input_schema }], tool_choice: { type: 'auto' }, messages }`. Assistant content arrays are kept whole; tool results go as `{ role: 'user', content: [{ type: 'tool_result', tool_use_id, content, is_error? }] }`; images as `{ type: 'image', source: { type: 'base64', media_type, data } }` inside a tool result. Parse: `content[]` text and `tool_use` blocks (`id`, `name`, `input`), `stop_reason` (`tool_use`, `end_turn`, `max_tokens`), `usage.input_tokens` / `output_tokens`. No forced tool choice (refused on 5.5 models).

Errors, both adapters, in `fetchJson` → `providerError(res, json)`: 429 (or Anthropic `error.type === 'rate_limit_error'`) → pause for `retry-after` seconds when the header is present and ≤ 60 min, else `pauseMinutes`; 401/403 → "`<label>` refused the key (`<keyEnv>`): <message>"; 404 or a message matching `GONE_RE` → "Model `<id>` was refused by `<label>`: <message>. Change the model in the Director panel"; 413 → "The request is too large for `<label>`"; 5xx and 529 → "`<label>` answered <status>: <message>". Every message is redacted and cut at 300 chars. None is retried.

### Prompt (`server/worker/prompt.mjs`, `server/worker/director-prompt.md`)
`systemPrompt({ backend: 'api', provider, d, vision })` = the API header + the shared rules. The header lists the tools by name, the numbers from config (`maxPrepareRounds`, `maxTurnsPerJob`, `jobTimeoutMinutes`, `maxImagesPerJob`), the vision line ("You can read stills with `read_image`" or "You cannot see images; rely on lint and the context"), and the hard limits in tool terms (never render, never approve, never ask for a path, the only writes are `write_draft`). `contextMessage(project, job)` = "Job <project>/<job>. Context:" + `JSON.stringify(directorContext(project, job))`, with `transcripts[*].segments` cut to the first 400 per asset. The shared rules file is the current skill body minus Claude Code specifics, written with action verbs the two headers map: "claim the job", "fetch the brief page", "write the source draft", "commit the source", "build the storyboard", "read each still", "fail the job with a reason". `.claude/skills/studio/SKILL.md` keeps its seat header (hard limits with `node engine/cli.mjs …`, `/studio status`, the step list with commands, `--by claude-seat`) and carries the shared rules between `<!-- BEGIN:DIRECTOR-RULES (generated from server/worker/director-prompt.md) -->` and `<!-- END:DIRECTOR-RULES -->`, written by `node .ai/scripts/sync-director-prompt.js` and pinned byte-for-byte by `tests/worker-prompt.test.mjs` (`.claude/scripts/check-propagation.js` is a protected file, so the test is the guard).

## Data design

`config/studio.json` → `director` keeps every key it has; the seat reads the same `maxJobsPerRun`, `maxRunsPerDay`, `jobTimeoutMinutes`, `maxLogBytes`, `routing.strongTemplates`. New block:
```json
"api": {
  "maxTurnsPerJob": 40,
  "requestTimeoutSeconds": 180,
  "maxOutputTokens": 8192,
  "maxTokensPerJob": 1000000,
  "maxCallsPerDay": 400,
  "maxResponseBytes": 4000000,
  "maxToolResultChars": 60000,
  "maxDraftBytes": 262144,
  "maxFetchBytes": 2000000,
  "maxPageChars": 40000,
  "maxImagesPerJob": 8,
  "maxImageBytes": 4000000,
  "maxPrepareRounds": 3,
  "pauseMinutes": 15
}
```
`maxTokensPerJob` counts input plus output as the provider reports them, summed over the job's calls (the same context is re-sent every turn, so 25 turns × 30k tokens of context is the realistic ceiling for a mixed brief with transcripts). The run budget is `maxTokensPerJob × jobs` and needs no key of its own. `maxCallsPerDay` is per provider, in `logs/director/calls-<provider>.json` through `usage`/`countUse` (day and month, the month shown in the panel). Runs per day stay `runs.json`, one count for both backends.

`config/providers.json`:
```json
{
  "default": "seat",
  "providers": {
    "seat": { "kind": "claude-code", "label": "Claude Code (seat)", "note": "Run Director without a provider, or type /studio run in Claude Code. Never behind a web route." },
    "openai": { "kind": "openai", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1", "model": "", "strongModel": "", "vision": true, "keyEnv": "OPENAI_API_KEY", "note": "Chat completions with tools. GPT-6 models need the Responses API (not built yet); pick a GPT-5.x id." },
    "grok": { "kind": "openai-compatible", "label": "Grok (xAI)", "baseUrl": "https://api.x.ai/v1", "model": "", "strongModel": "", "vision": true, "keyEnv": "XAI_API_KEY", "note": "Chat completions; xAI's docs now lead with the Responses API. The live check confirms." },
    "gemini": { "kind": "openai-compatible", "label": "Gemini", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "", "strongModel": "", "vision": true, "keyEnv": "GEMINI_API_KEY", "note": "Text director through Google's OpenAI-compatible endpoint (beta). The same key makes brand images and clips (Brand tab → Generate).", "models": { "image": "gemini-nano-banana-2.1", "video": "veo-3.1-lite-generate-preview" } },
    "claude": { "kind": "anthropic", "label": "Claude API", "baseUrl": "https://api.anthropic.com", "model": "", "strongModel": "", "vision": true, "keyEnv": "ANTHROPIC_API_KEY", "note": "Anthropic Messages API with the person's own API key. Never the Claude Code OAuth token; the seat child still gets no key." },
    "qwen": { "kind": "openai-compatible", "label": "Qwen (DashScope)", "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "", "strongModel": "", "vision": false, "keyEnv": "DASHSCOPE_API_KEY", "note": "Compatible mode. Keys are region-bound; the newer per-workspace host is https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1. Set vision true for a qwen3-vl id." }
  }
}
```
Empty `model` means "not set yet": `pickBackend` then falls back to the seat with `reason: 'openai has no model set'`. `strongModel` empty means the standard model takes hard jobs too. `gemini.models` (image and clip ids) stays as the Generate panel wrote it. The `seat` entry keeps `kind: 'claude-code'`, which no adapter claims, so the selector cannot route it to an HTTP call. `PUT /api/director/provider` rewrites the file with only `default` and the named provider's `model`, `strongModel`, `vision` changed (tested byte-for-byte like `saveModelDefaults`).

State under `logs/director/` (gitignored): `runs.json` (unchanged), `pause.json` (seat, unchanged), `pause-<provider>.json` `{ until, reason, at, project, provider }`, `calls-<provider>.json` `{ day, count, month, monthCount }`, `<project>.log` (same file as the seat; the first line names the backend).

Run object (`publicRun`): `{ project, jobs, command, model, by, startedAt, endedAt, status, message, backend: 'seat' | 'api', provider: null | '<id>', usage: null | { calls, inputTokens, outputTokens } }`. `command` stays the `/studio run …` text for both (it names the jobs); `model` is the label ("OpenAI gpt-5.6" or "Sonnet 5.5").

Log lines (`<project>.log`), one per event, through `flatLine` and `redact`: `<iso> <by> started: /studio run acme/promo (limit 15 min, on OpenAI gpt-5.6)`; `  promo: gpt-5.6, a standard job`; `[promo] turn 3 > fetch_page https://…`; `[promo] turn 4 > write_draft source (4 312 bytes)`; `[promo] turn 7 ! commit: script invalid: …` (first 300 chars); `[promo] turn 9 > prepare: awaiting_review, 2 warnings`; `[promo] done in 11 turns, 143 210 in / 6 802 out tokens`; `<iso> done: Finished`. The model's own prose is logged at most 400 chars per turn. No message body, no key, no page text.

Routes:
- `GET /api/director?project=` adds `backend: { kind, provider, label, reason }` (what the next click uses), `providers: [{ id, kind, label, keyEnv, hasKey, model, strongModel, vision, note }]` for every provider with an adapter, `default`, `usage: { '<provider>': { day, month } }`, `caps: { maxCallsPerDay }`. Never a key value.
- `PUT /api/director/provider` body `{ default: 'seat' | '<id>', model?, strongModel?, vision? }` → 200 `{ default, providers }`; 400 for an unknown id, a `seat` with model fields, or a model id outside `MODEL_RE` (`^[a-z0-9][a-z0-9._:-]{0,79}$`, case-insensitive); 409 while a run is active.
- `DELETE /api/director/pause` removes `pause.json` and every `pause-*.json`.
- `POST /api/director/run` unchanged in shape; 503 when the selected provider's config is bad (`assertApiConfig`), 429 when paused or over `maxCallsPerDay`, 409 while running, as today.

## External system contract
Verified on 2026-10-23 against the vendor docs named below. Marked spike where the docs did not settle it. The first real run per provider (T11) records what came back.

OpenAI
- `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer <OPENAI_API_KEY>`. Tools as `{ type: 'function', function: { name, description, parameters } }`; `tool_choice: 'auto'`; `parallel_tool_calls: false` keeps one call per answer; `max_completion_tokens`. Tool results as `{ role: 'tool', tool_call_id, content }`; images as `image_url` parts with a data URL and `detail`. The function-calling guide says Chat Completions "remains supported" and that GPT-6 Astra and GPT-6.1 Sol require the Responses API for tool calling; its examples use GPT-5.6 Terra. The migration guide: "Responses is recommended for all new projects". The Chat Completions reference page could not be fetched (403/404), so the exact `tool_calls[]` field names rest on the long-standing shape and are a spike for T11.
- Decision: phase 1 is Chat Completions for GPT-5.x ids; the Responses adapter is phase 2. The person picks the id.

xAI
- `https://api.x.ai/v1`, `Authorization: Bearer <XAI_API_KEY>`. The function-calling, chat and image-understanding guides now show only `POST /v1/responses` with `input_image` parts (JPG/PNG, 20 MiB, no count limit, `detail`) and `grok-4.7`. Whether `/v1/chat/completions` still answers with tools is a spike for T11; if it does not, Grok waits for the phase-2 Responses adapter and the panel says so.

Gemini (OpenAI-compatible)
- `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `Authorization: Bearer <GEMINI_API_KEY>`. Tools and `image_url` with base64 data URLs are documented. "Still in beta while we extend feature support"; unlisted parameters are silently ignored. Spike: whether `tool_calls[].id` is always present and whether `parallel_tool_calls` is honoured (the loop handles several calls per answer either way).

Anthropic
- `POST https://api.anthropic.com/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `max_tokens` required, `system` at the top level, `tools` with `input_schema`, `tool_choice: { type: 'auto' }`. Tool use comes back as `tool_use` blocks (`id`, `name`, `input`); results go back as `tool_result` blocks (`tool_use_id`, `content`, `is_error`) in a user message; images as `{ type: 'image', source: { type: 'base64', media_type, data } }` (jpeg, png, gif, webp). Every `thinking` / `redacted_thinking` block of an assistant turn must be passed back unchanged and the history kept append-only; forced tool choice (`any`, `tool`) is refused on Opus 5.5, Sonnet 5.5 and Fable 5.1. Errors: 429 `rate_limit_error` (a spend-cap 429 has no `retry-after`), 529 `overloaded_error`, 413 above 32 MB. `usage.input_tokens` / `output_tokens`.

Qwen (DashScope, OpenAI-compatible mode)
- Legacy host `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` ("remain available but are not preferred"); the documented host is now `https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` (Beijing: `cn-beijing`), keys region-bound (401 `invalid_api_key` across regions). `Authorization: Bearer <DASHSCOPE_API_KEY>`. Tools documented with `type: 'function'`; "the tools parameter cannot be used with stream=True"; `n` fixed at 1 with tools; the compatibility page names qwen-plus and qwen-max for tools. Image input through the same endpoint with `image_url` data URLs for the Qwen3-VL family (`qwen3-vl-plus` named). Spike: whether `reasoning_content` must be echoed back on a thinking model (the adapter echoes the assistant message whole, which covers it).

Data use: brand and brief text, the fetched page text and up to 8 stills per job leave the machine under the person's own account with each provider's API terms. The README section names it; the person decided it is acceptable (2026-10-23).

Human-only gates: creating each key and billing; setting the key in `.env` or the environment and restarting `npm run ui`; typing the model ids; T11 (the first real job per provider, paid); reading each provider's rate-limit tier (none of the five reports it through the API).

## Files to create / modify
| File | Change |
|------|--------|
| `.ai/docs/conventions.md` | modified — the model NEVER's Director sentence names two backends; the ALWAYS caps sentence names `director.api` |
| `CLAUDE.md` | modified — "Rules for using Claude here" bullets 1 and 4, the NEVER summary line, the Layout line for `config/` |
| `.cursor/rules/project.mdc`, `.claude/skills/project-conventions/SKILL.md`, `AGENTS.md`, `.github/copilot-instructions.md` | regenerated blocks + the hand-written intro sentence in each |
| `.cursor/rules/core.mdc`, `.cursor/rules/workflow.mdc`, `.cursor/rules/new-feature.mdc` | modified — one sentence each |
| `.claude/rules/backend-security.md` | modified — first bullet |
| `.claude/skills/security-review/SKILL.md` | modified — description, Claude boundary checklist (worker item) |
| `.claude/skills/server-route/SKILL.md`, `.claude/skills/code-review/SKILL.md`, `.claude/commands/workflow.md` | modified — the "no route invokes a model" sentence |
| `.claude/agents/{tech-lead,senior-dev}.md`, `.cursor/agents/{tech-lead,senior-dev}.md`, `.github/agents/{tech-lead,senior-dev}.agent.md` | modified — the boundary sentence |
| `.claude/skills/studio/SKILL.md` | modified — seat header kept; shared rules become a generated block |
| `server/worker/director-prompt.md` | new — the shared director rules |
| `.ai/scripts/sync-director-prompt.js` | new — writes the block into the skill |
| `config/studio.json` | modified — `director.api` |
| `config/providers.json` | modified — `kind`, `baseUrl`, `model`, `strongModel`, `vision`, notes; `default` is the selector |
| `engine/context.mjs` | new — `directorContext` |
| `engine/cli.mjs` | modified — `context` prints `directorContext` |
| `server/http.mjs` | new — `fetchJson`, `readCapped`, `redact`, `flatLine` |
| `server/generate.mjs` | modified — imports those four from `http.mjs`; behaviour unchanged |
| `server/director.mjs` | modified — `pickBackend`, `hardJob`, `workerModel`, `ADAPTERS` lookup, `startDirector` branch, `startSeatRun` (moved body), pause and call files per provider, `publicRun` fields, `setDefaultProvider` |
| `server/worker/run.mjs`, `loop.mjs`, `tools.mjs`, `fetch-page.mjs`, `prompt.mjs`, `adapters/openai-chat.mjs`, `adapters/anthropic.mjs` | new |
| `server/server.mjs` | modified — director GET fields, `PUT /api/director/provider`, pause DELETE, `runEngine` `done`/`kill` + key-free env, `runPrepare` passed to `startDirector` |
| `ui/app.js`, `ui/app.css` | modified — Director select, model fields, run label, status line, guide text |
| `tests/worker.test.mjs`, `tests/worker-prompt.test.mjs` | new |
| `tests/director.test.mjs` | modified — appended cases only (`pickBackend`, `hardJob`, `workerModel`, `setDefaultProvider`); nothing existing changes |
| `README.md`, `.ai/docs/architecture.md`, `.ai/docs/file-index.md` | modified — two backends, keys, costs, local state, new files |

## Task breakdown

### T1 — Change the rule to "two Director backends" and propagate it
Files: `.ai/docs/conventions.md`, `CLAUDE.md`, the four generated mirrors, `.cursor/rules/{core,workflow,new-feature}.mdc`, `.claude/rules/backend-security.md`, `.claude/skills/{security-review,server-route,code-review}/SKILL.md`, `.claude/commands/workflow.md`, `.claude/agents/{tech-lead,senior-dev}.md`, `.cursor/agents/{tech-lead,senior-dev}.md`, `.github/agents/{tech-lead,senior-dev}.agent.md`, `config/providers.json` notes.
Exact wording in "Rule changes" below. Run `node .claude/scripts/generate-mirrors.js` after editing conventions.md. The security-review checklist gains: "`server/worker/` is reached only from `startDirector`; project and job bound at loop start; tools write only the two draft files; `fetch_page` runs `urlCheck` on every hop; the key is a header only; `maxCallsPerDay`, `maxTurnsPerJob`, `maxTokensPerJob`, timeouts, byte caps, pause on 429, no retry, no backend switch mid-run; `directorEnv` still strips every `keyEnv` from the seat child and from engine children".
- **Verify:** `node .claude/scripts/check-propagation.js` exits 0 with no new warning; `node .claude/scripts/spec-lint.js` exits 0; `grep -rn "Director stays on the seat\|No script-writing worker\|Worker mode is not\|Only \`seat\`" CLAUDE.md .ai/docs .claude .cursor .github AGENTS.md config README.md` → 0 lines; `grep -rln "two Director backends" CLAUDE.md .ai/docs/conventions.md .claude/rules/backend-security.md .claude/skills/security-review/SKILL.md` → 4 files.
- [x] done (2026-10-23: check-propagation 0, spec-lint 0, "two Director backends" in 4 files; the last stale line, architecture.md "worker mode is not built", fixed by the coordinator. Open for T12: intros of project.mdc, copilot-instructions.md, core.mdc still say "Claude runs only inside Claude Code"; security-review names `--permission-prompts none` next to `dontAsk`.)

### T2 — Extract `directorContext` from the CLI
Files: `engine/context.mjs` (new), `engine/cli.mjs`.
`directorContext(project, job)` returns the object `case 'context'` builds today (brief, status, brand, voiceNotes, urlCheck, assets, template, transcripts + rule, icons, screenshots + rule, drafts + rule). `transcriptsOf` moves with it. The CLI case becomes `console.log(JSON.stringify(directorContext(project, id), null, 2))`.
- **Verify:** `node --test tests/brief-host.test.mjs tests/bullet-screenshots.test.mjs tests/drafts.test.mjs` → every case passes unedited; `node engine/cli.mjs context csr-console <an existing job>` prints the same keys as before (`brief`, `status`, `brand`, `voiceNotes`, `urlCheck`, `assets`, `template`, `icons`).
- [x] done (2026-10-23: engine/context.mjs; cli context prints the same keys; brief-host, bullet-screenshots, drafts pass unedited)

### T3 — Extract the capped fetch helper into `server/http.mjs`
Files: `server/http.mjs` (new), `server/generate.mjs`.
Exports: `readCapped(res, max, label)` (the body limit error names `label`, e.g. `generate.maxResponseBytes`), `redact(text, keys)` (every non-empty value in `keys` replaced by `[key]`, plus the patterns `AIza[0-9A-Za-z_-]{20,}`, `sk-[A-Za-z0-9_-]{16,}`, `xai-[A-Za-z0-9_-]{16,}`, `sk-ant-[A-Za-z0-9_-]{16,}`), `flatLine(text)` (the `CONTROL_RE` replace), `fetchJson(fetch, { url, init, timeoutMs, maxBytes, label, signal })` → `{ res, json, text }` with `redirect: 'error'`, a 3xx refused with the existing "redirect" message, timeout → 504 `StudioError`, network error → 502. `generate.mjs` keeps `callGoogle`'s Google-specific mapping (pause file, `GONE_RE`) on top of `fetchJson`. `redact(text, key)` with a string still works (one key).
- **Verify:** `node --test tests/generate.test.mjs tests/keys.test.mjs` → every case passes unedited; a new case in `tests/worker.test.mjs`: `redact('sk-abcdefghijklmnopqrstuv and xai-abcdefghijklmnopqr', ['v1'])` contains neither token; `fetchJson` with a fake `fetch` answering 302 → 502 "redirect" and one call; a body over `maxBytes` → 413 naming `label`.
- [x] done (2026-10-23: server/http.mjs; generate and keys tests pass unedited; tests/worker.test.mjs 7 cases; 73/73 across the six files)

### T4 — Config, selection and routing: `director.api`, `pickBackend`, `hardJob`, `workerModel`, `setDefaultProvider`
Depends: T1.
Files: `config/studio.json`, `config/providers.json`, `server/director.mjs`, `tests/director.test.mjs` (appended cases only), `tests/worker.test.mjs`.
`ADAPTER_KINDS = ['openai', 'openai-compatible', 'anthropic']` lives in `director.mjs` (the adapter modules come in T5; the selector needs only the names). `assertApiConfig(a)` checks every key in the Data design is a positive number (503 naming `director.api.<key>`). `pickBackend(providers, env)` as in Component design. `hardJob` extracted so `jobModel(d, …)` returns exactly what it returns today. `workerModel(provider, hard)`. `planRun(d, project, job, backend)` uses `jobModel` for the seat and `workerModel` for the API; its `label` is `"OpenAI gpt-5.6"` for the API. `setDefaultProvider(providersFile, body)` rewrites `default` and the one provider's `model`, `strongModel`, `vision`; refused during a run.
- **Verify:** `node --test tests/director.test.mjs` → every existing case unedited and green, plus appended: `pickBackend` → seat for `default: 'seat'`, seat with `reason` naming `OPENAI_API_KEY` when `default: 'openai'` and the env lacks it, seat with a reason naming "no model set" when `model` is empty, api with `provider: 'openai'` when the key and model are set, seat for a provider whose `kind` is `claude-code`; `hardJob` agrees with `jobModel` on the six cases of the existing routing test; `workerModel({ model: 'a', strongModel: 'b' }, true).model === 'b'` and `workerModel({ model: 'a', strongModel: '' }, true).model === 'a'`; `setDefaultProvider` on a temp copy of `providers.json` changes only `default` and `providers.openai.{model,strongModel,vision}` (parse both, delete those, `deepEqual`), refuses `default: 'nope'`, `model: 'x y'` and `default: 'seat', model: 'a'` with 400 and leaves the file byte-identical; `assertApiConfig` with `maxTurnsPerJob: 0` → 503 naming it.
- [x] done (2026-10-23: 82/82 in director, worker, generate, keys tests; keys.test expected list gains OPENAI_API_KEY and DASHSCOPE_API_KEY; pickBackend also returns model, strongModel, vision; nextRun backend, assertApiConfig in startDirector and the provider route wait for T9)

### T5 — Adapters: request builders and parsers, pure
Depends: T3.
Files: `server/worker/adapters/openai-chat.mjs`, `server/worker/adapters/anthropic.mjs`, `tests/worker.test.mjs`.
Each adapter: `request({ provider, model, key, system, messages, tools, maxOutputTokens })` → `{ url, init }`; `parse(json)` → `{ text, calls: [{ id, name, args }], usage: { input, output }, stop }`; `assistantMessage(parsed, raw)` (what the loop stores so it can be echoed); `toolResultMessage(id, content, { isError, image })`; `imagePart(buf, mime)`. Provider-neutral `messages` are `[{ role: 'user', text }]`, `[{ role: 'assistant', raw }]`, `[{ role: 'tool', id, content, isError, image? }]`.
- **Verify:** `node --test tests/worker.test.mjs`: OpenAI request URL is `<baseUrl>/chat/completions`, the key is in `Authorization` and nowhere in `url` or `init.body`, `tool_choice === 'auto'`, `parallel_tool_calls === false`, `stream === false`, `max_completion_tokens` for `kind: 'openai'` and `max_tokens` for `openai-compatible`; a fixture answer with `tool_calls[0].function.arguments: '{"kind":"source"}'` parses to `calls[0].args.kind === 'source'`, `usage.input === prompt_tokens`; a call without `id` gets a generated one; `arguments: '{bad'` → that call carries `error`; `finish_reason: 'length'` → `stop === 'length'`; Anthropic request has `x-api-key`, `anthropic-version: 2023-06-01`, `system[0].cache_control`, `tools[0].input_schema`, `tool_choice.type === 'auto'`; a fixture with a `thinking` block then a `tool_use` block round-trips: `assistantMessage` keeps both blocks byte-equal in the next `request()`'s `messages`; a `tool_result` with an image renders `source.type === 'base64'`; `stop_reason: 'tool_use'` → `stop === 'tool_use'`; neither adapter's `init.body` ever contains the sentinel key `SENTINEL-KEY-123`.
- [x] done (2026-10-23: adapters/openai-chat.mjs, anthropic.mjs, shared.mjs with providerError; cases in tests/worker-adapters.test.mjs (19), not worker.test.mjs; GONE_RE moved to http.mjs; parse returns neutral stop end/tool_use/length; only the system prompt is cached on Anthropic, caching the context message is a follow-up)

### T6 — Tools and the page fetch
Depends: T2, T3, T4.
Files: `server/worker/tools.mjs`, `server/worker/fetch-page.mjs`, `tests/worker.test.mjs`.
`toolsFor(ctx)` and `fetchPage` as in Component design; `checkArgs(schema, args)`; `readImage(ctx, kind, name)`; `pngSize`/`jpegSize` from the headers (a 20-line reader, no library). The test uses a temp project `zz-test-worker` (brand with `sources.allowedHosts: ['shop.example.com']`, one `explainer` brief, assets with a 4-byte PNG stub and a real small PNG), removed in `after` from `profiles`, `briefs` and `out`, as `tests/brief-host.test.mjs` does. `runPrepare` is injected as a stub that writes `status.json` with `status: 'awaiting_review'`, `lint` and `stills`.
- **Verify:** `node --test tests/worker.test.mjs`: `claim` moves the job to `scripting`; `write_draft` with `content` of 300 KB → `{ error }` naming `maxDraftBytes` and no file; `write_draft` source + `commit` source on a valid draft → `scripted` is not yet reached (status stays `scripting`, `kept: []`); `commit` with an invalid draft → `{ error }` containing "source invalid" and the job status unchanged; `read_job_file({ name: '../brand.json' })` → `{ error }` (enum check) and `read_job_file({ name: 'status.json' })` returns the status; `read_image({ kind: 'still', name: '../../brand.json' })` throws through `assertFileName`; `read_image` on the 4-byte stub → `{ error }` ("not a readable image"); the 9th `read_image` → `{ error }` naming `maxImagesPerJob`; the 4th `prepare` → `{ error }` naming `maxPrepareRounds`; `toolsFor({ vision: false })` has no `read_image`; `fetch_page` with `https://evil.example/x` → `{ error }` naming "allowed hosts" and zero fetch calls; a 302 from `shop.example.com` to `https://cdn.evil.example/` → `{ error }` and one fetch call; a 302 to `https://shop.example.com/p` → followed, two calls; a body over `maxFetchBytes` → `{ error }`; an HTML fixture with `<script>`, `<title>`, `<h1>`, `<li>`, `<img src="/a.png" alt="A">` → `title`, line-broken `text` without the script, `images[0].src === 'https://shop.example.com/a.png'`; `text` cut at `maxPageChars` with `truncated: true`; `fail({ reason })` → status `error` and the reason in `status.error`.
- [x] done (2026-10-23: tools.mjs, fetch-page.mjs; 16 cases in tests/worker-tools.test.mjs on zz-test-worker-tools; write_draft and commit refuse an unclaimed job; read_image returns image {mime, buf} for the loop to pass to the adapter; maxToolResultChars and an abort signal for fetch_page left to T8/T9)

### T7 — Prompt: the shared rules file, the API header, the skill mirror
Depends: T1.
Files: `server/worker/director-prompt.md`, `server/worker/prompt.mjs`, `.claude/skills/studio/SKILL.md`, `.ai/scripts/sync-director-prompt.js`, `tests/worker-prompt.test.mjs`.
The shared file is the current skill's Source, Script, Storyboard checks, Mixed briefs and "When a person edited something" text with the action verbs listed in Component design. The skill's seat header keeps the `node engine/cli.mjs …` commands and maps each verb to one. `systemPrompt` for the API maps each verb to a tool and injects the config numbers. `contextMessage` wraps `directorContext`.
- **Verify:** `node .ai/scripts/sync-director-prompt.js` rewrites only the block between the markers (diff the skill before and after: nothing outside the markers changes); `node --test tests/worker-prompt.test.mjs`: the block equals the shared file byte-for-byte; `systemPrompt({ vision: false })` contains "cannot see images" and no `read_image`; `systemPrompt({ vision: true })` names `read_image`; the prompt contains the strings `maxPrepareRounds`'s value ("at most 2 fix rounds" when it is 3) and "never render"; `contextMessage` on the T6 temp job parses back to JSON with `brief`, `template`, `urlCheck`; a transcript fixture with 500 segments is cut to 400. `node .ai/scripts/prose-audit.js server/worker/director-prompt.md` → no findings.
- [x] done (2026-10-23: worker-prompt 8/8; sync rewrites only the marked block; prose-audit clean; check-propagation 0. The shared file says "within the fix-round limit"; the seat header says two rounds, the API header says prepare at most maxPrepareRounds times. API pacing reads timing.json through read_job_file)

### T8 — The loop with a scripted adapter
Depends: T5, T6, T7.
Files: `server/worker/loop.mjs`, `tests/worker.test.mjs`.
`runJob` as in Component design. The test adapter is a script of answers (`[{ calls: [{ name: 'claim', args: {} }] }, { calls: [{ name: 'write_draft', … }] }, …]`) and a recording `fetch` is not needed: the adapter's `request`/`parse` are replaced by the script, so the loop is tested without HTTP. The real tools from T6 run on the temp job.
- **Verify:** `node --test tests/worker.test.mjs`: a happy script (claim → write source → commit source → write script → commit script → prepare → read_image → done) ends `outcome: 'done'` with the job in `awaiting_review` and `usage` summed from the script's numbers; a script that calls `done` while the job is `scripting` → `outcome: 'done'` and the run layer (T9) fails it; 41 calls → `outcome: 'turns'` after exactly `maxTurnsPerJob` requests; usage over `maxTokensPerJob` → `outcome: 'tokens'` with no further request; a deadline of 10 ms with a slow tool → `outcome: 'time'`; an aborted signal → `outcome: 'cancelled'`; two text-only answers → `outcome: 'failed'` with exactly one nudge message in the history; an unknown tool → a tool result with `error` and the loop continues; a `StudioError` from `commit` → a tool result with `error`, the loop continues; a thrown `TypeError` from a tool → `outcome: 'error'`; three calls in one answer run in order (the recorded tool order equals the answer order).
- [x] done (2026-10-23: server/worker/loop.mjs runJob never throws; 14 cases in tests/worker-loop.test.mjs; worker tests 57/57; fetch_page takes the run signal; outcome failed after two text-only answers leaves the job scripting for T9 to fail)

### T9 — The run, the Director branch, the routes
Depends: T4, T8.
Files: `server/worker/run.mjs`, `server/director.mjs`, `server/server.mjs`, `tests/worker.test.mjs`, `tests/director.test.mjs` (appended).
`startApiRun` as in Component design. `startDirector` keeps its first lines (`assertCanStart` with the selected backend's pause file, `planRun`, `engineBusy`), then `backend.kind === 'seat' ? startSeatRun(…) : startApiRun(…)`; the seat body moves into `startSeatRun` unchanged. `runEngine` returns `{ started, done, kill }` and spawns with `env: directorEnv(process.env, readJson(PROVIDERS_FILE))`; existing callers keep reading `started`. The routes from Data design. The log's first line names the backend; the panel's `tail` shows it.
- **Verify:** `node --test tests/worker.test.mjs tests/director.test.mjs`: with a fake `fetch` that answers an OpenAI-shaped script for two jobs, `startApiRun` ends `status: 'done'`, both jobs `awaiting_review`, `runs.json` +1, `calls-openai.json` equals the number of fake calls, `usage.calls` the same, the log's first line contains "on OpenAI"; a 429 on the second job → `status: 'paused'`, `pause-openai.json` with `until` ≈ now + `pauseMinutes` (or `retry-after`), job 1 stays `awaiting_review`, job 2 is `error` with a reason naming the pause, job 3 untouched (`queued`); `assertCanStart` with `pause-openai.json` present refuses an API run with 429 and still allows a seat run; `maxCallsPerDay` reached → 429 before any fetch; a cancelled run aborts the fetch (the fake `fetch` sees `signal.aborted`) and leaves the job in `error` with "cancelled"; `JSON.stringify(directorState())` and the log never contain `SENTINEL-KEY-123`; `directorEnv` cases unedited; `runEngine`'s child env has no `keyEnv` (checked through a `node -e` stub child that prints its env? no: the test calls the exported `engineEnv()` helper and asserts). Then `npm run ui` on a second port (`MOTION_STUDIO_PORT=4791`, every `keyEnv` removed from its env): `GET /api/director?project=csr-console` has `backend.kind === 'seat'`, `providers[*].hasKey === false`, no key-like value; `PUT /api/director/provider` without `X-Studio` → 403; with `{ default: 'openai', model: 'gpt-5.6' }` → 200 and the file changed in those two places only; `GET` now shows `backend.reason` naming `OPENAI_API_KEY`; `POST /api/director/run` → the seat path (503 "Claude Code was not found" on that instance's empty PATH, proving no provider call was attempted).
- [x] done (2026-10-23: server/worker/run.mjs startApiRun; startDirector branches once to startSeatRun or startApiRun; runEngine returns started/done/kill with engineEnv; recoverStale at start; GET/PUT /api/director routes; tests/worker-run.test.mjs 9 cases; second-port check on 4791 matched every expectation. Open: runAssetTask children still get the full env; recoverStale on a second instance would fail a live run on the first)

### T10 — Panel: pick the backend, see where the click goes
Depends: T9.
Files: `ui/app.js`, `ui/app.css`.
In `renderDirector`: a "Director" select (`data-dir-provider`) with "Claude seat" and each provider (label; "(no key)" appended and the option disabled when `hasKey` is false), saved through `PUT /api/director/provider`; when a provider is selected, two inputs "Model" and "Strong model" and a "Vision" checkbox with one Save; the seat's Model select shows only for the seat. The run label becomes "Run Director: 2 jobs on OpenAI gpt-5.6" / "… on Claude seat (Sonnet 5.5)". A status line under the buttons: "OpenAI is selected but OPENAI_API_KEY is not set: runs use the Claude seat." or "OpenAI calls today: 12/400". Pause line: "Paused: OpenAI quota or spend limit. Director runs are blocked until <time>." Guide text (line 1667) and the brief form note (line 1137) say "Claude Code on your seat, or the API provider you picked". The review page (`data-review`) hides the new controls as it hides every edit control.
- **Verify:** browser on the 4791 instance with no keys: the select shows "Claude seat" and five disabled "(no key)" options; the run label says "on Claude seat"; the Network tab shows no request to any provider host on load or on opening the panel. With `OPENAI_API_KEY=x` and `openai.model` set, through `page.route` stubs of `/api/director` (a real click would spend the person's quota): the label says "on OpenAI gpt-5.6", the status line shows the call count, a stubbed `pause-openai` shows the pause line with "Clear pause", a stubbed running API run shows "Director running (OpenAI gpt-5.6)" and the log tail; `npm run ui:review` → the review page shows no Director select and `GET /api/director` on 4781 returns the stub without `providers`. `npm test` green.
- [x] done (2026-10-23: ui/app.js dirBackendHtml + handlers, ui/app.css .dir-cfg. QA ran on 4791 with `/api/director` and `/api/jobs` stubbed and every write stubbed. It showed five disabled "(no key)" options, "on Claude seat (Sonnet 5.5)", "on OpenAI gpt-5.6", "OpenAI calls today: 12/400", the key-missing line, the OpenAI pause line with Clear pause, and the running line "(OpenAI gpt-5.6)" with an escaped log tail. Controls are disabled during a run, and a model id being typed survives a poll. The review page on 4792 hides `#director`, and its GET has no `providers`. No request went to a provider host. The real 4791 GET shows gemini `hasKey: true` because keys.mjs reads `.env`. The full `npm test` was not run here because another process runs render tests.)

### T11 — Live check, one job per provider the person has a key for (human-only, paid)
Depends: T10.
The person sets a key, types a model id, picks the provider, and clicks Run Director on one queued explainer job in a side project; then once with a mixed brief or a ui-story job to exercise `strongModel` and `read_image`.
- **Verify:** per provider: the log's first line names the provider and model; the job reaches `awaiting_review` with stills; `calls-<provider>.json` counts the calls; the Script tab shows a valid script whose claims trace to the source; the token totals in the log are under `maxTokensPerJob`. Record in "External system contract": whether xAI chat completions answered, Gemini's `tool_calls[].id` presence, Qwen's `reasoning_content` echo, the OpenAI `tool_calls` shape, Anthropic's thinking-block echo, and each provider's quirks that needed an adapter change (with a test fixture added for each).
- [ ] done

### T12 — Docs
Depends: T11.
Files: `README.md`, `.ai/docs/architecture.md`, `.ai/docs/file-index.md`.
README "Rules for the Director" becomes "Two Director backends": when each runs, key setup (`.env` or environment, restart), the model ids to type, what leaves the machine, costs per provider as the person's own, the local state under `logs/director/`, how to clear a pause. Architecture: the Director boundary section describes both backends, the tool table and the caps. File index: the new files and config keys.
- **Verify:** `node .ai/scripts/prose-audit.js README.md .ai/docs/architecture.md .ai/plans/api-director.md server/worker/director-prompt.md` → no findings; `node .claude/scripts/check-propagation.js` → 0 errors; `bash .ai/scripts/detect-leftovers.sh` clean; `npm test` green.
- [ ] done

## Rule changes (exact sentences)
1. `CLAUDE.md` → "Rules for using Claude here", bullet 1. Becomes: "The seat is company-owned. Claude Code runs only when a person starts it: typed `/studio run`, or the UI's Run Director button. Run Director (`server/director.mjs`) has two backends, chosen once per click: the Claude seat (`claude.exe -p` on this machine's own login, no token read, no API key added, the allowlist in `config/studio.json` → `director`; the default) and the API worker (`server/worker/`, a tool-calling loop over one provider's HTTP API with Node `fetch` and the person's own key from the `keyEnv` variable, used only when `config/providers.json` → `default` names a provider with an adapter, a model and a key). Both run one at a time, are capped in jobs, turns, time, tokens, log size, calls and runs per day, never render or approve, pause on a usage limit or a 429, never retry, and never switch backend during a run; the seat child still receives no `keyEnv` variable. No other route may invoke Claude or a text model. The one other model path is `server/generate.mjs`: …" (the rest of the bullet unchanged).
2. `CLAUDE.md` bullet 4, last two sentences. Now: "…the Director child process receives no `keyEnv` variable at all. No script-writing worker exists; the Director stays on the seat." Becomes: "…the seat child process and every engine child receive no `keyEnv` variable at all. The API worker reads one provider's key in-process, sends it as a request header only, and redacts every logged text; it is the second Director backend, not a second call site."
3. `CLAUDE.md` → NEVER summary, first bullet. Becomes: "NEVER invoke Claude or any model from `server/`, the UI, the engine, a cron or a loop — two person-clicked paths only, capped, one at a time, no auto-start, no retries: `server/director.mjs` (Run Director: the Claude seat with `claude.exe -p`, or the API worker in `server/worker/` on the one provider named by `config/providers.json` → `default`, with the person's own key from `keyEnv`) and `server/generate.mjs` (…unchanged…)".
4. `.ai/docs/conventions.md` → NEVER, the security bullet. The Director sentence becomes: "→ one exception: `server/director.mjs`. A person clicks Run Director and the local server runs one of two Director backends, chosen once at click time and shown in the log: the Claude seat (Claude Code headless, `claude.exe -p "/studio run …"`, never a `.cmd` through a shell, on that person's own logged-in seat, with the `--allowedTools` allowlist in `config/studio.json` → `director` (never render or approve), `--permission-mode dontAsk`, `--max-turns`, a key-free child environment) or the API worker (`server/worker/`, only when `config/providers.json` → `default` names a provider whose `keyEnv` is set: a tool-calling loop over that provider's HTTP API with Node `fetch`, the key in a request header only, tools bound to one project and job that write only the two draft files, `fetch_page` on the brand's allowed hosts only, caps in `director.api`: turns, tokens, calls per day, timeouts, byte caps, `maxPrepareRounds`, a pause file per provider on 429, no retry, no backend switch during a run). Both share a timeout of `jobTimeoutMinutes` × jobs, a capped log, one run at a time, a daily cap (`maxRunsPerDay`), and never render or approve. The second exception is `server/generate.mjs`: …" (unchanged). Closing sentence unchanged: "No other call site, no auto-start, no retries."
5. `.ai/docs/conventions.md` → ALWAYS caps bullet. Becomes: "ALWAYS keep director runs and asset generation capped by `config/studio.json` → `director` (max jobs per run, minutes per job, runs per day) and `director.api` (turns and tokens per job, calls per day, timeouts, bytes, prepare rounds) and `generate` (…unchanged…)".
6. Hand-written one-liners that say "except the two person-clicked paths, `server/director.mjs` (Claude Code on the seat) and `server/generate.mjs` (…)" (`.cursor/rules/core.mdc`, `.cursor/rules/project.mdc`, `.cursor/rules/workflow.mdc`, `.cursor/rules/new-feature.mdc`, `.github/copilot-instructions.md`, `.github/agents/{tech-lead,senior-dev}.agent.md`, `.claude/rules/backend-security.md`, `.claude/skills/{server-route,code-review,security-review}/SKILL.md`, `.claude/commands/workflow.md`, `.claude/agents/{tech-lead,senior-dev}.md`, `.cursor/agents/{tech-lead,senior-dev}.md`): "`server/director.mjs` (Claude Code on the seat)" becomes "`server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key)". `.claude/rules/backend-security.md` adds to its first bullet: "the worker's tools are bound to one job, write only the draft files, fetch only allowed hosts, and every call is counted and capped".
7. `config/providers.json` notes: as in Data design; no note says "not implemented".
8. `.claude/skills/studio/SKILL.md` seat header, after "Never call any model API.": "A person can also run the same rules through an API provider from the UI (Run Director with a provider selected); the rules below are shared with it and generated from `server/worker/director-prompt.md`."
9. `.ai/docs/architecture.md` → "Director (LLM) boundary": "Two backends behind one button. `pickBackend` chooses at click time … Only `startDirector` reaches either." The sentence "worker mode is not built" is removed.

Floor status after the change: no token reuse, no bypass flags, one call site for text models (`startDirector`) with two backends, one for assets. The worker's caps, its tool table, its single entry point, its key handling and the no-retry, no-switch rules are Floor items: loosening any of them needs the user.

## Acceptance criteria
- [ ] Run Director panel (real UI, 127.0.0.1:4780): with `default: 'seat'` the run label says "on Claude seat" and a click starts `claude.exe` as today (the log's first line says "on the Claude seat"); `tests/director.test.mjs` passes unedited.
- [ ] With a provider selected and its key set, the label says "on <Provider> <model>", a click runs the API loop, and the job reaches `awaiting_review` with stills visible in the Preview tab and a script in the Script tab whose scenes carry `source` refs (T11, per provider).
- [ ] With a provider selected and no key, the panel says so in one line and the click runs the seat; nothing is sent to any provider (Network tab on load and on click, and `calls-<provider>.json` absent).
- [ ] No fallback: a fake 429 mid-run (test) leaves the run `paused`, the current job `error` with a reason, later jobs `queued`, and no `claude.exe` spawn; the panel shows "Paused: <Provider> …" with Clear pause; `DELETE /api/director/pause` clears it.
- [ ] Caps hold: `maxTurnsPerJob`, `maxTokensPerJob`, `jobTimeoutMinutes`, `maxCallsPerDay`, `maxPrepareRounds`, `maxImagesPerJob`, `maxDraftBytes`, `maxFetchBytes`, `maxPageChars`, `requestTimeoutSeconds`, `maxResponseBytes` each have a test that trips them, and the message names the config key.
- [ ] Confinement: no tool takes a project, job or path; `read_job_file` is an enum; `read_image` goes through `assertFileName` + `within`; `write_draft` writes only `source.draft.json` / `script.draft.json`; `fetch_page` refuses a host outside `sources.allowedHosts` on the first and on every redirected hop (tests).
- [ ] Never render or approve: the tool table has no `render`, `approve`, `sequence`, `reset-dirty` and no generic file or shell tool (a test lists the tool names exactly); `prepare` goes through `runEngine` with the engine slot and the kill timer.
- [ ] Key hygiene: the key is in one header per call; `GET /api/director` and `GET /api/state` carry `hasKey` booleans; the log, the run object, `status.json`, every tool result and every error text pass the sentinel-key test; the seat child and engine children get `directorEnv`.
- [ ] One place for the rules: the skill's generated block equals `server/worker/director-prompt.md` (`tests/worker-prompt.test.mjs`); a change to the shared file without running the sync script fails `npm test`.
- [ ] `npm test` passes without network (the test file sets `globalThis.fetch` to a thrower); `node .claude/scripts/check-propagation.js` reports 0 errors; the server still binds to 127.0.0.1 and the Host, Origin and `X-Studio` checks run before the new route (403 without the header); the review link answers the Director stub without providers.

## Risks & impact
- Provider drift. OpenAI's newest models need the Responses API for tools, xAI's docs no longer show chat completions, Gemini's compatible endpoint is beta, DashScope moved to per-workspace hosts. Phase 1 covers what the chat-completions shape still reaches; T11 records the truth per provider and the Responses adapter (phase 2) is the planned answer. The panel shows the provider's own error text, redacted, so a dead endpoint is a visible 502, not a silent seat run.
- Quality differs by model. A weaker model may write claims the source does not support or miss `source` refs. `validateScript`, `validateSource` and lint are the same gate as for the seat; what they cannot catch (a wrong icon, a misread number) the person catches at review, as today. `strongModel` plus the existing `routing.strongTemplates` sends the hard jobs to the better id. Expect more `fail` outcomes and more two-round lint loops than on the seat; the caps bound the cost of a bad job.
- Cost. Each turn re-sends the system prompt and the context (10–30k tokens). At 25 turns a job is 250k–750k input tokens: roughly $0.30–$1 on a $1.25/M model, $4–$11 on a $15/M model, less with prompt caching (Anthropic `cache_control` is in the adapter; OpenAI caches automatically). The caps make the worst case per job finite; the person sets a spend limit at each provider and reads the usage line in the log. No price lives in code.
- Tool-call quirks. Missing call ids, several calls per answer, `arguments` that are not JSON, `reasoning_content` that must be echoed, thinking blocks that must be echoed unchanged. The adapters keep assistant messages verbatim and generate ids when absent; a fixture per quirk found at T11 pins it.
- Context size. `directorContext` includes the brand, the composed `beats.json` and transcripts. Transcripts are cut at 400 segments per asset; the rest is small. If a provider refuses a request as too large (413), the job fails with a message naming the provider; shrinking the context further is a later change.
- The loop runs inside the UI server process. A bug in the loop surfaces as a failed job, not a crashed server: every tool call and every adapter call is inside the loop's try, and `run.mjs` finishes the run the way `finish` does for the seat. A server restart mid-run loses the loop; the next click sees the jobs in `error` (set by `finish` on exit? no: on exit the loop dies without `finish`, so the jobs stay in `scripting` until the next `startDirector`, which `planRun` refuses with "not waiting for the Director"). Add `recoverStale` to T9: on server start, any job in `scripting` whose `history` last event is from `director-<provider>` goes to `error` "The server stopped during a Director run. Click Run Director again." A seat run has the same gap today, but its child is killed on exit; the API run has no child to kill.
- Shared code touched: `engine/cli.mjs` (`context` output unchanged; consumers: the seat skill, three test files), `server/generate.mjs` (imports moved; `tests/generate.test.mjs` unedited), `server/director.mjs` (branch + extraction; `tests/director.test.mjs` unedited plus appended cases), `server/server.mjs` (`runEngine` return value additive; env stripped: engine children never needed a key), `.claude/skills/studio/SKILL.md` (same rules, generated block). Templates, locks, statuses, `source.json`/`script.json` shapes: untouched.
- Rule drift. The 18 hand-written one-liners in "Rule changes" item 6 are covered by T1's grep; `check-propagation.js` covers the generated blocks and CLAUDE.md. A reviewer running the security-review skill before T1 lands would flag `server/worker/` as Critical: T1 goes first.
- `.env` and keys. `server/keys.mjs` already loads `OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `DASHSCOPE_API_KEY` once `providers.json` names them (it reads `keyEnv` names from the file). `ANTHROPIC_API_KEY` in `.env` now has a consumer; `directorEnv` still strips it from the seat child, so the seat cannot pick it up.
- Corporate proxy. Node `fetch` ignores `HTTP_PROXY`; a proxied network sees "Could not reach OpenAI: fetch failed". Out of scope, as for Generate.
- Spikes left: T11 per provider (wire quirks, which models answer with tools, image handling on Gemini and Qwen). All live, paid, human-only.

## Verification
- Baseline before T1 (2026-10-23): `npm test` 392/392 pass.
- After T1–T10 and the security-review fixes (2026-10-23): `npm test` 521/522. The one failure is `tests/scene-video.test.mjs` in `engine/playcheck.mjs` `freshLoad` (`page.reload: net::ERR_HTTP_RESPONSE_CODE_FAILURE`), code another session is changing; no file of this plan is in its stack. Security review: no critical finding; 2 medium and 4 low fixed with tests (review link hides providers, `maxFetchesPerJob`, one tool call per Anthropic turn, per-turn result budget, body-read errors, log stream errors, busy engine keeps the prepare round, private addresses and non-default ports refused, https `baseUrl`). Open: DNS rebinding between the check and the fetch (needs a pinned agent).

## Loop autonomy & process invariants
- No pop-up questions except at T11, which spends the user's money with the user's keys: the loop stops before it and asks.
- Full gate per task: IMPLEMENT → CODE_REVIEW (security-review skill on every diff touching `server/`, `engine/cli.mjs`, `config/` or the skill) → VERIFY → UNIT_TEST → QA for T10.
- No commit tooling: the folder is not a git repository. Record Verify results in this file.
- Never loosen a cap, the host rule, the header, the tool table, the single entry point or the no-retry rule to make a gate green; report instead.

## Resume across quota reset
On "You've hit your session limit", come back after the reset and re-run the same loop command or `claude --continue`. The loop reads the task checkboxes and the Loop Journal and continues from the first open task. Keep `npm run ui` running for T9 and T10. Do not schedule anything unattended.

## Loop Journal
<`<iso-ts> | iter N | <gate> | <failure-signature or "green"> | <action taken>` — one line per iteration.>

## What the loop built
<Written on DONE: one plain sentence for a stakeholder, then 3-6 sentences a teammate needs.>
