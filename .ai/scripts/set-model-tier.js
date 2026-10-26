#!/usr/bin/env node
// Sets the orchestrator model tier by hand. The statusline only writes .claude/state/model-tier.json
// when Claude Code hands it rate_limits (CLI on a Pro/Max plan); the VS Code extension and
// Team/Enterprise plans never do, so without this file every spawn runs at `full`.
// The manual tier expires on its own, and the CLI statusline overwrites it when it has live data.
// Usage: node .ai/scripts/set-model-tier.js <full|reduced|minimal> [--hours N]   (default 5h, max 24h)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Same tier → subagent model map as statusline.js MODEL_TIERS.
const MODELS = { full: null, reduced: 'opus', minimal: 'sonnet' };

const [tier, ...rest] = process.argv.slice(2);
if (!(tier in MODELS)) {
  console.error('usage: node .ai/scripts/set-model-tier.js <full|reduced|minimal> [--hours N]');
  process.exit(1);
}
const i = rest.indexOf('--hours');
const raw = i >= 0 ? Number(rest[i + 1]) : 5;
const hours = Number.isFinite(raw) ? Math.min(24, Math.max(0.25, raw)) : 5;

const root = (() => {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return process.cwd(); }
})();
const file = path.join(root, '.claude', 'state', 'model-tier.json');
const now = Math.floor(Date.now() / 1000);
const expires = now + Math.round(hours * 3600);

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ tier, model: MODELS[tier], source: 'manual', written_at: now, expires_at: expires }));

const until = new Date(expires * 1000).toLocaleTimeString();
console.log(tier === 'full'
  ? `✓ model tier reset to full (agent defaults) until ${until}`
  : `✓ model tier ${tier} until ${until} — subagents run on ${MODELS[tier]} (tech-lead keeps opus); the CLI statusline overrides it when it has live quota data`);
