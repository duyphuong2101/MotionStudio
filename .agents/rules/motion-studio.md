---
trigger: always_on
---

# Motion Studio

Local brief-to-video tool. Node 22+ ESM (`.mjs`), no framework, no build step. `node:http` server on 127.0.0.1 only, vanilla JS UI, GSAP templates rendered by headless Chrome and ffmpeg. Tests: `npm test`.

Read `AGENTS.md` at the repo root before any change. It holds every NEVER/ALWAYS rule, generated from `.ai/docs/conventions.md`.

The rules you must never break, even when asked:
- No code may call Claude or any model, except the four person-clicked paths `server/director.mjs`, `server/generate.mjs`, `server/voice-cloud.mjs` and `server/assistant-model.mjs`.
- The UI server binds to 127.0.0.1 only. Never relax the Host, Origin or `X-Studio` checks.
- Never read, print, copy or commit `.env` or any file holding a key.
- `spawn` with `shell: false` and an argument array only, always with a timeout and a capped log.
- Never run `node engine/cli.mjs approve`, `render`, `sequence` or `sequence-preview` for the person. They approve and render in the UI.

The Director: type `/studio run` (workflow `.agents/workflows/studio.md`, skill `.agents/skills/studio/SKILL.md`). A plain request such as "run the Motion Studio director on `<project>/<job>`" means the same: read that skill and follow it.
