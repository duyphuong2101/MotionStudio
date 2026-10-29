#!/usr/bin/env node
// Cursor beforeShellExecution hook: ask the person before a render, approve or sequence
// command runs, matching the Claude seat's own disallowedTools (render/approve/sequence)
// and Copilot's chat.tools.terminal.autoApprove gate. Cursor has no seat allowlist for its
// own agent, so this hook is what holds it to the same rule (CLAUDE.md "Rules for using
// Claude here"). failClosed:true so a crash/timeout/invalid-JSON asks rather than runs.
// Shared matcher shape with block-destructive.js — keep in sync.

const COMMAND_RE = /\bnode\s+(?:\.[\/])?engine[\/]cli\.mjs\s+(render|approve|sequence|sequence-preview)\b/i;
const NPM_RE = /\bnpm\s+run\s+studio\s+--\s+(render|approve|sequence|sequence-preview)\b/i;

function normalizeCommand(rawCommand) {
  const normalizeQuotes = (s) =>
    s
      .replace(/"([^"]*)"/g, (m, inner) => (/\s/.test(inner) ? '""' : inner))
      .replace(/'([^']*)'/g, (m, inner) => (/\s/.test(inner) ? "''" : inner));
  return normalizeQuotes(rawCommand);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    process.stdout.write(JSON.stringify({ permission: 'ask', user_message: 'ask-before-render: invalid hook payload — asking before running.' }));
    process.exit(0);
  }

  const command = normalizeCommand(data.command || data.tool_input?.command || '');
  const match = COMMAND_RE.exec(command) || NPM_RE.exec(command);
  if (match) {
    process.stdout.write(JSON.stringify({
      permission: 'ask',
      user_message: `This runs "${match[1]}", which renders or publishes a video. Confirm before it runs: "${command}".`,
      agent_message: `Ask the person before running "${match[1]}" — it renders, approves or joins a video.`,
    }));
    process.exit(0);
  }
  process.exit(0);
});
