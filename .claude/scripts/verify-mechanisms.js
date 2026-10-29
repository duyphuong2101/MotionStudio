#!/usr/bin/env node
// verify-mechanisms.js — self-test for the "judgment-layer" mechanisms wired into
// the kit: spec-first · AI-generated-code review lens · AI failure log · publish gate ·
// architecture diagram · failure teardown (via AI-failure-log + Loop Journal + retro) ·
// stakeholder explainer · agent-hosts mirror · security guards.
// Complements check-propagation.js (NEVER/ALWAYS drift) and spec-lint.js (frontmatter):
// those verify the RULE set; this verifies the MECHANISMS are wired + runnable + mirrored.
//
// Exit 0 = all mechanisms healthy; exit 1 = at least one broken/undermirrored.
// Run: node .claude/scripts/verify-mechanisms.js   (or /verify-config)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = (() => {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();

let failures = 0;
const results = []; // { mech, name, ok, detail }

function record(mech, name, ok, detail) {
  results.push({ mech, name, ok, detail });
  if (!ok) failures++;
}

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return null; }
}

// Assert every file in `files` contains `needle` (case-insensitive substring —
// we verify the mechanism is REFERENCED, not exact casing).
function assertReferenced(mech, needle, files) {
  const n = needle.toLowerCase();
  for (const f of files) {
    const c = read(f);
    const ok = c != null && c.toLowerCase().includes(n);
    record(mech, `${f} references "${needle.slice(0, 40)}"`, ok,
      c == null ? 'file missing' : (ok ? '' : 'reference absent'));
  }
}

