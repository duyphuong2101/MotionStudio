#!/usr/bin/env node
/**
 * Status line for Claude Code.
 * Reads JSON from stdin (session info) and prints a single line.
 *
 * Input fields (subset): model.display_name, workspace.current_dir,
 *   cost.total_cost_usd, cost.total_duration_ms, output_style.name,
 *   rate_limits.{five_hour,seven_day}.{used_percentage,resets_at} (Claude.ai Pro/Max only)
 *
 * Quota guard: writes .claude/state/quota-pause.flag when a rate-limit window
 * crosses WARN/STOP thresholds so a loop (via inject-context.js) can stop
 * gracefully BEFORE the hard "session limit" wall, and resume after reset.
 * Model tier: writes .claude/state/model-tier.json so orchestrators pass a
 * cheaper `model` to Agent() spawns as the windows fill.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const QUOTA_WARN_PCT = 90;
const QUOTA_STOP_PCT = 99;

// Only the user can switch the lead (/model); inject-context.js nudges for that.
const MODEL_TIERS = [
  { min: QUOTA_STOP_PCT, tier: "stop", model: null },
  { min: 90, tier: "minimal", model: "sonnet" },
  { min: 70, tier: "reduced", model: "opus" },
  { min: 0, tier: "full", model: null },
];
const TIER_RANK = { full: 0, reduced: 1, minimal: 2, stop: 3 };
// Weekly window: the 5h window resets, the week does not, so it downgrades later
// but also when spend runs ahead of elapsed time by this many points.
const WEEKLY_TIERS = [
  { min: QUOTA_STOP_PCT, tier: "stop" },
  { min: 95, tier: "minimal" },
  { min: 85, tier: "reduced" },
];
const WEEKLY_PACE_MARGIN = 20;
const WEEK_SECONDS = 7 * 24 * 3600;

function windowPct(rl, name) {
  const w = rl && rl[name];
  return w && typeof w.used_percentage === "number" ? w.used_percentage : null;
}

function weeklyTier(pct, resetsAt, nowSec) {
  if (pct === null) return "full";
  const byLevel = WEEKLY_TIERS.find((x) => pct >= x.min);
  if (byLevel) return byLevel.tier;
  if (typeof resetsAt === "number") {
    const elapsedPct = Math.max(0, Math.min(100, (1 - (resetsAt - nowSec) / WEEK_SECONDS) * 100));
    if (pct - elapsedPct >= WEEKLY_PACE_MARGIN) return "reduced";
  }
  return "full";
}

// Reads the 5-hour and 7-day rate-limit %, updates the pause flag + model tier,
// returns {pct, level}. Pure-ish (takes parsed data + base dir) so it can be unit-tested.
function evaluateQuota(data, baseDir) {
  const rl = data && data.rate_limits;
  const pct = windowPct(rl, "five_hour");
  const weekPct = windowPct(rl, "seven_day");
  const flagPath = path.join(baseDir, ".claude", "state", "quota-pause.flag");
  const tierPath = path.join(baseDir, ".claude", "state", "model-tier.json");

  const nowSec = Math.floor(Date.now() / 1000);
  if (pct === null && weekPct === null) {
    // rate_limits absent (API/Console/Enterprise, or before first turn) — no signal. A flag whose
    // reset time has passed is stale either way, so it must not keep a loop stopped.
    try {
      const f = JSON.parse(fs.readFileSync(flagPath, "utf8"));
      if (typeof f.resets_at === "number" && f.resets_at < nowSec) fs.unlinkSync(flagPath);
    } catch {
      /* no flag */
    }
    return { pct: null, level: "none", flagPath };
  }

  const resetsAt = pct !== null && typeof rl.five_hour.resets_at === "number" ? rl.five_hour.resets_at : null;
  const weekResetsAt = weekPct !== null && typeof rl.seven_day.resets_at === "number" ? rl.seven_day.resets_at : null;
  const worst = Math.max(pct ?? 0, weekPct ?? 0);
  let level = "ok";
  if (worst >= QUOTA_STOP_PCT) level = "stop";
  else if (worst >= QUOTA_WARN_PCT) level = "warn";

  try {
    const hourly = MODEL_TIERS.find((x) => (pct ?? 0) >= x.min).tier;
    const weekly = weeklyTier(weekPct, weekResetsAt, nowSec);
    const tier = TIER_RANK[weekly] > TIER_RANK[hourly] ? weekly : hourly;
    const model = MODEL_TIERS.find((x) => x.tier === tier).model;
    const source = tier === weekly && tier !== hourly ? "seven_day" : "five_hour";
    fs.mkdirSync(path.dirname(tierPath), { recursive: true });
    fs.writeFileSync(
      tierPath,
      JSON.stringify({
        tier, model, source,
        pct, resets_at: resetsAt,
        week_pct: weekPct, week_resets_at: weekResetsAt,
        written_at: nowSec,
      }),
    );
  } catch {
    /* best-effort */
  }

  try {
    if (level === "stop" || level === "warn") {
      // Report the window that tripped the level: a weekly stop carries the weekly % and reset.
      const weekly = (weekPct ?? -1) >= (pct ?? -1);
      fs.mkdirSync(path.dirname(flagPath), { recursive: true });
      fs.writeFileSync(
        flagPath,
        JSON.stringify({
          level,
          pct: weekly ? weekPct : pct,
          window: weekly ? "seven_day" : "five_hour",
          resets_at: weekly ? weekResetsAt : resetsAt,
          written_at: nowSec,
        }),
      );
    } else if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath); // quota recovered (post-reset) — clear so the loop may resume
    }
  } catch {
    /* flag is best-effort; never break the status line */
  }

  return { pct, weekPct, level, resetsAt, flagPath };
}

