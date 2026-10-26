# Plan files

A plan file is the repo-local contract for one Medium/High change: `.ai/plans/<slug>.md`, created from `plan-template.md`.

- `tech-lead` writes it (Intent, Options considered, Scope, Reuse & extension, Architecture, Task breakdown with a Verify per task, Acceptance criteria).
- `senior-dev` implements only its Scope, one task and one Verify at a time.
- CODE_REVIEW checks the diff against its Scope and Acceptance criteria.
- `/loop-ticket` and `/epic` keep their state in its checkboxes and `## Loop Journal`.
- `/plan-sync` compares it with the code; `/release-evidence` turns it into a summary.

Skip the plan for a trivial single-file `dev-quick` change. Use a short kebab-case slug, e.g. `quote-scene.md`.
