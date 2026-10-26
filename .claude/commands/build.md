---
description: "Check that Motion Studio is ready to run (there is no build step)"
allowed-tools: Bash(npm install:*), Bash(npm ls:*), Bash(node --version:*), Bash(node engine/cli.mjs help:*), Read
---

Motion Studio has no compile or bundle step: Node runs the `.mjs` sources directly and the UI is static files. "Build" means confirming the runtime is ready.

1. `node --version` — must be 20 or newer.
2. `npm ls --depth=0` — every dependency in `package.json` is installed. If not, run `npm install`.
3. `node engine/cli.mjs help` — the engine loads and prints its usage.
4. Report Chrome as a prerequisite the person must have installed (`config/studio.json` → `engine.chromeChannel`); do not try to install it.

Report each step as pass/fail. Do not start the UI server and do not run `prepare` or `render` unless the user asks.
