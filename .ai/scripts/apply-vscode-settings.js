#!/usr/bin/env node
// Merges the Copilot context-diet keys into <target>/.vscode/settings.json.
// By default VS Code Copilot Chat sends AGENTS.md + CLAUDE.md + .github/copilot-instructions.md on
// every request (instruction sources are additive); the kit keeps only copilot-instructions.md always-on.
// Idempotent, merges instead of overwriting, and never rewrites a JSONC file it cannot parse.
// Usage: node .ai/scripts/apply-vscode-settings.js [targetDir]
const fs = require('fs');
const path = require('path');

const target = path.resolve(process.argv[2] || process.cwd());
const file = path.join(target, '.vscode', 'settings.json');
const KEYS = {
  'chat.useAgentsMdFile': false,
  'chat.useClaudeMdFile': false,
  'chat.instructionsFilesLocations': {
    '.github/instructions': true,
    '.claude/rules': false,
    '~/.copilot/instructions': true,
    '~/.claude/rules': false,
  },
};

let cur = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    cur = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    console.log(`○ .vscode/settings.json has comments or trailing commas — add these keys by hand:\n${JSON.stringify(KEYS, null, 2)}`);
    process.exit(0);
  }
}

let changed = false;
for (const [k, v] of Object.entries(KEYS)) {
  const next = typeof v === 'object' ? { ...(cur[k] || {}), ...v } : v;
  if (JSON.stringify(cur[k]) !== JSON.stringify(next)) { cur[k] = next; changed = true; }
}
if (!changed) {
  console.log('✓ VS Code Copilot context settings already applied');
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n');
console.log('✓ VS Code Copilot context settings merged into .vscode/settings.json (AGENTS.md/CLAUDE.md no longer sent per request)');
