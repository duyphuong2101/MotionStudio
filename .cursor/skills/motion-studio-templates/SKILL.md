---
name: motion-studio-templates
description: Create or change a Motion Studio video template (templates/<id>/beats.json + template.mjs). Use when adding a scene kind, a new template, changing limits or layout, or making a template that extends another.
---

# Motion Studio templates

The full guide is `.claude/skills/template-authoring/SKILL.md` (shared with Claude Code). Read it before editing a template.

Key rules:
- `beats.json` = the rules (`sequence`, `fields`, `limits`, `enums`, `defaults`); `template.mjs` = `build({ brief, brand, script, timing, size })` returning one HTML page. `"extends": "<id>"` reuses another renderer.
- Shell from `templates/kit.mjs` (`page`, `geometry`); text through `h()`; sizes through `px()`; `data-lint` on text that must fit.
- Everything visible is a function of `seek(t)`: no timers, no `Math.random`, no `Date.now`.
- Icons only from `motion-kit/icons.mjs`.
- Scaffolds: `.ai/templates/beats.json.template`, `.ai/templates/template.mjs.template`.
- Verify with `npm test`, then `node engine/cli.mjs prepare <project> <job>` and look at the stills.
