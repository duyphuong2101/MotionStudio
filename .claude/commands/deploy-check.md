---
description: "Pre-release validation: install check + tests + engine smoke + a storyboard on a demo job"
allowed-tools: Bash(npm ls:*), Bash(npm test:*), Bash(node --version:*), Bash(node engine/cli.mjs help:*), Bash(node engine/cli.mjs list:*), Bash(node engine/cli.mjs prepare:*), Read
---

Motion Studio is a local tool; "deploy" means handing the folder to another person or machine. Run, in order, and stop at the first failure:

1. `node --version` (20+) and `npm ls --depth=0` (all dependencies installed).
2. `npm test` — all suites pass.
3. `node engine/cli.mjs help` and `node engine/cli.mjs list`.
4. Config sanity: read `config/studio.json` and confirm `server.host` is `127.0.0.1`, `director.maxJobsPerRun` and `director.jobTimeoutMinutes` are set, `engine.maxConcurrentRuns`, `engine.runTimeoutMinutes` and `engine.maxLogBytes` are set.
5. Secrets: confirm `config/providers.json` holds only `keyEnv` names, no key values.
6. Only if the user agrees to the run time: pick a job that already has `script.json` from `node engine/cli.mjs list`, run `node engine/cli.mjs prepare <project> <job>` (needs Chrome) and check that stills appear in `out/<project>/<job>/stills/`.

Report a table: check, result, details for failures. Verdict: READY / NOT READY.
