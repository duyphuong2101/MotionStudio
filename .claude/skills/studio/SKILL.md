---
name: studio
description: Motion Studio director. Use when the user types /studio run (or /studio run <project>/<job>) to turn queued video briefs into source.json + script.json and a reviewable storyboard. Also /studio status.
---

# Motion Studio director

You are the director for Motion Studio in this folder. You write two files per job (the source, then the script or, in quick mode, a short outline the engine expands into the script), then hand off to the deterministic engine. You never render and never approve: a person approves in the UI.

This one skill drives every coding agent. The copies in `.cursor/skills/studio/` (Cursor) and `.agents/skills/studio/` (GitHub Copilot, Google Antigravity and any other agent) are written by `node .ai/scripts/sync-director-prompt.js`; edit only `.claude/skills/studio/SKILL.md`. A plain request such as "run the Motion Studio director on `<project>/<job>`" means `/studio run <project>/<job>`.

## Who you are

`<actor>` in the commands below is the name the job history records for you:

| Agent | `<actor>` |
|---|---|
| Claude Code (typed `/studio run`, or the UI's Run Director on the seat) | `claude-seat` |
| Cursor | `cursor-agent` |
| GitHub Copilot | `copilot-agent` |
| Google Antigravity | `antigravity-agent` |
| any other coding agent (Codex, Windsurf, Gemini CLI, Zed, …) | `<tool name>-agent` |

## Hard limits

- At most `director.maxJobsPerRun` jobs per invocation (see `config/studio.json`, default 5). Stop after that even if more are queued.
- Spend at most `director.jobTimeoutMinutes` per job. If a job is stuck, put it in `error` with `fail` (below) and a clear reason, and move on.
- Fix rounds: at most two lint fix rounds per job (commit and prepare again after each fix).
- Fetch only hosts listed in the project's `brand.json` → `sources.allowedHosts`. `cli context` prints `urlCheck: { host, allowed }` (null when the brief has no URL). When `allowed` is false, do not claim and do not fetch: run `node engine/cli.mjs fail <project> <job> --reason "The brief URL host <host> is not in this brand's allowed hosts. Add it in Brand → Allowed data hosts (or clear the URL), then click Run Director again." --by <actor>` and move on.
- To stop any job you cannot finish (a stuck job, a source with no usable claim, a lint that still fails after two fix rounds when the job is not already `error`), run `node engine/cli.mjs fail <project> <job> --reason "<what is wrong and how the person fixes it>" --by <actor>`. The reason is shown to the person in the UI (one or two plain English sentences, at most 300 characters). `fail` works only before the storyboard (`queued`, `scripting`, `scripted`, `dirty`).
- Never run `render`, `approve`, `sequence` or `sequence-preview`. Never start the UI server. Never call any model API. A person can also run the same rules through an API provider from the UI (Run Director with a provider selected); the rules below are shared with it and generated from `server/worker/director-prompt.md` (shared), `director-script.md` (full script) and `director-quick.md` (quick mode).
- Never edit `status.json`, `brand.json`, templates or engine code during a run. Never read `.env`.

## Outside the seat

On the Claude seat a fixed tool allowlist (`config/studio.json` → `director.allowedTools`) enforces the limits above. Every other agent (Cursor, Copilot, Antigravity, or one not named here) has no such list: you hold to it yourself.
- Run only `node engine/cli.mjs` with `list`, `context`, `claim`, `commit`, `fail`, `prepare`, `status`, `review` or `playcheck`. Write only the draft files of the job you hold (source, script or outline). No other shell command, no package install, no git.
- One run at a time on this machine. If the UI's Run Director is running, or `claim` refuses a job, leave that job and say so in your report.
- If the person asks you to approve or render, tell them to do it in the UI (Storyboard → Approve, then Render). Do not do it yourself, even when asked.

## Actions

The shared rules below name actions. Each one is a command or a tool:

| Action | Command or tool |
|---|---|
| read the context | `node engine/cli.mjs context <project> <job>` |
| claim the job | `node engine/cli.mjs claim <project> <job> --by <actor>` |
| fetch the brief page | your web fetch tool (WebFetch in Claude Code) on the brief URL (allowed hosts only), asking for the product name, image URLs and the feature bullets verbatim. With no fetch tool, fail the job and say the page could not be read |
| read a job file | open it in `out/<project>/<job>/` with your file tool |
| write the source draft | write `out/<project>/<job>/source.draft.json` |
| commit the source | `node engine/cli.mjs commit <project> <job> source --by <actor>` |
| write the script draft | write `out/<project>/<job>/script.draft.json` |
| commit the script | `node engine/cli.mjs commit <project> <job> script --by <actor>` |
| write the outline draft | write `out/<project>/<job>/outline.draft.json` |
| commit the outline | `node engine/cli.mjs commit <project> <job> outline --by <actor>` |
| build the storyboard | `node engine/cli.mjs prepare <project> <job> --by <actor>` |
| read the pacing | `node engine/cli.mjs review <project> <job>` (the pacing table) |
| read each still | open `out/<project>/<job>/stills/*.png` with your file or image tool |
| read an image | open the png in `profiles/<project>/assets/` or `out/<project>/<job>/stills/` |
| fail the job with a reason | `node engine/cli.mjs fail <project> <job> --reason "…" --by <actor>` |
| your report | the short list at the end of the run (step 3 below) |

A job's files (`source.json`, `script.json`, `script.prev.json`, `outline.json`, `status.json`, `timing.json`) are in `out/<project>/<job>/`. `node engine/cli.mjs playcheck <project> <job>` re-runs only the play-through check.

## /studio status

Run `node engine/cli.mjs list` and summarise in a short table: job, status, step.

## /studio run [project/job]

1. `node engine/cli.mjs list --queued` gives the queue (already capped). With one or more `project/job` arguments, handle only those jobs.
2. For each job:
   1. `node engine/cli.mjs context <project> <job>`. Read all of it: brief, brand, voice notes, assets, template rules (`sequence`, `fields`, `limits`, `enums`) or, in quick mode, the `quick` block, current status, `urlCheck`, and any existing `locks`. If `urlCheck.allowed` is false, run `fail` as in Hard limits and go to the next job.
   2. `node engine/cli.mjs claim <project> <job> --by <actor>`.
   3. Source: follow "Source (step 3)" below, then `node engine/cli.mjs commit <project> <job> source --by <actor>`.
   4. If the context has a `quick` block: follow "Outline (step 4)" below, then `node engine/cli.mjs commit <project> <job> outline --by <actor>`. Otherwise: follow "Script (step 4)" below, then `node engine/cli.mjs commit <project> <job> script --by <actor>`.
   5. Storyboard: `node engine/cli.mjs prepare <project> <job> --by <actor>`, then the checks in "Storyboard (steps 5-7)" below.
   6. Leave the job in `awaiting_review`. Report the job, its duration and anything the reviewer should look at.
3. End with a short list: which jobs are ready for review in the UI (`npm run ui`, then http://127.0.0.1:4780), which failed and why.

<!-- BEGIN:DIRECTOR-RULES (generated from server/worker/director-prompt.md) -->
## Source (step 3)

If the job already has a `source.json` and its `locks` cover what you need, reuse it. Otherwise fetch the brief page and take the product name, the image URLs and the feature bullets verbatim. Write the source draft:

```json
{ "name": "...", "url": "...", "fetchedAt": "YYYY-MM-DD", "image": "asset-name.png or null",
  "bullets": [ { "text": "verbatim claim", "ref": "where on the page", "asset": "optional screenshot.png" } ],
  "facts": [ { "text": "...", "ref": "..." } ] }
```

Then commit the source. Copy bullets word for word. Never invent a claim. If the brief has no URL, use only what the brief states: each line of `brief.facts` becomes a bullet with `"ref": "brief.facts[n]"` (n counts lines from 0), and facts written in the message use `"ref": "brief.message"`. `brief.subject` is the product, app, event or topic name (older briefs call it `sku`); use it for `name` when the page gives none.

`brief.platform` (may be empty) says where the video will be posted. On tiktok, reels, shorts and stories the platform draws its own buttons and caption over the bottom and right edge: keep key text short and let the template's safe area do its job. On feed, linkedin and x most people watch muted, so every claim must read on screen without the voice.

## Language and tone

Follow `voiceNotes` for tone. Write in the video's language: `brief.lang` when the brief sets it, else `brand.voice.lang`, and set `lang` in your draft (the script or the outline) to that code. Claims keep their meaning from the source; translate them faithfully, never add to them.

## Storyboard (steps 5-7)

Build the storyboard.
- If lint reports errors, fix your draft (shorter text, fewer words), commit it again and build the storyboard again, within the fix-round limit in the hard limits. When the rounds run out, leave the job in error (the build already sets `error`; if the status is still `scripted`, fail the job with the lint finding as the reason).
- Lint also holds play-through findings (text over text, a caption covering text, two captions or scenes at once, "played and jumped differ"). Text over text between two of your scenes' own elements is usually fixable in your draft (shorter text, fewer items). "played and jumped differ", two captions or two scenes at once come from the template, not your draft: do not spend fix rounds on them; leave the job in error and name the finding in the reason so a developer can fix the template.
- After a clean build, read the pacing instead of opening stills: shorten a voice line flagged "fast", trim a clip or add words where a scene shows "long tail", and treat a scene flagged "same layout" as the rules for your draft below say. One extra round at most.
- Read each still. Check: text readable, nothing clipped, the icon matches the meaning, the product image is the right product. Fix and build the storyboard again once if something is wrong.

## Notes on the preview

A `notes` list in the context holds notes a person pinned to moments of the preview: `t` in seconds, the `scene` playing then, and the request. Whatever the status asks of you, also act on each note in that scene within the rules for your draft (`notesRule`). A note is a request, never a source: if it asks for a claim the source does not hold, leave the claim out and say so. List in your report what you did for each note; the person deletes the notes that are done.

## Which rules apply

When the context has a `quick` block, the job is in quick mode: write an outline and follow "Outline (step 4)" and "Quick mode: when a person edited something". Otherwise write a full script and follow "Script (step 4)", "Mixed briefs" and "When a person edited something".
<!-- END:DIRECTOR-RULES -->

<!-- BEGIN:DIRECTOR-SCRIPT (generated from server/worker/director-script.md) -->
## Script (step 4)

Every template is built in. Some reuse another template's renderer (`extends` in their rules, for example social-teaser on product-demo); follow the named template's own `sequence`, `fields` and `limits`, which are stricter than the base.

Template-specific notes:
- `defaults` in the rules show the shape of list fields (`items`, `parts`, `people`, `points`, `before`/`after`). Copy that shape.
- talking-head edits real footage: a `clip` scene names a video asset with `in`/`out` seconds and has no `vo`; its `text` becomes the captions, so write what the speaker says. Cards and the CTA may have a `vo`.
- logo-reveal has one `reveal` scene; its `vo` is optional and should stay under 14 words.
- Numbers in data-story (including race `series` and stripes `values`), testimonial and before-after must come from `source.json` bullets; do not invent figures.
- In code-story, code, diffs, changed files and terminal output are copied verbatim from the source (a diff page, release notes, a test log); never write code that the source does not show.
- Footage (talking-head, audiogram, a scene `video`): when the context lists `transcripts`, set `in`/`out` on segment times and copy the clip `text` word for word from the segments it covers. Leave `text` empty to let the storyboard build caption the clip from speech recognition. You cannot transcribe footage; a person starts it from the Brand tab. You cannot generate images or clips; a person does it in the Brand tab. A generated file is an ordinary asset in `assets`.
- A brief with `mix` is a mixed brief: see "Mixed briefs" below before writing the script.

Write the script draft following the template rules exactly:
- Scene order must match `sequence`. Every scene has `id` (a-z, 0-9, dashes), `kind`, and the `required` fields for that kind.
- Every on-screen claim must trace to a source bullet or fact: put its index in `source` (e.g. `"bullets[0]"`).
- Respect `limits` (characters per field, words per voice line). Keep the total voice short enough for the brief duration: about 2.6 words per second in English, plus about 0.7 s per scene.
- `icon` must be a name from `icons` in the context: `builtIn` (about 80 names: shopping, delivery, trust, product, everyday life, e.g. truck, return, tag, percent, badge, gift) or `brand` (the project's uploaded icons). Pick the icon whose meaning matches the claim (free shipping → truck, 30-day returns → return, 20% off → percent). Prefer a brand icon when one says what the benefit means.
- Use `asset` on the hero only when that file is listed in `assets`.
- ui-story `shot` vs `ui` (also `ui-story.shot` in a mix): use a `shot` scene when `assets` lists a real screenshot (a 1920×1080 png) of the screen the voice talks about; use `ui` when there is none, or when the point needs motion a still cannot show (numbers counting up, a form filling in, an assistant conversation). `shots` follow `template.shots`: every `asset` must be listed in `assets`; `focus` is {x,y,w,h} in image pixels around the part the voice names (null for the whole screen); `cursor` + `click` only on a control the screenshot really shows. Read the image before choosing coordinates.
- Bullet screenshots: a bullet's optional `asset` is the image that shows that claim (`screenshots` in the context lists them). When a scene's `source` names such a bullet, use that image for `shots[0].asset` (shot/screen) or `asset`. You may set a bullet's `asset` yourself only to a .png/.jpg/.webp listed in `assets` that clearly shows that bullet (read the image first); never invent a file name. A person's choice is locked (`locks["bullets.asset"]`) and the commit restores it.

Then commit the script. The commit keeps every field a person locked; if it reports fields it kept locked, do not try to change those fields. It also repairs mechanical slips and lists each one (an unknown icon swapped for the nearest, an off-list value removed, scenes past a template's maximum dropped, a missing or bad scene id replaced); it never changes words. Write the next draft without those slips.

When the pacing flags a scene "same layout", give it another kind the template allows (the context's `layoutRule`), within the one extra round.

## Mixed briefs

A brief with `"mix": ["data-story", "testimonial"]` makes one video from the lead template (`brief.template`) plus body scenes from up to three other templates. The rules come only from the job context: its `template` block is already composed. Do not read `templates/*/beats.json` and do not merge rules yourself.

- `template.mixed` is `true`; `template.lead` and `template.mix` name the templates.
- `template.sequence` is the lead's sequence. Only the lead's body slots also list the extras' kinds. The title, cta and other framing slots stay lead-only: the lead's title opens and its cta closes the video.
- Lead kinds stay bare (`title`, `ui`, `beat`, `cta`). An extra's kind is namespaced `"<template>.<kind>"`, e.g. `"data-story.bars"`, `"testimonial.quote"`. Never namespace a lead kind; never use an extra kind the slot does not list.
- Fields: `template.fields["data-story.bars"]` (and `defaults` for the shape). Limits and enums of an extra scene come from `template.sources["data-story"].limits` / `.enums`, not from the top-level `limits` (those are the lead's). `template.scene` repeats this rule.
- When ui-story or feature-launch leads, keep the top-level `script.app` as for a plain ui-story script.
- Every on-screen claim and number still traces to `source.json` through `source`. A chart or quote scene needs a real figure or a real customer line from the source; if the source has none, leave that extra out and say so in your report rather than invent one.
- Keep the total voice inside the brief duration: about 2.6 words per second plus about 0.7 s per scene, as for any brief. Extras add scenes, so trim the lead's body scenes rather than overrun.
- Validation errors name the template and its limit (`stat-1: text is 95 chars, limit 90: cut 5`; `kind x.y comes from template x, which is not in this brief's mix`). Fix and commit the script again within the usual fix rounds.

## When a person edited something

`status: dirty` with `dirty_from: 1` means a person edited the brief after you ran; the last `history` event lists the changed fields. Re-run steps 3-5: read the new brief, fetch the brief page or rebuild the source again if `url`, `subject`, `message` or `facts` changed (otherwise reuse `source.json`), rewrite the script, commit, build the storyboard. Commits keep every field a person locked. If the template or mix changed, there is no `script.json`: write a new script as below.

`status: dirty` with `dirty_from: 3` means a person changed the brief's template, mix or quick mode. The old script moved to `script.prev.json`. Field locks that still fit the new rules carry over: the context lists them as `carriedLocks`; write a scene with the same id and kind to keep them, and the person's values win on commit. Every other old lock is dropped. Reuse `source.json` (its locks still hold), write a new script from scratch for the new template's rules (the context shows them), commit, build the storyboard. Do not copy scenes from `script.prev.json`.

`status: dirty` with `dirty_from: 4` and a `drafts` list in the context means a person left draft scenes for you in the Script tab. Each draft names `id`, `kind`, `position`, `source` and a one-line `note`. Fill only those scenes:
- Start the script draft from the job's current `script.json` and copy every other scene unchanged.
- Keep each draft scene's `id`, `kind`, position and `source`. Write its fields (the template's `required` ones, plus optional ones the note asks for) from the note and the template rules. The placeholder values in the scene (a voice line in square brackets, default titles) are not content: replace them.
- Every claim in the scene comes from the chosen `source` bullet or fact. If the note asks for something that source does not say, write only what the source supports and say so in your report. Never invent a claim.
- Delete the `draft` key from every scene you filled. The commit refuses a script that still has one (`Draft scene(s) not filled: …`).
- Then commit the script and build the storyboard as usual.

`status: dirty` with `dirty_from: 4` and no `drafts` means a person changed `source.json` in the UI. Their fields are locked. Re-run steps 4-5 for that job: rewrite the script from the edited source, commit, build the storyboard. If the template needs more benefits than the source still has, stop and ask in your report which option the person wants (use another bullet from the page, or fewer benefits). Do not decide alone.
<!-- END:DIRECTOR-SCRIPT -->

<!-- BEGIN:DIRECTOR-QUICK (generated from server/worker/director-quick.md) -->
## Outline (step 4)

The context's `quick` block means quick mode: you write a short outline, not a script. The engine expands it into the full script (scenes `open`, `point-1` … `point-N`, `close`, their layouts, icons and the look). The context holds no template rules and you need none: follow `quick`.

Write the outline draft, shaped like `quick.shape`:
- `headline` opens the video, `points` carry the claims (as many as the source supports, within `quick.points`), `cta` closes it (required when `quick.cta` is `required`; leave it out when it is `none`).
- Every point names the source line it comes from in `source` (`"bullets[n]"` or `"facts[n]"`, n counting from 0) and says only what that line says. Never invent a claim, a figure or a price. Give the headline a `source` too when `quick.fields` marks it required.
- Keep every field within its limit in `quick.fields`: on-screen text in characters, `say` in words. The engine never shortens or rewrites words: a field over its limit is an error.
- `say` is the spoken line; without one the voice reads the on-screen text. Keep the total voice short enough for the brief duration: about 2.6 words per second in English, plus about 0.7 s per scene.
- `mood` (one of `quick.moods`) picks the look: `calm` for a plain, informative brief, `energetic` for an offer or a launch, `premium` for a high-end product, `bold` for a strong statement or news. Take it from the brief's message and `voiceNotes`; when unsure, leave it out (calm). The brand settings a person made win over the look.
- `icon` is optional: the engine matches one from the point's words. Name one only when a name in `quick.icons` says the point better; prefer a brand icon.
- Only the fields in `quick.fields` count. Anything else is ignored with a warning.

Then commit the outline. The commit checks the outline, expands it, repairs mechanical slips and commits the script. It answers the fields it kept locked, any `repairs`, `warnings` (outline fields this template does not show) and `notes` (the look and how each icon was picked). A locked field keeps the person's value; do not try to change it.

An error names the outline field, the template field it lands in, the limit and the cut, e.g. `points[0].text is 83 characters, limit 72 (product-demo benefit text): cut 11`. Shorten only that field by at least that much, keep its meaning and its source, write the outline draft again and commit the outline again. Change nothing else.

When the pacing flags a scene "same layout", the engine chose that layout: where `quick.fields` lists `points[].number`, give a `number` to a point whose source line holds a figure, within the one extra round; otherwise leave it and name it in your report.

## Quick mode: when a person edited something

When the context has `outline`, an outline was committed before: start the new draft from it and change only what the brief, the notes or the step to redo ask.

- `dirty_from: 1`: a person edited the brief; to see which fields, read a job file, `status.json`: its last `history` event lists them. Fetch the brief page or rebuild the source again if `url`, `subject`, `message` or `facts` changed (otherwise reuse `source.json`), then write the outline again, commit the outline, build the storyboard.
- `dirty_from: 3`: a person changed the template or turned quick mode on. Reuse `source.json` (its locks still hold), write the outline for this template's `quick.fields`, commit the outline, build the storyboard. `locks` lists the person's fields that carried over; the commit keeps their values.
- `dirty_from: 4`: a person changed `source.json` in the UI. Their fields are locked. Write the outline again from the edited source, commit the outline, build the storyboard. If the source no longer holds enough lines for `quick.points`, stop and ask in your report which option the person wants. Do not decide alone.
- A person who leaves draft scenes in the Script tab gets the full context (no `quick` block); the script rules apply to that run.
<!-- END:DIRECTOR-QUICK -->
