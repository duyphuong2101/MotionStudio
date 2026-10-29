# review-2026-10-28-fixes — fix every finding from the full-repo review

**Status:** in-review (code done; three items wait on the user, see "Waiting on the user")
**Author:** senior-dev (this session)
**Branch:** master
**Created:** 2026-10-29

## Intent
A full-repo review on 2026-10-28 (6 parallel agents: server, engine, media, templates, UI, tests/tooling) produced 77 findings. The user asked to fix all of them, P0 → P1 → P2, one commit per cluster, tests run after each. This file tracks which findings are fixed, so a session restart does not lose track.

This is a bug-fix sweep, not a new feature: each item already had a root cause and a proposed fix from the review. Verification is the existing or added test, plus a browser or ffmpeg check where a test cannot reach.

## Done (commit, then what)

### P0
- [x] 854ad6f Seat Director runs on its own allowlist (`--setting-sources user`, `--strict-mcp-config`); `UNSAFE_RULE` refuses broad node/npm rules; the missing Cursor `ask-before-render.js` hook added and wired.
- [x] 9b61177 Namespaced `<s:script>` refused in SVG uploads; job and preview assets served with the sandbox CSP.
- [x] 962bf00 + 0e07f47 Seat Edit narrowed to the three draft files; composition page CSP (no sandbox: Preview reads `frame.contentWindow.seek()`); `connect-src 'self' blob:` after Chrome showed `'none'` broke the .glb fetch and then `blob:` textures.
- [x] fc9dfd6 Lottie light player (no expression eval); uploads with expressions or outside pictures refused.
- [x] 7de6bc7 Typed and swapped text never through TextPlugin's innerHTML (kit `typeText`, ui-story `swapText`).
- [x] adcb3c7 Voice-take cuts seek on the input side (scene 2 on were silent).
- [ ] P0-8 interactive-session gaps — **waiting on the user** (protected files). `/deploy-check` narrowed in the working tree, not committed yet.

### P1
- [x] 115ccdd `dirty_from` read whatever the status.
- [x] 0b08aec CSV `#` rows inside a table are data.
- [x] 91324d5 Scene `source` refs checked against source.json (commit and UI save refuse; prepare warns).
- [x] 592d772 Locks: dropped or re-sourced edited scenes refused; carried locks rechecked on a second template change.
- [x] b10a7dd Seat may not read secret files; seat log redacted.
- [x] 1b1f9ff UI page not frameable; stream and child `error` listeners; a crashed engine child's busy job goes to error; suffix ranges.
- [x] 45be1ca UI: Brand tab stays in its project; Script/Source save refuses a stale copy (stamp, 409); banner errors stay; review hides file buttons.
- [x] e206e35 Templates: before-after `.mk` → `bamk` and kit collects only real marks; `markWords` keeps a mark whole; SplitText class `kitline`; product-tour themed title plate; decal size by host scale. Also re-records templates.test hashes that 7de6bc7 left failing.
- [x] fa9e7b9 Stereo final mix and music bed at the old balance (+3.01 dB music).
- [x] ce1f48a Clip frames converted BT.709 TV → JPEG range.
- [x] 6dc5363 Stress ramp sampled every 120 samples.
- [x] 3bb0951 Change-aware runner sees spawned entries, shared template modules, listTemplates, kit files read by tests, moved imports; server-evidence port.
- [x] 3f46224 A server start does not reset another live server's API-run jobs.
- [x] cdb77ae Chrome tests fail on a broken page; run.mjs prints skips.
- [ ] P1-E7 look vs a brand's explicit "off" — **waiting on the user** (product decision, see below).

### P2
- [x] 165bf35 Cross-site `/api` GETs refused; one Director run across servers; runEngine one run per job; video uploads one at a time, no second copy; fetch_page blocklist; worker-run loops bounded.
- [x] 93b76d6 SVG icon size limits before the even-odd pass; .glb outside uris refused; atomic built-in media; PowerShell by full path; ffmpeg stdin EPIPE; pack-glb texture steps down; render Chromes must load the same fonts.
- [x] 2a174c1 Finished run's unscripted job → error; null scene / non-text field refused; QA checks video track and size; sequence captions stop at the next part; half-failed delete rolls back.
- [x] 08a203f logo-reveal digit-first ids; long words fit their heading (`fitWords`).
- [x] 96783e4 product-tour `sameModel`; lifestyle dark frames (centre shade, photo cta); exact font/image file patterns.
- [x] ce62e63 UI: preview stops with its job; bounded ready waits; polls keep the focus; one note post at a time, IME-safe; Shots list and sub-tab roles.
- [x] 73a40d9 Docs: CLAUDE.md seat rules, kit-process, file-index.
- [ ] P2-D1 `security-lint.js` repo patterns — **waiting on the user** (protected hook file).

### Looked at and left as is (with the reason)
- talking-head's video seek resolves on a 1.5 s timeout: renders use pre-cut frames; rejecting would fail a prepare under load, a worse failure than a stale still.
- explainer's `#xicon` outside the scene group: it is the persistent icon that morphs across step cuts by design (like the carry bar); following each scene's camera would make it jump at every cut.
- `.claude/state/model-tier.json` "missing": a runtime file statusline writes; the docs are right.
- Seat run counts into RUNS_FILE and checks `files.runs`: the same file in production; only an injected test `files` differs.
- A seat-run caps test with a fake claude.exe: not added (needs an injectable spawn); the caps logic is unchanged.

## Waiting on the user
1. P0-8: `.claude/settings.json` (`Bash(node -e *)` from allow to ask) and `.claude/hooks/block-destructive.js` (`node -e … readFileSync('.env')`, `npm run studio -- render|approve|sequence`); then the conventions NEVER line about "no coding agent can pass the review from a shell" can stay true. Both files are self-protected; editing them needs the user's go-ahead.
2. P2-D1: `.claude/hooks/security-lint.js` (same protection).
3. P1-E7: the Brand tab has no "unset" vs "None" for backdrop, wipe, motion, cut sound and music, so a look fills a field set to "None". Fixing it needs a third choice in the UI and a stored "off" value that every template reads; a product decision, not a bug fix.

## Verify
Each commit names its tests. Before closing: `npm test` in full (in progress at the time of writing).
