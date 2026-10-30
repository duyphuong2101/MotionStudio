# settings-tab — one Settings tab for providers, keys and models

**Status:** in-review
**Author:** tech-lead
**Branch:** master
**Created:** 2026-10-30
**Risk tier / auto-enabled phases:** secrets (a write path into the root `.env`) → security review; server boundary → route test

## Intent
The provider, key and model choices are spread over the Jobs tab (Director), the Brand tab (Generate), `config/studio.json` (Assistant, cloud voice) and a hand-edited `.env`. The CSR dashboard keeps them on one Settings page. Motion Studio gets the same: one tab where the person sees every key's state, enters or removes a key, and picks the model for each use.
**For whom / outcome:** the person running Motion Studio; no hand-editing of `.env` or JSON to connect a provider.

## User decisions
- 2026-10-30: build the Settings tab, and allow entering a key in the UI ("có" to both questions).
- 2026-10-30 (same turn): like the CSR dashboard, a provider is connected with its key and a Connect, and the models each use takes are picked from that provider's list. The Assistant therefore runs on any connected API provider, through the API worker's adapters.

## Scope
- [x] `server/settings.mjs`: `allowedKeyNames`, `keyState` (set / where from, never a value), `saveKey` and `removeKey` (rewrite the one `NAME=` line of the root `.env`, atomic, then update `process.env`), `saveAssistantSettings` (writes `config/studio.json` → `assistant`, checked against the fetched model list).
- [x] `server/server.mjs`: `GET /api/settings`, `PUT|DELETE /api/settings/keys/:name`, `PUT /api/settings/assistant`; never on the review link; keys loaded from `.env` at start are remembered so the tab can say where a key comes from.
- [x] `server/generate.mjs`: the fetched model list keeps Gemini text models as kind `text` (the Assistant's choices); image and clip choices unchanged.
- [x] `server/worker/models.mjs` + `modelsRequest` / `modelsFrom` in both adapters: Connect, one model-list GET per click, capped by `settings`, chat models saved under `logs/providers/`.
- [x] `server/assistant-model.mjs`: `provider:model` refs, one `pick_intent` tool call through the adapters (OpenAI, Grok, Qwen, Claude API, Gemini's compatible endpoint), a pause file per provider, config read on every call so a saved setting applies without a restart.
- [x] `ui/settings.js` + a Settings nav entry: API keys (password field, Save, Remove), Director (provider, model ids), Generate (default image and clip model, Refresh models), Assistant (freeform, models, daily cap), hidden on the review link.
- [x] Tests: `tests/settings.test.mjs`; `tests/generate.test.mjs` for the text kind.
- [x] Docs: conventions.md (the `.env` write path), CLAUDE.md, file-index, mirrors.

## Out of scope
- Showing, copying or exporting a key's value. The server never returns it.
- A key for a name that is not a `keyEnv` in `config/providers.json` or `voiceCloud.keyEnv`.
- Overriding a key that comes from the real environment (the environment wins; the tab says so).

## Key safety
- Write-only: the value goes in a `PUT` body over 127.0.0.1 with the Origin and `X-Studio` checks; the answer is `{ name, hasKey, source }`.
- Name from the allowlist only; value `^[A-Za-z0-9._:+/=-]{8,512}$` (no spaces, quotes, `#` or newlines, so it cannot add a second line).
- The `.env` file is rewritten line by line through a temp file in the repo root and a rename; other lines stay byte for byte.
- No log line carries the value; the error text never echoes it.

## Verify
- `node --test tests/settings.test.mjs tests/generate.test.mjs tests/assistant-model.test.mjs tests/assistant.test.mjs tests/worker-adapters.test.mjs`.
- Live on a spare port: the settings state carries no key value; a bad key name 400, a bad value 400, no `X-Studio` 403; Connect Gemini listed 17 chat models; Connect seat 400; the Assistant save took connected refs and refused `openai:gpt-9`; three asks through the adapter answered in 0.9-1.9 s (brand, status, a refused delete).
- The key save itself is covered by the temp-file tests; the live check did not write the real key file.
