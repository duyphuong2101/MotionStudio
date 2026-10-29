#!/usr/bin/env node
// Stop hook: Notify when Claude finishes a task
// Fires when Claude stops responding (task complete or needs input)

const { execSync, execFileSync } = require('child_process');

try {
  const title = 'Claude Code - Task Complete';
  const message = 'Claude has finished processing.';

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
    try {
      execSync('powershell -NoProfile -Command "[console]::beep(1000,200); Start-Sleep -Milliseconds 100; [console]::beep(1200,200)"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
    } catch (e2) {}
  }
} catch (e) {}

process.exit(0);
