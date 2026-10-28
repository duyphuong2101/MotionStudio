---
name: template-authoring
description: Create or change a Motion Studio video template (templates/<id>/beats.json + template.mjs). Use when adding a scene kind, a new template, changing limits or layout, or making a template that extends another.
---

# Template authoring

A template is two files in `templates/<id>/`:

- `beats.json` — the rules the director must follow. `validateScript` (`engine/script.mjs`) enforces them.
- `template.mjs` — `export function build({ brief, brand, script, timing, size })` returning one HTML page. A kit renderer splits it: `export function parts(args)` → `{ css, body, scenes, js, extra?, particles?, subs? }` and `build(args) = page({ ...args, title: '<id>', ...parts(args) })`.

A template with `"extends": "<other-id>"` in `beats.json` has no `template.mjs`; it reuses the other renderer with its own (stricter) rules. Use that when only the rules differ.

## New template

1. Copy `.ai/templates/beats.json.template` to `templates/<id>/beats.json`. Set `id` = folder name.
2. Copy `.ai/templates/template.mjs.template` to `templates/<id>/template.mjs`, or set `extends`.
3. Every kind in `sequence` needs a `fields` entry, a `defaults` entry (the UI and tests use it), a branch in `build()` and a `KINDS` timeline builder.
4. Run `npm test`. `tests/templates.test.mjs` builds a sample script from your `defaults` in every format.
5. Add the template to `.ai/docs/file-index.md`.

## beats.json contract

| Key | Meaning |
|---|---|
| `formats`, `sizes` | Allowed aspect ratios and their pixel size |
| `durations` | `[min, max]` seconds a brief may ask for |
| `directors` | Provider ids from `config/providers.json` |
| `sequence` | Ordered slots: `{ kind: [...], min, max }` |
| `fields` | Per kind: `required` and `optional` field names |
| `limits` | Max characters per field, `voWords` per voice line |
| `enums` | Allowed values (`pace`, `style`, …) |
| `defaults` | Sample values per kind (the Script tab prefills a new scene with them) |
| `help` | Script tab help: `kinds[kind]` one "use it for…" sentence; `fields[field]` or `fields["<kind>.<field>"]` a short hint where `FIELD_HELP` (`engine/help.mjs`) does not fit. `tests/help.test.mjs` fails on a kind or field without help |
| `pace` | Per pace: `perShot`, `minScene`, `tail` seconds |
| `audio` | `"footage"` when scenes carry video clips with their own sound |
| `mixable` | Body kinds this template adds to a mixed brief (as `<id>.<kind>`) and, as lead, the kinds that mark its body slots. Absent = not mixable |
| `quick` | Quick mode (`engine/quick.mjs`): `points` `[min, max]`, `open`/`point`/`close` (and optional `number`, a point with a figure) each `{ kind, <outline field>: <scene field> }`, `or` (fallback field when one is blank), `vary` (scene fields cycled over the points), `icons` (fallback cycle). The engine fills `theme`, `icon` and `image`. `tests/quick.test.mjs` checks every mapped kind's required fields are filled. Absent = no quick mode |

Every field listed in `fields` (required or optional) is lockable: `engine/jobs.mjs` reads the field names from all templates, so a UI edit of any of them is locked.

## Renderer rules

