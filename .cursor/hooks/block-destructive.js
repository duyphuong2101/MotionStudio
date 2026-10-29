#!/usr/bin/env node
// Cursor beforeShellExecution hook: block destructive shell commands.
// Cursor payload puts the command at data.command (Claude uses data.tool_input.command);
// read both so the same matchers work under either harness.
// Blocking contract: emit {"permission":"deny"} (exit 2 also denies). Wired failClosed:true
// so a crash/timeout/invalid-JSON BLOCKS rather than allows (Cursor default is fail-open).

const BLOCKED_COMMANDS = [
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\b/i, reason: 'Recursive forced deletion' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\b/i, reason: 'Recursive forced deletion' },
  { pattern: /\brm\s+--recursive\s+--force\b/i, reason: 'Recursive forced deletion' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+[\/~]/i, reason: 'Recursive deletion of root or home paths' },
  { pattern: /(\bRemove-Item\b|\bri\b|\brd\b)(?=[^|;&]*-Recurse)(?=[^|;&]*-Force)/i, reason: 'PowerShell recursive forced deletion' },
  { pattern: /\.(rmSync|rmdirSync)\s*\(/, reason: 'Node fs recursive deletion via node/interpreter -e' },
  { pattern: /\b(del|rmdir|rd|erase)\b[^|;&]*\/s\b/i, reason: 'cmd recursive deletion (any flag order)' },
  { pattern: /\brimraf\b/i, reason: 'rimraf recursive deletion' },
  { pattern: /\bfind\b[^|;&]*\s-delete\b/i, reason: 'find -delete bulk deletion' },
  { pattern: /git\s+push\s+(?:[^|;&]*\s)?--force(?![-\w])/i, reason: 'Force push (use --force-with-lease instead)' },
  { pattern: /git\s+push\s+(?:[^|;&]*\s)?-f(?![-\w])/i, reason: 'Force push -f (use --force-with-lease instead)' },
  { pattern: /git\s+reset\s+--hard/i, reason: 'Hard reset discards uncommitted changes' },
  { pattern: /git\s+clean\s+-[a-zA-Z]*f/i, reason: 'Force clean removes untracked files' },
  { pattern: /git\s+checkout\s+(?:--\s+)?\.\s*$/i, reason: 'Discards all unstaged changes' },
  { pattern: /\bgit\s+branch\s+(?:[^|;&]*\s)?(?:-[a-z]*D[a-z]*|--delete\s+--force|--force\s+--delete)/, reason: 'Force delete branch without merge check' },
  { pattern: /DROP\s+(DATABASE|TABLE|SCHEMA)\s/i, reason: 'Database/table destruction' },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?[a-zA-Z_\[]/i, reason: 'Table truncation (with or without TABLE keyword)' },
  { pattern: /(>|>>)\s*\S*\.env\s*($|[;&|])/i, reason: 'Shell redirect into .env (bypasses protect-files)' },
  // A secret read through an interpreter: `node -e "fs.readFileSync('.env')"` prints it as surely as cat does.
  { pattern: /^(?=[\s\S]*\b(?:node|deno|bun|python[23]?|ruby|perl|php)\b)(?=[\s\S]*\b(?:readFileSync|readFile|createReadStream|openSync|read_text|file_get_contents|File\.read)\b)(?=[\s\S]*['"\x60][^'"\x60\s]*(?:\.env(?:\.(?!example|sample|template)[\w-]+)?|CLAUDE\.local\.md|appsettings\.local\.json|\.pem|\.key|id_rsa)['"\x60])/i, reason: 'Reading a secret file through an interpreter (use the Read tool if you genuinely need one value)' },
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Drive formatting' },
];

// Shared with Claude .claude/hooks/block-destructive.js — keep in sync.
function normalizeCommand(rawCommand) {
  const normalizeQuotes = (s) =>
    s
      .replace(/"([^"]*)"/g, (m, inner) => (/\s/.test(inner) ? '""' : inner))
      .replace(/'([^']*)'/g, (m, inner) => (/\s/.test(inner) ? "''" : inner));
  const SUBSHELL_RE = /\$\(|`|<\(/;
  const INTERPRETER_RE = /(^|[\s;&|])(powershell|pwsh|node|deno|bun|cmd(\.exe)?|sqlcmd|bash|sh|zsh|perl|python[23]?|ruby|php)\b/i;
  const stripped = normalizeQuotes(rawCommand);
  return SUBSHELL_RE.test(rawCommand) || INTERPRETER_RE.test(stripped) ? rawCommand : stripped;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    process.stdout.write(JSON.stringify({ permission: 'deny', user_message: 'block-destructive: invalid hook payload — blocked.' }));
    process.exit(2);
  }

  const command = normalizeCommand(data.command || data.tool_input?.command || '');
  for (const { pattern, reason } of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      process.stdout.write(JSON.stringify({
        permission: 'deny',
        user_message: `Blocked: ${reason}. Command: "${command}". Confirm with the user before running destructive commands.`,
        agent_message: `Destructive command blocked (${reason}).`,
      }));
      process.exit(2);
    }
  }
  process.exit(0);
});
