#!/usr/bin/env node
// PreToolUse hook: Block edits to sensitive files
// Prevents accidental modification of secrets, lock files, and git internals
const fs = require('fs');
const path = require('path');

// The safety machinery must not rewrite itself during an unattended loop: one auto-approved Edit
// to a hook or a settings file disables every other guard. These are the ONLY patterns the
// NSC_ALLOW_CONFIG_EDIT hatch waives — secrets, lock files and .git stay blocked either way.
// Whole folders, not *.js: a hooks/package.json with "type":"module" breaks every require() hook.
const SELF_PROTECTION = [
  /(^|[\\/])\.claude[\\/]hooks[\\/]/i,
  /(^|[\\/])\.claude[\\/]scripts[\\/]/i,
  /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/i,
  /(^|[\\/])\.cursor[\\/]hooks[\\/]/i,
  /(^|[\\/])\.cursor[\\/]hooks\.json$/i,
];

const BLOCKED_PATTERNS = [
  // Secrets and environment files (.env.example/.sample/.template are docs — allowed)
  // A suffixed env file (.env.int, .env.prep) is just as secret as the bare one.
  /\.env([\\/]|$|\.(?!example|sample|template))/i,
  // Basename-anchored: UserCredentials.cs and SecretsService.cs are source, not secrets.
  /(^|[\\/])(credentials|secrets)(\.[^\\/]+)?$/i,
  /\.(pem|key|pfx|p12)$/i,
  /(^|[\\/])id_(rsa|ed25519|ecdsa|dsa)$/i,

  // Environment-specific app settings (parity with Cursor protect-files)
  /(^|[\\/])appsettings\.(production|preproduction)\.json$/i,

  // Lock files (should only be changed by package managers)
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /Cargo\.lock$/i,
  /poetry\.lock$/i,
  /Pipfile\.lock$/i,
  /composer\.lock$/i,

  // Git internals — /i because Windows resolves .GIT/config to the real .git directory.
  /(^|[\\/])\.git[\\/]/i,
  /[\\/]\.git$/i,

  // Machine-local credential files. block-destructive.js already guards these on the Bash side
  // (cat/cp/git add); the write-guard needs them too — CLAUDE.local.md is injected as project
  // instructions every session, so appending to it is a prompt-injection vector.
  /(^|[\\/])CLAUDE\.local\.md$/i,
  /(^|[\\/])appsettings\.local\.json$/i,
  /(^|[\\/])accounts\.json$/i,

  // Steers every future agent: adding an MCP server here grants new tools with no prompt.
  /(^|[\\/])\.mcp\.json$/i,

  ...SELF_PROTECTION,
];

// Windows aliases for the same file: `x.js.` / `x.js ` (trailing dot/space stripped by Win32),
// `x.js::$DATA` (default stream), and 8.3 short names (`CLAUDE~1`). Each spelling is checked.
function spellings(rawPath) {
  const out = new Set();
  const cleaned = path.normalize(rawPath.trim())
    .replace(/:(:\$DATA|\$DATA|[^:\\/]*:\$DATA)$/i, '')
    .split(/[\\/]/).map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : seg.replace(/[. ]+$/, ''))).join(path.sep);
  out.add(cleaned);
  try {
    let dir = path.resolve(cleaned);
    const tail = [];
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) { tail.unshift(path.basename(dir)); dir = path.dirname(dir); }
    out.add(path.join(fs.realpathSync.native(dir), ...tail));
  } catch (e) { /* unresolvable path: the cleaned spelling is still checked */ }
  return [...out];
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const rawPath = data.tool_input?.file_path || data.tool_input?.notebook_path || data.tool_input?.path || '';
    if (!rawPath) process.exit(0);

    // Deliberate escape hatch for a HUMAN doing config work: NSC_ALLOW_CONFIG_EDIT=1 lets the
    // agent edit the kit's own hooks/scripts/settings.
    //
    // The hatch SUBTRACTS exactly the self-protection patterns — it is not a directory-wide
    // exemption. Exiting early, before the loop, would also make `.claude/.env`,
    // `.claude/.git/config` and `.claude/package-lock.json` freely writable (the hole closed
    // 2026-08-28).
    //
    // The variable alone is weak. It is commonly parked in `.claude/settings.local.json`,
    // whose `env` block applies to EVERY session — including `/loop-ticket` and `/epic`, which are
    // designed never to stop and ask. So also refuse when a headless/CI marker is present.
    // Set it per session instead: `$env:NSC_ALLOW_CONFIG_EDIT = "1"; claude` in one terminal.
    const HEADLESS =
      process.env.CI === 'true' ||
      process.env.CLAUDE_HEADLESS === '1' ||
      process.env.CLAUDE_CODE_NON_INTERACTIVE === '1';
    const CONFIG_EDIT_ALLOWED = process.env.NSC_ALLOW_CONFIG_EDIT === '1' && !HEADLESS;

    for (const filePath of spellings(rawPath)) {
      for (const pattern of BLOCKED_PATTERNS) {
        if (!pattern.test(filePath)) continue;
        if (CONFIG_EDIT_ALLOWED && SELF_PROTECTION.includes(pattern)) continue;
        process.stderr.write(`Blocked: Editing protected file "${rawPath}" is not allowed. Use the package manager for lock files, or edit secrets manually.`);
        process.exit(2);
      }
    }
    process.exit(0);
  } catch (e) {
    // Fail closed: a write guard that crashes must not wave the write through.
    process.stderr.write(`Blocked: protect-files.js could not evaluate the path (${e.message}).`);
    process.exit(2);
  }
});
