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

// T6220: same `git rev-list --count HEAD` expression as vite.config.js's
// __APP_BUILD__ define -- keep the two in agreement, they must produce the
// same number for the same commit or the lockstep assertion is meaningless.
const buildNumber = Number(execGit('git rev-list --count HEAD')) || 0;

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

// T6220: also write public/build.json, copied verbatim into dist/ so the
// deployed site serves it at /build.json -- a fetchable fact the lockstep
// assertion (scripts/verify-build-lockstep.sh) compares against the
// backend's GET /api/version `build`. This is the SAME number vite.config.js
// bakes into __APP_BUILD__ (see the comment there); scraping the number back
// out of a hashed, minified bundle would be fragile, so it is duplicated here
// as plain JSON instead.
const buildJsonPath = path.join(__dirname, 'public', 'build.json');
fs.writeFileSync(buildJsonPath, JSON.stringify({ build: buildNumber, commit }, null, 2));

console.log('✓ Generated version info:');
console.log(`  Branch: ${branch}`);
console.log(`  Commit: ${commit}`);
console.log(`  Build:  ${buildTime}`);
console.log(`  Build#: ${buildNumber} (public/build.json)`);
