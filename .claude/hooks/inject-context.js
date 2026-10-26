#!/usr/bin/env node
/**
 * UserPromptSubmit hook.
 * Injects a short conventions reminder when user requests coding work.
 * Reads JSON from stdin: { prompt, cwd, session_id, ... }
 * Outputs JSON: { hookSpecificOutput: { hookEventName, additionalContext } }
 *
 * NEVER/ALWAYS rules are read DIRECTLY from .ai/docs/conventions.md so this
 * hook stays in sync with the single source of truth automatically.
 * The full block is injected once per session; later coding prompts get a
 * one-line pointer (the model retains a once-stated rule; the repeat cost
 * 1.5-4 KB per prompt).
 */

const fs = require("fs");
const path = require("path");

let chunks = "";
process.stdin.on("data", (c) => (chunks += c));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(chunks || "{}");
  } catch {
    process.exit(0);
  }

  const rawPrompt = data.prompt || "";

  // Early-out for large prompts (paste of huge diff/log/etc)
  if (rawPrompt.length > 50000) process.exit(0);

  const prompt = rawPrompt.toLowerCase();
  const cwd = data.cwd || process.cwd();

  const codingTriggers = [
    /\btạo\s+(template|scene|route|api|trang|page|component|màn\s+hình)\b/,
    /\bthêm\s+(template|scene|route|tính\s+năng|feature|bước|step)\b/,
    /\b(implement|triển\s+khai|xây\s+dựng)\b/,
    /\bcập\s+nhật\s+(template|engine|server|ui|style|logic|api|pipeline)\b/,
    /\b(update|modify|change)\b[\w\s]{0,20}\b(template|scene|renderer|engine|pipeline|server|route|ui|style|api|layout)\b/i,
    /\b(refactor|refactoring)\b/,
    // Verb + optional article/adjective/nouns + target noun (don't miss "create a new login page")
    /\b(create|add|new|build|write|implement|scaffold)\b[\w\s]{0,20}?\b(template|scene|renderer|feature|route|endpoint|api|step|validator|test|ui|screen|provider|worker)\b/,
    /\bbuild\s+(a|an|the|new)\s/,
    /\b(develop|developing)\s+(feature|template|route)\b/,
    // Bug fixes — verb anywhere before a problem noun
    /\b(fix|sửa|debug)\b.*\b(bug|lỗi|issue|error|crash)\b/,
  ];
  const gaTriggers = [];
  // Security-relevant prompts get the full Security NEVER subset injected.
  const securityTrigger =
    /\b(auth|token|password|credential|secret|key|api|endpoint|route|server|host|origin|upload|spawn|shell|exec|child_process|ffmpeg|chrome|playwright|path|escape|claude|anthropic|model|provider|worker|fetch)\b/i;

  const isCoding = codingTriggers.some((re) => re.test(prompt));
  const isGA = gaTriggers.some((re) => re.test(prompt));
  const isSecurity = securityTrigger.test(rawPrompt);
  if (!isCoding && !isGA && !isSecurity) {
    // Not a coding/GA/security prompt — but the quota guard + model tier must still
    // surface on ANY prompt (a loop resume like "tiếp tục" isn't a coding trigger).
    emit([modelTierLine(cwd), quotaGuardLine(cwd)]);
    process.exit(0);
  }

  if (!firstInjectionThisSession(cwd, data.session_id)) {
    emit([
      "[Conventions were injected earlier this session — .ai/docs/conventions.md is the source; re-read it before writing code.]",
      modelTierLine(cwd),
      quotaGuardLine(cwd),
    ]);
    process.exit(0);
  }

  const conventionsPath = path.join(cwd, ".ai", "docs", "conventions.md");
  if (!fs.existsSync(conventionsPath)) process.exit(0);

  // Read NEVER/ALWAYS sections from the source-of-truth file.
  // The NEVER block is split: general bullets vs. the Security subset that
  // appears after the bold "**Security (NEVER" marker (before "## ALWAYS Do").
  let generalNever = [];
  let securityNever = [];
  let alwaysItems = [];
  try {
    const md = fs.readFileSync(conventionsPath, "utf8");
    const never = extractSection(md, "NEVER Do");
    generalNever = never.general;
    securityNever = never.security;
    alwaysItems = extractSection(md, "ALWAYS Do").general;
  } catch {
    process.exit(0);
  }

  const lines = [
    "[Auto-loaded from .ai/docs/conventions.md — coding-trigger detected]",
  ];

  if (isCoding && generalNever.length) {
    lines.push("NEVER:");
    // Char-budget accumulator — push general NEVER bullets up to ~900 chars.
    for (const item of takeWithinBudget(generalNever, 900)) lines.push("- " + item);
  }

  // Security NEVER subset gets its OWN budget so it's never crowded out by the
  // general bullets. Fires on explicit security prompts or backend-ish coding.
  if ((isSecurity || (isCoding && securityTrigger.test(rawPrompt))) && securityNever.length) {
    lines.push("SECURITY NEVER (the Floor — never work around these):");
    for (const item of takeWithinBudget(securityNever, 1800)) lines.push("- " + item);
  }

  if (isCoding && alwaysItems.length) {
    lines.push("ALWAYS:");
    for (const item of takeWithinBudget(alwaysItems, 900)) lines.push("- " + item);
  }

  lines.push("Source of truth: .ai/docs/conventions.md, .ai/docs/common-patterns.md");

  const tier = modelTierLine(cwd);
  if (tier) lines.unshift(tier);
  const guard = quotaGuardLine(cwd);
  if (guard) lines.push(guard);

  emit(lines);
});

