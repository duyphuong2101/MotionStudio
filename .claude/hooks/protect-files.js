#!/usr/bin/env node
// PreToolUse hook: Block edits to sensitive files
// Prevents accidental modification of secrets, lock files, and git internals

// The safety machinery must not rewrite itself during an unattended loop: one auto-approved Edit
// to a hook or a settings file disables every other guard. These are the ONLY patterns the
// NSC_ALLOW_CONFIG_EDIT hatch waives — secrets, lock files and .git stay blocked either way.
const SELF_PROTECTION = [
  /(^|[\\/])\.claude[\\/]hooks[\\/].*\.js$/i,
  /(^|[\\/])\.claude[\\/]scripts[\\/].*\.js$/i,
  /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/i,
  /(^|[\\/])\.cursor[\\/]hooks[\\/].*\.js$/i,
  /(^|[\\/])\.cursor[\\/]hooks\.json$/i,
];

const BLOCKED_PATTERNS = [
  // Secrets and environment files (.env.example/.sample/.template are docs — allowed)
  // A suffixed env file (.env.int, .env.prep) is just as secret as the bare one.
  /\.env([\\/]|$|\.(?!example|sample|template))/i,
  /credentials\./i,
  /secrets\./i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,

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

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // Normalise before matching: `.claude//hooks//x.js` and `.claude/./hooks/x.js` slipped past
    // the raw regexes because of the doubled separator and the `.` segment.
    const rawPath = data.tool_input?.file_path || data.tool_input?.path || '';
    const filePath = require('path').normalize(rawPath.trim());

    // Deliberate escape hatch for a HUMAN doing config work: NSC_ALLOW_CONFIG_EDIT=1 lets the
    // agent edit the kit's own hooks/scripts/settings.
    //
    // The hatch SUBTRACTS exactly the five self-protection patterns — it is not a directory-wide
    // exemption. Exiting early, before the loop, would also make `.claude/.env`,
    // `.claude/.git/config` and `.claude/package-lock.json` freely writable (the hole closed
    // 2026-08-28).
    //
    // The variable alone is weak. It is commonly parked in `.claude/settings.local.json`,
    // whose `env` block applies to EVERY session — including `/loop-ticket` and `/epic`, which are
    // designed never to stop and ask. So also refuse when a headless/CI marker is present.
    // NOT gated on a TTY: hooks are spawned with piped stdio, so isTTY is undefined even in a
    // fully interactive session — testing it disables the hatch outright (measured 2026-08-28).

    const HEADLESS =
      process.env.CI === 'true' ||
      process.env.CLAUDE_HEADLESS === '1' ||
      process.env.CLAUDE_CODE_NON_INTERACTIVE === '1';
    const INTERACTIVE = process.stdout.isTTY === true || process.stderr.isTTY === true;
	const CONFIG_EDIT_ALLOWED = process.env.NSC_ALLOW_CONFIG_EDIT === '1' && !HEADLESS;

    for (const pattern of BLOCKED_PATTERNS) {
      if (!pattern.test(filePath)) continue;
      if (CONFIG_EDIT_ALLOWED && SELF_PROTECTION.includes(pattern)) continue;
      process.stderr.write(`Blocked: Editing protected file "${filePath}" is not allowed. Use the package manager for lock files, or edit secrets manually.`);
      process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    process.exit(0); // Don't block on parse errors
  }
});
