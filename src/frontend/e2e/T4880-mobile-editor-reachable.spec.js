/**
 * T4880 — Mobile: Framing/Overlay content below the timeline must be reachable.
 *
 * Regression: on a phone the editor used an always-on fullscreen video takeover
 * that hid the below-timeline controls (Framing "Export" / Overlay "Add
 * Spotlight" + settings) with no way to reach them, so mobile could not complete
 * the framing -> overlay -> export flow. The fix defaults mobile to the inline
 * scrollable layout (fullscreen is opt-in), so those controls render in normal
 * flow and can be scrolled into view AND clicked.
 *
 * This drives the REAL app as a real user (dev-login) at iPhone-sized viewports
 * in BOTH portrait and landscape, and saves per-criterion evidence.
 *
 * HONESTY CAVEAT: Playwright device emulation reproduces the layout math but NOT
 * iOS Safari's dynamic-toolbar (100vh vs 100dvh) chrome behavior. The `h-dvh`
 * shell change that maps the scroll pane to the true visible viewport can only be
 * fully confirmed on a real iPhone — that final check is on the user once this
 * branch is on staging.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PORTRAIT = { width: 390, height: 844 };   // iPhone 14 portrait
const LANDSCAPE = { width: 844, height: 390 };   // iPhone 14 landscape

/** Open the first Framing-ready reel draft; returns once the crop editor loaded. */
async function openFramingDraft(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
  await framingChip.waitFor({ timeout: 30000 });
  await framingChip.click();
  // Framing editor is loaded when the crop handle appears.
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
}

/** Assert a control can be scrolled into view AND is clickable (enabled + hit-able). */
async function assertReachableAndClickable(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, `${label} should be visible`).toBeVisible();
  await expect(locator, `${label} should be enabled`).toBeEnabled();
  // Playwright refuses to click an element covered by another (the exact iOS bug
  // class); trial:true performs all actionability checks WITHOUT firing the click.
  await locator.click({ trial: true, timeout: 5000 });
}

test.describe('T4880 mobile editor reachability', () => {
  test('Framing: Export control reachable + clickable (portrait & landscape)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();

    await openFramingDraft(page);

    // Primary framing export/proceed button ("Export" or "Export (n/m)"), NOT the
    // mode-switcher "Export from Framing first…" tooltip button.
    const exportBtn = page.getByRole('button', { name: /^Export( \(\d+\/\d+\))?$/ });

    // --- Portrait ---
    await page.setViewportSize(PORTRAIT);
    await assertReachableAndClickable(page, exportBtn, 'Framing Export (portrait)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-framing-export-portrait');

    // --- Landscape ---
    await page.setViewportSize(LANDSCAPE);
    await assertReachableAndClickable(page, exportBtn, 'Framing Export (landscape)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-framing-export-landscape');

    // Desktop must be unchanged; mobile 375 must not overflow.
    await responsiveSweep(page);
    await context.close();
  });

  test('Overlay: Add Spotlight control reachable + clickable (portrait & landscape)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();

    await openFramingDraft(page);

    // Overlay mode is only reachable once the reel has an exported/working video.
    // If this env's first draft isn't exported, skip here rather than pass
    // silently — the overlay layout is deterministically covered by the Vitest
    // regression OverlayModeView.mobileReachable.test.jsx.
    // Detect reachability without depending on a single selector: the mode-switcher
    // Overlay tab is disabled (title "Export from Framing first…") until exported.
    const overlayTab = page.getByTestId('mode-overlay');
    const disabledOverlay = page.getByRole('button', { name: /Export from Framing first to enable Overlay mode/ });
    const overlayReachable =
      (await overlayTab.count()) > 0
        ? await overlayTab.isEnabled()
        : (await disabledOverlay.count()) === 0;
    test.skip(!overlayReachable, 'Overlay needs an exported reel in this env; covered by Vitest OverlayModeView.mobileReachable');
    await (await overlayTab.count() ? overlayTab : page.getByRole('button', { name: /Overlay/ }).first()).click();

    // In overlay mode the primary export button is labelled "Add Spotlight".
    const addSpotlight = page.getByRole('button', { name: /Add Spotlight/ });

    // --- Portrait ---
    await page.setViewportSize(PORTRAIT);
    await addSpotlight.waitFor({ timeout: 90000 });
    await assertReachableAndClickable(page, addSpotlight, 'Add Spotlight (portrait)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-addspotlight-portrait');

    // --- Landscape ---
    await page.setViewportSize(LANDSCAPE);
    await assertReachableAndClickable(page, addSpotlight, 'Add Spotlight (landscape)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-addspotlight-landscape');

    await responsiveSweep(page);
    await context.close();
  });
});
