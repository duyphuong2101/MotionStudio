#!/usr/bin/env node
// Copies the three Director rules files (server/worker/director-prompt.md shared, director-script.md full script,
// director-quick.md outline) into .claude/skills/studio/SKILL.md, each between its own markers (BLOCKS),
// then copies that skill byte for byte to the other agents' skill folders (MIRRORS).
// Nothing outside the markers changes. tests/worker-prompt.test.mjs fails until this has run after an edit.
//
// Usage: node .ai/scripts/sync-director-prompt.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'studio', 'SKILL.md');
// Cursor reads .cursor/skills; GitHub Copilot, Google Antigravity and any other agent read .agents/skills.
const MIRRORS = [
  path.join(ROOT, '.cursor', 'skills', 'studio', 'SKILL.md'),
  path.join(ROOT, '.agents', 'skills', 'studio', 'SKILL.md'),
];
// tests/worker-prompt.test.mjs holds the same marker texts.
const BLOCKS = [
  ['DIRECTOR-RULES', 'director-prompt.md'],
  ['DIRECTOR-SCRIPT', 'director-script.md'],
  ['DIRECTOR-QUICK', 'director-quick.md'],
].map(([name, file]) => ({
  rules: path.join(ROOT, 'server', 'worker', file),
  begin: `<!-- BEGIN:${name} (generated from server/worker/${file}) -->`,
  end: `<!-- END:${name} -->`,
}));

const skill = fs.readFileSync(SKILL, 'utf8');
let next = skill;
for (const { rules, begin, end } of BLOCKS) {
  const start = next.indexOf(begin);
  const stop = next.indexOf(end);
  if (start < 0 || stop < start) {
    console.error(`${path.relative(ROOT, SKILL)}: the ${begin} / ${end} markers are missing or out of order.`);
    process.exit(1);
  }
  next = `${next.slice(0, start)}${begin}\n${fs.readFileSync(rules, 'utf8').trimEnd()}\n${next.slice(stop)}`;
}
if (next === skill) {
  console.log('studio skill: rules blocks already current');
} else {
  fs.writeFileSync(SKILL, next);
  console.log('studio skill: rules blocks rewritten from server/worker/director-*.md');
}

for (const file of MIRRORS) {
  const rel = path.relative(ROOT, file);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) {
    console.log(`${rel}: already current`);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  console.log(`${rel}: copied from .claude/skills/studio/SKILL.md`);
}
