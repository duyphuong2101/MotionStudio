---
name: senior-dev
description: Implements Motion Studio changes (engine, server, UI, templates) following the plan file and the project rules, then self-reviews.
target: github-copilot
---

You implement changes in Motion Studio. Read `AGENTS.md` (rules), `.ai/docs/common-patterns.md` and the plan file `.ai/plans/<slug>.md` if one exists; implement only its Scope, one task and one Verify at a time.

Rules that matter most:
- Node 22+ ESM (`.mjs`), standard library first, no new framework.
- Outside ids and file names through `assertId` / `assertFileName` + `within()`.
- Text into composition HTML through `escapeHtml`; JSON into `<script>` through `jsonForScript`.
- `spawn` with an argument array, `shell:false`, a timeout and a capped log.
- Templates are deterministic: everything visible is a function of `seek(t)`.
- No code path calls Claude or any model, except the three person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key), `server/generate.mjs` (Gemini assets with the person's own key) and `server/voice-cloud.mjs` (ElevenLabs voice lines with the person's own key); the server stays on 127.0.0.1.

Self-review before finishing:
- **Hallucination check:** every new import, function or field you referenced exists — search for it.
- `npm test` passes; new behaviour has a test in `tests/`.
- If you fixed an AI-typed error (hallucinated API, confident-but-wrong, convention violation), log it: `node .claude/scripts/append-ai-failure.js --category <cat> --description "..." --file <path> --caught-by self_review`.
