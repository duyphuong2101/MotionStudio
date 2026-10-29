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
  // .agents/skills mirrors .claude/skills for Codex/Antigravity; Copilot already reads the source.
  'chat.agentSkillsLocations': {
    '.agents/skills': false,
  },
};

let cur = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    cur = raw.trim() ? JSON.parse(raw) : {};
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) throw new Error('not an object');
  } catch {
    console.log(`○ .vscode/settings.json has comments or trailing commas — add these keys by hand:\n${JSON.stringify(KEYS, null, 2)}`);
    process.exit(0);
  }
}

let changed = false;
for (const [k, v] of Object.entries(KEYS)) {
  const prev = cur[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k]) ? cur[k] : {};
  const next = typeof v === 'object' ? { ...prev, ...v } : v;
  if (JSON.stringify(cur[k]) !== JSON.stringify(next)) { cur[k] = next; changed = true; }
}
if (!changed) {
  console.log('✓ VS Code Copilot context settings already applied');
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
// Temp file + rename so an interrupted run never leaves a half-written settings.json.
fs.writeFileSync(`${file}.tmp`, JSON.stringify(cur, null, 2) + '\n');
fs.renameSync(`${file}.tmp`, file);
console.log('✓ VS Code Copilot context settings merged into .vscode/settings.json (AGENTS.md/CLAUDE.md no longer sent per request)');
