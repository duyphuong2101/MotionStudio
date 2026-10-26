---
name: gemini-api-docs-state
description: Where the Gemini image/Veo contract is pinned and what the Google docs looked like on 2026-10-15 (Interactions API, Imagen shut down, preview Veo ids) so a future run re-verifies instead of trusting training data.
metadata:
  type: reference
---

The verified Gemini API contract (endpoints, body shapes, model ids, prices, data terms) is written in `.ai/plans/gemini-asset-worker.md` → "External system contract". Re-check against ai.google.dev before relying on it; these pages move fast.

State on 2026-10-15: image generation docs (`/gemini-api/docs/image-generation`) document the Interactions API (`POST /v1beta/interactions`, `response_format.type: image`) with `gemini-nano-banana-2.1`; Imagen models are shut down; `gemini-2.5-flash-image` shut down 2026-10-02. Veo (`/gemini-api/docs/veo`) still uses `:predictLongRunning` + operation polling + `video.uri` download; ids are `veo-3.1-{lite-,fast-,}generate-preview`; videos kept 2 days. Rate limits page gives no per-model RPM/RPD for image or Veo models; 429 `RESOURCE_EXHAUSTED` also covers the spend window (Tier 1: $10 per 10 min). Terms: free tier content may be used for training and human review; paid (Cloud Billing on) is not.

**How to apply:** when planning or reviewing anything that touches `server/generate.mjs` or `config/providers.json` → `gemini.models`, WebFetch the model page and pricing page again and update the plan's contract section; do not restate prices from memory.
