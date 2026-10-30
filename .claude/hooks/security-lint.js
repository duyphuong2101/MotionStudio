#!/usr/bin/env node
/**
 * PostToolUse hook — fires after every Edit/Write.
 * Scans the written file for high-risk security patterns drawn from the
 * 504-finding dual-model scan of the source kit (2026-05-13); generic web/Node patterns.
 *
 * On a hit: outputs a warning via additionalContext so Claude sees it and
 * can self-correct before the turn ends. Never blocks — always exits 0.
 *
 * Stdin JSON shape: { tool_name, tool_input: { file_path, content? }, cwd }
 */

'use strict';

const fs = require('fs');
const path = require('path');

let chunks = '';
process.stdin.on('data', (c) => (chunks += c));
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(chunks || '{}'); } catch { process.exit(0); }

  // Claude payload: tool_input.file_path; Cursor afterFileEdit: top-level file_path/path
  // Normalize \ → / so the substring skips below work on Windows paths too.
  const filePath = (data.tool_input?.file_path || data.file_path || data.path || '').replace(/\\/g, '/');
  if (!filePath) process.exit(0);

  // Only scan code files — skip docs, locks, binaries, snapshots, node_modules
  const ext = path.extname(filePath).toLowerCase();
  const SKIP_EXTS = new Set(['.lock', '.png', '.jpg', '.svg', '.ico', '.woff', '.ttf', '.eot', '.pdf', '.zip', '.md', '.mdc', '.mdx', '.txt', '.html']);
  if (SKIP_EXTS.has(ext)) process.exit(0);
  if (filePath.includes('node_modules')) process.exit(0);
  if (filePath.includes('playwright-report')) process.exit(0);
  if (filePath.includes('.claude/hooks/') || filePath.includes('.cursor/hooks/')) process.exit(0); // skip hook files — pattern strings cause self-false-positives

  let src = '';
  try { src = fs.readFileSync(filePath, 'utf8'); } catch { process.exit(0); }
  if (src.length > 300_000) process.exit(0); // skip huge generated files

  const findings = [];

  // ─── PATTERN REGISTRY ───────────────────────────────────────────────────────
  // Each entry: { id, severity, desc, fix, pattern (RegExp | fn(src) => bool) }

  // The text of every spawn(…) / spawnSync(…) call, parentheses matched.
  const spawnCalls = (src) => [...src.matchAll(/\bspawn(?:Sync)?\s*\(/g)].map((m) => {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    return src.slice(m.index, i + 1);
  });
  const inDir = (...dirs) => dirs.some((d) => filePath.includes(d));
  const PATTERNS = [

    // ── Injection ──
    {
      id: 'CMD_INJECTION_SHELL_TRUE',
      severity: 'CRITICAL',
      desc: 'spawn() called with shell:true — if any arg derives from user input this is RCE',
      fix: 'Use shell:false and build argv from an allowlist',
      // Each spawn( call read to its matching ")", so arguments like path.join(...) do not end the scan early.
      pattern: (src) => spawnCalls(src).some((c) => /shell\s*:\s*true/.test(c)),
    },
    {
      id: 'GRAPHQL_STRING_INTERP',
      severity: 'CRITICAL',
      desc: 'User-controlled value interpolated into GraphQL query string',
      fix: 'Use typed $variables in the query and pass values via the variables map',
      pattern: /`[^`]*\$\{[^}]*(?:vuid|eventType|action|userId|email|input)[^}]*\}[^`]*(?:query|mutation|gql)/i,
    },
    {
      id: 'PATH_COMBINE_USER_INPUT',
      severity: 'HIGH',
      desc: 'Path.Combine with a user-supplied parameter — path traversal risk',
      fix: 'Path.GetFileName(input) + verify Path.GetFullPath(result).StartsWith(root + sep)',
      pattern: /Path\.Combine\s*\([^)]*(?:file|fileName|name|input|param|request\.|model\.)[^)]*\)/i,
    },
    {
      id: 'SQL_STRING_CONCAT',
      severity: 'HIGH',
      desc: 'String concatenation into what looks like a SQL query',
      fix: 'Use parameterised queries / Dapper @param syntax',
      pattern: /(?:SELECT|INSERT|UPDATE|DELETE|WHERE)[^"'`\n]{0,80}["'`]\s*\+\s*(?:request|model|input|param|user)/i,
    },

    // ── Authentication ──
    {
      id: 'NULL_TOKEN_EQUALITY',
      severity: 'CRITICAL',
      desc: 'Token compared with == — null stored token matches null attacker input (auth bypass)',
      fix: 'Treat null/empty stored token as InvalidToken; use CryptographicOperations.FixedTimeEquals',
      pattern: /(?:ResetPasswordToken|AuthenticationCode|Token|Code)\s*(?:!=|==)\s*(?:request|reset|auth|check)\w*(?:Token|Code)/i,
    },
    {
      id: 'NON_CONSTANT_TIME_CMP',
      severity: 'HIGH',
      desc: 'API key / token / OTP compared with string.Equals or == — timing attack surface',
      fix: 'CryptographicOperations.FixedTimeEquals over UTF-8 bytes',
      pattern: /string\.Equals\s*\([^)]*(?:Key|Token|Secret|Code|Hmac|Signature)[^)]*\)|(?:Key|Token|Secret|Code)\s*==\s*(?:header|request|body|supplied)/i,
    },
    {
      id: 'HARDCODED_SECRET',
      severity: 'HIGH',
      desc: 'Hardcoded credential, API key, or password literal detected',
      fix: 'Read from process.env or IConfiguration; document in .env.example',
      pattern: /(?:password|apiKey|api_key|secret|token|credential)\s*(?:=|:)\s*["'][A-Za-z0-9@!$#%^&*_\-+=/]{8,}["']/i,
    },

    // ── Authorization & IDOR ──
    {
      id: 'MISSING_AUTHORIZE',
      severity: 'HIGH',
      desc: 'Controller class or action lacks [Authorize] / [AllowAnonymous] declaration',
      fix: 'Add [Authorize] (or explicit [AllowAnonymous]) to every controller that touches user data',
      // Flag C# controllers that have no [Authorize] and no [AllowAnonymous] at all
      pattern: (src) =>
        /class\s+\w+Controller/.test(src) &&
        !/\[Authorize/.test(src) &&
        !/\[AllowAnonymous\]/.test(src) &&
        /\[Http(?:Get|Post|Put|Delete|Patch)\]/.test(src),
    },
    {
      id: 'CLIENT_SUPPLIED_OWNER_ID',
      severity: 'HIGH',
      desc: 'CustomerId / OrderGroupId / CartName bound from request body without server-side override — IDOR risk',
      fix: 'Overwrite from CustomerContext.Current.CurrentContactId server-side; never trust client value',
      pattern: /(?:public\s+\w+\s+CustomerId|public\s+int\s+OrderGroupId|public\s+string\s+CartName)\s*\{\s*get;\s*set;\s*\}/,
    },

    // ── CSRF ──
    {
      id: 'STATE_CHANGING_GET',
      severity: 'HIGH',
      desc: '[HttpGet] action that writes/deletes/mutates — CSRF-able via <img> or link',
      fix: 'Convert to [HttpPost] + [ValidateAntiForgeryToken]',
      // HttpGet on an action whose name suggests mutation
      pattern: /\[HttpGet\][^{]{0,200}(?:Delete|Remove|Clear|Cancel|Update|Save|Set|Reset|Create|Add)\w*\s*\(/i,
    },
    {
      id: 'MISSING_ANTIFORGERY',
      severity: 'MEDIUM',
      desc: '[HttpPost] action without [ValidateAntiForgeryToken] in a non-[ApiController] context',
      fix: 'Add [ValidateAntiForgeryToken]; SameSite=None cookies mean cross-site POSTs succeed',
      pattern: (src) => {
        // Only flag MVC controllers (not [ApiController])
        if (/\[ApiController\]/.test(src)) return false;
        // Has [HttpPost] actions
        if (!/\[HttpPost\]/.test(src)) return false;
        // But no antiforgery anywhere in the file
        return !/ValidateAntiForgeryToken|AutoValidateAntiforgery/.test(src);
      },
    },
    {
      id: 'DISCARDED_ANTIFORGERY_RESULT',
      severity: 'MEDIUM',
      desc: 'IsRequestValidAsync result assigned but never used — dead CSRF check',
      fix: 'Branch on the result or remove the call and rely solely on [ValidateAntiForgeryToken]',
      pattern: /=\s*await\s+_antiforgery\.IsRequestValidAsync\b/,
    },

    // ── Open Redirect ──
    {
      id: 'OPEN_REDIRECT_REFERER',
      severity: 'HIGH',
      desc: 'returnUrl extracted from Referer header without Url.IsLocalUrl() validation',
      fix: 'Validate with Url.IsLocalUrl(returnUrl); fall back to "/" on failure',
      pattern: /(?:Referer|returnUrl|ReturnUrl)[^;\n]{0,120}Redirect\s*\(/i,
    },
    {
      id: 'OPEN_REDIRECT_QUERY',
      severity: 'HIGH',
      desc: 'returnUrl from query string forwarded to Redirect() without host/local check',
      fix: 'Url.IsLocalUrl(returnUrl) or allowlist of trusted hosts before Redirect()',
      pattern: /GetReturnUrl|Request\.Query\[["']returnUrl["']\][^;\n]{0,80}Redirect/i,
    },

    // ── Data Exposure ──
    {
      id: 'EX_MESSAGE_IN_RESPONSE',
      severity: 'HIGH',
      desc: 'ex.Message / exception detail returned to API caller — information disclosure',
      fix: 'Log server-side; return a generic error string to the client',
      pattern: /(?:ErrorMessage|Message|error)\s*=\s*(?:ex|exception|err)\.Message/i,
    },
    {
      id: 'PII_IN_LOG',
      severity: 'MEDIUM',
      desc: 'Full request model serialized into log — may contain PII (email, address, phone)',
      fix: 'Log opaque correlation ID only; never serialize user-facing request models',
      pattern: /_logger\.\w+\s*\([^)]*(?:Serialize|JsonConvert\.Serialize|model|request)\b/i,
    },
    {
      id: 'SECRET_IN_LOG',
      severity: 'HIGH',
      desc: 'HTTP request object (incl. headers/keys) written to logger',
      fix: 'Log path/method only, never the full request or its headers',
      pattern: /_logger\.\w+\s*\([^)]*(?:Request|HttpContext|Headers)/i,
    },

    // ── Resource Exhaustion / API Abuse ──
    {
      id: 'UNBOUNDED_TASK_WHENALL',
      severity: 'HIGH',
      desc: 'Task.WhenAll over user-controlled list with no count cap — DoS / quota amplification',
      fix: 'Enforce hard cap (e.g. ≤ 20) before Task.WhenAll; return BadRequest() above cap',
      pattern: /Task\.WhenAll\s*\(\s*\w+\.(?:Select|Map)\s*\(/,
    },
    {
      id: 'UNBOUNDED_LIST_CTOR',
      severity: 'HIGH',
      desc: 'new List<T>(userControlledInt) — attacker can trigger OOM with maxItems=Int32.MaxValue',
      fix: 'Math.Clamp(value, 1, MAX) before using as List capacity or loop bound',
      pattern: /new\s+List\s*<[^>]+>\s*\(\s*(?:maxItems|pageSize|count|limit|request\.\w+)\s*\)/i,
    },

    // ── Webhooks ──
    {
      id: 'UNSIGNED_WEBHOOK',
      severity: 'HIGH',
      desc: 'Webhook handler without HMAC signature verification — forged payloads accepted',
      fix: 'Read X-Signature header, HMAC-SHA256 over raw body with configured secret, reject on mismatch',
      pattern: (src) =>
        /(?:SaveReward|SaveReferred|Webhook|webhook)\w*\s*\(/.test(src) &&
        !/(?:Signature|Hmac|VerifySignature|X-Voucherify)/i.test(src),
    },

    // ── Node.js / QA Dashboard ──
    {
      id: 'NODE_HARDCODED_CRED',
      severity: 'HIGH',
      desc: 'Credential or token hardcoded in JavaScript/Node source',
      fix: 'Read from process.env; document expected vars in .env.example',
      pattern: /(?:password|apiKey|api_key|secret|token)\s*[:=]\s*["'][^"']{6,}["']/i,
    },
    {
      id: 'PROCESS_ENV_SPREAD',
      severity: 'MEDIUM',
      desc: 'Full process.env spread into child process env — leaks all secrets to subprocess',
      fix: 'Clone only the specific vars needed: Object.assign({}, { PATH: ..., NODE_ENV: ... })',
      pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*process\.env\s*\)/,
    },
    // ── Motion Studio NEVER rules (.ai/docs/conventions.md) ──
    {
      id: 'CHILD_PROCESS_COMMAND_STRING',
      severity: 'CRITICAL',
      desc: 'exec()/execSync() run a command string through a shell',
      fix: 'spawn(cmd, [args], { shell: false, windowsHide: true }) with a timeout and a capped log',
      pattern: (src) => /require\(['"](?:node:)?child_process['"]\)|from\s+['"](?:node:)?child_process['"]/.test(src) && /\bexec(?:Sync)?\s*\(\s*[`'"]/.test(src),
    },
    {
      id: 'PATH_JOIN_OUTSIDE_ID',
      severity: 'HIGH',
      desc: 'path.join with a request value: an outside id or file name must go through assertId / assertFileName + within()',
      fix: 'within(base, assertId(id)) / within(base, assertFileName(name))',
      pattern: /path\.join\([^)]*\b(?:req\.|body\.|params\b|searchParams\b|query\.)/,
    },
    {
      id: 'GSAP_TEXT_TWEEN',
      severity: 'HIGH',
      desc: 'GSAP text: tween (TextPlugin) sets innerHTML: script or brief text in it is parsed as markup',
      fix: 'A count tween writing textContent (typeText in templates/kit.mjs, swapText in ui-story)',
      pattern: (src) => inDir('templates/') && /\{\s*text\s*:\s*(?!['"])[^,}]/.test(src),
    },
    {
      id: 'MODEL_CALL_OUTSIDE_ALLOWED',
      severity: 'CRITICAL',
      desc: 'A model API or Claude Code called outside the person-clicked paths (server/director.mjs + server/worker/, server/generate.mjs, server/voice-cloud.mjs, server/assistant-model.mjs)',
      fix: 'Route it through Run Director, the Brand tab Generate, Make cloud voice or the Assistant panel; never from engine/, a cron or a loop',
      pattern: (src) => !inDir('server/director.mjs', 'server/worker/', 'server/generate.mjs', 'server/voice-cloud.mjs', 'server/assistant-model.mjs', 'tests/')
        && /api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.openai\.com|['"]claude(?:\.exe)?['"]\s*,\s*\[/.test(src),
    },
    {
      id: 'SERVER_NOT_LOCALHOST',
      severity: 'CRITICAL',
      desc: 'A server listens on an address other than 127.0.0.1',
      fix: 'listen(port, "127.0.0.1"); the read-only review link (server/review.mjs) is the one exception',
      pattern: (src) => inDir('server/') && !inDir('server/review.mjs') && /\.listen\([^)]*['"](?:0\.0\.0\.0|::|localhost)['"]/.test(src),
    },
    {
      id: 'PERMISSION_BYPASS_FLAG',
      severity: 'CRITICAL',
      desc: 'A Claude Code flag that disables auth or permission checks, as an argument',
      fix: 'Never pass --bare or --dangerously-skip-permissions; the seat runs with --permission-mode dontAsk on its allowlist',
      pattern: (src) => !inDir('tests/') && /['"`]--(?:bare|dangerously-skip-permissions|allow-dangerously-skip-permissions)['"`]/.test(src),
    },
  ];

  // ─── RUN PATTERNS ────────────────────────────────────────────────────────────
  for (const p of PATTERNS) {
    let hit = false;
    try {
      if (typeof p.pattern === 'function') {
        hit = p.pattern(src);
      } else {
        hit = p.pattern.test(src);
      }
    } catch { /* ignore regex errors */ }

    if (hit) {
      findings.push(`[${p.severity}] ${p.id}: ${p.desc}\n  Fix: ${p.fix}`);
    }
  }

  if (findings.length === 0) process.exit(0);

  const relPath = filePath.replace(data.cwd || '', '').replace(/^[/\\]/, '');
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [
        `⚠️  Security lint flagged ${findings.length} pattern(s) in ${relPath}:`,
        ...findings.map((f, i) => `${i + 1}. ${f}`),
        '',
        'Review each finding above. If the pattern is a false positive, note why. If real, fix before completing the turn.',
      ].join('\n'),
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
