#!/usr/bin/env node
/**
 * Merge the NSC-recommended user-scope Claude Code settings into ~/.claude/settings.json.
 * Project-scope config travels with the repo; this covers the per-machine half:
 * model fallbacks, effort/thinking defaults, and the display mode for agent teams.
 *
 * Idempotent — only the keys below are touched, everything else in the file is kept.
 * Never writes secrets. Run: node .ai/scripts/apply-user-settings.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const RECOMMENDED = {
  // overload/5xx only — rate-limit errors never trigger it; quota is handled by model-tier.json
  fallbackModel: ["opus", "sonnet"],
  // false would switch thinking off on an Opus 5 fallback; Fable always thinks regardless
  alwaysThinkingEnabled: true,
  effortLevel: "medium",
  modelSettings: {
    "claude-fable-5-1": { effort: "medium" },
    "claude-opus-5": { effort: "high" },
    "claude-sonnet-5": { effort: "high" },
  },
  // split panes need tmux/iTerm2; in-process is the only mode that works in VS Code on Windows
  teammateMode: "in-process",
};

const dryRun = process.argv.includes("--dry-run");
const home = process.env.USERPROFILE || process.env.HOME;
if (!home) {
  console.error("Cannot resolve home directory (USERPROFILE/HOME unset).");
  process.exit(1);
}
const file = path.join(home, ".claude", "settings.json");

let current = {};
if (fs.existsSync(file)) {
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file} is not valid JSON — fix it by hand first (${e.message}).`);
    process.exit(1);
  }
}

const changes = [];
const next = { ...current };
for (const [key, value] of Object.entries(RECOMMENDED)) {
  const before = JSON.stringify(current[key]);
  const merged =
    key === "modelSettings" ? { ...(current.modelSettings || {}), ...value } : value;
  if (before !== JSON.stringify(merged)) {
    next[key] = merged;
    changes.push(`${key}: ${before ?? "(unset)"} -> ${JSON.stringify(merged)}`);
  }
}

if (!changes.length) {
  console.log(`✓ ${file} already has the recommended user-scope settings.`);
  process.exit(0);
}

console.log(`${dryRun ? "Would change" : "Changing"} in ${file}:`);
for (const c of changes) console.log("  " + c);
if (dryRun) process.exit(0);

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
console.log("✓ written. Restart Claude Code — model/effort settings are read at startup only.");
