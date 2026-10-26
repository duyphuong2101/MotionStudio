#!/usr/bin/env node
/**
 * PostToolUse hook for Edit/Write.
 * Warns when .ai/docs/* files are modified — reminds to propagate
 * changes to .claude/agents, .claude/skills, .cursor/rules, .cursor/skills.
 *
 * Stdin JSON: { tool_name, tool_input: { file_path, ... }, ... }
 * Stdout (text): non-blocking warning shown after the tool run.
 */

let chunks = "";
process.stdin.on("data", (c) => (chunks += c));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(chunks || "{}");
  } catch {
    process.exit(0);
  }

  // Claude payload: tool_input.file_path; Cursor afterFileEdit: top-level file_path/path
  const filePath = (data.tool_input?.file_path || data.file_path || data.path || "").replace(/\\/g, "/");
  if (!filePath) process.exit(0);

  // Match either absolute (.../​.ai/docs/...) or relative (.ai/docs/...) paths
  const isAiDocs = /(^|\/)\.ai\/docs\//.test(filePath);
  if (!isAiDocs) process.exit(0);

  const fileName = filePath.split("/").pop();
  const propagationMap = {
    "conventions.md": [
      ".cursor/rules/project.mdc — NEVER/ALWAYS section",
      ".claude/skills/project-conventions/SKILL.md",
      ".claude/output-styles/motion-studio.md — rules reference (if section was rewritten)",
      "node .claude/scripts/generate-mirrors.js (AGENTS.md, copilot-instructions.md, project.mdc, project-conventions/SKILL.md)",
      ".claude/agents/senior-dev.md self-review checklist",
      ".claude/hooks/inject-context.js — NEVER/ALWAYS lines",
    ],
    "common-patterns.md": [
      ".cursor/rules/project.mdc — pattern count number",
      ".claude/skills/template-authoring or server-route SKILL.md",
    ],
    "architecture.md": [
      ".claude/agents/*.md and .cursor/agents/*.md if the pipeline, statuses or layout changed",
      ".claude/skills/template-authoring/SKILL.md if the template contract changed",
    ],
    "accessibility-ux.md": [
      ".ai/docs/conventions.md accessibility section",
      ".claude/skills/frontend-design/SKILL.md",
    ],
  };

  // file-index.md is read directly by agents — no propagation needed, skip reminder entirely
  const targets = propagationMap[fileName];
  if (!targets) process.exit(0);

  const msg = [
    "⚠ .ai/docs/" + fileName + " changed — propagate to:",
    ...targets.map((t) => "  • " + t),
    "  See .ai/docs/kit-process.md → Mandatory Update Propagation.",
  ].join("\n");

  // Plain PostToolUse stdout is NOT injected into Claude's context — must use
  // hookSpecificOutput.additionalContext (same as security-lint.js).
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
    })
  );
});
