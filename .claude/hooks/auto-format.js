#!/usr/bin/env node
// PostToolUse hook: Auto-format files after Edit/Write
// Detects the project's formatter and runs it on the changed file

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // Claude payload: tool_input.file_path; Cursor afterFileEdit: top-level file_path/path
    const filePath = data.tool_input?.file_path || data.file_path || data.path;
    if (!filePath || !fs.existsSync(filePath)) {
      process.exit(0);
    }

    const ext = path.extname(filePath).toLowerCase();
    const dir = findProjectRoot(filePath);
    if (!dir) {
      process.exit(0);
    }

    // Detect formatter and run it
    const formatter = detectFormatter(dir, ext);
    if (formatter) {
      // Snapshot before formatting so a formatter that blanks the file can be undone
      let original = null;
      try {
        original = fs.readFileSync(filePath, 'utf8');
      } catch (e) {}
      try {
        // execFileSync + argv array (NOT a single interpolated string): each arg is
        // passed separately so a filePath with quotes/; can't inject a command.
        // Windows .cmd shims (npm bins) can't spawn with shell:false (EINVAL), so we
        // set shell:true for them — but because cmd+args stays an ARRAY, Node quotes
        // each element; there is no string concatenation to break out of.
        const args = formatter.args.map((x) => (x === '{}' ? filePath : x));
        const isWinShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(formatter.cmd);
        execFileSync(formatter.cmd, args, {
          cwd: dir,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 15000,
          shell: isWinShim,
        });
      } catch (e) {
        // Formatting failed silently — don't block the workflow
      }
      // Restore if the formatter emptied or gutted the file (<50% of original size)
      if (original && original.trim().length > 0) {
        try {
          const after = fs.readFileSync(filePath, 'utf8');
          if (after.trim().length === 0 || after.length < original.length * 0.5) {
            fs.writeFileSync(filePath, original);
          }
        } catch (e) {}
      }
    }
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});

function findProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) ||
        fs.existsSync(path.join(dir, 'pyproject.toml')) ||
        fs.existsSync(path.join(dir, 'go.mod')) ||
        fs.existsSync(path.join(dir, 'Cargo.toml')) ||
        fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Returns { cmd, args } for execFileSync (no shell). '{}' in args = the file path.
// On Windows, node_modules/.bin tools are .cmd shims; execFileSync needs shell:false,
// so resolve the .cmd variant when present.
function binPath(dir, name) {
  const bin = path.join(dir, 'node_modules', '.bin', name);
  const cmd = bin + '.cmd';
  if (process.platform === 'win32' && fs.existsSync(cmd)) return cmd;
  return fs.existsSync(bin) ? bin : null;
}

function detectFormatter(dir, ext) {
  const jsExts = ['.js', '.mjs', '.cjs', '.css'];
  const pyExts = ['.py', '.pyi'];
  const goExts = ['.go'];
  const rustExts = ['.rs'];
  const phpExts = ['.php', '.phtml'];

  if (phpExts.includes(ext)) {
    // WordPress / Magento / Laravel — prefer project-local tools, config-gated
    const vendorBin = path.join(dir, 'vendor', 'bin');
    const hasCsFixerConfig =
      fs.existsSync(path.join(dir, '.php-cs-fixer.php')) ||
      fs.existsSync(path.join(dir, '.php-cs-fixer.dist.php'));
    if (hasCsFixerConfig && fs.existsSync(path.join(vendorBin, 'php-cs-fixer'))) {
      return { cmd: path.join(vendorBin, 'php-cs-fixer'), args: ['fix', '{}'] };
    }
    const hasPhpcsConfig =
      fs.existsSync(path.join(dir, 'phpcs.xml')) ||
      fs.existsSync(path.join(dir, 'phpcs.xml.dist'));
    if (hasPhpcsConfig && fs.existsSync(path.join(vendorBin, 'phpcbf'))) {
      return { cmd: path.join(vendorBin, 'phpcbf'), args: ['{}'] };
    }
    return null;
  }

  if (jsExts.includes(ext)) {
    const hasPrettierConfig =
      fs.existsSync(path.join(dir, '.prettierrc')) ||
      fs.existsSync(path.join(dir, '.prettierrc.json')) ||
      fs.existsSync(path.join(dir, '.prettierrc.js')) ||
      fs.existsSync(path.join(dir, 'prettier.config.js'));
    const prettier = binPath(dir, 'prettier');
    if (hasPrettierConfig && prettier) {
      return { cmd: prettier, args: ['--write', '--ignore-unknown', '{}'] };
    }
  }

  if (pyExts.includes(ext)) {
    if (fs.existsSync(path.join(dir, 'ruff.toml'))) {
      return { cmd: 'ruff', args: ['format', '{}'] };
    }
    try {
      const pyproject = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
      if (pyproject.includes('[tool.ruff]')) {
        return { cmd: 'ruff', args: ['format', '{}'] };
      }
      if (pyproject.includes('[tool.black]')) {
        return { cmd: 'black', args: ['{}'] };
      }
    } catch (e) {}
  }

  if (goExts.includes(ext)) {
    return { cmd: 'gofmt', args: ['-w', '{}'] };
  }

  if (rustExts.includes(ext)) {
    return { cmd: 'rustfmt', args: ['{}'] };
  }

  // C# dotnet format disabled — same issue as Prettier, reformats entire file
  return null;
}
