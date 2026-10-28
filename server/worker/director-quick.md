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
