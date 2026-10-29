# review-2026-10-28-fixes — fix every finding from the full-repo review

**Status:** in-progress
**Author:** senior-dev (this session)
**Branch:** master
**Created:** 2026-10-29

## Intent
A full-repo review on 2026-10-28 (6 parallel agents: server, engine, media, templates, UI, tests/tooling) produced 77 findings. The user asked to fix all of them, P0 → P1 → P2, one commit per cluster, tests run after each. This file tracks which findings are fixed, so a session restart does not lose track (the previous attempt at this task was interrupted with zero commits made).

This is a bug-fix sweep, not a new feature — no "for whom / outcome" or "options considered" sections apply; each item below already has a root cause and a proposed fix from the review itself. Verification is: the existing or added test, plus (for anything a test cannot reach, e.g. hook wiring) a manual read-back.

## Scope — tracked by finding, most severe first

### P0 (breaks the security Floor or a whole feature)
- [x] P0-1 Seat Director isolated from project/local `settings.json` and project MCP servers (`server/director.mjs` `directorArgs`: `--setting-sources user`, `--strict-mcp-config`, `--mcp-config {}`; `UNSAFE_RULE` now also rejects a broad `Bash(node ...)`/`Bash(npm ...)` rule). Test: `tests/director.test.mjs`.
- [ ] P0-2a `Edit(out/**)` narrowed to `*.draft.json` only (`config/studio.json` director.allowedTools) + preview iframe gets a `sandbox` attribute (`ui/app.js`).
- [x] P0-3 SVG script-element check widened (namespaced `<s:script>`) + `ASSET_HEADERS` sent on `/files/.../assets/*` and `/tpreview` (`engine/assets.mjs`, `server/server.mjs`).
- [ ] P0-4 Lottie: vendor `lottie_light.min.js` (no expression engine) + reject uploads with an expression (`x`) field or non-embedded image asset (`engine/vendor.mjs`, `engine/lottie.mjs`).
- [ ] P0-5 GSAP TextPlugin `text:` tweens replaced with a `textContent`-based reveal so brief/script text is never parsed as HTML (`templates/kit.mjs` `typeText`, `templates/promo`, `templates/code-story`, `templates/ui-story`).
- [ ] P0-6 Voice-take per-scene cut: seek on the input side (`-ss`/`-t` before `-i`), not the output side, so `afade out` times against the cut's own length (`engine/voicetake.mjs`).
- [x] P0-7 Missing Cursor hook `.cursor/hooks/ask-before-render.js` created and wired into `.cursor/hooks.json` (`beforeShellExecution`, asks before render/approve/sequence).
- [ ] P0-8 Interactive-session gaps: move `Bash(node -e *)` to ask in `.claude/settings.json`; narrow `/deploy-check` away from `node engine/cli.mjs:*`; extend the secret-read hook regex to catch `readFileSync('.env')`-shaped Node reads.

### P1 (wrong data or real UX/data loss, not a security floor break)
- [ ] P1-E1 `dirty_from` read regardless of job status, not only when status is literally `dirty` (`engine/pipeline.mjs`, `server/server.mjs`, `engine/jobs.mjs`).
- [ ] P1-E2 CSV evidence: `#`-prefixed row only treated as a comment before the header, or only when it has no delimiter (`engine/evidence.mjs`).
- [ ] P1-E3 `validateScript` checks `source` against `source.json`, reusing quick mode's `sourceError` (`engine/script.mjs`).
- [ ] P1-E4 Quick mode: lock a point's `source` together with its text; refuse a commit where a locked scene's `source` changed (`engine/quick.mjs`, `engine/jobs.mjs`).
- [ ] P1-E5 A scene with field locks dropped by a Director draft is kept or the commit fails naming it, instead of silently vanishing (`engine/jobs.mjs`).
- [ ] P1-E6 Carried-over locks recomputed (or dropped) on a second template/mix/quick change instead of going stale (`engine/jobs.mjs`).
- [ ] P1-E7 Brand validation stores explicit "off" values (`backdrop: none`, `wipe: none`, `motion: standard`, `sfx.cut: none`, `duck: false`) so a look cannot override them (`engine/brand.mjs`, `engine/looks.mjs`).
- [ ] P1-S1 Director can read `.env` via `Read`/`Grep`/`Glob` with no path limit; seat log not redacted (`config/studio.json`, `.claude/hooks/protect-files.js` parity, `server/director.mjs` log `write()`).
- [ ] P1-S2 `X-Frame-Options: DENY` / `frame-ancestors 'none'` on the main UI page, not only the review link (`server/server.mjs`).
- [ ] P1-S3 Unhandled stream/child-process `error` events: `stream.pipeline` instead of bare `.pipe()`, `.on('error')` on log streams and children (`server/server.mjs`).
- [ ] P1-S4 Engine child crash outside prepare/render's try/catch leaves the job stuck busy — set to `error` on a non-zero exit if still mid-step (`server/server.mjs` `runEngine`).
- [ ] P1-T1 before-after `.mk` class renamed so it stops colliding with the kit's marks selector (`templates/before-after/template.mjs`).
- [ ] P1-T2 Multi-word marks: split on text with marks already turned into spans (treat a mark as one token) in testimonial, promo, lifestyle, talking-head.
- [ ] P1-T3 data-story's `.rl` class renamed so `brand.reveal: "lines"` stops shrinking every split heading (`templates/data-story/template.mjs`, `templates/kit.mjs` `linesClass`).
- [ ] P1-T4 product-tour themed title: transparent background so the model stays visible under `theme: dark`/`accent` (`templates/product-tour/template.mjs`).
- [ ] P1-T5 3D decal size/offset divided by the host's world scale, not applied in raw world units (`templates/model3d.mjs`).
- [ ] P1-M1 Final mix forced to stereo (`aformat=channel_layouts=stereo` or `-ac 2`) so built-in stereo tracks are not folded to mono (`engine/pipeline.mjs` `mixFilter`, `engine/sequences.mjs`).
- [ ] P1-M2 Footage frame extraction color-matrix conversion so BT.709 clips don't color-shift through JPEG (`engine/frames.mjs` `cutClipFrames`).
- [ ] P1-M3 Stress-span gain ramp: `asetnsamples` before `volume=...:eval=frame` so the ramp isn't quantized to ~85ms blocks (`engine/tts.mjs`).
- [ ] P1-U1 Brand tab stale-closure fix: check `box.isConnected` and `project === S.project` before redrawing assets/gen/transcripts; clear polls on tab redraw (`ui/app.js`).
- [ ] P1-U2 Script/Source save sends a version stamp; server 409s on mismatch; `directorClick` warns before discarding unsaved edits (`ui/app.js`, `server/server.mjs`).
- [ ] P1-U3 Job/sequence banner errors persist across the next `guarded()` redraw instead of disappearing immediately (`ui/app.js`).
- [ ] P1-U4 Review link: hide `[data-pickup]`/`[data-mclear]` controls; Script/Source handlers no-op under `REVIEW` (`ui/app.css`, `ui/app.js`).
- [ ] P1-X1 `tests/impact.mjs` selects the every-template sweeps when `templates/kit.mjs`/`templates/shared.mjs` changes, and selects relevant tests when `server/server.mjs`/`engine/cli.mjs`/`engine/banner.mjs` changes.
- [ ] P1-X2 Test servers' `recoverStale()` does not reset jobs owned by a still-live run from another process (parity with `recoverInflight`'s owner-pid check).
- [ ] P1-X3 Template test `t.skip('Chrome is not available')` catches narrowed to actual Chrome-unavailability, not every page error (13 call sites — rethrow on `/Composition|script error/`).
- [ ] P1-X4 Port collision: `tests/review-sheet.test.mjs` and `tests/server-evidence.test.mjs` both hardcode 4796 — give each a unique port or port 0.

