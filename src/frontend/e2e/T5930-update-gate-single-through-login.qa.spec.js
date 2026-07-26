import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5930 — the "New version" gate fired TWICE (before + after login) because
 * runUpdate's version-mismatch branch did a bare window.location.reload(). That
 * does NOT skipWaiting, so the old SW kept control and re-served the OLD bundle;
 * the freshly-installed bundle stayed WAITING and its onNeedRefresh then raised a
 * SECOND gate around login.
 *
 * bug39 only mitigated this via a race: it let a later requireUpdate('sw') UPGRADE
 * the reason to route through skipWaiting — but that upgrade only lands if
 * onNeedRefresh fires BEFORE the click. Click first (slow/flaky SW install) and
 * the reason stays 'version-mismatch' and the bare-reload strands the SW.
 *
 * The fix decides skipWaiting-vs-reload from the ACTUAL waiting SW
 * (registration?.waiting, via the store's waiting probe) instead of from `reason`,
 * so the raced version-mismatch gate still activates the waiting bundle in ONE
 * click. This spec reproduces the RACE-LOST case (reason never upgrades) and
 * proves a single click takes skipWaiting, not a bare reload — driven through the
 * login boundary the report describes.
 *
 * SCOPE: like bug39-update-gate-aggressive.qa.spec.js, a real new BUILD's waiting
 * SW is out of container scope; we drive the real in-page singletons the way
 * pwaUpdate/sessionInit do in production. The workbox skipWaiting-vs-reload wiring
 * itself is unit-covered in stores/updateGateStore.test.js.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5930-update-gate-single-through-login.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const GATE_SELECTOR = '[role="alertdialog"]';

test.describe('T5930 update-gate fires once through login', () => {
  // Drives /src/... Vite-dev source imports in-page (404s on a deployed build);
  // the skipWaiting wiring is also fully Vitest-covered. Skip loudly on deployed.
  skipOnDeployedTarget(test, "import()s /src/stores/updateGateStore.js (Vite-dev path)");
  test.setTimeout(60_000);

  test('RACE LOST: a version-mismatch gate with a WAITING SW updates in ONE click (skipWaiting, not bare reload), no second gate through login', async ({ context, page }) => {
    // --- Pre-login: the gate the user first sees on the login screen ---------
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    // Simulate the exact wild race: a new bundle IS waiting (probe -> true) and a
    // stand-in updateSW records how it's invoked, but onNeedRefresh has NOT fired
    // yet — so ONLY the backend version-mismatch raises the gate and `reason`
    // never upgrades to 'sw'. A bare reload here would strand the waiting SW.
    const raiseState = await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      window.__t5930 = { swCalledWith: undefined, bareReloadCalled: false };
      useUpdateGateStore.getState().setUpdateSW((v) => { window.__t5930.swCalledWith = v; });
      // registration?.waiting is truthy — the fix's race-free signal.
      useUpdateGateStore.getState().setWaitingProbe(() => true);
      useUpdateGateStore.getState().requireUpdate('version-mismatch'); // the race is LOST: no 'sw' upgrade
      const s = useUpdateGateStore.getState();
      return { isUpdateRequired: s.isUpdateRequired, reason: s.reason };
    });
    expect(raiseState.isUpdateRequired).toBe(true);
    expect(raiseState.reason).toBe('version-mismatch'); // NOT upgraded — the wild bug's precondition

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible();
    await expect(gate).toHaveCount(1); // exactly ONE gate
    await saveEvidence(page, 't5930-pre-login-single-gate');

    // ONE click. Logged out -> no flush barrier; the fix consults the waiting
    // probe and takes updateSW(true)/skipWaiting instead of a bare reload.
    await gate.getByRole('button', { name: /update now/i }).click();
    await expect.poll(async () => page.evaluate(() => window.__t5930.swCalledWith)).toBe(true);

    // In production, skipWaiting -> the new SW's 'controlling' event reloads onto
    // the NEW bundle, so onNeedRefresh never re-fires and there is NO second gate.
    // Simulate that activation: the SW is no longer waiting, and a return-to-app
    // re-check must not raise a new gate.
    const secondGate = await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      // Clear the acted-on gate (the real reload would boot a fresh page with the
      // gate down) and flip the probe: the bundle activated, nothing is waiting.
      useUpdateGateStore.setState({ isUpdateRequired: false, reason: null });
      useUpdateGateStore.getState().setWaitingProbe(() => false);
      // A resume re-check on the now-current build must NOT re-gate.
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      return useUpdateGateStore.getState().isUpdateRequired;
    });
    expect(secondGate).toBe(false);

    // --- Cross the login boundary: the report's "after logging in" moment ----
    // The UpdateGateModal renders above the auth surface (main.jsx), outside auth
    // gating, so logging in must not surface a second gate.
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000); // let any post-login /api/version re-check resolve
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);
    await saveEvidence(page, 't5930-post-login-no-second-gate');

    console.log('[T5930] PASS: raced version-mismatch gate + waiting SW updated in ONE click (skipWaiting); no second gate before or after login');
  });
});
