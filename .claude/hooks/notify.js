#!/usr/bin/env node
// Notification hook: Windows toast notification + sound
// Alerts when Claude needs permission or is waiting for input

const { execSync, execFileSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const matcher = data.notification_type || 'unknown';

    let title = 'Claude Code';
    let message = 'Claude needs your attention';

    if (matcher === 'permission_prompt') {
      title = 'Claude Code - Permission Required';
      message = 'Claude is requesting permission to proceed.';
    } else if (matcher === 'idle_prompt' || matcher === 'agent_needs_input') {
      title = 'Claude Code - Waiting';
      message = 'Claude is waiting for your input.';
    } else if (matcher === 'agent_completed') {
      title = 'Claude Code - Done';
      message = 'Claude finished the task.';
    }

    // Windows toast notification via PowerShell
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
    `;

    try {
      // -EncodedCommand keeps the here-string's line breaks; joining lines with '; ' broke `@"` every time.
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
    } catch (e) {
      // Fallback: simple beep
      try {
        execSync('powershell -NoProfile -Command "[console]::beep(800,300)"', {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000,
        });
      } catch (e2) {}
    }
  } catch (e) {}
  process.exit(0);
});
