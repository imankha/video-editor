import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { openLoadableOverlayDraft } from '../helpers/overlayDraft.js';

/**
 * T11905 - the shared Spotlight-draft helper (e2e/helpers/overlayDraft.js) opens a draft
 * instead of returning ok:false (which the eleven specs that use it turn into a skip).
 * It used to look for an 'Open in Spotlight' button the app no longer renders.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T11905.check.spec.js --reporter=line
 */
test.setTimeout(240000);

test.describe('T11905 Spotlight draft helper', () => {
  test('T11905:C1 the shared helper opens a Spotlight draft so the specs that use it run instead of skipping', async ({ context, page }) => {
    await loginForCheck(context);
    const opened = await openLoadableOverlayDraft(page, { minReadyState: 2 });
    expect(opened.ok, `helper verdict: ${opened.reason}`).toBe(true);
    await expect(page.getByTestId('overlay-video-stage').first()).toBeVisible({ timeout: 60000 });
    expect(page.url()).toContain('/overlay');
  });

  test('T11905:C2 on a phone the Spotlight primary button, found by its test id, is reachable and clickable in portrait and landscape', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await loginForCheck(context);
    const page = await context.newPage();
    const opened = await openLoadableOverlayDraft(page, { minReadyState: 2 });
    expect(opened.ok, `helper verdict: ${opened.reason}`).toBe(true);

    // The same locator e2e/T4880-mobile-editor-reachable.spec.js uses for its Spotlight half.
    const cta = page.locator('[data-testid="primary-cta"]:visible').first();
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(cta).toBeVisible({ timeout: 60000 });
      await cta.scrollIntoViewIfNeeded();
      await expect(cta).toBeEnabled();
      await cta.click({ trial: true, timeout: 5000 });
    }
    await context.close();
  });
});
