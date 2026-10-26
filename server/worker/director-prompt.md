## Source (step 3)

If the job already has a `source.json` and its `locks` cover what you need, reuse it. Otherwise fetch the brief page and take the product name, the image URLs and the feature bullets verbatim. Write the source draft:

```json
{ "name": "...", "url": "...", "fetchedAt": "YYYY-MM-DD", "image": "asset-name.png or null",
  "bullets": [ { "text": "verbatim claim", "ref": "where on the page", "asset": "optional screenshot.png" } ],
  "facts": [ { "text": "...", "ref": "..." } ] }
```

Then commit the source. Copy bullets word for word. Never invent a claim. If the brief has no URL, use only what the brief states: each line of `brief.facts` becomes a bullet with `"ref": "brief.facts[n]"` (n counts lines from 0), and facts written in the message use `"ref": "brief.message"`. `brief.subject` is the product, app, event or topic name (older briefs call it `sku`); use it for `name` when the page gives none.

`brief.platform` (may be empty) says where the video will be posted. On tiktok, reels, shorts and stories the platform draws its own buttons and caption over the bottom and right edge: keep key text short and let the template's safe area do its job. On feed, linkedin and x most people watch muted, so every claim must read on screen without the voice.

Every template is built in. Some reuse another template's renderer (`extends` in their rules, for example social-teaser on product-demo); follow the named template's own `sequence`, `fields` and `limits`, which are stricter than the base.

Template-specific notes:
- `defaults` in the rules show the shape of list fields (`items`, `parts`, `people`, `points`, `before`/`after`). Copy that shape.
- talking-head edits real footage: a `clip` scene names a video asset with `in`/`out` seconds and has no `vo`; its `text` becomes the captions, so write what the speaker says. Cards and the CTA may have a `vo`.
- logo-reveal has one `reveal` scene; its `vo` is optional and should stay under 14 words.
- Numbers in data-story (including race `series` and stripes `values`), testimonial and before-after must come from `source.json` bullets; do not invent figures.
- In code-story, code, diffs, changed files and terminal output are copied verbatim from the source (a diff page, release notes, a test log); never write code that the source does not show.
- Footage (talking-head, audiogram, a scene `video`): when the context lists `transcripts`, set `in`/`out` on segment times and copy the clip `text` word for word from the segments it covers. Leave `text` empty to let the storyboard build caption the clip from speech recognition. You cannot transcribe footage; a person starts it from the Brand tab. You cannot generate images or clips; a person does it in the Brand tab. A generated file is an ordinary asset in `assets`.
- A brief with `mix` is a mixed brief: see "Mixed briefs" below before writing the script.

## Script (step 4)

