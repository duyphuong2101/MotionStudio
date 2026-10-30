---
paths:
  - "server/**/*.mjs"
  - "engine/**/*.mjs"
  - "templates/**/*.mjs"
  - "config/*.json"
---

# Server / engine / template security rules (path-scoped)

These load only when working in `server/`, `engine/`, `templates/` or `config/`. **Source of truth is `.ai/docs/conventions.md` (NEVER section)**; this is a path-scoped pointer, not a second copy. If a rule changes, edit `conventions.md` and run `node .claude/scripts/check-propagation.js`. Full review checklist: the `security-review` skill.

- No code path invokes Claude or any model, except the four person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key; two Director backends, chosen once per click: the seat runs `claude.exe -p` with the allowlist, `--permission-mode dontAsk`, capped; the worker's tools are bound to one job, write only the draft files, fetch only allowed hosts, and every call is counted and capped) and `server/generate.mjs` (Gemini assets with the person's own key: `GEMINI_API_KEY` from the environment, header only, capped by `config/studio.json` → `generate`) and `server/voice-cloud.mjs` (Make cloud voice: each missing line once to ElevenLabs with the person's own key, `voiceCloud.keyEnv`, header only, capped by `voiceCloud`; prepare only reads the saved take) and `server/assistant-model.mjs` (the Assistant panel, user decision 2026-10-30: with `assistant.freeform` on and a model picked in the composer, a line the parser does not know goes once to a connected API provider's model with the person's own key for it, header only, capped by `config/studio.json` → `assistant`; the model only names one of the panel's intents and the person still approves the card); no CLI token reuse; no `--bare` / `--dangerously-skip-permissions`
- Server binds to 127.0.0.1 only; keep the Host (421) and Origin + `X-Studio: 1` (403) checks. The opt-in review link (`server/review.mjs`) is the one exception: one private IPv4, GET/HEAD allowlist via `reviewRoute`, access code; never add a write route or a Director/Generate route to it
- Keys only in env vars named by `keyEnv`; never a key value in a file, except the gitignored root `.env` that `server/keys.mjs` reads once at server start for the `keyEnv` names only (environment wins, no value logged or returned)
- `spawn` with an argument array, `shell:false`, `windowsHide:true`, a timeout and a capped log
- Outside ids and file names → `assertId` / `assertFileName` + `within()`; never `path.join` on input
- Text into composition HTML → `escapeHtml` (`h`); JSON into `<script>` → `jsonForScript`
- Uploads → `cleanAssetName`, `ASSET_TYPES`, `maxBytesFor`; served with `ASSET_HEADERS`
- Errors to the client are `StudioError` messages; a 500 returns the generic text, never a stack
- Director fetches only hosts in the brand's `sources.allowedHosts`
