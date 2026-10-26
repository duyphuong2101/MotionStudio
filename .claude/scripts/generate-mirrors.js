#!/usr/bin/env node
/**
 * Generate the NEVER / ALWAYS rule mirrors from the single source of truth.
 *
 * Source:  .ai/docs/conventions.md  (## NEVER Do  +  ## ALWAYS Do)
 * Targets (FULL block): .cursor/rules/project.mdc
 *                        .claude/skills/project-conventions/SKILL.md
 *                        AGENTS.md   (open agent standard — Copilot coding agent, Codex, Zed, Jules, …;
 *                                     read once per agent run, not per-chat-turn, so full detail is cheap)
 * Target  (CONDENSED):  .github/copilot-instructions.md — Copilot sends this file's full text on
 *                        EVERY chat/agent turn in VS Code/Visual Studio (unlike AGENTS.md, which the
 *                        coding agent reads once). Token cost compounds per-message, so this target
 *                        gets a compact one-line-per-rule form instead of the full canonical text —
 *                        same rules, ~40% fewer tokens. Full detail always lives in AGENTS.md.
 *
 * Each target carries HTML-comment markers wrapping its NEVER and ALWAYS
 * blocks. This script replaces ONLY the text BETWEEN those markers with the
 * canonical (or condensed) block — everything outside the markers is preserved
 * byte-for-byte. Re-running on an already-synced file produces no diff
 * (idempotent), so drift on these mirrors becomes impossible.
 *
 * Run:
 *   node .claude/scripts/generate-mirrors.js
 *
 * Exit 0 always (on success); throws + exit 1 on a structural error
 * (missing source section, missing markers in a target).
 *
 * The companion `.claude/scripts/check-propagation.js` re-runs this logic
 * in-memory and asserts the on-disk marked regions match exactly.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CONVENTIONS = path.join(ROOT, ".ai/docs/conventions.md");

const FULL_TARGETS = [
  path.join(ROOT, ".cursor/rules/project.mdc"),
  path.join(ROOT, ".claude/skills/project-conventions/SKILL.md"),
  path.join(ROOT, "AGENTS.md"),
];
// Condensed targets = files injected on EVERY request/turn, where token cost
// compounds per-message. copilot-instructions.md (every Copilot chat turn) and
// project.mdc (Cursor injects on every request, alwaysApply:true) both qualify.
// AGENTS.md stays FULL — it's read once per coding-agent run, not per turn.
const CONDENSED_TARGETS = [
  path.join(ROOT, ".github/copilot-instructions.md"),
  path.join(ROOT, ".cursor/rules/project.mdc"),
];
const TARGETS = [...FULL_TARGETS, ...CONDENSED_TARGETS];

// Core mirrors must always exist (missing = real error). The Copilot/open-standard
// mirrors are optional — a feature branch that never added the .github/ + AGENTS.md
// tree simply has nothing to sync; skip with a warning rather than hard-failing.
const OPTIONAL_TARGETS = new Set([
  path.join(ROOT, ".github/copilot-instructions.md"),
  path.join(ROOT, "AGENTS.md"),
]);

// Marker text — exported so check-propagation.js can share the exact strings.
const MARKERS = {
  NEVER: {
    begin: "<!-- BEGIN:NEVER (generated from conventions.md — do not edit) -->",
    end: "<!-- END:NEVER -->",
  },
  ALWAYS: {
    begin: "<!-- BEGIN:ALWAYS (generated from conventions.md — do not edit) -->",
    end: "<!-- END:ALWAYS -->",
  },
};

/**
 * Extract the verbatim body of a `## <Heading>` section from conventions.md —
 * everything between the heading line and the next `## ` heading, with leading
 * and trailing blank lines trimmed. Line endings are normalised to "\n" so the
 * generated block is stable regardless of the source file's EOL style.
 */
