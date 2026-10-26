# ux-review — Whole-tool usability pass

**Status:** done
**Author:** claude (session 2026-10-14)
**Branch:** none (folder is not a git repo; source backed up in the session scratchpad before edits)
**Created:** 2026-10-14
**Risk tier / auto-enabled phases:** server boundary (new DELETE route, two more served files) → security check; job state → engine test

## Intent
The user asked for a deep review of every feature: keep the tool easy to use, drop what is not needed, add what is missing.
**For whom / outcome:** the person who writes briefs, reviews storyboards and renders videos in the local UI. Fewer dead controls, no lost edits, and a storyboard they can review with sound.

## Findings that drive the scope
Measured in the running UI (1440x900, project csr-console, 11 jobs):
- Script tab: the Save button sits about 8,700 px down a 11-scene script. Brand: Save at about 1,550 px.
- Clicking another job while the Script or Source tab has unsaved edits drops them without asking (`selectJob` never checks `S.paneDirty`). Switching project and closing the tab do the same.
- The composition preview is silent, although `voice.wav` exists from step 5. A storyboard is approved without hearing it.
- A job cannot be deleted from the UI (projects and sequences can).
- The Sequences list sits below 11 jobs, off screen (top at y≈1,095).
- Dead UI for a feature that does not exist: the Providers tab, the Director select in the brief form (Claude API, Gemini, Grok all say "no worker yet"; the seat director runs every brief anyway), the `director: seat` pill, "allowed directors" on template cards.
- Script tab draws an "add scene" row between every scene even where no kind fits (2 of 12 rows were fully disabled).
- The brief form shows an empty "Mix in scenes from" box for templates that cannot mix, and no description of the chosen template.
- "Run Director for queued jobs (0)" is a disabled primary button when nothing is queued.
- The sidebar repeats the `/studio run` command that the banners and Copy command button already give.

## Scope
- [x] Engine: `deleteJob(project, id)` moves the brief and `out/` folder to `trash/<project>-<id>-<time>/`; refused while busy or while a sequence plays the job.
- [x] Engine: `validateBrief` defaults `director` to `providers.default`; `updateBrief` keeps the stored one when the form sends none.
- [x] Server: `DELETE /api/jobs/:p/:j`; serve `voice.wav` and `footage.wav` under `/files/` (Range for audio too); `has.voice`, `has.footage` in job detail.
- [x] UI: Composition preview plays the voice track in sync with Play and seek.
- [x] UI: Sticky save bar for Script, Source and Brand; unsaved-changes guard on job switch, project switch and page unload.
- [x] UI: Delete job (confirm dialog) in the job header.
- [x] UI: Job list: Jobs / Sequences switch at the top, status filter (All / To do / Done); no list re-render when nothing changed.
- [x] UI: Remove the Providers tab, Director select, director pill, "allowed directors", the sidebar command hint.
- [x] UI: Hide add-scene rows where no kind fits; hide the mix box for non-mixable templates; show the template description in the brief form; "Save and run Director" on a new brief; "Use this template" on template cards.
- [x] Docs: architecture.md, CLAUDE.md layout line for trash. (README.md is the AI-config kit's installer README, not about Motion Studio; left for the owner.)
- [x] Tests: deleteJob, director default, updateBrief keeps the director.
- [x] Follow-up (asked 2026-10-14): scene ↔ still links in Script and Preview; the playing scene marked in stills and timing.
- [x] Follow-up: new README.md for Motion Studio; the AI-config kit README moved to `.ai/ai-config-kit.md`.

## Out of scope
- `config/providers.json` stays; API workers are still not built.
- No change to the director, its caps, the localhost checks or the pipeline.
- Template look and the composition contract.

## Files to create / modify
| File | Change |
|------|--------|
| `engine/jobs.mjs` | `deleteJob`, director default |
| `server/server.mjs` | DELETE job route, voice files, audio Range |
| `ui/app.js`, `ui/index.html`, `ui/app.css` | items above |
| `tests/engine.test.mjs` | new tests |
| `.ai/docs/architecture.md`, `CLAUDE.md`, `README.md` | docs |
