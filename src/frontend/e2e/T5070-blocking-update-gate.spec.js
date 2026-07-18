import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5070 — Blocking update gate + guaranteed cache flush + state sync flow.
 * See docs/plans/tasks/T5070-design.md for the full design.
 *
 * WHAT THIS SPEC TESTS (container-verifiable slice of the acceptance criteria):
 *
 *   A. Gate blocks interaction/login: once required, the gate paints above
 *      everything (z-[60] > AuthGateModal's z-50) and has no dismiss affordance
 *      (no X, no backdrop-close, Escape does nothing).
 *   B. Version-mismatch opens the gate: a later /api/version response
 *      advertising a different value than what the client booted with raises
 *      the gate with reason 'version-mismatch' — the backend-only-deploy gap.
 *   C. Flush awaits confirmation and blocks-on-failure: a 503 from
 *      /api/sync/flush-verify keeps the gate up with a visible error and
 *      NEVER reloads (no data loss) — the update-click's barrier ordering.
 *   D. Flush succeeds -> reload: a healthy flush proceeds to the terminal
 *      reload step.
 *
 * NOT covered here (see docs/plans/tasks/T5070-design.md §4b + final report):
 * real waiting-SW activation across an actual new build, and the iOS/PWA
 * real-device cache-flush pass — those are documented as manual/out-of-container
 * verification, not claimed as passing here.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5070-blocking-update-gate.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const GATE_SELECTOR = '[role="alertdialog"]';

test.describe('T5070 blocking update gate', () => {
  test.setTimeout(60_000);

  test('A — gate blocks interaction/login, no dismiss affordance', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Sanity: nothing gates the app before requireUpdate fires.
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    // Raise the gate directly (SW 'reason: sw' path) — this is the gate's own
    // blocking behavior under test, independent of a real waiting SW (that
    // lifecycle is unit-tested in pwaUpdate.test.js and needs a real new
    // build to exercise for real — see the spec header + final report).
    await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      useUpdateGateStore.getState().requireUpdate('sw');
    });

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible();
    await expect(gate.getByText('A new version is ready')).toBeVisible();
    await saveEvidence(page, 'T5070-A-gate-visible-blocking');

    // Blocks interaction: the topmost element at an arbitrary page point must
    // be the gate itself, not whatever UI sits behind it.
    const blockedByGate = await page.evaluate(() => {
      const el = document.elementFromPoint(20, 20);
      const dialog = document.querySelector('[role="alertdialog"]');
      return !!dialog && dialog.contains(el);
    });
    expect(blockedByGate).toBe(true);

    // No dismiss affordance: exactly one button (the single action), and
    // Escape/backdrop clicks do nothing.
    await expect(gate.locator('button')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(gate).toBeVisible();
    await page.mouse.click(5, 5); // corner, outside the centered card
    await expect(gate).toBeVisible();

    console.log('[T5070] A PASS: gate blocks interaction, no dismiss affordance');
  });

  test('B — backend version mismatch raises the gate', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // The real first /api responses latch the client's boot version
    // (whatever this container's backend advertises) before we mock.
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    // Simulate a FULLY-CONVERGED backend deploy: every /api response now
    // advertises the new X-App-Version. This is exactly what the passive
    // interceptor (sessionInit.js) observes in prod once the fleet finishes
    // rolling. We override only the header, preserving each real body/status,
    // so the app keeps working. The M2 debounce deliberately requires the SAME
    // new version on two consecutive checks — a single mixed-fleet blip must
    // NOT gate — so a converged deploy (not a one-off) is the faithful trigger.
    await context.route('**/api/**', async (route) => {
      const resp = await route.fetch();
      await route.fulfill({
        response: resp,
        headers: { ...resp.headers(), 'x-app-version': 'e2e-fake-mismatch' },
      });
    });

    // Two API round-trips through the patched global fetch — the passive
    // version probe fires twice with the new version, crossing the debounce.
    await page.evaluate(async () => {
      await fetch('/api/version').catch(() => {});
      await fetch('/api/version').catch(() => {});
    });

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T5070-B-version-mismatch-gate');

    const reason = await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      return useUpdateGateStore.getState().reason;
    });
    expect(reason).toBe('version-mismatch');

    console.log('[T5070] B PASS: converged backend version mismatch raised the gate');
  });

  test('C — flush failure keeps the gate up, shows an error, and never reloads', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await context.route('**/api/sync/flush-verify', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            code: 'sync_failed',
            retryable: true,
            detail: 'Could not confirm your latest changes were saved. Please try again.',
          },
        }),
      })
    );

    await page.evaluate(async () => {
      window.__t5070NoReloadMarker = true;
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      useUpdateGateStore.getState().requireUpdate('sw');
    });

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible();
    await gate.getByRole('button', { name: /update now/i }).click();

    // Barrier failure: error surfaces, gate stays up.
    await expect(gate.getByText(/could not confirm your latest changes/i)).toBeVisible({ timeout: 5000 });
    await expect(gate).toBeVisible();
    await saveEvidence(page, 'T5070-C-flush-failure-error');

    // No reload happened — the in-page marker set before the click survived.
    const markerSurvived = await page.evaluate(() => window.__t5070NoReloadMarker === true);
    expect(markerSurvived).toBe(true);

    // The retry affordance is the SAME button, now reading "Try again".
    await expect(gate.getByRole('button', { name: /try again/i })).toBeVisible();

    console.log('[T5070] C PASS: flush failure blocks the destructive step, no data loss');
  });

  test('D — successful flush proceeds past the barrier (no waiting SW -> reload)', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // No route mock: a clean session's real /api/sync/flush-verify returns 200
    // (nothing pending to sync) — the "cheap verify" ideal outcome from the
    // design doc §5.2.
    await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      useUpdateGateStore.getState().requireUpdate('sw');
    });

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible();

    const navigationPromise = page.waitForEvent('framenavigated', { timeout: 10_000 });
    await gate.getByRole('button', { name: /update now/i }).click();
    await navigationPromise;

    await page.waitForLoadState('domcontentloaded');
    // Fresh bundle boots with the gate down again.
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);
    await saveEvidence(page, 'T5070-D-successful-flush-reloaded');

    console.log('[T5070] D PASS: successful flush proceeded to reload; fresh boot has no gate');
  });
});
