# review-fixes-2026-10-23 — Fix the findings of the in-depth functional review

**Status:** in-review
**Author:** lead session (five senior-dev agents, one per file set)
**Branch:** none (the folder is not a git repo)
**Created:** 2026-10-23
**Risk tier / auto-enabled phases:** server boundary + job state + template look → security review, engine tests, USER_REVIEW with stills

## Intent
The person asked for an in-depth review of the tool, then asked to fix everything it found.
**For whom / outcome:** the people who make videos with Motion Studio. Jobs stop getting stuck, edits and locks stop getting lost, no engine child sees an API key, and brand options work in every template.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| One agent, all fixes in sequence | no file clashes | hours of wall time, one long context | ❌ too slow for 60+ findings |
| Five agents split by file ownership, lead does the joins | parallel, no two agents edit one file | cross-file contracts must be named up front | ✅ contracts: `failed: 'render'`, `status.stale/staleReason`, QA `normalised`, `keyFreeEnv`, `commitBase` |

## Scope
- [x] Server: key-free env for every child (`engineChild`), usage-limit pause only on Claude Code's own messages, reset `preparing` on an early Director end, restart recovery from `logs/inflight/<pid>.json`, a seat run holds an engine slot, review link (preview gating, serve-only music/sfx, no generate state, adapter choice), 400/413 handling, pinned `fetch_page`.
- [x] Engine jobs: cleared locked source fields stay cleared, platform/director edits keep the approval, format re-runs prepare only, locks that still fit carry across a template or mix change (`script.locks.json`), sequence `stale`, `reset-dirty` validated, voice-take one-miss tolerance, QA reads `-inf` as silent.
- [x] Engine pipeline: `keyFreeEnv` on in-process spawns, retry render from `error` with `failed: 'render'`, ffmpeg timeouts and `killTree`, single-video music loops, too-short warning, `assertCommittable`, sound clip scenes hold for the voice.
- [x] Templates: marks wrap per line (circle limit 10), flash words never break, `video.html` inlines three.js and the model, product-demo / social-teaser / app-walkthrough on `kit.page()`, playcheck compares classes, canvas and video time, clip seek checks its frame, close cuts, caption band vs content area, logo on dark accent scenes.
- [x] UI: unsaved-edit guard on actions, panes locked while busy, per-job in-flight lock, connection banner, upload pre-check and progress, fonts.files and logoBug controls, palette and number validation, escaping, observers disconnected, Generate disabled at its cap, review-mode guards, Retry render, stale sequence badge, review preview queue.
- [x] Docs: CLAUDE.md (Generate makes images only for now), studio SKILL.md and director-prompt.md (carried locks), template-authoring SKILL.md (mixable note).

## Out of scope
- Render resume or checkpoints (a feature, not a fix).
- Veo clip generation (phase 2 of `gemini-asset-worker.md`).
- Self-hosting the UI's Google Fonts.
- Making product-demo and app-walkthrough mixable.

## Verify
- `npm test` full suite after the five agents and the lead's joins: 671/671 pass.
- Independent read-only review of the batch found 6 more; fixed 5 (probe failure no longer resets a live server's jobs, "Claude usage limit reached" pauses, a draft finished before a timeout still commits, the review link serves only previews already made, music loops cap at 32 copies). The sixth (module-script rewrite in `htmlvideo.mjs`) does not apply: the only module script is fixed code with no scene text.
- After those fixes, two full runs overlapped a restarted UI server building previews and a second `npm test` from another session; only Chrome/ffmpeg-heavy tests failed, all on timeouts. Rerun alone: cinematic, cuts, frames, playcheck 34/34 pass. The ffmpeg timeout floor went from 60 s to 180 s as a result.
- Still to do: one clean full `npm test` on a quiet machine, stills of product-demo and app-walkthrough with a real brand (USER_REVIEW), a browser pass of the UI.