// On Windows a bare `bash` from cmd.exe is often WSL's System32 stub (exit 1 with no distro installed),
// so look for a real one: next to `git --exec-path` (<Git>/mingw64/libexec/git-core), the usual Git install
// folders, then any bash on PATH that is not the System32 / WindowsApps stub. null = none found.
function gitBash() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [];
  try {
    const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 10000 }).trim();
    if (/^[A-Za-z]:[\\/]/.test(exec)) candidates.push(path.join(exec, '..', '..', '..', 'bin', 'bash.exe'));
  } catch {}
  for (const base of [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (base) candidates.push(path.join(base, 'Git', 'bin', 'bash.exe'));
  }
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  try {
    const found = execFileSync('where', ['bash'], { encoding: 'utf8', timeout: 10000 }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    candidates.push(...found.filter((p) => !/[\\/](System32|WindowsApps)[\\/]/i.test(p)));
  } catch {}
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Run a script and assert exit code (2 = block, 1 = validation reject, 0 = ok).
function runExpect(mech, name, cmd, args, expectCode, stdin) {
  let code = 0;
  try {
    execFileSync(cmd, args, { cwd: ROOT, input: stdin, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { code = e.status == null ? -1 : e.status; }
  record(mech, name, code === expectCode, `exit ${code}, expected ${expectCode}`);
}

// ── 1. AI FAILURE LOG ────────────────────────────────────────────────────────
{
  const M = 'AI-failure-log';
  const scriptExists = fs.existsSync(path.join(ROOT, '.claude/scripts/append-ai-failure.js'));
  record(M, 'append-ai-failure.js exists', scriptExists, scriptExists ? '' : 'writer script missing');
  if (scriptExists) {
    // valid category accepted (writes a throwaway entry, then we trim it)
    runExpect(M, 'accepts valid entry', 'node',
      ['.claude/scripts/append-ai-failure.js', '--category', 'other', '--description', '__verify_probe__', '--caught-by', 'user'], 0);
    // invalid category rejected
    runExpect(M, 'rejects bad category', 'node',
      ['.claude/scripts/append-ai-failure.js', '--category', 'nope', '--description', 'x'], 1);
    // missing required field rejected
    runExpect(M, 'rejects missing description', 'node',
      ['.claude/scripts/append-ai-failure.js', '--category', 'other'], 1);
    // trim the probe entry so the log stays clean
    try {
      const p = path.join(ROOT, '.claude/state/ai-failure-log.ndjson');
      if (fs.existsSync(p)) {
        const kept = fs.readFileSync(p, 'utf8').split('\n').filter(l => l && !l.includes('__verify_probe__'));
        fs.writeFileSync(p, kept.length ? kept.join('\n') + '\n' : '');
      }
    } catch {}
  }
  assertReferenced(M, 'append-ai-failure', [
    '.claude/commands/ai-failure.md',
    '.claude/commands/workflow.md',
    '.claude/commands/retro-skills.md',
    '.claude/agents/senior-dev.md',
    '.claude/skills/code-review/SKILL.md',
    '.ai/docs/conventions.md',
    '.cursor/rules/workflow.mdc',
    '.cursor/agents/senior-dev.md',
  ]);
}

// ── 2. SPEC-FIRST ────────────────────────────────────────────────────────────
{
  const M = 'spec-first';
  assertReferenced(M, 'For whom / outcome', ['.ai/plans/plan-template.md']);
  assertReferenced(M, 'Options considered', ['.ai/plans/plan-template.md']);
  assertReferenced(M, 'Who is this for', [
    '.claude/commands/workflow.md',
    '.claude/agents/tech-lead.md',
    '.cursor/rules/workflow.mdc',
    '.cursor/agents/tech-lead.md',
  ]);
}

// ── 3. AI-GENERATED-CODE REVIEW LENS ─────────────────────────────────────────
{
  const M = 'review-lens';
  assertReferenced(M, 'hallucination check', [
    '.claude/skills/code-review/SKILL.md',
    '.claude/commands/workflow.md',
    '.cursor/rules/workflow.mdc',
    '.cursor/agents/explore.md',
  ]);
  assertReferenced(M, 'Product lens', ['.claude/skills/code-review/SKILL.md']);
}

// ── 4. PUBLISH GATE — not configured for this project: no push allow, no PR script ──
{
  const M = 'publish-gate';
  let allow = [];
  try { allow = JSON.parse(read('.claude/settings.json') || '{}').permissions?.allow || []; } catch {}
  const pushAllowed = allow.some((a) => /^Bash\(git push\b/.test(a));
  record(M, 'no git push allow in settings', !pushAllowed, pushAllowed ? 'remove the git push allow rule' : '');
}

// ── 5. ARCHITECTURE DIAGRAM (system-thinking artifact) ───────────────────────
{
  const M = 'architecture-diagram';
  assertReferenced(M, '## Architecture', ['.ai/plans/plan-template.md']);
  // tech-lead (both tools) + workflow must instruct filling it for Medium/High
  assertReferenced(M, '## Architecture', ['.claude/agents/tech-lead.md', '.cursor/agents/tech-lead.md']);
  assertReferenced(M, 'Architecture', ['.claude/commands/workflow.md', '.cursor/rules/workflow.mdc']);
}

// ── 6. FAILURE TEARDOWN (covered by AI failure log + Loop Journal + retro) ────
// No dedicated section — verify the covering mechanisms are still wired.
{
  const M = 'failure-teardown';
  const lt = read('.claude/commands/loop-ticket.md');
  record(M, 'loop-ticket Loop Journal records failure-signature', !!(lt && /Loop Journal/.test(lt) && /failure-signature|failure signature/i.test(lt)), '');
  const retro = read('.claude/commands/retro-skills.md');
  record(M, 'retro-skills mines ai-failure-log', !!(retro && retro.includes('ai-failure-log.ndjson')), '');
  record(M, 'retro-skills mines outcome-log', !!(retro && retro.includes('outcome-log.ndjson')), '');
}

// ── 7. STAKEHOLDER EXPLAINER (business-language summary) ──────────────────────
{
  const M = 'stakeholder-explainer';
  // release-evidence PR Summary must be stakeholder-facing
  const re = read('.claude/commands/release-evidence.md');
  record(M, 'release-evidence PR Summary is stakeholder-facing', !!(re && /stakeholder-facing|business language/i.test(re)), '');
  // "What the loop built" must lead with a plain-business-language sentence (both tools)
  assertReferenced(M, 'business-language', [
    '.ai/plans/plan-template.md',
    '.claude/commands/loop-ticket.md',
    '.cursor/commands/loop-ticket.md',
  ]);
}

// ── 8. GITHUB / COPILOT MIRROR (condensed — the 3rd platform) ────────────────
// GitHub .agent.md files are hand-authored condensed mirrors; verify the mechanisms
// reached them too (the platform most easily forgotten during propagation).
{
  const M = 'github-mirror';
  const tl = read('.github/agents/tech-lead.agent.md');
  record(M, 'tech-lead.agent.md has spec-first', !!(tl && /Who is this for/i.test(tl)), '');
  record(M, 'tech-lead.agent.md mentions Architecture section', !!(tl && tl.includes('`## Architecture`')), '');
  record(M, 'tech-lead.agent.md has stakeholder explainer', !!(tl && /business-language/i.test(tl)), '');
  const sd = read('.github/agents/senior-dev.agent.md');
  record(M, 'senior-dev.agent.md has hallucination check + failure log', !!(sd && /hallucination check/i.test(sd) && sd.includes('append-ai-failure')), '');
  const qa = read('.github/agents/qa.agent.md');
  record(M, 'qa.agent.md gate has AI-generated code lens', !!(qa && /hallucination check/i.test(qa)), '');
}

// ── 8b. AGENT HOSTS (.agents/ mirror for Codex, Antigravity, Copilot CLI) ────
{
  const M = 'agent-hosts';
  const sync = '.ai/scripts/sync-agent-hosts.js';
  const exists = fs.existsSync(path.join(ROOT, sync));
  record(M, 'sync-agent-hosts.js exists', exists, exists ? '' : 'generator missing');
  if (exists) runExpect(M, '.agents/ in sync (--check)', 'node', [sync, ROOT, '--check'], 0);
  assertReferenced(M, 'sync-agent-hosts', [
    '.claude/scripts/generate-mirrors.js',
    '.claude/scripts/check-propagation.js',
    'CLAUDE.md',
    '.claude/skills/update-propagation/SKILL.md',
    '.ai/docs/kit-process.md',
  ]);
  const vs = read('.ai/scripts/apply-vscode-settings.js');
  record(M, 'Copilot skips the .agents/skills duplicate', !!(vs && vs.includes('chat.agentSkillsLocations')), '');
}

// ── 9. SECURITY GUARDS (from 2026-07-21 review) ──────────────────────────────
{
  const M = 'security-guards';
  const bd = read('.claude/hooks/block-destructive.js');
  record(M, 'block-destructive covers single-file delete', !!(bd && /unlinkSync/.test(bd)), '');
  record(M, 'block-destructive covers protected-file writes', !!(bd && /Set-Content|Out-File/.test(bd)), '');
  const pf = read('.claude/hooks/protect-files.js');
  record(M, 'protect-files guards settings.local.json', !!(pf && pf.includes('settings(\\.local)?\\.json')), '');
  const af = read('.claude/hooks/auto-format.js');
  record(M, 'auto-format uses execFileSync (no shell interpolation)', !!(af && af.includes('execFileSync') && !af.includes("execSync(formatter")), '');
  const cdp = read('.claude/scripts/create-draft-pr.js');
  if (cdp) record(M, 'create-draft-pr confines file paths to repo', cdp.includes('confineToRepo'), '');
  record(M, 'block-destructive fails closed + token analyzer', !!(bd && bd.includes('function analyze') && /catch \(e\) \{[\s\S]{0,400}?process\.exit\(2\)/.test(bd)), '');
  const cbd = read('.cursor/hooks/block-destructive.js');
  record(M, 'Cursor block-destructive shares the Claude rule set', !!(cbd && cbd.includes("'.claude', 'hooks', 'block-destructive.js'")), '');
  const st = read('.claude/settings.json');
  record(M, 'quota-guard wired on Agent spawns', !!(st && st.includes('quota-guard.js') && fs.existsSync(path.join(ROOT, '.claude/hooks/quota-guard.js'))), '');
  const bash = gitBash();
  if (bash) runExpect(M, 'block-destructive harness green', bash, ['.claude/scripts/test-block-destructive.sh'], 0);
  else record(M, 'block-destructive harness green', false, 'Git Bash not found — install Git for Windows (https://git-scm.com/download/win) and rerun');
}

// ── REPORT ───────────────────────────────────────────────────────────────────
const byMech = {};
for (const r of results) (byMech[r.mech] ||= []).push(r);
console.log('\n  Mechanism self-test — judgment-layer + security guards\n');
for (const [mech, rs] of Object.entries(byMech)) {
  const bad = rs.filter(r => !r.ok).length;
  console.log(`  ${bad === 0 ? '✓' : '✗'} ${mech} (${rs.length - bad}/${rs.length})`);
  for (const r of rs.filter(r => !r.ok)) console.log(`      ✗ ${r.name} — ${r.detail}`);
}
console.log(`\n  ${failures === 0 ? '✓ ALL MECHANISMS HEALTHY' : `✗ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
