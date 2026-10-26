---
name: gemini-personal-key-decision
description: User decided (2026-10-15) a personal Gemini API key may generate brand assets from the Brand tab; the "no model from server/" Floor gets a second narrow exception. Google Flow stays out of scope.
metadata:
  type: project
---

On 2026-10-15 the user decided Motion Studio may generate brand images (Gemini "Nano Banana") and short clips (Veo) through the Gemini API with the user's own personal API key (Google AI Studio, own Cloud Billing). Plan: `.ai/plans/gemini-asset-worker.md`.

**Why:** the user wants product/scene visuals without leaving for AI Studio and re-uploading. There is no company Google key. Google Flow has no public API, so Flow stays manual (download, then upload as an asset); automating its UI or reusing its session is not allowed. The Google AI Pro subscription quota only applies in the AI Studio web UI, so nothing may use that session.

**How to apply:** treat `server/generate.mjs` (once built) as the second person-clicked, capped model path next to `server/director.mjs`, not as a Floor violation. Hard conditions the user set: key only in env `GEMINI_API_KEY` (named by `keyEnv`), never logged or sent to the UI; one asset per click; never triggered by the Director, pipeline, cron, loop or retry; generate-once-and-persist with a sidecar; caps in `config/studio.json` → `generate`; pause on 429; English text; a one-line data notice before the first generate per project. If a later request would loosen any of these (auto-generation, Director access, key in a file), that is a new decision for the user, not a judgment call. See [[csr-console-ui-story-priority]] for the user's main project.
