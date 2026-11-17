/**
 * T16800 - per-criterion acceptance check (group checks protocol).
 *
 * C1: "The steps above give the expected result", where the steps are T16730:C1 run against
 * staging after #803 merged. This runs exactly those steps (../helpers/returnAfterSharpen.js, shared
 * with T16730.check.spec.js); `staging-check` runs it on staging after merge, and since T16800
 * a failure that overlapped a staging deploy is re-run once that deploy has finished.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16800.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { returnAfterSharpenFindsHighlight } from '../helpers/returnAfterSharpen';

test('T16800:C1 - the T16730:C1 steps pass: a parent who returns after a sharpen finds the highlight in Highlights', async ({ browser }) => {
  test.setTimeout(900000);
  await returnAfterSharpenFindsHighlight(browser, 'T16800');
});
