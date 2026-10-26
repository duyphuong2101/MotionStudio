# carry-transitions — one object carries the eye across a cut

**Status:** in-review (phase 1 implemented 2026-10-26; phase 2 not started)
**Author:** tech-lead
**Branch:** none (repo is not under git)
**Created:** 2026-10-26
**Risk tier / auto-enabled phases:** template look → USER_REVIEW with stills and the cut sheet; engine test (playcheck contract)

## Intent
The person asked to apply the ideas from `yihui-dev/awesome-opus5-5-videos`. The strongest one left is the object-driven transition: "the thing in the front of the shot becomes the transition", "one object carries the story across shots". Today every cut hides one scene and shows the next; the veil (2026-10-26) made colour changes smooth, but nothing on screen links one scene to the next.
**For whom / outcome:** people who approve and present brand films (the NSC award film first). The film reads as one continuous piece instead of a slide show, and a reviewer stops noticing the cuts.

## Options considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| A. Brand carrier: one accent shape (a bar in `secondary`) lives above the scenes; at every cut it glides from the outgoing scene's anchor (its kicker or title) to the incoming one's, on one eased curve | Kit only; no script or Director change; every cinematic template gets it; nothing to approve per scene; the "one accent carries every transition" rule from the references | The same motion at every cut; a scene without a kicker or title has no anchor (the carrier parks at the logo bug) | ✅ phase 1: small, safe, visible on the next render |
| B. Content carry: a scene may set `carry: "value" \| "title"`; at the cut that element flies into the matching element of the next scene (a stat number becomes the next heading), cross-fading into it | The real match cut; strongest effect | New script field, a Director rule, per-kind `data-carry` marks in every renderer, a playcheck exemption (two scenes' text on screen for 0.4 s) | ✅ phase 2, only after A is approved on a real film |
| C. Keep cuts as they are | No work | Leaves the biggest quality gap the references name | ❌ |

## Scope (phase 1 only; phase 2 gets its own update of this file)
- [x] Brand field `carry: true` (cinematic and clean motion only, through a `carrier` field on their `MOTION_PROFILES` rows; ignored elsewhere), validated in `engine/brand.mjs`, listed in the Brand tab next to the light leaks.
- [x] `templates/kit.mjs`: `#carrier` above the veil (z 23, under the vignette and captions); per scene its anchor box is read at the start of build(), before any tween (a `[data-anchor]`, else the first `.kick`, else `.hd`, the text's own box via a Range); at each cut it tweens x, y and width from the old box to the new over the veil window (0.25 s in, 0.35 s out), `power3.inOut`; it is a function of `seek(t)` only.
- [x] Hidden in a full-frame footage scene (no anchor that reads over a picture) and on the first and last 0.3 s of the video.
- [x] Off by default: every page without `brand.carry` stays byte for byte the same (the hash tests prove it).

## Out of scope
Phase 2 (content carry), any change to the Director, script schema or beats.json; the standard, editorial, kinetic and parallax profiles; the sequence joins between parts.

## Reuse & extension
- **Reused:** the veil's cut windows (`VEIL_IN`, `VEIL_OUT`) so the carrier moves while the frame changes; `surfaceDark` for its colour on dark scenes; `cutWindows` for the timing; the playcheck `oneScene` rule (the carrier is not text, so it is not counted).
- **Extracted:** none yet; phase 2 would extract the per-scene anchor lookup as the shared seam.
- **Extension point:** a renderer can mark its own anchor with `data-anchor` on one element; without it the kit falls back to `.kick`, then `.hd`.
- **Old path proven by:** the CINE_BASELINE and PARTS_BASELINE hashes unchanged for a brand without `carry`.

## Architecture
```mermaid
flowchart LR
  brand[brand.json carry:true] --> page[kit page()]
  page --> build[build(): per scene anchor box]
  build --> tl[GSAP timeline: carrier tweens in each cut window]
  tl --> seek[seek(t)] --> chrome[render frames]
  chrome --> qa[QA cut check + cuts.jpg]
```
The seam is `page()` in `templates/kit.mjs`: one more optional layer like `#cutveil`, written only when the brand asks for it.

## Files to create / modify
| File | Change |
|------|--------|
| `engine/brand.mjs` | `carry` validation |
| `templates/kit.mjs` | `#carrier` css, markup, `CARRY_JS`, call in `build()` |
| `ui/app.js` | Brand tab checkbox |
| `tests/cinematic.test.mjs` | carrier moves only in cut windows, sits on each anchor between cuts, hashes unchanged without it |
| `CLAUDE.md` | one clause in the brand fields list |

## Task breakdown
### T1 — validate `brand.carry`
- **Files:** `engine/brand.mjs`, `tests/cinematic.test.mjs`
- **Verify:** `node --test --test-name-pattern "carry" tests/cinematic.test.mjs`
- [x] done — brand.carry test → 1/1 pass; motion-presets keeps UI options in step (`carry` flag) → 14/14 pass

### T2 — the carrier in the kit
- **Files:** `templates/kit.mjs`, `tests/cinematic.test.mjs`
- **Verify:** `node --test tests/cinematic.test.mjs tests/templates.test.mjs` (hashes unchanged, carrier test passes in Chrome)
- [x] done — carrier Chrome test 1/1 pass (rests on each anchor, moves only over the cut, ink on accent); CINE/PARTS hashes unchanged without `carry`

### T3 — Brand tab and the NSC sample
- **Files:** `ui/app.js`, `CLAUDE.md`
- **Verify:** `npm run ui`, tick Carry on a copy of the NSC brand, prepare a3, open `review/cuts.jpg`: the bar travels from heading to heading at every cut
- [x] done — Brand tab checkbox (`br-carry`, shown for profiles with `carrier`); NSC a3 built with `carry` in a scratch copy (NSC brand untouched): cut sheet shows the bar under each kicker or heading, ink on accent, gone over footage. Found and fixed: seeking the timeline to measure anchors broke shared elements on the mixed page (step icon in every scene); anchors are now measured before any tween, guarded by the "carrier hidden" pixel test (fails at 218 levels with the old code, passes now)
