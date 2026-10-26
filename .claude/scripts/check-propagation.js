#!/usr/bin/env node
/**
 * Propagation chain consistency check.
 *
 * Asserts that NEVER/ALWAYS rules in `.ai/docs/conventions.md` (single source of
 * truth) match what's in downstream files (Cursor rules, project-conventions skill,
 * CLAUDE.md, output-styles, inject-context).
 *
 * Run:
 *   node .claude/scripts/check-propagation.js
 *
 * Exits 0 if everything is consistent, 1 (with detailed diff) if drift detected.
 *
 * The hook `.claude/hooks/propagation-reminder.js` nudges humans on edits;
 * this script is a hard gate for CI / pre-commit.
 */

const fs = require("fs");
const path = require("path");
const { buildBlocks, condenseBlock, applyToContent, MARKERS, CONDENSED_TARGETS } = require("./generate-mirrors");

const ROOT = path.resolve(__dirname, "..", "..");
const errors = [];
const warnings = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

/**
 * Extract bullet items from a markdown section by heading.
 * Returns array of stripped one-line items.
 */
function extractBullets(md, headingRegex) {
  if (!md) return [];
  const m = md.match(headingRegex);
  if (!m) return [];
  const start = m.index + m[0].length;
  const after = md.slice(start);
  const next = after.search(/\n#{1,3}\s+/);
  const section = next === -1 ? after : after.slice(0, next);

  const items = [];
  for (const line of section.split(/\r?\n/)) {
    const m2 = line.match(/^\s*-\s+(.+)/);
    if (m2) items.push(m2[1].replace(/[`*]/g, "").trim());
  }
  return items;
}

/**
 * Get the "key" (first 5 words, lowercased) of a bullet — used to match
 * paraphrased copies across files. Different wordings of the same rule should
 * still share the first few keywords.
 */
function keyOf(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s→]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

// ----------------------------------------------------------------
// Two-tier propagation model (2026-06 refactor)
//
//   1. GENERATED mirrors — .cursor/rules/project.mdc + project-conventions
//      SKILL.md carry the FULL canonical NEVER/ALWAYS blocks verbatim between
//      <!-- BEGIN:… --> / <!-- END:… --> markers, produced by
//      generate-mirrors.js. For these we do a STRICT check: re-run the
//      generator in-memory and assert the on-disk file already equals the
//      regenerated output. Any difference = stale → ERROR + "run
//      generate-mirrors.js". Drift on these two is structurally impossible
//      once regenerated.
//
//   2. HAND-CURATED CLAUDE.md — deliberately abbreviated, NOT generated.
//      We can't byte-compare it, so we keep a CONTENT-PRESENCE check: every
//      SECURITY NEVER rule from conventions.md must have a keyword match
//      somewhere in CLAUDE.md (security must always propagate → ERROR if
//      missing); non-security rules may be omitted from the summary (WARNING).
//
// The keyword-signature helpers below now serve tier 2 only.
// ----------------------------------------------------------------

// Tokens that carry no discriminating meaning — stripped before matching so
// paraphrases ("focus on" vs "focus") still line up.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "with", "without", "from",
  "and", "or", "as", "at", "by", "is", "be", "use", "using", "used", "add",
  "into", "that", "this", "when", "any", "no", "not", "only", "your", "their",
  "after", "before", "each", "all", "via", "per", "etc", "eg", "ie", "vs",
]);

// The left-hand side of a rule is the part before the "→" arrow — the actual
// prohibition/requirement. The right-hand side is the remedy and varies more
// across paraphrases, so we key on the LHS.
function lhsOf(rule) {
  const arrowIdx = rule.search(/[→]|->/);
  return arrowIdx === -1 ? rule : rule.slice(0, arrowIdx);
}

// Light stem: drop a trailing plural/3rd-person "s" and common "-ing"/"-ed"
// endings so paraphrases line up ("comparison"≈"compare", "tokens"≈"token",
// "sanitising"≈"sanitise"). Crude but dependency-free and good enough for
// keyword-overlap matching.
function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith("ion")) s = s.slice(0, -3); // comparison→compar
  if (s.length > 4 && (s.endsWith("e") || s.endsWith("y"))) s = s.slice(0, -1); // compare→compar, query→quer
  return s;
}

// Reduce a rule's LHS to a sorted set of meaningful (stemmed) keyword tokens.
function keywordSig(rule) {
  return new Set(
    lhsOf(rule)
      .toLowerCase()
      .replace(/[`*_]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem)
      .filter((w) => w.length > 1),
  );
}

// Two rules match when their keyword signatures overlap "enough": at least
// 60% of the smaller signature's tokens appear in the larger. This tolerates
// paraphrasing/abbreviation (e.g. "OrderGroupId" vs "OrderGroupId/wishlist
// owner") while still catching a genuinely different rule.
function rulesMatch(sigA, sigB) {
  if (sigA.size === 0 || sigB.size === 0) return false;
  let overlap = 0;
  for (const t of sigA) if (sigB.has(t)) overlap++;
  const smaller = Math.min(sigA.size, sigB.size);
  return overlap / smaller >= 0.6;
}

// Short human-readable label for a rule (its LHS, trimmed).
function ruleLabel(rule) {
  const lhs = lhsOf(rule).trim();
  return lhs.length > 70 ? lhs.slice(0, 67) + "…" : lhs;
}

// Tier 2 (CLAUDE.md) — a SECURITY rule must always propagate. These hints flag
// which conventions.md NEVER bullets are security-relevant.
const SECURITY_HINTS = [
  "csrf", "antiforgery", "token", "otp", "spawn", "shell", "path.combine",
  "graphql", "sql", "webhook", "hmac", "signature", "credential", "secret",
  "pii", "ex.message", "returnurl", "customerid", "ordergroupid", "auth",
  "[authorize]", "rate limit", "task.run", "servicescope", "fixedtimeequals",
];
function looksSecurity(rule) {
  const l = rule.toLowerCase();
  return SECURITY_HINTS.some((h) => l.includes(h));
}

// ----------------------------------------------------------------
// Tier 1 — STRICT generated-mirror check.
//
// Re-run the generator's pure transform in-memory and assert the on-disk file
// already equals it. Because the generator only ever rewrites the marked
// regions, any difference means the marked NEVER/ALWAYS block is stale (or a
// marker was removed) — an ERROR that `node .claude/scripts/generate-mirrors.js`
// fixes. No fuzzy matching: byte-equality or bust.
// ----------------------------------------------------------------
// Copilot/open-standard mirrors are optional — a branch without the .github/
// + AGENTS.md tree just has nothing to check (matches generate-mirrors.js).
const OPTIONAL_MIRRORS = new Set([".github/copilot-instructions.md", "AGENTS.md"]);

function checkGeneratedMirror(rel, blocks) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    if (OPTIONAL_MIRRORS.has(rel)) {
      warnings.push(`${rel} not present (optional Copilot mirror) — skipped`);
      return;
    }
    errors.push(`${rel} missing — cannot verify generated mirror`);
    return;
  }
  const onDisk = fs.readFileSync(abs, "utf8");
  for (const key of ["NEVER", "ALWAYS"]) {
    if (!onDisk.includes(MARKERS[key].begin) || !onDisk.includes(MARKERS[key].end)) {
      errors.push(
        `${rel}: missing ${key} BEGIN/END markers — run "node .claude/scripts/generate-mirrors.js" after wrapping the block`,
      );
      return;
    }
  }
  let expected;
  try {
    expected = applyToContent(onDisk, blocks);
  } catch (e) {
    errors.push(`${rel}: ${e.message}`);
    return;
  }
  if (expected !== onDisk) {
    errors.push(
      `${rel}: generated NEVER/ALWAYS block is STALE — run "node .claude/scripts/generate-mirrors.js" to regenerate from conventions.md`,
    );
  }
}

