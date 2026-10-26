# Motion Studio — Common Patterns

Real excerpts from the codebase. Copy the shape, not the content.

## 1. Safe ids and paths (`engine/core.mjs`, `engine/jobs.mjs`)

```js
export function within(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  const root = path.resolve(base);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new StudioError('Path escapes its base folder', 400);
  return resolved;
}

export const jobDir = (project, id) => within(DIRS.out, assertId(project, 'project'), assertId(id, 'job'));
export const jobFile = (project, id, name) => within(jobDir(project, id), name);
```

Every id from a URL, CLI argument or JSON goes through `assertId` / `assertFileName`, and every
path through `within()`.

## 2. API route (`server/server.mjs`)

Routes are plain `if` checks on method and path parts inside `api()`. Expected failures throw
`StudioError(message, code)`; the top-level handler turns them into `{ error }` JSON.

```js
if (m === 'POST' && action === 'run') {
  const what = body.action;
  if (!['prepare', 'render'].includes(what)) throw new StudioError('action must be prepare or render', 400);
  if (what === 'render' && !['approved', 'done'].includes(st.status)) throw new StudioError('Approve the storyboard first', 409);
  return send(res, 202, runEngine(what, project, id));
}
```

## 3. Child process with caps (`server/server.mjs` → `runEngine`)

```js
const child = spawn(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), action, project, id, '--by', USER], {
  cwd: ROOT, shell: false, windowsHide: true,
});
const capped = (d) => { if (bytes < cfg.engine.maxLogBytes) { bytes += d.length; log.write(d); } };
child.stdout.on('data', capped);
child.stderr.on('data', capped);
const timer = setTimeout(() => { child.kill(); setStatus(/* … error … */); }, cfg.engine.runTimeoutMinutes * 60000);
```

Argument array, `shell:false`, concurrency limit, hard timeout, capped log. Same shape for
ffmpeg (`engine/media.mjs`) and PowerShell TTS (`engine/tts.mjs`).

## 4. Job state change (`engine/jobs.mjs`, `engine/pipeline.mjs`)

```js
export function claim(project, id, by) {
  loadBrief(project, id);
  const st = getStatus(project, id);
  requireStatus(st, DIRECTOR_PICKABLE, 'claim');
  fs.mkdirSync(jobDir(project, id), { recursive: true });
  return setStatus(project, id, { status: 'scripting', step: 3, error: null }, `claimed by director`, by);
}
```

Check the allowed source statuses, then `setStatus` with an event text and actor, so `history`
records it.

## 5. Data model: template rules (`templates/<id>/beats.json`)

```json
{
  "id": "explainer",
  "formats": ["16:9", "1:1", "9:16", "4:5", "2:3", "21:9"],
  "sizes": { "16:9": [1920, 1080], "1:1": [1080, 1080], "9:16": [1080, 1920], "4:5": [1080, 1350], "2:3": [1080, 1620], "21:9": [2520, 1080] },
  "durations": [15, 150],
  "sequence": [
    { "kind": ["title"], "min": 1, "max": 1 },
    { "kind": ["step", "diagram", "video", "flash"], "min": 1, "max": 10 },
    { "kind": ["cta"], "min": 0, "max": 1 }
  ],
  "fields": { "step": { "required": ["vo", "title", "icon", "source"], "optional": ["kicker", "text", "theme", "pace"] } },
  "limits": { "title": 44, "text": 110, "voWords": 34 },
  "enums": { "theme": ["light", "dark", "accent"] },
  "data": { "flash": { "items": [2, 12], "chars": 28 } },
  "mixable": ["step", "diagram", "video", "flash"]
}
```

`validateScript` enforces `sequence`, `fields`, `limits` and `enums`, and `data[kind]` shapes through `validateData`. A template may `extends`
another to reuse its renderer with stricter rules. `mixable` lists the body kinds the template adds
to another template's brief (absent = not mixable); a mixed script writes them as `explainer.step`.

## 6. Template renderer (`templates/explainer/template.mjs`)

```js
import { page, geometry, h } from '../kit.mjs';

export function build(args) {
  return page({ ...args, title: 'explainer', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, size }) {
  const { px, port } = geometry(size);
  const blocks = [], scenes = [];
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'title') {
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="hd tt" data-lint>${h(sc.title)}</div></div>`);
      scenes.push({ id, kind: 'title' });
    } else if (sc.kind === 'cta') {
      blocks.push(`<div class="sc fill dark" id="g-${id}">…</div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  // css: flat rules sized with px(n); js: `const KINDS = { title(sc, s) {…}, … };` at top level.
  return { css, body: blocks.join('\n'), scenes, js };
}
```

All text through `h` (`escapeHtml`). Sizes through `px()`. `data-lint` on text that must stay in
the safe area. Animation is built per scene into a timeline that `seek(t)` drives; no timers.
`buildMixed` (`engine/mix.mjs`) calls the same `parts()` for a mixed brief, so css stays a flat rule
list (no `@` rules), global ids carry a template prefix, and a scene on a dark frame says `dark: true`.

## 7. Test (`tests/engine.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('ids and paths refuse traversal', () => {
  assert.throws(() => assertId('../x'));
  assert.equal(assertId('megamax-9x16'), 'megamax-9x16');
  assert.throws(() => within(DIRS.out, '..', 'secret'));
});
```

`node:test` + `node:assert/strict`, one behaviour per test, no mocks for the file system: tests
use the real `templates/` and `profiles/` folders. Run with `npm test`.

## 8. UI call (`ui/app.js`)

```js
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { 'X-Studio': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}
```

Every write sends `X-Studio: 1`. HTML built in the UI goes through `esc()`.
