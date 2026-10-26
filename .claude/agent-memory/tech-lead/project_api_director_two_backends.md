---
name: api-director-two-backends
description: 2026-10-23 user decision — Run Director keeps the Claude seat and gains an API-provider backend (OpenAI, xAI, Gemini, Anthropic API, Qwen) picked at click time; no mid-run fallback; plan in .ai/plans/api-director.md
metadata:
  type: project
---

Run Director has two backends, chosen once per click: the Claude seat (default) or an API agent loop in `server/worker/` on the one provider named by `config/providers.json` → `default`, only when that provider's `keyEnv` key is set and a model id is typed. Decided 2026-10-23 (first version of the brief said "replace the seat"; the user changed it the same day to "two backends, seat stays live").

**Why:** the seat is company-owned and can be paused or busy; the person wants storyboards to keep coming on their own provider account, with the same caps and review gate. Keys are personal (own billing); brief/brand text may go to these providers.

**How to apply:** any plan touching the Director must keep both paths; selection happens at click time and is shown on the Run button and in the log; an API error, 429 or missing key fails or pauses that run and never restarts on the seat; `directorEnv` keeps stripping every `keyEnv` from the seat child. No retries, no auto-start, no per-brief `director` override yet (old briefs already carry `seat` from `validateBrief`). Phase 2 is an OpenAI Responses adapter (GPT-6 and xAI need it for tools). Related: [[gemini-personal-key-decision]].
