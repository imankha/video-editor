#!/usr/bin/env node
/**
 * PostToolUse hook: lint the file Claude just edited/wrote.
 * - src/frontend JS/JSX -> eslint (frontend flat config)
 * - src/backend  .py    -> ruff check
 * Exit 2 + stderr => findings are fed back to Claude to fix.
 * Missing linter or non-lintable file => exit 0 (best-effort, never blocks).
 * Works on the Windows host and inside the Linux task containers.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

let input;
try {
  input = JSON.parse(readStdin());
} catch {
  process.exit(0);
}

const filePath =
  (input.tool_input && input.tool_input.file_path) ||
  (input.tool_response && input.tool_response.filePath);
if (!filePath || !fs.existsSync(filePath)) process.exit(0);

const repoRoot = path.resolve(__dirname, '..', '..');
const norm = path.resolve(filePath);
const rel = path.relative(repoRoot, norm).replace(/\\/g, '/');
if (rel.startsWith('..')) process.exit(0); // outside repo

function run(cmd, args, cwd) {
  // No shell: direct exec works in the hook env, the Bash sandbox, and Linux containers.
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 45000 });
}

function report(toolName, res) {
  if (res.error || res.status === null) process.exit(0); // linter unavailable/timeout: stay silent
  if (res.status === 0) process.exit(0);
  const out = ((res.stdout || '') + '\n' + (res.stderr || '')).trim();
  // Exit 2 feeds stderr back to Claude as actionable feedback.
  process.stderr.write(`[hook:${toolName}] ${rel} has lint errors — fix them now:\n${out}\n`);
  process.exit(2);
}

if (/^src\/frontend\/.+\.(js|jsx|ts|tsx)$/.test(rel) && !rel.includes('node_modules')) {
  const feDir = path.join(repoRoot, 'src', 'frontend');
  if (!fs.existsSync(path.join(feDir, 'node_modules', '.bin'))) process.exit(0);
  report('eslint', run('npx', ['--no-install', 'eslint', '--no-warn-ignored', norm], feDir));
}

if (/^src\/backend\/.+\.py$/.test(rel) && !rel.includes('.venv')) {
  const beDir = path.join(repoRoot, 'src', 'backend');
  const candidates =
    process.platform === 'win32'
      ? [path.join(beDir, '.venv', 'Scripts', 'ruff.exe')]
      : [path.join(beDir, '.venv', 'bin', 'ruff'), '/usr/local/bin/ruff'];
  const ruff = candidates.find((c) => fs.existsSync(c)) || 'ruff';
  report('ruff', run(ruff, ['check', '--no-cache', norm], beDir));
}

process.exit(0);