// Resolve current branch. Fast path: read .git/HEAD and parse "ref: refs/heads/<branch>".
// Fall back to git only when HEAD is detached or .git can't be read; cap git so a
// stalled invocation can't hang the status line.
function getBranch(cwd) {
  try {
    let dir = cwd;
    while (true) {
      const head = path.join(dir, ".git", "HEAD");
      if (fs.existsSync(head)) {
        const ref = fs.readFileSync(head, "utf8").trim();
        const m = ref.match(/^ref:\s*refs\/heads\/(.+)$/);
        if (m) return m[1];
        break; // detached HEAD (raw SHA) — defer to git for a short name
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  } catch {}

  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    })
      .toString()
      .trim();
  } catch {}

  return "";
}

let chunks = "";
process.stdin.on("data", (c) => (chunks += c));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(chunks || "{}");
  } catch {}

  const cwd = data.workspace?.current_dir || process.cwd();
  const branch = getBranch(cwd);

  const model = data.model?.display_name || "claude";
  const cost = data.cost?.total_cost_usd;
  const style = data.output_style?.name;
  // State lives at the project root; cwd moves when the session cd's into a subfolder.
  const quota = evaluateQuota(data, data.workspace?.project_dir || process.env.CLAUDE_PROJECT_DIR || cwd);

  const parts = [];
  if (branch) parts.push(`⎇ ${branch}`);
  parts.push(`⚡ ${model}`);
  if (style && style !== "default") parts.push(`[${style}]`);
  if (typeof cost === "number") parts.push(`$${cost.toFixed(3)}`);
  if (quota.pct !== null || quota.weekPct != null) {
    const tag = quota.level === "stop" ? "🛑" : quota.level === "warn" ? "⚠️" : "";
    const h = quota.pct !== null ? `${quota.pct.toFixed(0)}%5h` : "";
    const w = quota.weekPct != null ? `${quota.weekPct.toFixed(0)}%7d` : "";
    parts.push(`${tag}${[h, w].filter(Boolean).join("/")}`);
  }

  process.stdout.write(parts.join("  "));
});

module.exports = { evaluateQuota, weeklyTier, QUOTA_WARN_PCT, QUOTA_STOP_PCT, MODEL_TIERS, WEEKLY_TIERS };
