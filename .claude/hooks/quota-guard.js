#!/usr/bin/env node
// PreToolUse hook (Agent|Task): refuse a new subagent while the quota-pause flag says "stop".
// inject-context.js only reaches the model on a user prompt; an unattended /loop never sends one,
// so the stop signal has to be enforced at the spawn itself. The flag is written by statusline.js
// at >=99% of the 5-hour or 7-day window and removed once the window resets.
// NSC_IGNORE_QUOTA=1 lets a human override for one session.
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    if (process.env.NSC_IGNORE_QUOTA === '1') process.exit(0);
    const data = JSON.parse(input || '{}');
    const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
    const f = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'state', 'quota-pause.flag'), 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (f.level !== 'stop' || (typeof f.resets_at === 'number' && f.resets_at < now)) process.exit(0);
    const when = typeof f.resets_at === 'number' ? new Date(f.resets_at * 1000).toLocaleString() : 'the next reset';
    process.stderr.write(
      `Blocked by quota-guard: ${f.window === 'seven_day' ? 'weekly' : '5-hour'} quota at ${f.pct}% (>=99%). ` +
      `Do not start a new agent. Finish the current item without spawning, append a Loop Journal line, and stop. ` +
      `Resume after ${when}.`,
    );
    process.exit(2);
  } catch (e) {
    process.exit(0); // no flag, or unreadable: no quota signal to enforce
  }
});
