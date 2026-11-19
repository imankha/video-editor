import { test, expect } from '@playwright/test';
import { runSpecTests } from '../helpers/specRunner.js';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T17880 - the T17780 Spotlight check runs without sharpening anything, so it no longer spends the
 * staging gate account's credits and keeps passing run after run.
 *
 * Both criteria run the real T17780 check in a child Playwright process (helpers/specRunner.js),
 * against whatever target this run points at. C1 reads the account's credit balance around that run
 * on a deployed target (on the dev stack each child gets its own fresh account, and the T17780 tests
 * compare that account's balance themselves). C2 runs both T17780 tests twice in a row.
 *
 * Needs a project with a sharpened video on the account (FIXTURE-CONTRACT.md item 2a); without one
 * the T17780 check fails at once and says so.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17880.check.spec.js --reporter=line
 */

const T17780 = 'e2e/checks/T17780.check.spec.js';

const describeRun = (r) => `${r.file} --grep '${r.grep}':\n` +
  (r.tests.length ? r.tests.map((t) => `  [${t.status}] ${t.title}` +
    (t.error ? `\n    ${t.error.split('\n').slice(0, 6).join('\n    ')}` : '')).join('\n') : `  no test ran\n${r.log}`);

function expectAllPassed(run, count) {
  expect(run.tests.map((t) => t.status), describeRun(run)).toEqual(Array(count).fill('passed'));
}

/** The deployed account's balance, read before the first navigation (T16100). Null on the dev stack. */
async function deployedBalance(browser) {
  if (!process.env.E2E_BASE_URL) return null;
  const context = await browser.newContext();
  await loginForCheck(context);
  const res = await context.request.get(checkApi('/credits'));
  expect(res.ok(), `GET /credits -> ${res.status()}`).toBe(true);
  const { balance } = await res.json();
  await context.close();
  return balance;
}

test('T17880:C1 the T17780 check reaches and measures the Delete text control without spending credits', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  const before = await deployedBalance(browser);
  const [run] = await runSpecTests([{ file: T17780, grep: 'T17780:C1' }]);
  console.log(describeRun(run));
  expectAllPassed(run, 1);
  if (before !== null) expect(await deployedBalance(browser), 'credit balance after the T17780 check').toBe(before);
});

test('T17880:C2 both T17780 checks pass on two runs in a row', async () => {
  test.setTimeout(30 * 60 * 1000);
  for (const round of [1, 2]) {
    const [run] = await runSpecTests([{ file: T17780, grep: 'T17780:C' }]);
    console.log(`round ${round}: ${describeRun(run)}`);
    expectAllPassed(run, 2);
  }
});
