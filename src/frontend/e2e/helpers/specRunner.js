import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run other spec files' tests from inside an acceptance check (T11905): a check whose criterion
 * says "spec X runs and passes" runs spec X itself, not a copy of its locators.
 *
 * Each test runs in its own child `npx playwright test` with its own account: one account shared
 * by parallel runs gets its sessions logged out under the other runs (401s, T11905 fix round 1).
 * On the dev stack each child clones a fresh `full` dev preset; on a deployed target (E2E_BASE_URL)
 * every child uses E2E_CHECK_EMAIL and the runs go one at a time.
 */

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A fresh `full` dev preset account's email (dev stack only). */
async function freshPresetEmail() {
  const apiBase = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_API_PORT || 8000}/api`;
  const res = await fetch(`${apiBase}/auth/dev-accounts/full`, { method: 'POST', headers: { 'X-Test-Mode': 'true' } });
  if (!res.ok) throw new Error(`dev-accounts/full failed (${res.status}): ${await res.text()}`);
  return (await res.json()).email;
}

/** Every test in a Playwright JSON report: {title, status, skipReason, annotations, error}. */
function testsInReport(report) {
  const out = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const last = (t.results || []).at(-1) || {};
        const skip = (t.annotations || []).concat(last.annotations || []).find(a => a.type === 'skip');
        const err = last.error || (last.errors || [])[0];
        out.push({
          title: [...titles, spec.title].join(' > '),
          status: last.status || 'skipped',
          skipReason: skip?.description || '',
          annotations: (t.annotations || []).concat(last.annotations || []).map(a => a.type),
          error: err ? `${err.message || ''}\n${err.stack || ''}` : '',
        });
      }
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title].filter(Boolean));
  };
  for (const suite of report.suites || []) walk(suite, []);
  return out;
}

/** Run one spec test in a child Playwright process; resolves to its report entries + log tail. */
async function runOne({ file, grep }, email) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-run-'));
  const jsonPath = path.join(dir, 'report.json');
  // The parent worker's TEST_* vars would make the child think it is a worker itself
  // (PLAYWRIGHT_BROWSERS_PATH and the like stay: the child needs them to find its browser).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^TEST_/.test(k)));
  Object.assign(env, {
    E2E_REAL_EMAIL: email,
    E2E_RESULTS_DIR: dir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath,
    PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath,
  });
  const args = ['playwright', 'test', file, '--project=chromium', '--workers=1', '--reporter=json', '--grep', grep];
  const log = await new Promise((resolve) => {
    const child = spawn('npx', args, { cwd: FRONTEND_DIR, env });
    let text = '';
    child.stdout.on('data', () => {}); // the JSON goes to the file; stdout repeats it
    child.stderr.on('data', (d) => { text = (text + d).slice(-4000); });
    child.on('close', (code) => resolve(`exit ${code}\n${text}`));
  });
  const report = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : { suites: [] };
  return { file, grep, tests: testsInReport(report), log };
}

/**
 * Run each `{file, grep}` entry (file relative to src/frontend, grep selecting its test(s)),
 * `concurrency` at a time: at 3 the dev stack slowed enough that spec tests timed out inside their
 * own waits, at 6 most did.
 * @returns {Promise<Array<{file, grep, tests: Array<{title, status, skipReason, annotations, error}>, log}>>}
 */
export async function runSpecTests(entries, { concurrency = 2 } = {}) {
  const deployed = Boolean(process.env.E2E_BASE_URL);
  const width = deployed ? 1 : concurrency;
  const results = new Array(entries.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(width, entries.length) }, async () => {
    while (next < entries.length) {
      const i = next++;
      const email = deployed ? (process.env.E2E_CHECK_EMAIL || 'e2e-gate@test.local') : await freshPresetEmail();
      results[i] = await runOne(entries[i], email);
    }
  });
  await Promise.all(workers);
  return results;
}