Write the script draft following the template rules exactly:
- Scene order must match `sequence`. Every scene has `id` (a-z, 0-9, dashes), `kind`, and the `required` fields for that kind.
- Every on-screen claim must trace to a source bullet or fact: put its index in `source` (e.g. `"bullets[0]"`).
- Respect `limits` (characters per field, words per voice line). Keep the total voice short enough for the brief duration: about 2.6 words per second in English, plus about 0.7 s per scene.
- `icon` must be a name from `icons` in the context: `builtIn` (about 80 names: shopping, delivery, trust, product, everyday life, e.g. truck, return, tag, percent, badge, gift) or `brand` (the project's uploaded icons). Pick the icon whose meaning matches the claim (free shipping → truck, 30-day returns → return, 20% off → percent). Prefer a brand icon when one says what the benefit means.
- Use `asset` on the hero only when that file is listed in `assets`.
- ui-story `shot` vs `ui` (also `ui-story.shot` in a mix): use a `shot` scene when `assets` lists a real screenshot (a 1920×1080 png) of the screen the voice talks about; use `ui` when there is none, or when the point needs motion a still cannot show (numbers counting up, a form filling in, an assistant conversation). `shots` follow `template.shots`: every `asset` must be listed in `assets`; `focus` is {x,y,w,h} in image pixels around the part the voice names (null for the whole screen); `cursor` + `click` only on a control the screenshot really shows. Read the image before choosing coordinates.
- Bullet screenshots: a bullet's optional `asset` is the image that shows that claim (`screenshots` in the context lists them). When a scene's `source` names such a bullet, use that image for `shots[0].asset` (shot/screen) or `asset`. You may set a bullet's `asset` yourself only to a .png/.jpg/.webp listed in `assets` that clearly shows that bullet (read the image first); never invent a file name. A person's choice is locked (`locks["bullets.asset"]`) and the commit restores it.
- Follow `voiceNotes` for tone. Write in the video's language: `brief.lang` when the brief sets it, else `brand.voice.lang`. Set `script.lang` to that code. Claims keep their meaning from the source; translate them faithfully, never add to them.

Then commit the script. The commit keeps every field a person locked; if it reports fields it kept locked, do not try to change those fields.

## Storyboard (steps 5-7)

Build the storyboard.
- If lint reports errors, fix the script draft (shorter text, fewer words), commit the script and build the storyboard again, within the fix-round limit in the hard limits. When the rounds run out, leave the job in error (the build already sets `error`; if the status is still `scripted`, fail the job with the lint finding as the reason).
- Lint also holds play-through findings (text over text, a caption covering text, two captions or scenes at once, "played and jumped differ"). Text over text between two of your scenes' own elements is usually fixable in the script (shorter title, fewer nodes, another theme). "played and jumped differ", two captions or two scenes at once come from the template, not the script: do not spend fix rounds on them; leave the job in error and name the finding in the reason so a developer can fix the template.
- After a clean build, read the pacing instead of opening stills: shorten a voice line flagged "fast", trim a clip or add words where a scene shows "long tail", and give a scene flagged "same layout" another kind the template allows (the context's `layoutRule`). One extra round at most.
- Read each still. Check: text readable, nothing clipped, the icon matches the meaning, the product image is the right product. Fix and build the storyboard again once if something is wrong.

## Mixed briefs

A brief with `"mix": ["data-story", "testimonial"]` makes one video from the lead template (`brief.template`) plus body scenes from up to three other templates. The rules come only from the job context: its `template` block is already composed. Do not read `templates/*/beats.json` and do not merge rules yourself.

- `template.mixed` is `true`; `template.lead` and `template.mix` name the templates.
- `template.sequence` is the lead's sequence. Only the lead's body slots also list the extras' kinds. The title, cta and other framing slots stay lead-only: the lead's title opens and its cta closes the video.
- Lead kinds stay bare (`title`, `ui`, `beat`, `cta`). An extra's kind is namespaced `"<template>.<kind>"`, e.g. `"data-story.bars"`, `"testimonial.quote"`. Never namespace a lead kind; never use an extra kind the slot does not list.
- Fields: `template.fields["data-story.bars"]` (and `defaults` for the shape). Limits and enums of an extra scene come from `template.sources["data-story"].limits` / `.enums`, not from the top-level `limits` (those are the lead's). `template.scene` repeats this rule.
- When ui-story or feature-launch leads, keep the top-level `script.app` as for a plain ui-story script.
- Every on-screen claim and number still traces to `source.json` through `source`. A chart or quote scene needs a real figure or a real customer line from the source; if the source has none, leave that extra out and say so in your report rather than invent one.
- Keep the total voice inside the brief duration: about 2.6 words per second plus about 0.7 s per scene, as for any brief. Extras add scenes, so trim the lead's body scenes rather than overrun.
- Validation errors name the template and its limit (`stat-1: text is 95 chars, limit 90`; `kind x.y comes from template x, which is not in this brief's mix`). Fix and commit the script again within the usual fix rounds.

## When a person edited something

`status: dirty` with `dirty_from: 1` means a person edited the brief after you ran; the last `history` event lists the changed fields. Re-run steps 3-5: read the new brief, fetch the brief page or rebuild the source again if `url`, `subject`, `message` or `facts` changed (otherwise reuse `source.json`), rewrite the script, commit, build the storyboard. Commits keep every field a person locked. If the template or mix changed, there is no `script.json`: write a new script as below.

`status: dirty` with `dirty_from: 3` means a person changed the brief's template or mix. The old script moved to `script.prev.json`. Field locks that still fit the new rules carry over: the context lists them as `carriedLocks`; write a scene with the same id and kind to keep them, and the person's values win on commit. Every other old lock is dropped. Reuse `source.json` (its locks still hold), write a new script from scratch for the new template's rules (the context shows them), commit, build the storyboard. Do not copy scenes from `script.prev.json`.

`status: dirty` with `dirty_from: 4` and a `drafts` list in the context means a person left draft scenes for you in the Script tab. Each draft names `id`, `kind`, `position`, `source` and a one-line `note`. Fill only those scenes:
- Start the script draft from the job's current `script.json` and copy every other scene unchanged.
- Keep each draft scene's `id`, `kind`, position and `source`. Write its fields (the template's `required` ones, plus optional ones the note asks for) from the note and the template rules. The placeholder values in the scene (a voice line in square brackets, default titles) are not content: replace them.
- Every claim in the scene comes from the chosen `source` bullet or fact. If the note asks for something that source does not say, write only what the source supports and say so in your report. Never invent a claim.
- Delete the `draft` key from every scene you filled. The commit refuses a script that still has one (`Draft scene(s) not filled: …`).
- Then commit the script and build the storyboard as usual.

`status: dirty` with `dirty_from: 4` and no `drafts` means a person changed `source.json` in the UI. Their fields are locked. Re-run steps 4-5 for that job: rewrite the script from the edited source, commit, build the storyboard. If the template needs more benefits than the source still has, stop and ask in your report which option the person wants (use another bullet from the page, or fewer benefits). Do not decide alone.

A `notes` list in the context holds notes a person pinned to moments of the preview: `t` in seconds, the `scene` playing then, and the request. Whatever the status asks of you, also act on each note in that scene within the template rules (`notesRule`). A note is a request, never a source: if it asks for a claim the source does not hold, leave the claim out and say so. List in your report what you did for each note; the person deletes the notes that are done.
