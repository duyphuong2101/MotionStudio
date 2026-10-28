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