### P2 (smaller correctness/hardening/doc items)
- [ ] P2-S1 GET routes with side effects (`tts/preview`, `templates/:t/preview`, `sequences/transitions/:x/preview`, `music/:id`) refuse `Sec-Fetch-Site: cross-site` or require `X-Studio`.
- [ ] P2-S2 Suffix byte-range (`bytes=-500`) served correctly (last N bytes, not first).
- [ ] P2-S3 Video upload streamed to a temp file instead of buffered whole in memory.
- [ ] P2-S4 Cross-process "one run at a time": a lock file under `logs/director/` for the run's lifetime.
- [ ] P2-S5 `fetch_page` private-address blocklist extended (6to4 `2002::/16`, NAT64 `64:ff9b::/96`, CGNAT `100.64.0.0/10`, `198.18.0.0/15`).
- [ ] P2-M1 SVG icon upload: reject on subpath/segment count before the quadratic `orient()` pass runs (`engine/icons.mjs`).
- [ ] P2-M2 `.glb` upload: parse the JSON chunk and refuse any external `uri` in buffers/images (`engine/glb.mjs`/`engine/assets.mjs`).
- [ ] P2-M3 `ensureMusic` writes to a temp file then renames, matching `ensureSfx` (`engine/library.mjs`).
- [ ] P2-M4 Font-fallback check: verify `document.fonts.check(...)` for brand families after `__ready`, fail the render if missing.
- [ ] P2-T1 logo-reveal: pass elements instead of `#<id>` selector strings so a digit-leading scene id doesn't throw (`templates/logo-reveal/template.mjs`).
- [ ] P2-T2 Long single-word headings sized from the longest word (promo hook, talking-head, lifestyle), matching explainer's `flashSize` approach.
- [ ] P2-U1 2.5s poll diffs HTML before writing (sequences list, director log, `#topstatus`) to stop stealing focus / jumping scroll.
- [ ] P2-U2 Preview audio/video torn down (`stopPlay()`) on every path that replaces the job detail area, not only `leaveDetail()`.
- [ ] P2-U3 Note submit guarded against double-send and IME composition (`e.isComposing`).
- [ ] P2-D1 `.claude/hooks/security-lint.js` extended with patterns for this repo's own NEVER rules (currently mostly .NET-shaped patterns), or marked explicitly advisory-only in its own header.
- [ ] P2-D2 Stale doc references fixed: `file-index.md`'s `tests/playcheck-templates.test.mjs` → the three split files; `kit-process.md`'s `.claude/state/model-tier.json` reference removed; the "seat allowlist refuses render/sequence" line scoped to Run Director only, not every `/studio run`.

## Out of scope
- Anything found only as PLAUSIBLE with no concrete reproduction, where fixing risks a behavior change nobody asked for, is fixed conservatively (narrowest change that removes the hole) rather than redesigned.
- `.claude/settings.local.json` is gitignored and machine-specific; not read or edited (per the user's global CLAUDE.md: never dump/edit a `*.local.json`). P0-1's `--setting-sources user` fix removes it from the seat's effective permissions regardless of its contents.
- No new tests beyond what each fix needs to not regress; this is not a coverage sweep.

## Verify (after each cluster)
- The specific test file(s) for that cluster (`npm test -- tests/<file>.test.mjs` or `node tests/run.mjs <file>`).
- `npm test` (full suite) before the final commit of each top-level group (P0, P1, P2).
- For hook/doc changes with no test: read the file back and state what was checked by hand.

## Commit plan
One commit per numbered cluster above (P0-1, P0-2a+P0-2b if split, P0-3, …), in order, each with its own test run reported. Co-authorship per the session's attribution reminder.
