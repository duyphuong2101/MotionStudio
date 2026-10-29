#!/usr/bin/env node
// PreToolUse hook: Block destructive bash commands
// Prevents accidental data loss from dangerous shell commands

const BLOCKED_COMMANDS = [
  // Destructive file operations
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\b/i, reason: 'Recursive forced deletion' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\b/i, reason: 'Recursive forced deletion' },
  { pattern: /\brm\s+--recursive\s+--force\b/i, reason: 'Recursive forced deletion' },
  // `rm -r -f x` is `rm -rf x` with a space; the clustered patterns above only catch r and f in ONE
  // cluster. Long and short forms mix freely (`rm -r --force`, `rm --force -r`), so accept either.
  { pattern: /\brm\s+(?:(?:-[a-zA-Z]+|--\w[\w-]*)\s+)*(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive)\s+(?:(?:-[a-zA-Z]+|--\w[\w-]*)\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b/i, reason: 'Recursive forced deletion (separated flags)' },
  { pattern: /\brm\s+(?:(?:-[a-zA-Z]+|--\w[\w-]*)\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\s+(?:(?:-[a-zA-Z]+|--\w[\w-]*)\s+)*(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b/i, reason: 'Recursive forced deletion (separated flags)' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+[\/~]/i, reason: 'Recursive deletion of root or home paths' },

  // PowerShell / cmd / node deletions (bypass Unix rm patterns)
  // PowerShell accepts any unambiguous prefix of -Recurse (-r, -re, -rec …) → match them all.
  { pattern: /(\bRemove-Item\b|\bri\b|\brd\b)(?=[^|;&]*\s-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?\b)/i, reason: 'PowerShell recursive deletion (Recurse/-r, Force optional)' },
  { pattern: /\[(?:IO\.|System\.IO\.)?Directory\]::Delete/i, reason: 'PowerShell [IO.Directory]::Delete recursive deletion' },
  { pattern: /\.(rmSync|rmdirSync|rmdir)\s*\(/, reason: 'Node fs sync recursive deletion via interpreter -e' },
  // Matches fs.rm(, fs.promises.rm(, require('fs'|'node:fs'|'fs/promises').rm( — quote or backtick.
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.rm\s*\(/i, reason: 'Node fs.rm / fs.promises.rm deletion via interpreter -e' },
  { pattern: /require\(['"`](?:node:)?fs(?:\/promises)?['"`]\)[\s\S]*\b(rm|rmdir)\s*\(/i, reason: 'Node fs/promises destructured rm() via interpreter -e' },
  { pattern: /\b(del|rmdir|rd|erase)\b[^|;&]*\/s\b/i, reason: 'cmd recursive deletion (any flag order)' },
  { pattern: /\brimraf\b/i, reason: 'rimraf recursive deletion (e.g. npx rimraf)' },
  { pattern: /\bfind\b[^|;&]*\s-delete\b/i, reason: 'find -delete bulk deletion' },

  // Single-file deletion (bypasses the recursive-only patterns above; allow lists
  // permit `node -e`/`powershell`/`del`, so a lone unlink/Delete must be caught too)
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.(unlink|unlinkSync|truncate|truncateSync)\s*\(/i, reason: 'Node fs single-file delete/truncate via interpreter -e' },
  { pattern: /require\(['"`](?:node:)?fs(?:\/promises)?['"`]\)[\s\S]*\b(unlink|unlinkSync|truncate|truncateSync)\s*\(/i, reason: 'Node fs destructured unlink/truncate via interpreter -e' },
  { pattern: /\[(?:IO\.|System\.IO\.)?File\]::Delete/i, reason: 'PowerShell [IO.File]::Delete single-file deletion' },
  { pattern: /(\bRemove-Item\b|\bri\b|\bdel\b|\berase\b)(?![^|;&]*\s-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?\b)[^|;&]*\.(env|pem|key)\b/i, reason: 'PowerShell/cmd deletion of a secret file' },

  // Overwrite/truncate a PROTECTED file (config/hooks/secrets) — general writes are
  // fine; only guard files protect-files.js guards, since Bash bypasses that hook.
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|rename|renameSync)\s*\([^)]*(\.env|settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json|\.claude[\\/](?:hooks|scripts)[\\/])/i, reason: 'Node fs write/copy/rename onto a protected file via interpreter -e' },
  { pattern: /(?:Set-Content|Out-File|Add-Content)\b[^|;&]*(\.env|settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json|\.claude[\\/](?:hooks|scripts))/i, reason: 'PowerShell write onto a protected file' },

  // Dangerous git operations
  { pattern: /git\s+push\s+(?:[^|;&]*\s)?--force(?![-\w])/i, reason: 'Force push (use --force-with-lease instead)' },
  { pattern: /git\s+push\s+(?:[^|;&]*\s)?-f(?![-\w])/i, reason: 'Force push -f (use --force-with-lease instead)' },
  // A leading + on a refspec is exactly --force for that ref, and carries no -f/--force token.
  { pattern: /git\s+push\b[^|;&]*\s\+[\w./-]+:/i, reason: 'Force push via + refspec (use --force-with-lease)' },
  { pattern: /git\s+reset\s+--hard/i, reason: 'Hard reset discards uncommitted changes' },
  { pattern: /git\s+clean\s+-[a-zA-Z]*f/i, reason: 'Force clean removes untracked files' },
  // checkout/restore of the whole worktree — any tree-ish prefix (HEAD, @), any terminator incl. # comment, and the ":/" magic pathspec (= repo root).
  { pattern: /git\s+checkout\s+(?:[^|;&#]*\s)?(?:--\s+)?(?:\.|:\/)(?=\s*($|[;&|#]))/i, reason: 'Discards unstaged changes (git checkout .)' },
  { pattern: /git\s+checkout\s+(?:-f|--force)\b/i, reason: 'Force checkout discards local changes' },
  { pattern: /git\s+restore\s+(?:[^|;&#]*\s)?(?:--\s+)?(?:\.|:\/)(?=\s*($|[;&|#]))/i, reason: 'git restore . discards unstaged changes' },
  { pattern: /git\s+switch\s+(?:[^|;&]*\s)?(?:-f|--force|--discard-changes)\b/i, reason: 'git switch -f/--discard-changes discards local changes' },
  { pattern: /git\s+stash\s+(?:drop|clear)\b/i, reason: 'git stash drop/clear destroys stashed work' },
  { pattern: /git\s+update-ref\s+(?:[^|;&]*\s)?-d\b/i, reason: 'git update-ref -d deletes a ref (evades branch -D)' },
  { pattern: /git\s+worktree\s+remove\s+(?:[^|;&]*\s)?(?:-f|--force)\b/i, reason: 'git worktree remove --force discards a worktree with changes' },
  { pattern: /\bgit\s+branch\s+(?:[^|;&]*\s)?(?:-[a-z]*D[a-z]*|--delete\s+--force|--force\s+--delete)/, reason: 'Force delete branch without merge check' },

  // Database destruction
  { pattern: /DROP\s+(DATABASE|TABLE|SCHEMA)\s/i, reason: 'Database/table destruction' },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?[a-zA-Z_\[]/i, reason: 'Table truncation (with or without TABLE keyword)' },

  // Exfiltration of a secret file. protect-files.js only guards WRITES (Edit|Write), so nothing
  // stopped `cat CLAUDE.local.md` printing a password into the transcript, or `cp .env /tmp`
  // moving it out of the repo. The Read tool stays allowed on purpose — it is visible and scoped;
  // these Bash paths are the ones that dump or relocate the file wholesale.
  // SECRET_FILE below is the shared shape: .env, CLAUDE.local.md, *.local.json, credentials/keys.
  // A secret path ENDS at .env — `.env.example`/`.sample`/`.template` are docs and `build.env.log`
  // is a log, so the lookahead must reject a following filename char but accept every shell
  // terminator (`;` `|` `&` `>` `)` quote, whitespace, EOL). `[^\w.-]` covers them all at once.
  // The verb list is deliberately broad: any reader (sed/awk/base64/tar/openssl/curl) exfiltrates
  // just as well as `cat`, and the earlier narrow list left all of them open.
  // `.env` and `.env.int`/`.env.prep` are both secrets; `.env.example|sample|template` are docs.
  // accounts.json holds the QA credential pool; .mcp.json holds MCP server tokens.
  { pattern: /\b(cat|type|less|more|head|tail|strings|xxd|od|base64|sed|awk|nl|grep|rg|Select-String|sls|Get-Content|gc|tar|zip|7z|openssl|curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*(?:\.env(?:\.(?!example|sample|template|log|txt|md|bak|orig)[\w-]+)?(?![\w.-])|CLAUDE\.local\.md|appsettings\.local\.json|accounts\.json|\.mcp\.json|credentials\.|\.pem(?![\w.-])|\.key(?![\w.-])|id_rsa)/i, reason: 'Reading/exfiltrating a secret file (use the Read tool if you genuinely need one value)' },
  { pattern: /\b(cp|copy|mv|move|scp|rsync|Copy-Item|Move-Item)\b[^|;&]*(?:\.env(?:\.(?!example|sample|template|log|txt|md|bak|orig)[\w-]+)?(?![\w.-])|CLAUDE\.local\.md|appsettings\.local\.json|accounts\.json|\.mcp\.json|credentials\.|\.pem(?![\w.-])|\.key(?![\w.-])|id_rsa)/i, reason: 'Copying/moving a secret file (exfiltration risk)' },
  // A secret read through an interpreter: `node -e "fs.readFileSync('.env')"` prints it as surely as cat does.
  { pattern: /^(?=[\s\S]*\b(?:node|deno|bun|python[23]?|ruby|perl|php)\b)(?=[\s\S]*\b(?:readFileSync|readFile|createReadStream|openSync|read_text|file_get_contents|File\.read)\b)(?=[\s\S]*['"\x60][^'"\x60\s]*(?:\.env(?:\.(?!example|sample|template)[\w-]+)?|CLAUDE\.local\.md|appsettings\.local\.json|\.pem|\.key|id_rsa)['"\x60])/i, reason: 'Reading a secret file through an interpreter (use the Read tool if you genuinely need one value)' },
  // env/printenv dump every variable — the same harm as `cat .env`, through a different door.
  // Bare `env` / `printenv` only. `env FOO=bar cmd` sets a variable and is fine; a `printenv` that
  // appears inside a quoted regex or a longer word must not match, hence the command-position
  // anchor plus a hard end-of-command boundary.
  { pattern: /(?:^|[;&|]\s*|\n\s*)(?:env|printenv)[ \t]*(?:$|[;&|>\n])/i, reason: 'Dumping the whole environment (secrets live there) — read the one variable you need' },
  { pattern: /(?:^|[;&|]\s*|\n\s*)(?:Get-ChildItem|gci|ls|dir)\s+env:[ \t]*(?:$|[;&|>\n])/i, reason: 'Dumping the whole environment via PowerShell env: drive' },
  // The write-guard only sees Edit/Write, so a text mutator can disable it from Bash.
  // Only the IN-PLACE forms — `sed -n`/`awk` reading a hook is legitimate inspection.
  { pattern: /\b(?:sed|perl)\b[^|;&]*\s-[a-z]*i[a-z]*\b[^|;&]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'In-place edit of a guard hook/script from the shell (bypasses protect-files.js)' },
  { pattern: /\b(?:truncate|tee|dd|install)\b[^|;&]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'Overwriting a guard hook/script from the shell (bypasses protect-files.js)' },
  { pattern: /\b(?:rm|cp|mv|move|Copy-Item|Move-Item|Remove-Item)\b[^|;&]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'Deleting/replacing a guard hook/script from the shell' },
  { pattern: /\bgit\s+(?:checkout|restore)\b[^|;&]*\.(?:claude|cursor)[\\/](?:hooks|scripts)/i, reason: 'Reverting a guard hook/script via git (silently disables the guard)' },

  // Staging a secret for commit. A leaked credential on a remote is permanent — rotation is the
  // only remedy — so this is blocked outright, not warned about. `git add -A`/`.`/`--all` is
  // included because it sweeps whatever is untracked, which is exactly how an unignored secret
  // gets committed. Stage explicit non-secret paths instead; if a secret genuinely must be
  // committed (a rotated example file, say), the user says so and does it themselves.
  { pattern: /\bgit\s+add\b[^|;&]*(?:\.env(?![\w.-])|CLAUDE\.local\.md|appsettings\.local\.json|credentials\.|\.pem(?![\w.-])|\.key(?![\w.-])|id_rsa)/i, reason: 'Staging a secret file for commit — a leaked credential on a remote is permanent' },
  // Anchored to a command position (start, or after ; && || | newline) so that merely MENTIONING
  // the string — `grep "git add -A" docs/`, a commit message, this file's own comment — is not
  // mistaken for running it.
  { pattern: /(?:^|[;&|]\s*|\n\s*)git\s+(?:-\S+\s+)*add\s+(?:-A\b|--all\b|\.\s*($|[;&|]))/i, reason: 'git add -A/. sweeps untracked files (an unignored secret lands in the commit) — stage explicit paths' },

  // Shell redirect into protected env files (path must END at .env — build.env.log is fine)
  { pattern: /(>|>>)\s*\S*\.env\s*($|[;&|])/i, reason: 'Shell redirect into .env (bypasses protect-files)' },
  // Shell redirect into other protected files (settings, prod appsettings, hooks/scripts)
  { pattern: /(>|>>)\s*\S*(settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json)\s*($|[;&|])/i, reason: 'Shell redirect into a protected config file (bypasses protect-files)' },
  { pattern: /(>|>>)\s*\S*\.claude[\\/](?:hooks|scripts)[\\/]\S*\s*($|[;&|])/i, reason: 'Shell redirect into a .claude hook/script (guard-disables-guard)' },

  // System-level danger
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Drive formatting' },
];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // Cursor payload puts the command at data.command (Claude uses data.tool_input.command)
    const rawCommand = data.tool_input?.command || data.command || '';

    // Normalize quoting so commit messages / echo prose mentioning dangerous verbs
    // don't false-positive, WITHOUT opening a bypass. Rules:
    //   - A quoted span with NO internal whitespace is a single argv word the shell
    //     still executes (`"rm"`, `'-rf'`) → UNQUOTE it (keep the content).
    //   - A quoted span WITH whitespace is prose (a commit message) → blank it.
    const normalizeQuotes = (s) =>
      s
        .replace(/"([^"]*)"/g, (m, inner) => (/\s/.test(inner) ? '""' : inner))
        .replace(/'([^']*)'/g, (m, inner) => (/\s/.test(inner) ? "''" : inner));

    // Scan RAW (no unquoting) when the shell would execute quoted content as code:
    //   - command substitution: $(...), backticks, <(...)
    //   - an interpreter that runs a quoted script: sh/bash/node/python/perl/ruby/php/powershell/cmd/sqlcmd -c|-e|-Command
    const SUBSHELL_RE = /\$\(|`|<\(/;
    const INTERPRETER_RE = /(^|[\s;&|])(powershell|pwsh|node|deno|bun|cmd(\.exe)?|sqlcmd|bash|sh|zsh|perl|python[23]?|ruby|php|eval|source|xargs)\b/i;
    const stripped = normalizeQuotes(rawCommand);
    const preNormalized =
      SUBSHELL_RE.test(rawCommand) || INTERPRETER_RE.test(stripped)
        ? rawCommand
        : stripped;
    const GIT_GLOBAL_OPT =
      // `-C.` / `-C"."` are valid git (the value may be glued to the flag), so the value part must
      // be optional-whitespace, not required-whitespace — otherwise those two forms slip past.
      /\bgit\s+(?:(?:-C\s*\S+|-c\s*\S+|--git-dir[=\s]\S+|--work-tree[=\s]\S+|--namespace[=\s]\S+|--exec-path[=\s]\S+|--config-env[=\s]\S+|-p|--paginate|-P|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks)\s+)+/gi;
    let command = preNormalized;
    for (let i = 0; i < 5; i++) {
      const next = command.replace(GIT_GLOBAL_OPT, 'git ');
      if (next === command) break;
      command = next;
    }

    for (const { pattern, reason } of BLOCKED_COMMANDS) {
      if (pattern.test(command)) {
        process.stderr.write(`Blocked: ${reason}. Command: "${command}". Ask the user for confirmation before running destructive commands.`);
        process.exit(2);
      }
    }
    // Render, approve and join make or publish a video: ask the person, however the command is started (the
    // Copilot and Cursor gates do the same). Blocked patterns above still win.
    const ASK_RE = /\b(?:npm\s+run\s+studio\s+--|node\s+(?:\.[\\/])?engine[\\/]cli\.mjs)\s+(render|approve|sequence|sequence-preview)\b/i;
    const ask = ASK_RE.exec(command);
    if (ask) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `"${ask[1]}" renders, approves or joins a video: confirm before it runs.` } }));
      process.exit(0);
    }
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});
