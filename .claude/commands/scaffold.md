---
description: "Scaffold a new video template (beats.json + template.mjs)"
argument-hint: "[template-id] - lower-case id with dashes, e.g. quote-card"
---

Scaffold a new template named `$ARGUMENTS`. Follow the `template-authoring` skill.

1. Check the id matches `^[a-z0-9][a-z0-9-]{0,63}$` and `templates/$ARGUMENTS/` does not exist yet. Stop and ask if either fails.
2. Ask (or infer from the request) whether an existing renderer fits. If yes, create only `templates/$ARGUMENTS/beats.json` with `"extends": "<existing-id>"` and stricter rules.
3. Otherwise copy `.ai/templates/beats.json.template` → `templates/$ARGUMENTS/beats.json` and `.ai/templates/template.mjs.template` → `templates/$ARGUMENTS/template.mjs`; replace `__ID__` and `__LABEL__`.
4. Adjust `sequence`, `fields`, `limits`, `defaults` to the request; keep every kind in `sequence` matched by a branch in `build()` and a `KINDS` entry.
5. Run `npm test` (`tests/templates.test.mjs` builds every template in every format).
6. Add the template to `.ai/docs/file-index.md`.

Report the files created and the test result.
