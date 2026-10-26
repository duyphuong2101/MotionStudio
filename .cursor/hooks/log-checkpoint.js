#!/usr/bin/env node
// Cursor 'stop' hook: log a checkpoint marker when the agent completes.
// Does NOT create a git stash — just logs file count + timestamp to stdout
// so the user has a quick "what changed in this run" reference.
// (Renamed from auto-checkpoint.js — the original name implied stashing.)

const { execSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const cwd = process.cwd();
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf8', timeout: 5000 }).trim();

    if (!status) {
      process.exit(0);
      return;
    }

    const changedFiles = status.split('\n').length;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    console.log(`[Cursor checkpoint] ${timestamp} | ${changedFiles} files changed`);
  } catch (e) {
    // Silent fail
  }
  process.exit(0);
});
