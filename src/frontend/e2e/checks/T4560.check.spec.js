/**
 * T4560 - per-criterion acceptance check (group checks protocol).
 *
 * T4560:C3: the six dialogs moved onto DialogShell must look as they did before the
 * move, on phone and desktop. Each dialog is rendered by the dev-only harness
 * (t4560diag.html) and its screenshot is compared pixel for pixel with the baseline in
 * T4560.check.spec.js-snapshots/, which was captured from the pre-move revision
 * (3a6d98e72) with this same spec and harness (`--update-snapshots`).
 *
 * The harness page exists only on the Vite dev server, so the check skips on a deployed
 * build. Run: bash scripts/dev-verify.sh e2e/checks/T4560.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';

const DIALOGS = ['confirm', 'playsonly', 'notice', 'toolarge', 'sizelimit', 'credithistory'];
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

test.describe('T4560 checks: dialogs keep their pre-move look', () => {
  test('T4560:C3 - screenshots of the six dialogs match the pre-move baseline on phone and desktop', async ({ page }) => {
    const base = process.env.E2E_BASE_URL;
    test.skip(!!base && !/localhost|127\.0\.0\.1/.test(base), '[T4560] t4560diag.html is a dev-server-only harness');
    // CreditHistoryModal loads its rows on mount: a fixed failure keeps its state the same on every run.
    await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"check"}' }));
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      for (const d of DIALOGS) {
        await page.goto(`/t4560diag.html?d=${d}`);
        await expect(page.locator('[role="dialog"], [role="alertdialog"], .fixed.inset-0').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect.soft(page, `${d} at ${vpName} width`).toHaveScreenshot(`${d}-${vpName}.png`, {
          animations: 'disabled', caret: 'hide', maxDiffPixels: 50,
        });
      }
    }
  });
});
