#!/usr/bin/env node
/**
 * Upstream spec-lint — Layer 1 of the upstream-currency watcher (offline, no network).
 *
 * Validates the project config against a checked-in snapshot of the CURRENT
 * Claude Code + Cursor spec (.ai/snapshots/upstream-spec.json):
 *   - agent / skill / command frontmatter keys must be known fields
 *   - settings.json hook events must be known events
 *   - .mcp.json transport types must be valid
 *   - no stale model/version strings or removed commands in config + guides
 *
 * Runs on every `/check` and is cheap enough for pre-commit. The companion
 * `/upstream-check` (Layer 2) refreshes the snapshot from the live docs.
 *
 * Exit 0 = consistent, 1 = drift (with detail). Dependency-free (fs/path).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const errors = [];
const warnings = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

const snapRaw = read(".ai/snapshots/upstream-spec.json");
if (!snapRaw) {
  console.error("✗ .ai/snapshots/upstream-spec.json missing — run /upstream-check to create it");
  process.exit(1);
}
const SPEC = JSON.parse(snapRaw);

// ---- frontmatter key extraction ----
function frontmatterKeys(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0].trim() !== "---") return null; // no frontmatter
  const keys = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return keys;
    const m = lines[i].match(/^([A-Za-z][\w-]*):/);
    if (m) keys.push(m[1]);
  }
  return keys; // unterminated — still return what we saw
}

// ---- recursive file walk with excludes ----
const EXCLUDE = [
  "node_modules", "worktrees", ".git", "out", "models",
  path.join(".ai", "reports"), path.join(".ai", "snapshots"),
  path.join(".claude", "state"), path.join(".claude", "scripts"),
];
function isExcluded(p) {
  const norm = p.replace(/[\\/]+/g, "/");
  const hit = EXCLUDE.some((e) => {
    const en = e.replace(/[\\/]+/g, "/");
    if (en === ".git") return /(^|\/)\.git(\/|$)/.test(norm); // match .git dir, NOT .github
    return norm.includes(en);
  });
  return hit ||
    /(?:ai-config-|audit).*\.(md|html)$/i.test(path.basename(p));
}
function walk(rel, exts, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = path.join(rel, e.name);
    const childAbs = path.join(ROOT, childRel);
    if (isExcluded(childAbs)) continue;
    if (e.isDirectory()) walk(childRel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(childRel);
  }
}

// ---- 1. frontmatter field validation ----
function lintFrontmatter(relGlobDir, fileMatch, allowed, label, level) {
  const files = [];
  walk(relGlobDir, [".md"], files);
  for (const f of files) {
    if (fileMatch && !fileMatch.test(path.basename(f))) continue;
    const content = read(f);
    const keys = content && frontmatterKeys(content);
    if (!keys) continue; // no frontmatter block (reported separately if required)
    for (const k of keys) {
      if (!allowed.includes(k)) {
        const msg = `${f}: unknown ${label} frontmatter field "${k}" — not in snapshot spec (deprecated/typo, or new field to add to snapshot)`;
        (level === "error" ? errors : warnings).push(msg);
      }
    }
  }
}
lintFrontmatter(".claude/agents", null, SPEC.claudeCode.agentFields, "agent", "error");
lintFrontmatter(".claude/skills", /^SKILL\.md$/, SPEC.claudeCode.skillFields, "skill", "error");
lintFrontmatter(".claude/commands", null, SPEC.claudeCode.commandFields, "command", "warning");
// cursor rules + skills + agents
(function cursor() {
  const rules = [];
  walk(".cursor/rules", [".mdc"], rules);
  for (const f of rules) {
    const keys = frontmatterKeys(read(f) || "");
    if (!keys) continue;
    for (const k of keys) {
      if (!SPEC.cursor.ruleFields.includes(k)) warnings.push(`${f}: unknown Cursor rule field "${k}"`);
    }
  }
  if (SPEC.cursor.skillFields) {
    const skills = [];
    walk(".cursor/skills", [".md"], skills);
    for (const f of skills.filter((p) => /SKILL\.md$/i.test(p))) {
      const keys = frontmatterKeys(read(f) || "");
      if (!keys) continue;
      for (const k of keys) {
        if (!SPEC.cursor.skillFields.includes(k)) warnings.push(`${f}: unknown Cursor skill field "${k}"`);
      }
    }
  }
  if (SPEC.cursor.agentFields) {
    const agents = [];
    walk(".cursor/agents", [".md"], agents);
    const validModels = new Set([...(SPEC.models?.currentIds || []), "inherit"]);
    for (const f of agents) {
      const raw = read(f) || "";
      const keys = frontmatterKeys(raw);
      if (!keys) continue;
      for (const k of keys) {
        if (!SPEC.cursor.agentFields.includes(k)) warnings.push(`${f}: unknown Cursor agent field "${k}"`);
      }
      // Cursor subagents need a full model ID or "inherit" — bare aliases (sonnet/opus)
      // don't resolve and silently fall back to the default model.
      const mm = raw.match(/^model:\s*([^\s#[]+)/m);
      if (mm && validModels.size && !validModels.has(mm[1])) {
        errors.push(`${f}: Cursor agent model "${mm[1]}" is not a full model ID — use one of ${[...validModels].join(", ")} (bare aliases don't resolve)`);
      }
    }
  }
})();

// ---- 1c. .github/agents/*.agent.md (GitHub Copilot custom agents) ----
(function githubCopilot() {
  if (!SPEC.copilot || !SPEC.copilot.agentFields) return;
  const agents = [];
  walk(".github/agents", [".md"], agents);
  const validModels = new Set([...(SPEC.models?.currentIds || []), "inherit"]);
  for (const f of agents.filter((p) => /\.agent\.md$/i.test(p))) {
    const raw = read(f) || "";
    const keys = frontmatterKeys(raw);
    if (!keys) continue; // README.md etc. have no frontmatter — skip
    for (const k of keys) {
      if (!SPEC.copilot.agentFields.includes(k)) {
        const retired = (SPEC.copilot._retiredFields || []).includes(k);
        warnings.push(`${f}: unknown Copilot agent field "${k}"${retired ? " (retired)" : ""}`);
      }
    }
    // tools: built-in alias OR "server/tool" | "server/*". A bare token not in
    // toolAliases and without "/" is invalid (the search/codebase class of bug).
    const tm = raw.match(/^tools:\s*(.+)$/m);
    if (tm && SPEC.copilot.toolAliases) {
      const toks = tm[1].replace(/[[\]'"]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
      for (const t of toks) {
        const lower = t.toLowerCase();
        const slash = t.indexOf("/");
        let ok;
        if (slash === -1) {
          ok = SPEC.copilot.toolAliases.includes(lower); // bare token must be a built-in alias
        } else {
          const server = lower.slice(0, slash);
          // "server/tool" is valid only if the server is NOT a built-in alias name
          // (alias/xxx means a built-in alias was mistaken for an MCP server).
          ok = server.length > 0 && !SPEC.copilot.toolAliases.includes(server);
        }
        if (!ok) {
          errors.push(`${f}: Copilot tool "${t}" is not a built-in alias {${SPEC.copilot.toolAliases.join(",")}} and has no "server/" prefix — an allowlisted invalid tool silently strips execute/read/edit`);
        }
      }
    }
    // model IS spec-valid but kit convention: do not pin it (subscription-dependent).
    const mm = raw.match(/^model:\s*([^\s#[]+)/m);
    if (mm) {
      warnings.push(`${f}: Copilot agent pins model "${mm[1]}" — kit convention is to omit model (available models depend on the user's Copilot subscription)`);
      if (validModels.size && !validModels.has(mm[1])) {
        warnings.push(`${f}: pinned model "${mm[1]}" is also not a current model ID`);
      }
    }
  }
})();

// ---- 2. settings.json hook events ----
const settings = read(".claude/settings.json");
if (settings) {
  try {
    const s = JSON.parse(settings);
    for (const ev of Object.keys(s.hooks || {})) {
      if (!SPEC.claudeCode.hookEvents.includes(ev)) {
        errors.push(`.claude/settings.json: hook event "${ev}" not in snapshot spec — verify it still exists upstream`);
      }
    }
  } catch (e) {
    errors.push(`.claude/settings.json: invalid JSON — ${e.message}`);
  }
}

// ---- 2b. .cursor/hooks.json event names ----
const cursorHooks = read(".cursor/hooks.json");
if (cursorHooks && SPEC.cursor && SPEC.cursor.hookEvents) {
  try {
    const ch = JSON.parse(cursorHooks);
    for (const ev of Object.keys(ch.hooks || {})) {
      if (!SPEC.cursor.hookEvents.includes(ev)) {
        errors.push(`.cursor/hooks.json: hook event "${ev}" not in snapshot Cursor spec — likely silently ignored (e.g. "beforeFileEdit" does not exist; use beforeReadFile + failClosed)`);
      }
    }
  } catch (e) {
    errors.push(`.cursor/hooks.json: invalid JSON — ${e.message}`);
  }
}

// ---- 3. .mcp.json transport types ----
const mcp = read(".mcp.json");
if (mcp) {
  try {
    const m = JSON.parse(mcp);
    for (const [name, def] of Object.entries(m.mcpServers || {})) {
      const t = def.type || "stdio";
      if (!SPEC.claudeCode.mcpTypes.includes(t)) {
        errors.push(`.mcp.json: server "${name}" uses transport "${t}" not in {${SPEC.claudeCode.mcpTypes.join(",")}}`);
      }
    }
  } catch (e) {
    errors.push(`.mcp.json: invalid JSON — ${e.message}`);
  }
}

// ---- 4. stale-string scan across config + guides ----
const scanFiles = [];
["CLAUDE.md"].forEach((f) => fs.existsSync(path.join(ROOT, f)) && scanFiles.push(f));
for (const g of ["claude-code-guide", "claude-code-guide-en", "cursor-guide", "cursor-guide-en", "cursor-ai-guide", "cursor-ai-guide-en", "qa-tests-guide"]) {
  if (fs.existsSync(path.join(ROOT, g + ".html"))) scanFiles.push(g + ".html");
}
walk(".ai/docs", [".md", ".html"], scanFiles);
walk(".cursor", [".md", ".mdc"], scanFiles);
walk(".claude/commands", [".md"], scanFiles);
walk(".claude/agents", [".md"], scanFiles);
walk(".claude/skills", [".md"], scanFiles);
walk(".claude/output-styles", [".md"], scanFiles);
walk(".github", [".md"], scanFiles);

const compiled = SPEC.staleStrings.map((s) => ({ re: new RegExp(s.pattern), ...s }));
for (const f of [...new Set(scanFiles)]) {
  const content = read(f);
  if (!content) continue;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const s of compiled) {
      if (s.re.test(lines[i])) {
        errors.push(`${f}:${i + 1}: stale "${s.pattern.replace(/\\/g, "")}" (${s.reason}) → ${s.replacement}`);
      }
    }
  }
}

// ---- report ----
console.log("\n━━━ Upstream Spec-Lint ━━━");
console.log(`Snapshot verified against docs as of: ${SPEC.lastVerifiedAgainst.date}`);
console.log("Checks: agent/skill/command frontmatter, Claude + Cursor hook events, mcp transport, stale model/command strings\n");
if (!errors.length && !warnings.length) {
  console.log("✓ Config is consistent with the snapshot spec. No drift.\n");
  process.exit(0);
}
if (errors.length) {
  console.log("ERRORS (must fix):");
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log("");
}
if (warnings.length) {
  console.log("WARNINGS (review):");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log("");
}
console.log("If a flagged field/string is actually CURRENT, the snapshot is stale — run /upstream-check to refresh it.");
process.exit(errors.length ? 1 : 0);