// ----------------------------------------------------------------
// Tier 2 — CLAUDE.md content-presence check.
//
// CLAUDE.md is hand-curated and abbreviated, so we don't byte-compare. Instead:
//   - SECURITY NEVER rules MUST appear (keyword match) somewhere in CLAUDE.md →
//     missing = ERROR (security must always propagate).
//   - non-security rules MAY be omitted from the summary → missing = WARNING.
// ----------------------------------------------------------------
function checkClaudeMdPresence(claudeText, canonNever) {
  if (!claudeText) return; // missing-file error raised elsewhere
  const claudeSigs = allRuleLikeLines(claudeText).map(keywordSig);
  for (const rule of canonNever) {
    const sig = keywordSig(rule);
    const present = claudeSigs.some((cs) => rulesMatch(sig, cs));
    if (present) continue;
    if (looksSecurity(rule)) {
      errors.push(
        `CLAUDE.md: SECURITY NEVER rule not propagated — "${ruleLabel(rule)}" [security must always propagate]`,
      );
    } else {
      warnings.push(
        `CLAUDE.md: NEVER rule omitted from summary — "${ruleLabel(rule)}" (allowed: CLAUDE.md is abbreviated)`,
      );
    }
  }
}

// Every `- ` bullet AND every markdown heading in a doc — the pool used for the
// CLAUDE.md keyword-presence scan (does this canonical rule appear anywhere?).
function allRuleLikeLines(md) {
  if (!md) return [];
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const b = line.match(/^\s*-\s+(.+)/);
    if (b) out.push(b[1].replace(/[`*]/g, "").trim());
    const h = line.match(/^#{1,4}\s+(.+)/);
    if (h) out.push(h[1].replace(/[`*#]/g, "").trim());
  }
  return out;
}

// ----------------------------------------------------------------
// 1. Source of truth
// ----------------------------------------------------------------
const conventionsMd = read(".ai/docs/conventions.md");
if (!conventionsMd) {
  errors.push(".ai/docs/conventions.md missing — cannot run propagation check");
  finish();
}

const conventionsNever = extractBullets(conventionsMd, /^##\s+NEVER Do/m);
const conventionsAlways = extractBullets(conventionsMd, /^##\s+ALWAYS Do/m);

if (conventionsNever.length === 0) {
  errors.push("conventions.md: ## NEVER Do section is empty");
}
if (conventionsAlways.length === 0) {
  errors.push("conventions.md: ## ALWAYS Do section is empty");
}

// ----------------------------------------------------------------
// 2. CLAUDE.md (root) — must mention NEVER + ALWAYS
// ----------------------------------------------------------------
const claudeMd = read("CLAUDE.md");
if (!claudeMd) {
  errors.push("CLAUDE.md (root) missing");
} else {
  if (!/^###\s+NEVER/m.test(claudeMd)) {
    warnings.push("CLAUDE.md: missing ### NEVER section");
  }
  if (!/^###\s+ALWAYS/m.test(claudeMd)) {
    warnings.push("CLAUDE.md: missing ### ALWAYS section");
  }
}

// ----------------------------------------------------------------
// 3. .cursor/rules/project.mdc — must mention NEVER + ALWAYS
// ----------------------------------------------------------------
const cursorRules = read(".cursor/rules/project.mdc");
if (!cursorRules) {
  errors.push(".cursor/rules/project.mdc missing");
} else {
  if (!/###\s+NEVER/.test(cursorRules)) {
    warnings.push(".cursor/rules/project.mdc: missing ### NEVER section");
  }
  if (!/###\s+ALWAYS/.test(cursorRules)) {
    warnings.push(".cursor/rules/project.mdc: missing ### ALWAYS section");
  }
}

// ----------------------------------------------------------------
// 4. project-conventions skill — must mention NEVER + ALWAYS
// ----------------------------------------------------------------
const skillMd = read(".claude/skills/project-conventions/SKILL.md");
if (!skillMd) {
  errors.push(".claude/skills/project-conventions/SKILL.md missing");
} else {
  if (!/##\s+NEVER Do/.test(skillMd)) {
    warnings.push("project-conventions/SKILL.md: missing ## NEVER Do section");
  }
}

// ----------------------------------------------------------------
// 5. Output style — must NOT redeclare NEVER/ALWAYS as bullet list
//    (it should reference conventions.md instead).
//    Resolved from settings.json outputStyle so the check survives a
//    project rename (new projects create output-styles/<project>.md).
// ----------------------------------------------------------------
let styleName = "nsc";
try {
  const s = JSON.parse(read(".claude/settings.json") || "{}");
  if (s.outputStyle) styleName = String(s.outputStyle).toLowerCase();
} catch {}
const styleRel = `.claude/output-styles/${styleName}.md`;
const nscStyle = read(styleRel);
if (!nscStyle) {
  errors.push(`${styleRel} missing (settings.json outputStyle = "${styleName}")`);
} else {
  // It should reference conventions.md
  if (!/conventions\.md/.test(nscStyle)) {
    warnings.push(`${styleName}.md: should reference .ai/docs/conventions.md`);
  }
  // It should NOT have its own ## NEVER section that duplicates rules
  // (single bullet list of ~5+ items is the smell)
  const styleNever = extractBullets(nscStyle, /^##\s+NEVER Do/m);
  if (styleNever.length >= 5) {
    warnings.push(
      `${styleName}.md: appears to redeclare NEVER rules (${styleNever.length} bullets) — should reference conventions.md instead`,
    );
  }
}

// ----------------------------------------------------------------
// 6. inject-context.js — must read from conventions.md (no hardcoded list)
// ----------------------------------------------------------------
const injectJs = read(".claude/hooks/inject-context.js");
if (!injectJs) {
  errors.push(".claude/hooks/inject-context.js missing");
} else {
  if (!/readFileSync\([^)]*conventions/.test(injectJs)) {
    errors.push(
      "inject-context.js: should read .ai/docs/conventions.md dynamically (look for readFileSync(conventionsPath))",
    );
  }
  if (/NEVER:[\s\S]{50,500}-\s+Hardcode/.test(injectJs)) {
    warnings.push(
      "inject-context.js: appears to have hardcoded NEVER/ALWAYS list — should read from conventions.md",
    );
  }
}

// ----------------------------------------------------------------
// 7. propagation-reminder.js — map should reference downstreams that exist
// ----------------------------------------------------------------
const reminderJs = read(".claude/hooks/propagation-reminder.js");
if (!reminderJs) {
  errors.push(".claude/hooks/propagation-reminder.js missing");
} else {
  const mustMention = [
    ".cursor/rules/project.mdc",
    "project-conventions/SKILL.md",
    `output-styles/${styleName}.md`,
    "inject-context.js",
  ];
  for (const target of mustMention) {
    if (!reminderJs.includes(target)) {
      warnings.push(
        `propagation-reminder.js: 'conventions.md' downstream list missing reference to '${target}'`,
      );
    }
  }
}

// ----------------------------------------------------------------
// 8a. Skills frontmatter audit — read-only skills must declare allowed-tools
// ----------------------------------------------------------------
const READ_ONLY_SKILLS = [
  "code-review",
  "explain-code",
  "frontend-design",
  "project-conventions",
  "security-review",
  "refactor-guide",
];
for (const skill of READ_ONLY_SKILLS) {
  const md = read(`.claude/skills/${skill}/SKILL.md`);
  if (!md) {
    warnings.push(`skills/${skill}/SKILL.md missing`);
    continue;
  }
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    warnings.push(`skills/${skill}/SKILL.md: no frontmatter block`);
    continue;
  }
  if (!/^allowed-tools:/m.test(fm[1])) {
    warnings.push(
      `skills/${skill}/SKILL.md: missing 'allowed-tools' frontmatter — read-only skills should whitelist tools (Read, Grep, Glob, WebFetch)`,
    );
  }
}

// ----------------------------------------------------------------
// 8b. Explore agent must exist if any skill declares 'agent: Explore'
// ----------------------------------------------------------------
const skillsDir = path.join(ROOT, ".claude/skills");
if (fs.existsSync(skillsDir)) {
  const skillFolders = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const usesExplore = [];
  for (const s of skillFolders) {
    const md = read(`.claude/skills/${s}/SKILL.md`);
    if (md && /^agent:\s*Explore\b/im.test(md)) usesExplore.push(s);
  }
  if (usesExplore.length > 0) {
    const exploreAgent = read(".claude/agents/explore.md");
    if (!exploreAgent) {
      errors.push(
        `Skills [${usesExplore.join(", ")}] declare 'agent: Explore' but .claude/agents/explore.md is missing`,
      );
    }
  }
}

// ----------------------------------------------------------------
// 8c. Cursor MCP parity with Claude — same servers should be enabled
// ----------------------------------------------------------------
const claudeSettings = read(".claude/settings.json");
const cursorMcp = read(".cursor/mcp.json");
if (claudeSettings && cursorMcp) {
  try {
    const cs = JSON.parse(claudeSettings);
    const cm = JSON.parse(cursorMcp);
    const claudeServers = new Set(cs.enabledMcpjsonServers || []);
    const cursorServers = new Set(Object.keys(cm.mcpServers || {}));
    for (const s of claudeServers) {
      if (!cursorServers.has(s)) {
        warnings.push(
          `MCP parity: '${s}' enabled in .claude/settings.json but missing from .cursor/mcp.json`,
        );
      }
    }
  } catch (e) {
    warnings.push(`MCP parity check failed: ${e.message}`);
  }
}

// ----------------------------------------------------------------
// 8d. Cursor memory folder — should exist if Claude has agent-memory
// ----------------------------------------------------------------
if (fs.existsSync(path.join(ROOT, ".claude/agent-memory"))) {
  if (!fs.existsSync(path.join(ROOT, ".cursor/memory"))) {
    warnings.push(
      ".cursor/memory/ missing — Claude has .claude/agent-memory/, Cursor side should mirror per-agent notes",
    );
  }
}

// ----------------------------------------------------------------
// 9. Sanity: CLAUDE.md (hand-curated summary) count shouldn't exceed canonical.
//    project.mdc / SKILL.md counts are enforced exactly by the strict check
//    below, so no count heuristic is needed for them.
// ----------------------------------------------------------------
const claudeNever = claudeMd ? extractBullets(claudeMd, /^###\s+NEVER/m) : [];

if (claudeNever.length > 0 && claudeNever.length > conventionsNever.length + 3) {
  warnings.push(
    `CLAUDE.md NEVER count (${claudeNever.length}) exceeds conventions.md (${conventionsNever.length}) — may be out of sync`,
  );
}

// ----------------------------------------------------------------
// 9b. Tier 1 — STRICT generated-mirror check (project.mdc + SKILL.md)
//
// These two carry the FULL canonical NEVER/ALWAYS verbatim between markers.
// Re-run the generator logic in-memory; on-disk content MUST already equal it.
// Any difference = stale → ERROR pointing at generate-mirrors.js. This makes
// drift on the two mirrors structurally impossible (vs. the old fuzzy diff,
// which the 2026-05-29 audit showed could miss silent rule swaps).
// ----------------------------------------------------------------
let canonBlocks = null;
try {
  canonBlocks = buildBlocks(conventionsMd);
} catch (e) {
  errors.push(`generate-mirrors source error: ${e.message}`);
}
if (canonBlocks) {
  const condensedCanonBlocks = {
    NEVER: condenseBlock(canonBlocks.NEVER),
    ALWAYS: condenseBlock(canonBlocks.ALWAYS),
  };
  for (const rel of [
    ".cursor/rules/project.mdc",
    ".claude/skills/project-conventions/SKILL.md",
    ".github/copilot-instructions.md",
    "AGENTS.md",
  ]) {
    const isCondensed = CONDENSED_TARGETS.some(
      (t) => path.relative(ROOT, t).replace(/\\/g, "/") === rel.replace(/\\/g, "/"),
    );
    checkGeneratedMirror(rel, isCondensed ? condensedCanonBlocks : canonBlocks);
  }
}

// ----------------------------------------------------------------
// 9c. Tier 2 — CLAUDE.md content-presence (hand-curated, NOT generated)
//
// CLAUDE.md is an abbreviated, hand-maintained summary. Every SECURITY NEVER
// rule from conventions.md must still surface somewhere in it (ERROR if not);
// ordinary rules may be omitted (WARNING only).
// ----------------------------------------------------------------
checkClaudeMdPresence(claudeMd, conventionsNever);

// ----------------------------------------------------------------
// Report
// ----------------------------------------------------------------
function finish() {
  console.log("\n━━━ Propagation Chain Check ━━━");
  console.log(`Source: .ai/docs/conventions.md`);
  console.log(`  NEVER items:  ${conventionsNever.length}`);
  console.log(`  ALWAYS items: ${conventionsAlways.length}`);
  console.log("");
  console.log("Downstream files checked:");
  console.log("  CLAUDE.md (root)");
  console.log("  .cursor/rules/project.mdc");
  console.log("  .claude/skills/project-conventions/SKILL.md");
  console.log(`  .claude/output-styles/${styleName}.md (from settings.json outputStyle)`);
  console.log("  .claude/hooks/inject-context.js");
  console.log("  .claude/hooks/propagation-reminder.js");
  console.log("  .claude/skills/*/SKILL.md (allowed-tools frontmatter)");
  console.log("  .claude/agents/explore.md (referenced by fork-context skills)");
  console.log("  .cursor/mcp.json (MCP parity)");
  console.log("  .cursor/memory/ (parity with .claude/agent-memory/)");
  console.log("  project.mdc / project-conventions/SKILL.md");
  console.log("    └─ STRICT generated-mirror check (must equal generate-mirrors.js output)");
  console.log("  CLAUDE.md");
  console.log("    └─ content-presence check (every SECURITY NEVER must appear)");
  console.log("");

  if (errors.length === 0 && warnings.length === 0) {
    console.log("✓ All consistent. No drift detected.\n");
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log("ERRORS (must fix):");
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log("");
  }
  if (warnings.length > 0) {
    console.log("WARNINGS (should review):");
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    console.log("");
  }

  console.log(`See .ai/docs/kit-process.md (Mandatory Update Propagation) for the full chain.`);
  process.exit(errors.length > 0 ? 1 : 0);
}

finish();
