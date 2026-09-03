import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T8460 — silent app update, no blocking interstitial. Supersedes the old
 * T5070 blocking-gate spec: that behavior (a full-screen alertdialog the user
 * had to click through) no longer exists. See
 * docs/plans/tasks/first-reel-funnel/T8460-silent-app-update.md.
 *
 * WHAT THIS SPEC TESTS (container-verifiable slice of the acceptance criteria):
 *
 *   A. No role=alertdialog ever exists, and the update runs itself once the
 *      app is quiescent -- Add Game (or any other control) stays tappable
 *      throughout, including while the passive progress card is visible.
 *   B. Flush failure shows the paused card with Retry and NEVER reloads (the
 *      barrier ordering carried over unchanged from T5070/updateFlush.js).
 *   C. A successful Retry proceeds past the barrier to a real reload.
 *
 * Run at both 1280px (desktop) and 390x844 (mobile, the epic's tap-target
 * concern) per acceptance criteria.
 *
 * NOT covered here (see appVersion.test.js / T6230-update-gate-real-sw.spec.js):
 * the truth-check (checkServerVersion) and real ServiceWorker probe/lifecycle
 * mechanics -- this spec only drives the store directly via requireUpdate(),
 * same as T5070 did, and asserts the UI/gesture layer on top of it.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/update-gate.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const ALERTDIALOG = '[role="alertdialog"]';
const PROGRESS_CARD = '[data-testid="update-progress-card"]';

async function raiseGate(page) {
  await page.evaluate(async () => {
    const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
    useUpdateGateStore.getState().requireUpdate();
  });
}

/**
 * Session-init resolves authStore.isAuthenticated asynchronously AFTER
 * domcontentloaded -- and updateGateStore's isQuiescent() cold-boot guard
 * treats "not yet authenticated" the same as "logged out," which would
 * silently swallow the auto-run this spec is testing. Wait for a real
 * authenticated-only UI element before raising the gate.
 */
async function waitForAuthReady(page) {
  await expect(page.getByRole('button', { name: REAL_EMAIL })).toBeVisible({ timeout: 15_000 });
}

const RUNS = [
  { width: 1280, height: 800, label: '1280px' },
  { width: 390, height: 844, label: '390x844' },
];

for (const viewport of RUNS) {
  test.describe(`T8460 silent update gate @ ${viewport.label}`, () => {
    // T5420: drives the gate by import()ing /src/stores/updateGateStore.js in-page --
    // that Vite-dev source path 404s on a deployed CF Pages BUILD. Gate logic is also
    // covered by Vitest. Skip loudly on a deployed target.
    skipOnDeployedTarget(test, "import()s /src/stores/updateGateStore.js (Vite-dev path; 404s on a deployed build)");
    test.setTimeout(60_000);
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('no alertdialog ever appears; Add Game stays tappable through a slow flush', async ({ context, page }) => {
      await loginAsRealUser(context, REAL_EMAIL);
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await waitForAuthReady(page);

      // Sanity: nothing gates the app before requireUpdate fires.
      await expect(page.locator(ALERTDIALOG)).toHaveCount(0);

      // Slow the flush down so the progress card is guaranteed visible while we
      // probe interactivity underneath it -- a real flush is usually sub-second.
      await context.route('**/api/sync/flush-verify', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      await raiseGate(page);

      const card = page.locator(PROGRESS_CARD);
      await expect(card).toBeVisible();
      await expect(card.getByText(/updating to the latest version/i)).toBeVisible();
      // Still no alertdialog -- this is a passive card, not a gate.
      await expect(page.locator(ALERTDIALOG)).toHaveCount(0);

      // Add Game (or an equally-fundamental always-present control) is not
      // covered by anything -- the exact regression this task fixes (prod bug #18).
      const addGame = page.getByRole('button', { name: /add game/i }).first();
      await expect(addGame).toBeVisible();
      await expect(addGame).toBeEnabled();
      const addGameIsOnTop = await addGame.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return el === topEl || el.contains(topEl);
      });
      expect(addGameIsOnTop, 'Add Game must not be occluded by the progress card').toBe(true);

      await saveEvidence(page, `T8460-progress-card-nonblocking-${viewport.label}`);

      console.log(`[T8460] no-alertdialog + Add-Game-tappable PASS (${viewport.label})`);
    });

    test('flush failure shows the paused card with Retry, never reloads; Retry recovers', async ({ context, page }) => {
      await loginAsRealUser(context, REAL_EMAIL);
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await waitForAuthReady(page);

      let shouldFail = true;
      await context.route('**/api/sync/flush-verify', (route) => {
        if (shouldFail) {
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              detail: { detail: 'Could not confirm your latest changes were saved. Please try again.' },
            }),
          });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      await page.evaluate(() => { window.__t8460NoReloadMarker = true; });
      await raiseGate(page);

      const card = page.locator(PROGRESS_CARD);
      await expect(card.getByText(/update paused/i)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(ALERTDIALOG)).toHaveCount(0);
      await saveEvidence(page, `T8460-flush-error-card-${viewport.label}`);

      // No reload happened -- the in-page marker set before the flush attempt survived.
      const markerSurvived = await page.evaluate(() => window.__t8460NoReloadMarker === true);
      expect(markerSurvived).toBe(true);

      // Retry is the ONE interactive surface, and it never blocked the app behind it.
      const addGame = page.getByRole('button', { name: /add game/i }).first();
      await expect(addGame).toBeEnabled();

      shouldFail = false;
      const navigationPromise = page.waitForEvent('framenavigated', { timeout: 10_000 });
      await card.getByRole('button', { name: /retry/i }).click();
      await navigationPromise;

      await page.waitForLoadState('domcontentloaded');
      // Fresh bundle boots with nothing pending.
      await expect(page.locator(PROGRESS_CARD)).toHaveCount(0);

      console.log(`[T8460] flush-failure -> Retry -> reload PASS (${viewport.label})`);
    });
  });
}