function extractSection(md, headingRegex) {
  const m = md.match(headingRegex);
  if (!m) {
    throw new Error(
      `generate-mirrors: heading ${headingRegex} not found in conventions.md`,
    );
  }
  const start = m.index + m[0].length;
  const after = md.slice(start);
  const next = after.search(/\r?\n##\s+/);
  const raw = next === -1 ? after : after.slice(0, next);
  const body = raw.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  if (!body) {
    throw new Error(`generate-mirrors: section ${headingRegex} is empty`);
  }
  return body;
}

/**
 * Build the canonical NEVER and ALWAYS blocks from conventions.md.
 * Returned strings are the exact text that belongs between the markers.
 */
function buildBlocks(conventionsMd) {
  return {
    NEVER: extractSection(conventionsMd, /^##\s+NEVER Do[^\n]*\n/m),
    ALWAYS: extractSection(conventionsMd, /^##\s+ALWAYS Do[^\n]*\n/m),
  };
}

/**
 * Condense a NEVER/ALWAYS block for token-cost-sensitive targets (currently only
 * .github/copilot-instructions.md, sent on every chat turn): collapse each
 * top-level bullet's multi-line explanation to one line, and drop the nested
 * sub-numbered list under "SSR-first rendering hierarchy" to a single summary
 * line (full detail stays in the FULL targets — AGENTS.md, project.mdc, etc.).
 * Rule TEXT is never altered — only the multi-line -> one-line collapsing.
 */
function condenseBlock(block) {
  const lines = block.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Drop the nested "  1. **Pure SSR**..." sub-list under SSR-first — replace
    // with a compact inline summary on the parent bullet, then skip the sub-lines.
    if (/^-\s+\*\*SSR-first rendering hierarchy\*\*/.test(line)) {
      out.push(
        "- **SSR-first rendering hierarchy** — pick the LEAST client-side option: Pure SSR (preferred) → Hybrid SSR + Vue islands → Full client-side Vue (last resort, Razor skeleton first). Full detail: AGENTS.md.",
      );
      // Skip the following indented sub-list lines (they start with 2+ spaces).
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) i++;
      continue;
    }
    // A standalone bold sub-heading line (e.g. "**Security (NEVER...):**") — keep as-is, it's already one line.
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Replace the content between a BEGIN/END marker pair with `block`.
 * Preserves the marker lines and everything outside them. The replacement is
 * always rendered as:  BEGIN \n <block> \n END   so output is deterministic.
 */
function replaceRegion(content, marker, block) {
  const beginIdx = content.indexOf(marker.begin);
  const endIdx = content.indexOf(marker.end);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `generate-mirrors: markers ${marker.begin} / ${marker.end} not found — ` +
        `wrap the block first`,
    );
  }
  if (endIdx < beginIdx) {
    throw new Error(
      `generate-mirrors: END marker precedes BEGIN marker (${marker.begin})`,
    );
  }
  const before = content.slice(0, beginIdx + marker.begin.length);
  const after = content.slice(endIdx);
  return `${before}\n${block}\n${after}`;
}

/**
 * Produce the fully-synced version of a target file's content as a string,
 * given the canonical blocks. Pure (no I/O) so check-propagation.js can call
 * it on already-read content.
 */
function applyToContent(content, blocks) {
  let out = replaceRegion(content, MARKERS.NEVER, blocks.NEVER);
  out = replaceRegion(out, MARKERS.ALWAYS, blocks.ALWAYS);
  return out;
}

function main() {
  const conventionsMd = fs.readFileSync(CONVENTIONS, "utf8");
  const blocks = buildBlocks(conventionsMd);
  const condensedBlocks = {
    NEVER: condenseBlock(blocks.NEVER),
    ALWAYS: condenseBlock(blocks.ALWAYS),
  };

  let changed = 0;
  for (const target of TARGETS) {
    const rel = path.relative(ROOT, target);
    if (!fs.existsSync(target)) {
      if (OPTIONAL_TARGETS.has(target)) {
        console.log(`  ⚠ skipped ${rel} (not present — optional Copilot mirror)`);
        continue;
      }
      throw new Error(`generate-mirrors: target missing — ${rel}`);
    }
    const useBlocks = CONDENSED_TARGETS.includes(target) ? condensedBlocks : blocks;
    const original = fs.readFileSync(target, "utf8");
    const updated = applyToContent(original, useBlocks);
    if (updated !== original) {
      fs.writeFileSync(target, updated);
      changed++;
      console.log(`  ✎ updated ${rel}`);
    } else {
      console.log(`  ✓ in sync ${rel}`);
    }
  }
  console.log(
    changed === 0
      ? "✓ Mirrors already in sync (no changes)."
      : `✓ Regenerated ${changed} mirror(s) from conventions.md.`,
  );
}

// Exported for check-propagation.js (strict in-memory comparison).
module.exports = { buildBlocks, condenseBlock, applyToContent, replaceRegion, MARKERS, FULL_TARGETS, CONDENSED_TARGETS };

if (require.main === module) {
  try {
    console.log("━━━ Generate mirrors (NEVER/ALWAYS) ━━━");
    main();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
