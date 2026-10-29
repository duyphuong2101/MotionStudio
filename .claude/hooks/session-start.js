#!/usr/bin/env node
// SessionStart hook: Log session start with timestamp
// Creates a lightweight session audit trail

const fs = require('fs');
const path = require('path');

const logDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'logs');
const logFile = path.join(logDir, 'sessions.log');

try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);

      // Reset plan-guard state only on a fresh session — SessionStart also fires
      // on resume/compact, where wiping the file list mid-task loses planTouched.
      if (!data.source || data.source === 'startup') {
        try {
          fs.rmSync(path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', '.plan-guard-state.json'), { force: true });
        } catch (e) {}
      }

      // inject-context.js writes one marker per session; drop markers older than 24h.
      try {
        const injDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'state', 'injected');
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const f of fs.readdirSync(injDir)) {
          const p = path.join(injDir, f);
          if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
        }
      } catch (e) {}

      const entry = {
        timestamp: new Date().toISOString(),
        session_id: data.session_id || 'unknown',
        cwd: data.cwd || process.cwd(),
        event: 'session_start',
      };
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

      // Rotation: keep last 500 lines when over 200 KB (same policy as subagent-log)
      try {
        if (fs.statSync(logFile).size > 200 * 1024) {
          const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
          if (lines.length > 500) fs.writeFileSync(logFile, lines.slice(-500).join('\n') + '\n');
        }
      } catch (e) {}
    } catch (e) {}
    process.exit(0);
  });
} catch (e) {
  process.exit(0);
}
