#!/usr/bin/env node
// Cursor hook for protected files. Two roles depending on the event payload:
//   beforeReadFile  → DENY reading secrets/credentials into the LLM (permission:deny);
//                     for any other file, redact inline secret patterns.
//   afterFileEdit   → Cursor has NO before-edit block event, so the best we can do
//                     post-write is warn (exit 2 flags the action as denied/undesirable).
// Wired with "failClosed": true so a crash/timeout/invalid-JSON BLOCKS rather than allows
// (Cursor default is fail-open). Cursor blocking contract: emit {"permission":"deny"} or exit 2.

const path = require('path');

// Secret basenames: never read into the model, never edited. Anchored to avoid false positives
// like ".environment.json", "UserCredentials.cs". .env.example/.sample/.template are docs.
const SECRET = [
  /^\.env(\.(?!(example|sample|template)$)[\w-]+)?$/i,
  /(^|[._-])credentials(\.|$)/i,
  /(^|[._-])secrets?(\.|$)/i,
  /\.(pem|key|pfx|p12)$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)$/i,
  /^CLAUDE\.local\.md$/i,
  /^appsettings\.local\.json$/i,
  /^accounts\.json$/i,
  /^\.mcp\.json$/i,
];
// Edit-only protection (reads are legitimate): prod config, lock files, git internals, and the
// kit's own guards — parity with .claude/hooks/protect-files.js.
const EDIT_ONLY = [
  /^appsettings\.(production|preproduction)\.json$/i,
  /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|pipfile\.lock|composer\.lock)$/i,
];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    // failClosed: a parse failure must NOT silently allow — deny the action.
    process.stdout.write(JSON.stringify({ permission: 'deny', user_message: 'protect-files: invalid hook payload — blocked.' }));
    process.exit(2);
  }

  const rawPath = data.path || data.file_path || '';
  const filePath = rawPath.toLowerCase().replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  // Path-based matchers (checked on the FULL path, not just basename) — .git/ internals
  // and the safety machinery itself would slip past a basename-only check (e.g. .git/config).
  const PATH_PROTECTED = [
    /(^|\/)\.git(\/|$)/,
    /(^|\/)\.claude\/hooks\//,
    /(^|\/)\.claude\/scripts\//,
    /(^|\/)\.claude\/settings(\.local)?\.json$/,
    /(^|\/)\.cursor\/hooks\//,
    /(^|\/)\.cursor\/hooks\.json$/,
  ];
  const isSecret = SECRET.some((m) => m.test(fileName));
  const isEditOnly = EDIT_ONLY.some((m) => m.test(fileName)) || PATH_PROTECTED.some((m) => m.test(filePath));
  const isEdit = data.newContent !== undefined || data.edits !== undefined;
  if (isSecret || (isEditOnly && isEdit)) {
    if (isEdit) {
      // afterFileEdit: no pre-write block exists in Cursor — flag the write as denied.
      process.stdout.write(JSON.stringify({
        permission: 'deny',
        user_message: `Protected file modified: ${rawPath}. Use the package manager for lock files, or edit secrets manually outside the agent.`,
        agent_message: `Edit to protected file "${rawPath}" is not allowed.`,
      }));
      process.exit(2);
    }
    // beforeReadFile: deny sending the secret file's contents to the LLM.
    process.stdout.write(JSON.stringify({
      permission: 'deny',
      user_message: `Reading protected file "${rawPath}" into the model is blocked.`,
      agent_message: `Protected file "${rawPath}" cannot be read.`,
    }));
    process.exit(2);
  }

  // Non-protected beforeReadFile: ALLOW. Cursor's beforeReadFile does NOT support
  // returning modified content (schema is {permission, user_message} only) — the old
  // {content} redaction branch was a silent no-op at best, and under failClosed an
  // unrecognized response shape risks denying every file read. Secrets in tracked
  // source are handled by protect-files matchers (above) + the .env/.gitignore policy,
  // not by post-read redaction.
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
});
