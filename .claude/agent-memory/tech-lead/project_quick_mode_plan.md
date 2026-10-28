---
name: quick-mode-plan
description: 2026-10-28 quick-video plan — outline-in, engine-expands Director mode for weak models and any coding agent; decisions fixed by the user and the coordinator; open questions
metadata:
  type: project
---

Plan `.ai/plans/quick-video.md` (2026-10-28, status planning). Quick mode: the Director writes a short outline (headline, 2-5 points with `source`, optional cta, mood); `cli commit <p> <j> outline` expands it over a declarative `beats.quick` block into `script.json` (`generated: "outline"`, `look` from mood), then the normal pipeline. Mechanical repairs (icon, enum, over-max scenes, ids) at every commit, reported; over-limit text is always an error naming the cut.

**Why:** the user wants quality to come from the deterministic engine, not the model: GPT/Gemini/Grok/Qwen/Claude API providers and any coding agent (Cursor, Copilot, Antigravity, unnamed ones via `AGENTS.md` + `.agents/skills/studio/SKILL.md`) must make a finished-looking simple video. Verified before planning: no job has ever been made by the API worker (`director-<provider>` never appears in any `status.json`); the full Director context is ~26 KB plus ~12 KB of rules.

**How to apply:** do not reopen: outline mode, "engine never rewrites words", Windows only, the three first templates (explainer, product-demo, social-teaser; promo is phase 2 with an `offer` block). The coordinator took the approve/render guard for non-seat agents out of this plan (likely the CLI `approve` command goes away). Open with the user: a `theme` change counting as a layout change in `pacing`; product-demo 3+ points without a number (warning vs error); brand fields winning over the mood's look. Writing tip for plan files here: `node .ai/scripts/prose-audit.js` flags plans whose bullets mostly start with `**`, so keep `Files:`/`Verify:` labels unbolded in the task breakdown.
