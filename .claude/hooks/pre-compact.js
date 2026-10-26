#!/usr/bin/env node
// PreCompact hook: Save working state before context compaction
// 1. Logs the compaction event
// 2. Saves current git diff as context breadcrumb
// 3. Notifies user via toast

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const logDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  // 1. Log compaction event
  const logFile = path.join(logDir, 'compactions.log');
  fs.appendFileSync(logFile, `${timestamp} | COMPACT | ${cwd}\n`);
  // Rotation: keep last 500 lines when over 200 KB (same policy as subagent-log)
  try {
    if (fs.statSync(logFile).size > 200 * 1024) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      if (lines.length > 500) fs.writeFileSync(logFile, lines.slice(-500).join('\n') + '\n');
    }
  } catch (e) {}

  // 2. Save working state snapshot for context recovery
  const stateDir = path.join(cwd, '.claude', 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Compaction drops the conventions block inject-context.js injected once per
  // session; clearing the marker makes the next coding prompt inject it again.
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const sid = JSON.parse(raw || '{}').session_id;
    if (sid) fs.unlinkSync(path.join(stateDir, 'injected', `${String(sid).replace(/[^\w-]/g, '_')}.flag`));
  } catch (e) {}

  const stateFile = path.join(stateDir, 'last-compact.md');
  let state = `# Pre-Compact State Snapshot\n`;
  state += `**Timestamp:** ${timestamp}\n\n`;

  try {
    // Current branch
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    state += `**Branch:** ${branch}\n\n`;

    // Modified files
    const status = execSync('git status --short', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    if (status) {
      state += `## Modified Files\n\`\`\`\n${status}\n\`\`\`\n\n`;
    }

    // Brief diff summary (limited to avoid huge files)
    const diffStat = execSync('git diff --stat HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    if (diffStat) {
      state += `## Diff Summary\n\`\`\`\n${diffStat}\n\`\`\`\n\n`;
    }
  } catch (e) {
    state += `(git state unavailable)\n`;
  }

  fs.writeFileSync(stateFile, state);

  // 3. Windows toast notification
  const title = 'Claude Code - Context Compacting';
  const message = 'Context compacted. Working state saved to .claude/state/last-compact.md';

  const ps = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
    $template = @"
    <toast>
      <visual>
        <binding template="ToastText02">
          <text id="1">${title}</text>
          <text id="2">${message}</text>
        </binding>
      </visual>
      <audio src="ms-winsoundevent:Notification.Default"/>
    </toast>
"@
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Claude Code").Show($toast)
  `.replace(/\n/g, '; ');

  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
  } catch (e) {
    try {
      execSync('powershell -NoProfile -Command "[console]::beep(600,500)"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
    } catch (e2) {}
  }
} catch (e) {}

process.exit(0);
