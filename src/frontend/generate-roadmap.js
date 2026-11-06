#!/usr/bin/env node
/**
 * T14920: write public/roadmap.json from PLAN.md + docs/plans/roadmap-stage-map.json.
 * Runs before dev/build (`npm run roadmap`, chained into predev / prebuild*). The export is
 * Python (scripts/export_roadmap.py shares the task board's PLAN.md parser); this shim keeps
 * npm the one entry point on Windows and Linux by trying `python3` then `python`.
 *
 * Unlike generate-version.js this FAILS the build on an error: a PLAN.md that does not parse
 * or a stage map naming a task without a board row is a bug to fix, not a warning to scroll past.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, '..', '..', 'scripts', 'export_roadmap.py');
const out = path.join(__dirname, 'public', 'roadmap.json');

let ran = false;
for (const python of ['python3', 'python']) {
  const result = spawnSync(python, [script, '--out', out], { stdio: 'inherit' });
  if (result.error && result.error.code === 'ENOENT') continue;
  ran = true;
  if (result.error) {
    console.error(`generate-roadmap: ${python} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}
if (!ran) {
  console.error('generate-roadmap: neither python3 nor python is on PATH; the roadmap export needs Python 3.11+.');
  process.exit(1);
}
