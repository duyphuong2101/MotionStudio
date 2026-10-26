---
name: server-route
description: Add or change a route in the Motion Studio local UI server (server/server.mjs) and its UI call. Use for any new /api endpoint, file-serving change, or engine run trigger.
---

# Server route

`server/server.mjs` is a plain `node:http` server. No framework. Routes are `if` branches inside `async function api(req, res, url)`.

## Fixed boundary (never change)

- Binds to 127.0.0.1 only; refuses to start otherwise.
- Every request: Host must be `127.0.0.1:<port>` or `localhost:<port>` (421 otherwise).
- Every non-GET request: same-origin `Origin` (when present) and header `X-Studio: 1` (403 otherwise). These checks run before `api()`.
- No route invokes Claude or any model, directly or by spawning something that does. Exceptions: the two person-clicked paths, `server/director.mjs` (Run Director: the Claude seat, or the API worker in `server/worker/` on the person's own provider key; the Run Director routes) and `server/generate.mjs` (Gemini assets with the person's own key, the Generate and Refresh models routes). Never add another.

## Adding a route

1. Parse ids from `parts` and pass each through `assertId(value, 'what')`. File names through `assertFileName`. Paths through `within()`.
2. Read the body with `readBody(req)` (JSON, 256 KB cap) or `readRaw(req, limit)` (uploads).
3. Validate at the boundary (`validateBrief`, `validateBrand`, `validateSource`, `validateScript`, or a new validator in `engine/`).
4. Check the job status before changing anything: refuse with 409 while `preparing` or `rendering`.
5. Change state with `writeJson` / `setStatus` (actor = `USER`). Human edits of source/script go through `humanEdit` so they lock.
6. Answer with `send(res, code, data)`. Expected failures: `throw new StudioError('Short English message that says what to do', code)`.
7. Long work (prepare, render) goes through `runEngine(action, project, id)`: one at a time, `shell:false`, timeout, capped `engine.log`. Answer 202.

```js
if (m === 'POST' && parts[0] === 'jobs' && action === 'duplicate') {
  const target = assertId(body.id, 'job');
  // validate, write with writeJson, record with setStatus
  return send(res, 201, { id: target });
}
```

## UI side

Call through `api(path, { method, body })` in `ui/app.js`; it sends `X-Studio: 1` and throws the server's `error` text. Build HTML from data with `esc()`. Labels in English.

## Serving files

Job outputs are served only when the relative path matches `JOB_FILE_RE`. Brand assets get `ASSET_HEADERS` (sandbox CSP + `nosniff`). Widen `JOB_FILE_RE` only for a specific new output name.

## Test

Add a case to `tests/engine.test.mjs` for any new validator or state change. Run `npm test`. For the route itself, start `npm run ui` and exercise it from the UI.
