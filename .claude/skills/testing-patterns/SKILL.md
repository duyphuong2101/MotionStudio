---
name: testing-patterns
description: "Testing patterns for Motion Studio (node:test + node:assert/strict). Use when writing or modifying any tests."
---

# Testing patterns

Apply when writing or modifying tests in `tests/`.

## Stack

- Runner: `node --test tests/*.test.mjs` (`npm test`). No Jest, no Vitest, no extra dependency.
- Assertions: `import assert from 'node:assert/strict'`.
- Files: `tests/<area>.test.mjs`, ESM.

| File | Covers |
|---|---|
| `tests/engine.test.mjs` | ids and paths, escaping, script/source validation, locks, timing, brand validation |
| `tests/templates.test.mjs` | every template in `templates/` builds a sample script in every format |
| `tests/assets.test.mjs` | asset names, types, size caps |

## Shape

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { humanEdit, mergeRespectingLocks } from '../engine/jobs.mjs';

test('a locked field survives the next director commit', () => {
  const before = { name: 'A', bullets: [] };
  const { doc: edited } = humanEdit('source', before, { ...before, name: 'B' }, 'tester');
  const { doc, kept } = mergeRespectingLocks('source', edited, { name: 'C', bullets: [] });
  assert.equal(doc.name, 'B');
  assert.deepEqual(kept, ['name']);
});
```

- One behaviour per test, named as a sentence of what must hold.
- Arrange, act, assert. Build inputs with a small factory (`const script = () => ({ ... })`) and change one thing per case.
- Edge cases first: bad id (`'../x'`, `'Upper'`), path escape, a locked field, a job in the wrong status, a field over its limit, an unknown icon, a missing asset.
- Assert the specific message fragment for `StudioError` cases: `assert.throws(() => assertId('../x'))`, or `errors.some((e) => e.includes('chip'))`.

## What not to do

- No file-system mocks. Tests read the real `templates/` and `profiles/` folders.
- No network, no Chrome, no ffmpeg in unit tests. `prepare` and `render` are checked by running the CLI on a demo job, not in `npm test`.
- No writes outside a temp folder. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'))` and remove it in `t.after`.
- Never weaken, skip or delete an existing assertion to make a change pass.

## Template tests

`tests/templates.test.mjs` builds one scene of every kind from each template's `defaults`. A new template is covered automatically once its `defaults` fill every required field. Add a focused case only for template-specific logic (a parser, a layout branch).
