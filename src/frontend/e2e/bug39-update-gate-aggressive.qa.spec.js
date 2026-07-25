import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * bug39 — update-to-new-version gate fires too aggressively.
 *
 * Reproduces + verifies the fix for the three reported symptoms by driving the
 * REAL in-page singletons (updateGateStore + appVersion) the same way sessionInit
 * / pwaUpdate drive them in production. This is the container-verifiable slice;
 * real waiting-SW activation across an actual new build is unit-tested in
 * pwaUpdate.test.js / updateGateStore.test.js (a real new build is out of
 * container scope — see the final report).
 *
 *   1. FREQUENCY — after the user acknowledges v2 and reloads, seeing v2 again
 *      (mixed-fleet re-latch) must NOT re-raise the gate.
 *   2. DOUBLE-ACTION — when a version-mismatch gate is later joined by a waiting
 *      SW, the reason upgrades to 'sw' so a SINGLE "Update now" activates the new
 *      bundle via updateSW(true)/skipWaiting instead of a plain reload that would
 *      strand the waiting SW (requiring a second update).
 *   3. RE-FIRES ON RESUME — a Safari bfcache restore (pageshow persisted=true) /
 *      visibility return on an already-current build must NOT re-gate.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/bug39-update-gate-aggressive.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const GATE_SELECTOR = '[role="alertdialog"]';

test.describe('bug39 update-gate aggressiveness', () => {
  // Drives /src/... Vite-dev source imports in-page (404s on a deployed build);
  // gate logic is also fully covered by Vitest. Skip loudly on a deployed target.
  skipOnDeployedTarget(test, "import()s /src/stores/updateGateStore.js + /src/utils/appVersion.js (Vite-dev paths)");
  test.setTimeout(60_000);

  test('symptom 1 — an acknowledged build does NOT re-gate after reload (frequency)', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    // Capture the real X-App-Version and wait for it, so the boot version has
    // latched before we inject the fake drift — otherwise 'bug39-v2' could
    // itself become the boot baseline (a test-timing artifact, not the bug).
    const versionResp = await page.waitForResponse((r) => r.url().includes('/api/'));
    const realVersion = versionResp.headers()['x-app-version'] || 'dev';
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    // Drive a real version drift to a new build 'bug39-v2' (two consecutive
    // observations cross the M2 debounce) -> the gate raises, exactly as prod.
    // Re-assert the real boot version first so the fake is always a CANDIDATE,
    // never the latched baseline.
    await page.evaluate(async (real) => {
      const { checkAppVersion } = await import('/src/utils/appVersion.js');
      checkAppVersion(real);        // ensure boot is the real version
      checkAppVersion('bug39-v2');
      checkAppVersion('bug39-v2');
    }, realVersion);
    await expect(page.locator(GATE_SELECTOR)).toBeVisible({ timeout: 5000 });

    // The "Update now" gesture acknowledges the build being reloaded onto and
    // persists it (sessionStorage), so it survives the reload.
    await page.evaluate(async () => {
      const { acknowledgeAppVersion } = await import('/src/utils/appVersion.js');
      acknowledgeAppVersion();
    });
    const ack = await page.evaluate(() => sessionStorage.getItem('rb_ack_app_version'));
    expect(ack).toBe('bug39-v2');

    // Reload: fresh module singletons, but the acknowledged id survives. This is
    // the mixed-fleet re-latch scenario — the reloaded client re-observes v2.
    await page.reload();
    const reResp = await page.waitForResponse((r) => r.url().includes('/api/'));
    const realVersion2 = reResp.headers()['x-app-version'] || 'dev';
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    const reGated = await page.evaluate(async (real) => {
      const { checkAppVersion } = await import('/src/utils/appVersion.js');
      checkAppVersion(real);       // boot latches the (still-current) real version
      checkAppVersion('bug39-v2'); // already acknowledged last session -> must NOT gate
      checkAppVersion('bug39-v2');
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      return useUpdateGateStore.getState().isUpdateRequired;
    }, realVersion2);
    expect(reGated).toBe(false);
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);
    await saveEvidence(page, 'bug39-symptom1-no-regate-after-ack');

    console.log('[bug39] symptom 1 PASS: acknowledged build does not re-gate after reload');
  });

  test('symptom 2 — a version-mismatch gate joined by a waiting SW updates in ONE action', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Reproduce the race: version-mismatch latches the gate first, THEN the
    // freshly-installed SW's onNeedRefresh fires. Inject a stand-in updateSW so
    // we can observe whether the single click activates it (skipWaiting) instead
    // of a plain reload that leaves the waiting SW stranded (the "twice" bug).
    await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      window.__bug39_swCalledWith = undefined;
      useUpdateGateStore.getState().setUpdateSW((v) => { window.__bug39_swCalledWith = v; });
      useUpdateGateStore.getState().requireUpdate('version-mismatch'); // wins the race
      useUpdateGateStore.getState().requireUpdate('sw');               // SW upgrades it
    });

    const gate = page.locator(GATE_SELECTOR);
    await expect(gate).toBeVisible();
    const reason = await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      return useUpdateGateStore.getState().reason;
    });
    expect(reason).toBe('sw'); // upgraded — this is the fix

    // ONE click: clean session flush-verify returns 200, then the sw branch
    // activates the waiting SW (our stand-in) with true. No plain reload.
    await gate.getByRole('button', { name: /update now/i }).click();
    await expect.poll(async () =>
      page.evaluate(() => window.__bug39_swCalledWith)
    ).toBe(true);
    await saveEvidence(page, 'bug39-symptom2-single-action-activates-sw');

    console.log('[bug39] symptom 2 PASS: single update activated the waiting SW (skipWaiting), no stranded second reload');
  });

  test('symptom 3 — bfcache restore / visibility return on a current build does NOT re-gate (resume)', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);

    // Simulate waking / returning: a Safari bfcache restore fires pageshow with
    // persisted=true; a tab return fires visibilitychange. Both re-run the
    // update check, which on a CURRENT build re-observes the same version and
    // must not raise the gate.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Give the async /api/version re-check time to resolve; the gate must stay down.
    await page.waitForTimeout(1500);
    const gated = await page.evaluate(async () => {
      const { useUpdateGateStore } = await import('/src/stores/updateGateStore.js');
      return useUpdateGateStore.getState().isUpdateRequired;
    });
    expect(gated).toBe(false);
    await expect(page.locator(GATE_SELECTOR)).toHaveCount(0);
    await saveEvidence(page, 'bug39-symptom3-no-regate-on-resume');

    console.log('[bug39] symptom 3 PASS: bfcache/visibility resume on a current build did not re-gate');
  });
});