function emit(lines) {
  const text = lines.filter(Boolean).join("\n");
  if (!text) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
    }),
  );
}

// First coding prompt of a session → true (and records the session). A missing
// session_id disables the dedupe so the full block still lands. Best-effort.
function firstInjectionThisSession(cwd, sessionId) {
  if (!sessionId) return true;
  try {
    const dir = path.join(cwd, ".claude", "state", "injected");
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, `${String(sessionId).replace(/[^\w-]/g, "_")}.flag`);
    if (fs.existsSync(marker)) return false;
    fs.writeFileSync(marker, String(Math.floor(Date.now() / 1000)));
    return true;
  } catch {
    return true;
  }
}

// Model tier: statusline.js writes .claude/state/model-tier.json from the 5-hour
// and 7-day quota. Subagents downgrade via Agent({model}); only the user can
// switch the lead, so the line asks for /model + /effort. Null when full/absent.
function modelTierLine(cwd) {
  try {
    const p = path.join(cwd, ".claude", "state", "model-tier.json");
    if (!fs.existsSync(p)) return null;
    const t = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!t.model) return null;
    const effort = t.tier === "minimal" ? "low" : "medium";
    const win = t.source === "seven_day" ? `weekly quota ${Math.round(t.week_pct)}%` : `5h quota ${Math.round(t.pct)}%`;
    return `[MODEL TIER ${t.tier} — ${win}] Pass model:"${t.model}" on every Agent call this turn (tech-lead may keep "opus"). Lead: run /model ${t.model} and /effort ${effort} now — only the user can switch the lead's model or effort.`;
  } catch {
    return null;
  }
}

// Quota guard: statusline.js writes .claude/state/quota-pause.flag when a rate-limit
// window nears the limit. Return a line telling a running loop to wrap up + stop
// BEFORE the hard wall (or null if no flag). Best-effort — never throws.
function quotaGuardLine(cwd) {
  try {
    const flagPath = path.join(cwd, ".claude", "state", "quota-pause.flag");
    if (!fs.existsSync(flagPath)) return null;
    const f = JSON.parse(fs.readFileSync(flagPath, "utf8"));
    const resetTxt = f.resets_at ? new Date(f.resets_at * 1000).toLocaleTimeString() : "soon";
    if (f.level === "stop") {
      return `[QUOTA GUARD] quota at ${f.pct}% (>=99%). If a loop is running: finish the CURRENT item cleanly (commit only if VERIFY+UNIT_TEST green, else leave a clean state), append a Loop Journal line, then STOP — do NOT start a new item. Quota resets ~${resetTxt}; resume by re-running the loop command after reset.`;
    }
    if (f.level === "warn") {
      return `[QUOTA GUARD] quota at ${f.pct}% — approaching limit. Prefer finishing the current loop item over starting a large new one.`;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * Extract bullet list from a markdown section by heading text.
 * Returns { general, security }: bullets before the bold "**Security (NEVER"
 * marker go to `general`; bullets after it (until the next ## heading) go to
 * `security`. Sections without a Security marker put everything in `general`.
 */
function extractSection(md, headingText) {
  const heading = new RegExp("^##\\s+" + headingText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m");
  const m = md.match(heading);
  if (!m) return { general: [], security: [] };
  const start = m.index + m[0].length;
  const after = md.slice(start);
  const next = after.search(/\n##\s+/);
  const section = next === -1 ? after : after.slice(0, next);

  const general = [];
  const security = [];
  let bucket = general;
  const lines = section.split(/\r?\n/);
  let current = null;
  const flush = () => {
    if (current) {
      bucket.push(current);
      current = null;
    }
  };
  for (const line of lines) {
    // The Security NEVER subset begins at the bold marker line.
    if (/^\*\*Security\s*\(NEVER/i.test(line.trim())) {
      flush();
      bucket = security;
      continue;
    }
    if (/^- /.test(line)) {
      flush();
      current = line.slice(2).trim();
    } else if (current && /^\s+/.test(line) && line.trim()) {
      // continuation of previous bullet — keep first line only (collapse)
      // skip
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();

  // Strip markdown formatting that hurts readability in the inject
  const clean = (arr) =>
    arr
      .map((s) => s.replace(/\*\*/g, "").replace(/`/g, ""))
      .filter((s) => s.length > 0 && s.length < 200);

  return { general: clean(general), security: clean(security) };
}

/**
 * Take items from the front of `arr` until the cumulative character length
 * (including a short bullet prefix) would exceed `maxChars`. Always returns at
 * least one item if the array is non-empty.
 */
function takeWithinBudget(arr, maxChars) {
  const out = [];
  let used = 0;
  for (const item of arr) {
    const cost = item.length + 2; // "- " prefix
    if (out.length && used + cost > maxChars) break;
    out.push(item);
    used += cost;
  }
  return out;
}
