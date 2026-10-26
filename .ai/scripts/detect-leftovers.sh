#!/bin/bash
# ============================================================
# detect-leftovers.sh — find source-project (NSC) residue in a
# project that installed the AI-config kit but was customized for
# a DIFFERENT stack. Run from the TARGET project root.
#
#   cd /path/to/target-project
#   bash .ai/scripts/detect-leftovers.sh        # (shipped in the kit)
#
# Prints a per-file checklist of config still containing NSC-specific
# residue. Exits 1 if any found (usable as a setup gate), 0 if clean.
#
# WHY: the kit ships full NSC content and the 11-step setup cleans it
# by hand — easy to miss files. This turns the manual grep sweep into
# one command. See .ai/export/README.md "11-step setup".
# ============================================================

ROOT="$(pwd)"
cd "$ROOT" || exit 2

# Config surface to scan. Runtime state (.claude/state, tmp), per-machine
# memory (agent-memory), and the local-only files below are filtered via
# --exclude / --exclude-dir on the grep itself (fast + correct).
SCAN_PATHS=(.claude .cursor .github AGENTS.md CLAUDE.md .ai/docs .ai/templates .ai/snapshots .mcp.json .vscode
            claude-code-guide.html claude-code-guide-en.html cursor-guide.html cursor-guide-en.html
            cursor-ai-guide.html cursor-ai-guide-en.html qa-tests-guide.html)

# Residue patterns = strings that identify the NSC SOURCE project specifically.
# CRITICAL scoping rule: only match things unique to NSC — NOT shared-stack
# vocabulary. A target may legitimately be EPiServer/.NET/Vue/MediatR itself
# (AEI is EPiServer), so words like "EPiServer", "MediatR", "StructureMap",
# "NUnit", "Pinia", "Features/" are NOT residue — matching them floods the
# report with the target's own valid stack. Keep to: NSC name, NSC-only paths
# & aliases, NSC-only vendor integrations, and NSC-only skill/folder names the
# kit shipped.
# Matched case-insensitively (grep -i below): "northshore" in a URL is as much
# residue as "NorthShore" in prose. Smarty is scoped to SmartyStreets (the NSC
# address-validation vendor) — bare \bSmarty\b would flood a PHP target that
# legitimately uses the Smarty template engine.
PATTERNS='NorthShore|src/Presentation/NorthShore|(^|[^a-z])vue3/|UI/src/components|@UIUtils|@UIShared|@UIStores|@Checkout|NorthShore\.sln|northshorecare|dev\.azure\.com/northshorecare|\bOP-[0-9]{3,5}\b|\bDelivra\b|\bYotpo\b|SmartyStreets|smarty.?streets|wwwroot/bundles|cqrs-mediatr|pinia-store|vue-component-ui|vue-component-legacy|tailwind-design-system|nsc-dotnet|nsc-tailwind|niteco|phuong\.nguyen|PHUONG~1|hung-le-niteco|v0-nsc-trangdien'

# Credential-shaped lines are a separate, ALWAYS-fatal class (identity residue
# is expected pre-cleanup; secrets are not). Excludes env-indirection (${...}),
# VS Code promptString inputs, and rule text about credentials.
CRED_PATTERN='(^|[^[:alnum:]])[Pp]assword[*_`"'"'"']*[[:space:]]*[:=][[:space:]]*[^[:space:]$<{*]|(api[_-]?key|secret|bearer|access[_-]?token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_\-]{12,}'
CRED_FALSE_POS='TODO|EXAMPLE|placeholder|\$\{|promptString|[Pp]assword["'"'"']*[[:space:]]*[:=][[:space:]]*true|NEVER put real credentials|Hardcode credentials|(forgot|reset|change|confirm|new)[-_]?password|[Pp]assword["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?/|=[[:space:]]*ref\(|[Pp]assword:[[:space:]]*\|'

# False-positive filter — anchored so a real residue line can't be suppressed
# just because it happens to contain one of these substrings. Each entry
# matches only the benign self-referential lines (script names, marker text,
# "we do NOT use X" rewritten guidance).
FALSE_POS='NOT applicable|not-yet-adapted|NOT YET ADAPTED|(^|/)(init-claude-project|setup-existing-project|detect-leftovers)\.sh|pointing at NSC'

# Files explicitly flagged "NOT YET ADAPTED" in their first 15 lines are a known,
# accepted state — skip wholesale (their inner example lines always trip patterns).
is_flagged_not_adapted() {
  head -15 "$1" 2>/dev/null | grep -qiE 'NOT YET ADAPTED|not-yet-adapted|NOT adapted for'
}

echo "━━━ Scanning for source-project (NSC) residue ━━━"
echo "  Root: $ROOT"
echo ""

