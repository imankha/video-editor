/**
 * T17650 - per-criterion acceptance checks (group checks protocol).
 * The scenario lives in ../helpers/trimSplitScenario.js (also run by T17720 and T17730).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17650.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { runTrimSplitScenario as runScenario } from '../helpers/trimSplitScenario';

test.setTimeout(420000);

test.describe('T17650 @ desktop 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('T17650:C1 - a split can be deleted while the end stays trimmed; the trim edge shows only Undo end trim, uncovered', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page);
  });
});

test.describe('T17650 @ phone 390x844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('T17650:C2 phone - the same interaction stays reachable on a phone touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page, { isTouch: true });
  });
});

test.describe('T17650 @ tablet 820x1180 touch', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('T17650:C2 tablet - the same interaction stays reachable on a tablet touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page, { isTouch: true });
  });
});
