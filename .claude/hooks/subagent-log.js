#!/usr/bin/env node
/**
 * SubagentStop hook — appends subagent runs to .claude/state/subagent-log.ndjson.
 * Uses NDJSON (one entry per line) + appendFileSync for race safety:
 * concurrent subagents stopping at the same time will both append cleanly.
 *
 * Stdin JSON: { session_id, transcript_path, subagent_type?, ... }
 */

const fs = require("fs");
const path = require("path");

const stateDir = path.join(process.cwd(), ".claude", "state");
const logFile = path.join(stateDir, "subagent-log.ndjson");

let chunks = "";
process.stdin.on("data", (c) => (chunks += c));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(chunks || "{}");
  } catch {
    process.exit(0);
  }

  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

    // Field is `agent_type` (docs: common subagent input). Older code read the
    // non-existent `subagent_type` → 99.9% "unknown". Keep fallbacks for safety.
    const agentType =
      data.agent_type || data.subagent_type || data.tool_input?.subagent_type || "unknown";

    // Cheap outcome proxy: assistant turn count from the transcript (no PII —
    // count only). More turns ≈ harder/longer run; useful signal for retros.
    let turns = null;
    const tp = data.transcript_path;
    if (tp && fs.existsSync(tp)) {
      try {
        const lines = fs.readFileSync(tp, "utf8").trim().split("\n");
        turns = lines.filter((l) => {
          try {
            const d = JSON.parse(l);
            return d?.type === "assistant" || d?.message?.role === "assistant";
          } catch {
            return false;
          }
        }).length;
      } catch {}
    }

    // Metadata only — never add transcript content, request/response bodies, or env values here.
    const entry = {
      ts: new Date().toISOString(),
      session_id: data.session_id || null,
      agent_id: data.agent_id || null,
      agent_type: agentType,
      turns,
      cwd: data.cwd || null,
    };

    // Atomic append — race-safe across concurrent subagents
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");

    // Best-effort rotation: if file > 200KB, keep last 500 lines
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > 200 * 1024) {
        const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
        if (lines.length > 500) {
          fs.writeFileSync(logFile, lines.slice(-500).join("\n") + "\n");
        }
      }
    } catch {}
  } catch {}

  process.exit(0);
});
