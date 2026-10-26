#!/usr/bin/env node
// Copies server/worker/director-prompt.md into .claude/skills/studio/SKILL.md between the DIRECTOR-RULES markers.
// Nothing outside the markers changes. tests/worker-prompt.test.mjs fails until this has run after an edit.
//
// Usage: node .ai/scripts/sync-director-prompt.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RULES = path.join(ROOT, 'server', 'worker', 'director-prompt.md');
const SKILL = path.join(ROOT, '.claude', 'skills', 'studio', 'SKILL.md');
const BEGIN = '<!-- BEGIN:DIRECTOR-RULES (generated from server/worker/director-prompt.md) -->';
const END = '<!-- END:DIRECTOR-RULES -->';

const skill = fs.readFileSync(SKILL, 'utf8');
const start = skill.indexOf(BEGIN);
const end = skill.indexOf(END);
if (start < 0 || end < start) {
  console.error(`${path.relative(ROOT, SKILL)}: the ${BEGIN} / ${END} markers are missing or out of order.`);
  process.exit(1);
}
const next = `${skill.slice(0, start)}${BEGIN}\n${fs.readFileSync(RULES, 'utf8').trimEnd()}\n${skill.slice(end)}`;
if (next === skill) {
  console.log('studio skill: rules block already current');
} else {
  fs.writeFileSync(SKILL, next);
  console.log('studio skill: rules block rewritten from server/worker/director-prompt.md');
}