tmpfile="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/detect-leftovers.$$")"

for p in "${SCAN_PATHS[@]}"; do
  [ -e "$p" ] || continue
  # -H forces a filename prefix even for single-file paths (CLAUDE.md, AGENTS.md,
  #    .mcp.json) so the `cut -d:` grouping below never mistakes a line number
  #    for a filename. -I skips binaries. --exclude-dir keeps big vendor/state
  #    trees from being read at all (the old downstream `grep -v` still traversed
  #    them → multi-minute hang on a node_modules/.next checkout).
  grep -riHInE "$PATTERNS" "$p" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=bin --exclude-dir=obj --exclude-dir=state --exclude-dir=tmp \
    --exclude-dir=agent-memory --exclude-dir=worktrees --exclude-dir=v0-nsc-trangdien \
    --exclude='*.min.*' --exclude='CLAUDE.local.md' --exclude='*.patch' --exclude='HANDOVER-*' \
    2>/dev/null \
    | grep -vE "$FALSE_POS" \
    | while IFS= read -r line; do
        file="${line%%:*}"
        is_flagged_not_adapted "$file" && continue
        printf '%s\n' "$line"
      done \
    >> "$tmpfile" || true
done

# Credential scan — same surface, fatal regardless of adaptation state.
credfile="${tmpfile}.cred"
for p in "${SCAN_PATHS[@]}"; do
  [ -e "$p" ] || continue
  grep -rHInE "$CRED_PATTERN" "$p" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=bin --exclude-dir=obj --exclude-dir=state --exclude-dir=tmp \
    --exclude-dir=agent-memory --exclude-dir=worktrees --exclude-dir=v0-nsc-trangdien \
    --exclude='*.min.*' --exclude='CLAUDE.local.md' --exclude='settings.local.json' \
    --exclude='new-resource-keys-*' --exclude='HANDOVER-*' --exclude='*.patch' \
    2>/dev/null \
    | grep -vE "$CRED_FALSE_POS" \
    >> "$credfile" || true
done

# Separate check: a `git push` allow anywhere in the settings files. That's the
# one permission that's wrong on ANY project (push must be confirm-first, per the
# commit-after-verify-never-push policy). Stack-specific build allows (dotnet /
# msbuild / composer) are NOT flagged here — they're correct on their own stack,
# and the human-run prompt 7 already handles stack-fit of the allow-list.
settings_hits=""
for sf in .claude/settings.json .claude/settings.local.json; do
  [ -f "$sf" ] || continue
  # Match a plain git-push ALLOW (e.g. "Bash(git push:*)", "Bash(git push origin…")
  # but NOT the deny-list "Bash(git push --force…)" entry, which is correct.
  bad=$(grep -nE '"Bash\(git push( origin|:)' "$sf" 2>/dev/null)
  [ -n "$bad" ] && settings_hits="$settings_hits$sf (git push allow: $(echo "$bad" | tr '\n' ' '))"$'\n'
done

hits=0
if [ -s "$credfile" ]; then
  echo "✗ CREDENTIAL-shaped lines found (fatal — remove/rotate, never ship secrets):"
  cut -d: -f1-2 "$credfile" | sort -u | sed 's/^/  [ ] /'
  echo ""
  hits=1
fi

if [ -s "$tmpfile" ]; then
  echo "⚠ Residue found — these files still reference the NSC source project:"
  echo ""
  cut -d: -f1 "$tmpfile" | sort -u | while read -r f; do
    n=$(awk -F: -v f="$f" '$1==f' "$tmpfile" | wc -l)
    echo "  [ ] $f  ($n line(s))"
  done
  echo ""
  echo "  Sample lines (first 20):"
  head -20 "$tmpfile" | sed 's/^/    /'
  echo ""
  hits=1
fi

if [ -n "$settings_hits" ]; then
  echo "⚠ Stack-check the permission allow-list (may be NSC-specific):"
  printf '%s' "$settings_hits" | sed 's/^/  [ ] /'
  echo "  (Remove dotnet/msbuild allows on a non-.NET project; git push should stay off the allow list.)"
  echo ""
  hits=1
fi

if [ "$hits" -eq 0 ]; then
  echo "✓ No NSC residue found in the scanned config surface."
else
  echo "  Fix each real hit (rewrite for THIS project's stack), then re-run until clean."
  echo "  A hit is not always a bug — a rewritten 'don't use X' line is fine; extend"
  echo "  FALSE_POS (anchored, not a bare substring) or flag a file 'NOT YET ADAPTED'."
fi

rm -f "$tmpfile" "$credfile" 2>/dev/null || true
exit "$hits"
