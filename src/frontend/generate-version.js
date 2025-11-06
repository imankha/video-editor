#!/usr/bin/env node
/**
 * Generate version.json with git information
 * This runs automatically before dev/build via npm scripts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function execGit(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

// Get git info
const branch = execGit('git rev-parse --abbrev-ref HEAD');
const commit = execGit('git rev-parse --short HEAD');
const commitFull = execGit('git rev-parse HEAD');
const buildTime = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

// Detect environment (production or development)
const env = process.env.NODE_ENV || 'development';

// Create version object
const versionInfo = {
  branch,
  commit,
  commitFull,
  buildTime,
  environment: env
};

// Write to src/version.json
const outputPath = path.join(__dirname, 'src', 'version.json');
fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));

console.log('✓ Generated version info:');
console.log(`  Branch: ${branch}`);
console.log(`  Commit: ${commit}`);
console.log(`  Build:  ${buildTime}`);
