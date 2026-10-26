#!/usr/bin/env bash
# Adversarial harness for the block-destructive.js gaps closed 2026-07-21.
# Feeds each command as the real hook payload and asserts block (exit 2) / allow (exit 0).
set -u
HOOK="$(cd "$(dirname "$0")/../hooks" && pwd)/block-destructive.js"
pass=0; fail=0

check() { # $1=expect(block|allow) $2=command
  local expect="$1" cmd="$2" out code
  out=$(printf '%s' "{\"tool_input\":{\"command\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")}}" | node "$HOOK" 2>&1)
  code=$?
  local got="allow"; [ $code -eq 2 ] && got="block"
  if [ "$got" = "$expect" ]; then pass=$((pass+1));
  else fail=$((fail+1)); printf 'FAIL [want %s got %s] %s\n      -> %s\n' "$expect" "$got" "$cmd" "$out"; fi
}

echo "=== MUST BLOCK (new gaps) ==="
check block 'node -e "require('"'"'fs'"'"').unlinkSync('"'"'src/important.cs'"'"')"'
check block 'node -e "const fs=require('"'"'fs'"'"'); fs.unlink('"'"'x.cs'"'"',()=>{})"'
check block 'node -e "require('"'"'fs'"'"').truncateSync('"'"'app.js'"'"')"'
check block 'powershell -Command "[IO.File]::Delete('"'"'C:\x\migration.cs'"'"')"'
check block 'powershell -Command "[System.IO.File]::Delete($p)"'
check block 'node -e "require('"'"'fs'"'"').writeFileSync('"'"'.claude/hooks/block-destructive.js'"'"','"'"''"'"')"'
check block 'node -e "require('"'"'fs'"'"').writeFileSync('"'"'.env'"'"','"'"'x'"'"')"'
check block 'node -e "require('"'"'fs'"'"').copyFileSync('"'"'evil'"'"','"'"'appsettings.Production.json'"'"')"'
check block 'powershell -Command "Set-Content .claude/scripts/create-draft-pr.js '"'"''"'"'"'
check block 'powershell -Command "Out-File -FilePath settings.local.json"'
check block 'echo "x" > appsettings.Production.json'
check block 'echo "{}" > .claude/settings.local.json'
check block 'echo "x" > .claude/hooks/notify.js'
check block 'del .env'
check block 'Remove-Item secrets.key'

echo "=== MUST ALLOW (no false positive) ==="
check allow 'node -e "require('"'"'fs'"'"').writeFileSync('"'"'UI/src/foo.ts'"'"','"'"'code'"'"')"'
check allow 'node -e "require('"'"'fs'"'"').readFileSync('"'"'.env'"'"')"'
check allow 'echo "build.env.log written" '
check allow 'echo "hello" > output.txt'
check allow 'git commit -m "remove unlinkSync call and Set-Content usage"'
check allow 'cat appsettings.json > /dev/null'
check allow 'node .claude/scripts/append-outcome.js --task x --outcome accepted'
check allow 'npx prettier --write UI/src/foo.ts'
check allow 'rm build.txt'

echo "---"
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ] && echo "ALL GREEN" || echo "HAS FAILURES"
