#!/usr/bin/env node
// Cursor beforeShellExecution hook: block destructive shell commands.
// The rule set lives in .claude/hooks/block-destructive.js (token analyzer + regex layer); this file
// only adapts Cursor's payload and output so the two harnesses can never drift apart again.
// Blocking contract: emit {"permission":"deny"} (exit 2 also denies). Wired failClosed:true
// so a crash/timeout/invalid-JSON BLOCKS rather than allows (Cursor default is fail-open).
const path = require('path');

const deny = (user, agent) => {
  process.stdout.write(JSON.stringify({ permission: 'deny', user_message: user, agent_message: agent || user }));
  process.exit(2);
};

let check;
try {
  ({ check } = require(path.join(__dirname, '..', '..', '.claude', 'hooks', 'block-destructive.js')));
} catch (e) {
  deny(`block-destructive: shared rules at .claude/hooks/block-destructive.js could not load (${e.message}) — blocked.`);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let reason;
  try {
    const data = JSON.parse(input);
    reason = check(data.command || data.tool_input?.command || '');
  } catch (e) {
    deny(`block-destructive: could not evaluate the command (${e.message}) — blocked.`);
  }
  if (reason) deny(`Blocked: ${reason}. Confirm with the user before running destructive commands.`, `Destructive command blocked (${reason}).`);
  process.exit(0);
});