- Shell: `page()` from `templates/kit.mjs`. It adds brand CSS variables, the background, subtitles, `window.seek(t)`, `window.__studio` and `window.__ready`.
- Text: always `h(...)`. Never interpolate script or brand text raw.
- Sizes: `geometry(size).px(n)` — designed on a 1080 short side. Use `port` / `land` / `square` for layout branches. 4:5 draws `square`; 2:3 is `port` with `short` (shrink stacked visuals); for 21:9 use `padX(n)` on full-frame side padding so content stays in a centred 16:9 area.
- Ids: scene group `g-<scene.id>`; inner elements `<scene.id>-<name>`.
- `data-lint` on every text element that must stay inside the safe area; `prepare` reports overflow.
- Animation: add tweens to the shared `tl` timeline inside `KINDS[kind](sc, start, end, ctx)`. Helpers in the page: `fadeUp`, `pop`, `draw`, `countUp`, `typeText`, `cue(sc, frac)` (time of a word fraction into the voice line). Use the helpers rather than your own entrance tweens: the brand's motion profile (`motionProfile(brand)` in `engine/brand.mjs`) swaps them (cinematic: focus pulls, a `.hd` heading word by word; editorial: `.hd` words rise out of a mask, other things wipe in; clean, kinetic, parallax: their own eases and distances) and moves every scene group (a push-in, zoom and slide cuts, a drifting camera), so never tween a scene group's transform yourself, and keep edge text at least ~2% inside the safe area. Under parallax the kit drifts `.hd`, `.kick`, `img` and `video` on `x` unless a tween of the scene already moves them on `x`; a renderer whose scene is one drawn surface returns `layers: false` from `parts()` (ui-story). Branch on profile fields, never on the motion name.
- Deterministic: no `setTimeout`, `setInterval`, `Date.now`, `Math.random`. Pseudo-random values come from a seeded function of an index (see `PARTS` in `kit.mjs`).
- Tweens (rules from greensock/gsap-skills that fit a seeked page): animate transforms (`x`, `y`, `xPercent`, `scale`, `rotation`) and `opacity`, never `width`, `height`, `top`, `left` or `margin`. Place every tween on `tl` with its position parameter; never `delay`, a second timeline or a tween that plays on its own. A `fromTo` inside a scene takes `immediateRender: false` (the kit's `preset` puts the entrance state at the scene start). Many like elements take one tween with `stagger`, not a loop of start times.
- Ease: `X` is the page's default ease (`power3.out`, or the brand's own CustomEase curve `'brand'` when `brand.ease` is set). A plain move writes `ease: X` or leaves the timeline default, so the brand curve reaches it; name another ease only where the move needs its own character (a bounce, a linear drift).
- GSAP plugins: `DrawSVG`, `MorphSVG` and `Text` are on every page. `SplitText` (`brand.reveal`), `CustomEase` (`brand.ease`) and `Physics2D` (`brand.confetti`) are written into a page by the kit only when the brand asks, and all of them are in every job's `vendor/` (`GSAP_FILES` in `engine/vendor.mjs`); a template never adds its own `<script>`. Never use `ScrambleText` or `CustomWiggle`'s random type: both call `Math.random`. SplitText runs after fonts load (the kit builds after `document.fonts.ready`) and only on plain-text headings; a heading with marks or child elements keeps the whole-heading entrance. Physics2D without `friction` is a function of time, so it seeks; with friction it steps and does not.
- Text fitting (remotion-dev/skills `measuring-text`, applied to the lint): a text box needs a set width and an `overflow` other than `visible` for `lintInPage` to measure it. Size type from the field's character limit in beats.json at the narrowest format (9:16), not from the sample copy, and step it down with `:has()` counts rather than measuring at run time.
- Icons: only `ICONS` from `motion-kit/icons.mjs`; the director picks from `ICON_NAMES`.
- Assets: `asset(name)` from `kit.mjs`; logo via `logoHtml` from `shared.mjs`. When `hasLogoBug(brand)` is true the kit draws the corner logo on every scene, so a scene (a cta card, a clip's own bug) leaves its logo out: `const logo = hasLogoBug(brand) ? '' : logoHtml(…)`. A top-anchored title starts at `UNDER_BUG` (140) or lower when the bug shows.
- Content area: `contentArea(brand, g)` gives `{ top, bottom }` in 1080 units, clear of the corner logo (140, else 100) and of a two-line subtitle band (210, portrait 300). Stage layouts centre their block inside it (see explainer `step`/`diagram`, data-story `stat`/`bars`/`line`, before-after `split`/`stat`, code-story `checklist`). Write these overrides only under `if (M.layout === 'stage')` (`const M = motionProfile(brand)`; cinematic, clean, editorial and parallax use the stage layout), and when the type has to step down as a list grows, select on the count with `:has(> :nth-child(n))` rather than adding markup.
- Themes: a body kind may take `theme` (`light` | `dark` | `accent`, `enums.theme` in beats.json). `themeClass(sc)` adds ` dark` (brand primary, onPrimary text; push `dark: true` into the scene so the logo bug and subtitles switch) or ` acc` (brand secondary, ink text; not dark, `ACCENT_CSS` holds the base rule). Write theme rules only when a scene uses that theme, scoped to the kind's own classes (`.dark .stext .stx`, not `.dark .stx`), so pinned pages stay byte for byte the same.
- Chart data a kind needs (lists with counts, point indices) is validated from `beats.data[kind]` in `validateData` (`engine/script.mjs`): race, stripes, line `band`/`ref`, explainer `flash` items, code-story listings.
- Screenshots: a kind with `shots` (app-walkthrough `screen`, ui-story `shot`) declares `beats.shots` (`max`, `imageSize`), so `validateScript` checks every `asset` is in the project and every `focus`/`cursor` is inside the image; frame a focus with `camera(focus, imageSize)` from `kit.mjs`.
- A new kind on a renderer whose existing output is pinned by a hash (`PARTS_BASELINE`, `NO_SHOT_BASELINE`) writes its css, markup and js only when the script uses that kind (see ui-story `hasShots`).

## Making a template mixable

A mixed brief (`template` = lead, `mix` = up to 3 extras) builds one page from several renderers through `buildMixed` in `engine/mix.mjs`. To let a template join:

1. `beats.json`: `"mixable": [<body kinds>]`, and `defaults` that fill every required field of those kinds.
2. `template.mjs`: export `parts()` and make `build()` = `page(parts())` as above. For a template already pinned in `PARTS_BASELINE` (`tests/templates.test.mjs`) the hash must not move.
3. css: a flat rule list. No `@media` or other `@` rules, no nested blocks, no `{`/`}` inside strings; `scopeCss` prefixes every selector with `.t-<id>` and throws otherwise.
4. Ids: scene ids are unique already; any global (non-scene) id carries a template prefix (`xicon`, not `icon`).
5. js: `const KINDS = { … }` at the top level of the js string. In a mix the code runs in a function scope whose `D.scenes` shows other templates' scenes as `<id>.<kind>`, so a check like `D.scenes[i + 1].kind === 'step'` only matches your own kinds. No `afterSeek`, no `window.__prepare` (`buildMixed` refuses them).
6. `extra` keys are named after the template (`navLabels` for ui-story); every renderer's `extra` lands in one `D`.
7. Dark frames: a scene your renderer draws on a dark background (a `.dark` group, a full-bleed brand colour) carries `dark: true` in the `scenes` that `parts()` returns. When the lead sets a subtitle style, those scenes get its dark colours whichever template leads. A test checks every `.dark` group of a mixable renderer.
8. Subtitle style: only the lead's `subs` applies. `parts()` may return `subs: { size, weight, lineHeight, side, bottom, pill, color, lit, darkColor, darkLit }` (sizes in 1080-short-side units, colours hex or rgb(a)); absent = the kit pill.
9. Verify: `npm test`, then `prepare` a scratch mixed job with this template as an extra and look at every still.

Not mixable in v1: footage templates (`audio: "footage"`), and product-demo and app-walkthrough (on the kit with `parts()` since 2026-10-23, but their beats list no `mixable` kinds yet). Two templates sharing one renderer (feature-launch + ui-story) cannot share a page.

## Checking the result

```bash
npm test
node engine/cli.mjs prepare <project> <job>   # builds index.html + stills for a job using the template
```

Look at every still in `out/<project>/<job>/stills/` in each format you changed.
