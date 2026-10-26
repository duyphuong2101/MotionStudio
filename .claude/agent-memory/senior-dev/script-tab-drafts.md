---
name: script-tab-drafts
description: Draft scenes (draft key) and Script tab help — lock rules, dirty_from 4, where help text resolves; gotchas when touching humanEdit or beats.json help
metadata:
  type: project
---

- A draft scene's `draft` key is NOT a scene field. `diffLocks` reports a changed note as `scene:<id>.draft` so a draft-only save counts as a change, but `lockDrafts` in `engine/jobs.mjs` removes every `.draft` lock. If the draft were locked, `mergeRespectingLocks` would put it back and `commit` would refuse forever.
- `scene:<id>.kind` is a lock key only for draft scenes. `mergeRespectingLocks` restores `kind` separately, because `kind` is not in `sceneFieldNames()`.
- `dirty_from` uses `Math.min` with the old value. A job that went to 4 because of drafts stays at 4 after every draft is removed, until the Director runs (conservative, not yet fixed).
- Bullet screenshots (`source.bullets[n].asset`): an asset-only source edit gives lock key `bullets.asset` (not `bullets`), whose stamp carries `assets: { <bullet text>: file|null }`. Merge restores by bullet TEXT, so a Director reorder is safe and untouched bullets stay the Director's. `editDirtyFrom('source', doc, changed)` returns null for it, and the PUT route then keeps the status and only logs history.
- UI logic that needs a unit test goes in a small `ui/<name>.js` ES module (the server serves `/ui/[a-z0-9-]+.js`; package `type: module` lets tests import it).
- `tests/help.test.mjs` fails for any template kind or field without help text. A new field needs a `FIELD_HELP` entry or a beats.json `help.fields` entry.

**Why:** these were built 2026-10-14 for the user's "Add scene gave me a title I couldn't fill" report.
**How to apply:** check these before you change locks, `editDirtyFrom` or template fields. See also [[tooling-gotchas]].
