#!/usr/bin/env node
// PreToolUse hook: Block destructive bash commands
// Prevents accidental data loss from dangerous shell commands.
// Two layers: a token analyzer (flag order, quoting and wrappers cannot hide rm/git/secret/redirect
// intent) and the regex list below (interpreter one-liners, PowerShell, cmd). Cursor's
// .cursor/hooks/block-destructive.js requires analyze() from this file — one rule set for both.

// Basenames that hold secrets. `.env.example|sample|template` are docs; `build.env.log` is a log.
const SECRET_BASENAME = /^(?:\.env(?:\.(?!(?:example|sample|template|log|txt|md|bak|orig)$)[\w-]+)?|CLAUDE\.local\.md|appsettings\.local\.json|accounts\.json|\.mcp\.json|credentials(?:\.[\w-]+)?|secrets\.json|\.npmrc|\.netrc|id_(?:rsa|ed25519|ecdsa|dsa)|[\w.-]+\.(?:pem|key|pfx|p12))$/i;

const BLOCKED_COMMANDS = [
  // PowerShell / cmd / node deletions (bypass Unix rm patterns)
  // PowerShell accepts any unambiguous prefix of -Recurse (-r, -re, -rec …) → match them all.
  // `[^|;&\n]` everywhere: a rule must never reach across a newline into an unrelated command.
  { pattern: /(\bRemove-Item\b|\bri\b|\brd\b)(?=[^|;&\n]*\s-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?\b)/i, reason: 'PowerShell recursive deletion (Recurse/-r, Force optional)' },
  { pattern: /\[(?:IO\.|System\.IO\.)?Directory\]::Delete/i, reason: 'PowerShell [IO.Directory]::Delete recursive deletion' },
  { pattern: /\.(rmSync|rmdirSync|rmdir)\s*\(/, reason: 'Node fs sync recursive deletion via interpreter -e' },
  // Matches fs.rm(, fs.promises.rm(, require('fs'|'node:fs'|'fs/promises').rm( — quote or backtick.
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.rm\s*\(/i, reason: 'Node fs.rm / fs.promises.rm deletion via interpreter -e' },
  { pattern: /require\(['"`](?:node:)?fs(?:\/promises)?['"`]\)[\s\S]*\b(rm|rmdir)\s*\(/i, reason: 'Node fs/promises destructured rm() via interpreter -e' },
  { pattern: /\b(del|rmdir|rd|erase)\b[^|;&\n]*\/s\b/i, reason: 'cmd recursive deletion (any flag order)' },
  { pattern: /\brimraf\b/i, reason: 'rimraf recursive deletion (e.g. npx rimraf)' },
  { pattern: /\bfind\b[^|;&\n]*\s-delete\b/i, reason: 'find -delete bulk deletion' },
  { pattern: /\bfind\b[^|;&\n]*\s-exec(?:dir)?\s+(?:rm|del|unlink|shred)\b/i, reason: 'find -exec rm bulk deletion' },

  // Single-file deletion (bypasses the recursive-only patterns above; allow lists
  // permit `node -e`/`powershell`/`del`, so a lone unlink/Delete must be caught too)
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.(unlink|unlinkSync|truncate|truncateSync)\s*\(/i, reason: 'Node fs single-file delete/truncate via interpreter -e' },
  { pattern: /require\(['"`](?:node:)?fs(?:\/promises)?['"`]\)[\s\S]*\b(unlink|unlinkSync|truncate|truncateSync)\s*\(/i, reason: 'Node fs destructured unlink/truncate via interpreter -e' },
  { pattern: /\[(?:IO\.|System\.IO\.)?File\]::Delete/i, reason: 'PowerShell [IO.File]::Delete single-file deletion' },
  { pattern: /(\bRemove-Item\b|\bri\b|\bdel\b|\berase\b)(?![^|;&\n]*\s-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?\b)[^|;&\n]*\.(env|pem|key)\b/i, reason: 'PowerShell/cmd deletion of a secret file' },

  // Overwrite/truncate a PROTECTED file (config/hooks/secrets) — general writes are
  // fine; only guard files protect-files.js guards, since Bash bypasses that hook.
  { pattern: /(?:\bfs\b|require\(['"`](?:node:)?fs(?:\/promises)?['"`]\))(?:\.promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|rename|renameSync)\s*\([^)]*(\.env|settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json|\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]|\.cursor[\\/]hooks\.json)/i, reason: 'Node fs write/copy/rename onto a protected file via interpreter -e' },
  { pattern: /(?:Set-Content|Out-File|Add-Content)\b[^|;&\n]*(\.env|settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json|\.(?:claude|cursor)[\\/](?:hooks|scripts)|\.cursor[\\/]hooks\.json)/i, reason: 'PowerShell write onto a protected file' },

  // Dangerous git operations — also caught by the token analyzer in any flag order; these stay
  // for git invoked from inside an interpreter string (node -e "execSync('git reset --hard')").
  { pattern: /git\s+push\s+(?:[^|;&\n]*\s)?--force(?![-\w])/i, reason: 'Force push (use --force-with-lease instead)' },
  { pattern: /git\s+push\s+(?:[^|;&\n]*\s)?-f(?![-\w])/i, reason: 'Force push -f (use --force-with-lease instead)' },
  { pattern: /git\s+push\b[^|;&\n]*\s\+[\w./-]+/i, reason: 'Force push via + refspec (use --force-with-lease)' },
  { pattern: /git\s+reset\b[^|;&\n]*\s--hard\b/i, reason: 'Hard reset discards uncommitted changes' },
  { pattern: /git\s+clean\s+-[a-zA-Z]*f/i, reason: 'Force clean removes untracked files' },
  { pattern: /git\s+checkout\s+(?:[^|;&#\n]*\s)?(?:--\s+)?(?:\.|:\/)(?=\s*($|[;&|#]))/i, reason: 'Discards unstaged changes (git checkout .)' },
  { pattern: /git\s+checkout\s+(?:-f|--force)\b/i, reason: 'Force checkout discards local changes' },
  { pattern: /git\s+restore\s+(?:[^|;&#\n]*\s)?(?:--\s+)?(?:\.|:\/)(?=\s*($|[;&|#]))/i, reason: 'git restore . discards unstaged changes' },
  { pattern: /git\s+switch\s+(?:[^|;&\n]*\s)?(?:-f|--force|--discard-changes)\b/i, reason: 'git switch -f/--discard-changes discards local changes' },
  { pattern: /git\s+stash\s+(?:drop|clear)\b/i, reason: 'git stash drop/clear destroys stashed work' },
  { pattern: /git\s+update-ref\s+(?:[^|;&\n]*\s)?-d\b/i, reason: 'git update-ref -d deletes a ref (evades branch -D)' },
  { pattern: /git\s+worktree\s+remove\s+(?:[^|;&\n]*\s)?(?:-f|--force)\b/i, reason: 'git worktree remove --force discards a worktree with changes' },
  { pattern: /\bgit\s+branch\s+(?:[^|;&\n]*\s)?(?:-[a-z]*D[a-z]*|--delete\s+--force|--force\s+--delete)/, reason: 'Force delete branch without merge check' },

  // Database destruction
  { pattern: /DROP\s+(DATABASE|TABLE|SCHEMA)\s/i, reason: 'Database/table destruction' },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?[a-zA-Z_\[]/i, reason: 'Table truncation (with or without TABLE keyword)' },

  // env/printenv dump every variable — the same harm as `cat .env`, through a different door.
  // Bare `env` / `printenv` only. `env FOO=bar cmd` sets a variable and is fine; a `printenv` that
  // appears inside a quoted regex or a longer word must not match, hence the command-position
  // anchor plus a hard end-of-command boundary.
  { pattern: /(?:^|[;&|]\s*|\n\s*)(?:env|printenv)[ \t]*(?:$|[;&|>\n])/i, reason: 'Dumping the whole environment (secrets live there) — read the one variable you need' },
  { pattern: /(?:^|[;&|]\s*|\n\s*)(?:Get-ChildItem|gci|ls|dir)\s+env:[ \t]*(?:$|[;&|>\n])/i, reason: 'Dumping the whole environment via PowerShell env: drive' },
  // The write-guard only sees Edit/Write, so a text mutator can disable it from Bash.
  // Only the IN-PLACE forms — `sed -n`/`awk` reading a hook is legitimate inspection.
  // Flag clusters may carry digits (`perl -0pi`, `sed -i.bak`), and GNU sed spells it --in-place.
  { pattern: /\b(?:sed|perl)\b[^|;&\n]*\s(?:-[a-z0-9]*i[\w.]*|--in-place\S*)(?=\s)[^|;&\n]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'In-place edit of a guard hook/script from the shell (bypasses protect-files.js)' },
  { pattern: /\b(?:truncate|tee|dd|install)\b[^|;&\n]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'Overwriting a guard hook/script from the shell (bypasses protect-files.js)' },
  { pattern: /\b(?:rm|cp|mv|move|Copy-Item|Move-Item|Remove-Item)\b[^|;&\n]*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'Deleting/replacing a guard hook/script from the shell' },
  { pattern: /\bgit\s+(?:checkout|restore)\b[^|;&\n]*\.(?:claude|cursor)[\\/](?:hooks|scripts)/i, reason: 'Reverting a guard hook/script via git (silently disables the guard)' },

  // Shell redirect into protected files from inside an interpreter string; plain shell redirects
  // are handled by the token analyzer.
  { pattern: /(>|>>)\s*\S*\.env(?:\.(?!example|sample|template)[\w-]+)?(?=$|[\s;&|)'"])/i, reason: 'Shell redirect into .env (bypasses protect-files)' },
  { pattern: /(>|>>)\s*\S*(settings(?:\.local)?\.json|appsettings\.(?:production|preproduction)\.json)(?=$|[\s;&|)'"])/i, reason: 'Shell redirect into a protected config file (bypasses protect-files)' },
  { pattern: /(>|>>)\s*\S*\.(?:claude|cursor)[\\/](?:hooks|scripts)[\\/]/i, reason: 'Shell redirect into a guard hook/script (guard-disables-guard)' },

  // System-level danger
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Drive formatting' },

  // A secret read through an interpreter: `node -e "fs.readFileSync('.env')"` prints it as surely as cat does.
  { pattern: /^(?=[\s\S]*\b(?:node|deno|bun|python[23]?|ruby|perl|php)\b)(?=[\s\S]*\b(?:readFileSync|readFile|createReadStream|openSync|read_text|file_get_contents|File\.read)\b)(?=[\s\S]*['"\x60][^'"\x60\s]*(?:\.env(?:\.(?!example|sample|template)[\w-]+)?|CLAUDE\.local\.md|appsettings\.local\.json|\.pem|\.key|id_rsa)['"\x60])/i, reason: 'Reading a secret file through an interpreter (use the Read tool if you genuinely need one value)' },
  // Download-and-execute: an allow-listed `powershell -Command "... *"` must not become a dropper.
  { pattern: /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b[^\n]*\|\s*(?:iex|Invoke-Expression|sh|bash|zsh|pwsh|powershell|node|python[23]?)\b/i, reason: 'Download-and-execute (remote script piped into an interpreter)' },
  { pattern: /\b(?:iex|Invoke-Expression)\s*\(\s*(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|New-Object\s+Net\.WebClient)/i, reason: 'Download-and-execute (Invoke-Expression of a remote script)' },
];

// ── Token analyzer ───────────────────────────────────────────────────────────

// Splits a shell string into segments (argv lists) at unquoted ; && || | & newline ( ).
// Quotes are removed the way the shell removes them, so `g""it`, `"-f"` and `'--hard'` arrive as
// the words the shell would execute. $(...), `...` and <(...) bodies are returned as `nested`.
function tokenize(cmd) {
  const segs = [];
  const nested = [];
  let toks = [];
  let cur = '';
  let has = false;
  const pushTok = () => { if (has) toks.push({ v: cur }); cur = ''; has = false; };
  const pushSeg = () => { pushTok(); if (toks.length) segs.push(toks); toks = []; };
  const takeBalanced = (start) => { // start = index of '('; returns index after matching ')'
    let depth = 0;
    for (let j = start; j < cmd.length; j++) {
      if (cmd[j] === '(') depth++;
      else if (cmd[j] === ')' && --depth === 0) return j + 1;
    }
    return cmd.length;
  };
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j < 0 ? cmd.length : j;
      cur += cmd.slice(i + 1, end); has = true; i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && j + 1 < cmd.length && /["\\$`]/.test(cmd[j + 1])) { cur += cmd[j + 1]; j += 2; continue; }
        if (cmd[j] === '$' && cmd[j + 1] === '(') { const e = takeBalanced(j + 1); nested.push(cmd.slice(j + 2, e - 1)); j = e; continue; }
        if (cmd[j] === '`') { const e = cmd.indexOf('`', j + 1); const end = e < 0 ? cmd.length : e; nested.push(cmd.slice(j + 1, end)); j = end + 1; continue; }
        cur += cmd[j]; j++;
      }
      has = true; i = j + 1; continue;
    }
    if (c === '\\' && i + 1 < cmd.length) {
      if (cmd[i + 1] !== '\n') { cur += cmd[i + 1]; has = true; }
      i += 2; continue;
    }
    if ((c === '$' || c === '<' || c === '>') && cmd[i + 1] === '(') {
      const e = takeBalanced(i + 1);
      nested.push(cmd.slice(i + 2, e - 1)); cur += '$SUB'; has = true; i = e; continue;
    }
    if (c === '`') {
      const e = cmd.indexOf('`', i + 1);
      const end = e < 0 ? cmd.length : e;
      nested.push(cmd.slice(i + 1, end)); cur += '$SUB'; has = true; i = end + 1; continue;
    }
    if (c === '\n' || c === ';' || c === '(' || c === ')') { pushSeg(); i++; continue; }
    if (c === '&' && cmd[i + 1] === '>') { pushTok(); i++; continue; }
    if (c === '&' && has && /[<>]$/.test(cur)) { cur += c; i++; continue; }
    if (c === '&' || c === '|') { pushSeg(); i += cmd[i + 1] === c ? 2 : 1; continue; }
    if (c === '>' || c === '<') {
      const fd = has && /^\d+$/.test(cur) ? cur : '';
      if (!fd) pushTok(); else { cur = ''; has = false; }
      let op = fd + c; i++;
      if (c === '>' && (cmd[i] === '>' || cmd[i] === '|')) { op += cmd[i]; i++; }
      if (cmd[i] === '&') { let j = i + 1; while (j < cmd.length && /[\d-]/.test(cmd[j])) j++; op += cmd.slice(i, j); i = j; }
      toks.push({ v: op, op: true });
      continue;
    }
    if (/\s/.test(c)) { pushTok(); i++; continue; }
    cur += c; has = true; i++;
  }
  pushSeg();
  return { segs, nested };
}

const base = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
// `@file` (curl -d @.env), `name=@file` (curl -F), `--opt=file`, git `rev:path`.
const pathOf = (t) => t.replace(/^[\w-]*=@?/, '').replace(/^@/, '').replace(/^[^:/\\]{2,}:(?!\/\/)/, '');
const isSecret = (t) => SECRET_BASENAME.test(base(pathOf(t)));
const isProtectedWrite = (t) => {
  const p = t.replace(/\\/g, '/');
  const b = base(p);
  return isSecret(t) ||
    /^settings(\.local)?\.json$/i.test(b) ||
    /^appsettings\.(production|preproduction)\.json$/i.test(b) ||
    /(^|\/)\.(claude|cursor)\/(hooks|scripts)\//i.test(p) ||
    /(^|\/)\.cursor\/hooks\.json$/i.test(p);
};
const WHOLE_TREE = new Set(['.', './', ':/', ':/:', '*', ':(top)']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const WRAPPERS = new Set(['sudo', 'nohup', 'time', 'command', 'exec', 'builtin', 'nice', 'env', 'xargs', 'call', 'start']);
const READERS = new Set(['cat', 'type', 'less', 'more', 'head', 'tail', 'strings', 'xxd', 'od', 'base64', 'nl', 'tar', 'zip', '7z',
  'openssl', 'curl', 'wget', 'iwr', 'invoke-webrequest', 'get-content', 'gc', 'sed', 'awk', 'grep', 'egrep', 'fgrep', 'rg',
  'sls', 'select-string', 'findstr', 'certutil', 'xcopy', 'robocopy']);
const MOVERS = new Set(['cp', 'copy', 'mv', 'move', 'scp', 'rsync', 'copy-item', 'move-item', 'ln']);
// The first positional of these is a pattern/script, not a file — `grep "process.env" src` reads src.
const PATTERN_FIRST = new Set(['sed', 'awk', 'grep', 'egrep', 'fgrep', 'rg', 'sls', 'select-string', 'findstr']);

function analyzeSegment(toks, depth) {
  const args = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!t.op) { args.push(t.v); continue; }
    const target = toks[k + 1] && !toks[k + 1].op ? toks[k + 1].v : null;
    if (/&/.test(t.v) || !target) continue;
    k++;
    if (t.v.includes('<')) { if (isSecret(target)) return 'Reading a secret file via input redirect'; }
    else if (isProtectedWrite(target)) return 'Shell redirect into a protected file (bypasses protect-files)';
  }

  // Peel assignments and wrappers: `FOO=1 sudo -E nohup git reset --hard`.
  let a = args;
  for (let guard = 0; guard < 6 && a.length; guard++) {
    if (/^[A-Za-z_][\w]*=/.test(a[0])) { a = a.slice(1); continue; }
    const w = base(a[0]).toLowerCase().replace(/\.exe$/, '');
    if (!WRAPPERS.has(w)) break;
    a = a.slice(1);
    while (a.length && (/^-/.test(a[0]) || /^[A-Za-z_]\w*=/.test(a[0]))) a = a.slice(1);
  }
  if (!a.length) return null;
  const cmd = base(a[0]).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  const rest = a.slice(1);

  // Shell-in-shell: analyze the script string as a command of its own.
  if (SHELLS.has(cmd) || cmd === 'wsl') {
    const ci = rest.findIndex((t) => /^-[a-z]*c[a-z]*$/.test(t));
    if (ci >= 0 && rest[ci + 1] != null) return analyze(rest[ci + 1], depth + 1);
    if (cmd === 'wsl') return analyze(rest.filter((t) => !/^-/.test(t)).join(' '), depth + 1);
    return null;
  }
  if (cmd === 'powershell' || cmd === 'pwsh') {
    if (rest.some((t) => /^-e(nc(odedcommand)?|c)?$/i.test(t) && !/^-ex/i.test(t))) return 'Encoded PowerShell command cannot be inspected';
    const ci = rest.findIndex((t) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(t));
    const body = ci >= 0 ? rest.slice(ci + 1) : rest.filter((t) => !/^-/.test(t));
    return body.length ? analyze(body.join(' '), depth + 1) : null;
  }
  if (cmd === 'cmd') {
    const ci = rest.findIndex((t) => /^\/[ck]$/i.test(t));
    return ci >= 0 ? analyze(rest.slice(ci + 1).join(' '), depth + 1) : null;
  }
  if (cmd === 'eval') return analyze(rest.join(' '), depth + 1);

  const shortFlags = (list) => list.filter((t) => /^-[A-Za-z]+$/.test(t)).map((t) => t.slice(1)).join('');
  const hasLong = (list, name) => list.some((t) => t === `--${name}` || t.startsWith(`--${name}=`));
  const positional = (list) => {
    const out = [];
    let afterDashDash = false;
    for (const t of list) {
      if (afterDashDash) { out.push(t); continue; }
      if (t === '--') { afterDashDash = true; continue; }
      if (!/^-/.test(t)) out.push(t);
    }
    return out;
  };

  if (cmd === 'rm') {
    const flags = shortFlags(rest.slice(0, rest.includes('--') ? rest.indexOf('--') : rest.length));
    const recursive = /r/i.test(flags) || hasLong(rest, 'recursive');
    if (recursive && (flags.includes('f') || hasLong(rest, 'force'))) return 'Recursive forced deletion';
    if (recursive && positional(rest).some((p) => /^(\/|~|\$HOME|[A-Za-z]:[\\/]?)(\*|\/\*?)?$/.test(p) || /^~\//.test(p))) {
      return 'Recursive deletion of root or home paths';
    }
  }

  if (cmd === 'git') {
    let g = rest;
    while (g.length && /^-/.test(g[0])) {
      const takesValue = /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(g[0]);
      g = g.slice(takesValue ? 2 : 1);
    }
    const sub = g[0];
    const r = g.slice(1);
    const f = shortFlags(r);
    const pos = positional(r);
    switch (sub) {
      case 'push':
        if (f.includes('f') || hasLong(r, 'force')) return 'Force push (use --force-with-lease instead)';
        if (pos.some((p) => /^\+./.test(p))) return 'Force push via + refspec (use --force-with-lease)';
        break;
      case 'reset':
        if (hasLong(r, 'hard')) return 'Hard reset discards uncommitted changes';
        break;
      case 'clean':
        if ((f.includes('f') || hasLong(r, 'force')) && !f.includes('n') && !hasLong(r, 'dry-run')) return 'Force clean removes untracked files';
        break;
      case 'checkout':
        if (f.includes('f') || hasLong(r, 'force')) return 'Force checkout discards local changes';
        if (pos.some((p) => WHOLE_TREE.has(p))) return 'Discards unstaged changes (git checkout .)';
        break;
      case 'restore':
        if (pos.some((p) => WHOLE_TREE.has(p))) return 'git restore . discards unstaged changes';
        break;
      case 'switch':
        if (f.includes('f') || hasLong(r, 'force') || hasLong(r, 'discard-changes')) return 'git switch -f/--discard-changes discards local changes';
        break;
      case 'stash':
        if (pos[0] === 'drop' || pos[0] === 'clear') return 'git stash drop/clear destroys stashed work';
        break;
      case 'update-ref':
        if (f.includes('d') || hasLong(r, 'delete')) return 'git update-ref -d deletes a ref (evades branch -D)';
        break;
      case 'worktree':
        if (pos[0] === 'remove' && (f.includes('f') || hasLong(r, 'force'))) return 'git worktree remove --force discards a worktree with changes';
        break;
      case 'branch':
        if (f.includes('D') || ((f.includes('d') || hasLong(r, 'delete')) && (f.includes('f') || hasLong(r, 'force')))) return 'Force delete branch without merge check';
        break;
      case 'add':
        if (pos.some(isSecret)) return 'Staging a secret file for commit — a leaked credential on a remote is permanent';
        if (f.includes('A') || hasLong(r, 'all') || pos.some((p) => WHOLE_TREE.has(p))) return 'git add -A/. sweeps untracked files (an unignored secret lands in the commit) — stage explicit paths';
        break;
      case 'diff': case 'show': case 'log': case 'blame': case 'cat-file': case 'grep': case 'format-patch':
        if (r.some((t) => t === '--output' || t.startsWith('--output=') || t === '-o')) return `git ${sub} --output writes an arbitrary file`;
        if (pos.some(isSecret)) return 'Reading a secret file through git (use the Read tool if you genuinely need one value)';
        break;
      default:
        break;
    }
  }

  if (READERS.has(cmd)) {
    let files = positional(rest);
    const explicitPattern = rest.some((t) => /^(-e|-f|--regexp|--file|-pattern)$/i.test(t));
    if (PATTERN_FIRST.has(cmd) && !explicitPattern) files = files.slice(1);
    const valued = rest.filter((t) => /^[\w-]*=@|^@/.test(t));
    if (files.some(isSecret) || valued.some(isSecret)) return 'Reading/exfiltrating a secret file (use the Read tool if you genuinely need one value)';
  }
  if (MOVERS.has(cmd) && positional(rest).some(isSecret)) return 'Copying/moving a secret file (exfiltration risk)';
  // `gh api` is allow-listed for reads; a DELETE through it removes repos, branches, releases.
  if (cmd === 'gh' && rest[0] === 'api' && rest.some((t, k) => (/^(-X|--method)$/.test(t) && /^delete$/i.test(rest[k + 1] || '')) || /^(-XDELETE|--method=delete)$/i.test(t))) {
    return 'gh api DELETE removes a remote resource';
  }
  if (cmd === 'tee' && positional(rest).some(isProtectedWrite)) return 'tee into a protected file (bypasses protect-files)';
  if ((cmd === 'sed' || cmd === 'perl') && rest.some((t) => /^-[\w]*i/.test(t) || t.startsWith('--in-place')) &&
      positional(rest).some(isProtectedWrite)) {
    return 'In-place edit of a protected file from the shell (bypasses protect-files.js)';
  }
  return null;
}

function analyze(cmd, depth = 0) {
  if (depth > 4 || !cmd) return null;
  const { segs, nested } = tokenize(cmd);
  for (const s of segs) {
    const r = analyzeSegment(s, depth);
    if (r) return r;
  }
  for (const n of nested) {
    const r = analyze(n, depth + 1);
    if (r) return r;
  }
  return null;
}

// ── Regex layer ──────────────────────────────────────────────────────────────

function regexScan(rawCommand) {
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
  const preNormalized = SUBSHELL_RE.test(rawCommand) || INTERPRETER_RE.test(stripped) ? rawCommand : stripped;
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
  const hit = BLOCKED_COMMANDS.find(({ pattern }) => pattern.test(command));
  return hit ? hit.reason : null;
}

function check(rawCommand) {
  if (!rawCommand) return null;
  return analyze(rawCommand) || regexScan(rawCommand);
}

// Render, approve and join make or publish a video: ask the person, however the command is started (the
// Copilot and Cursor gates do the same). Blocked commands still win.
const ASK_RE = /\b(?:npm\s+run\s+studio\s+--|node\s+(?:\.[\\/])?engine[\\/]cli\.mjs)\s+(render|approve|sequence|sequence-preview)\b/i;
function askReason(rawCommand) {
  const m = ASK_RE.exec(rawCommand || '');
  return m ? `"${m[1]}" renders, approves or joins a video: confirm before it runs.` : null;
}

module.exports = { check, analyze, askReason, SECRET_BASENAME };

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let reason;
    let ask;
    try {
      const data = JSON.parse(input);
      // Cursor payload puts the command at data.command (Claude uses data.tool_input.command)
      const command = data.tool_input?.command || data.command || '';
      reason = check(command);
      ask = askReason(command);
    } catch (e) {
      // Fail closed: a guard that crashes must not wave the command through.
      process.stderr.write(`Blocked: block-destructive.js could not evaluate the command (${e.message}). Fix the hook or ask the user.`);
      process.exit(2);
    }
    if (reason) {
      process.stderr.write(`Blocked: ${reason}. Ask the user for confirmation before running destructive commands.`);
      process.exit(2);
    }
    if (ask) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ask } }));
    }
    process.exit(0);
  });
}
