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
import { openFramingDraft } from './helpers/framingDraft.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';

// reference_dev_fixture_account (house standard, T10780/T10810/T10820): its dev DB
// carries the seeded games this spec uses; imankh@gmail.com's dev profile does not.
// dev-login is dev-only.
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const PORTRAIT = { width: 390, height: 844 };   // iPhone 14 portrait
const LANDSCAPE = { width: 844, height: 390 };   // iPhone 14 landscape

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
  test('Framing: the primary below-timeline control is reachable + clickable on mobile (portrait & landscape)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();

    // The T4880 regression was a mobile fullscreen takeover that HID the
    // below-timeline controls. We CREATE our own genuinely unframed draft (the
    // account's first openable draft is unframed; and a framed draft's full-band
    // CTA is `hidden sm:flex` at 390 anyway — not visible — so it can't satisfy an
    // enabled+clickable check). On an unframed draft the primary below-timeline
    // control is the T11700 "Set focus point" button, present+enabled on EVERY
    // layout; proving IT reachable+clickable is the current-flow form of this
    // regression guard. The disabled Generate CTA / compact locked band is proven
    // in T8510 + T11700-frame-unlock. (openFramingDraft kept imported for the
    // overlay test below.)
    let rawClipId = null;
    try {
      const draft = await createUnframedDraft(context, {});
      rawClipId = draft.rawClipId;
      await page.goto('/');
      const card = page.locator('[data-testid="project-card"]', { hasText: draft.name }).first();
      await card.waitFor({ timeout: 20000 });
      await card.click();
      await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

      // --- Portrait (inline layout): the unframed primary below-timeline control
      // is the T11700 "Set focus point" button (`sm:hidden`, directly under the
      // stage) — the exact control the old fullscreen takeover hid. ---
      await page.setViewportSize(PORTRAIT);
      const setBtn = page.locator('[data-testid="set-focus-point-button"]:visible').first();
      await setBtn.waitFor({ timeout: 10000 });
      await assertReachableAndClickable(page, setBtn, 'Set focus point (portrait)');
      await saveEvidence(page, 'T4880-framing-setfocus-portrait');

      // Actually frame the clip (one tap) so the primary CTA enables. This also
      // lets the LANDSCAPE check assert an ENABLED control: landscape mobile early-
      // returns to the cockpit layout (FocusCockpit), which has NO under-stage Set
      // focus point button — its reachable primary control is the cockpit CTA
      // (`primary-cta`), disabled while unframed, so we frame first.
      await setBtn.click();
      await expect(page.locator('[data-testid="primary-cta"]:visible').first(), 'primary CTA enabled after first point').toBeEnabled();

      // --- Landscape (cockpit layout): the primary CTA must be reachable +
      // clickable (the regression was a takeover hiding it). Re-resolve after the
      // viewport flip and let the cockpit settle. ---
      await page.setViewportSize(LANDSCAPE);
      await page.waitForTimeout(600);
      const landscapeCta = page.locator('[data-testid="primary-cta"]:visible').first();
      await landscapeCta.waitFor({ timeout: 15000 });
      await assertReachableAndClickable(page, landscapeCta, 'Primary CTA (landscape cockpit)');
      // Reviewer BLOCKING/MAJOR guard: the clip is now framed (one focus point), so
      // the landscape COCKPIT must NOT show the T11710 coach ring/chip. It did before
      // the fix (FocusCockpit rendered CropOverlay without focusPointCount/isPlaying/
      // isDragging, pinning showCoach on). FIRST confirm the cockpit + crop overlay
      // actually mounted, so a failed-to-mount cockpit can't produce a false-positive
      // "chip count 0" pass; THEN assert the chip is absent.
      await expect(page.getByTestId('focus-cockpit'), 'landscape cockpit mounted').toBeVisible();
      await expect(page.locator('.crop-handle').first(), 'crop overlay mounted in cockpit').toBeVisible();
      await expect(page.locator('[data-testid="focus-coach-chip"]'), 'no coach chip in landscape cockpit once framed').toHaveCount(0);
      // Landscape (844) is wider than the pre-existing mode-tab overflow (~548px),
      // so the strict document-level overflow check holds here (the cockpit shell is
      // `overflow-hidden` by design).
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, 'T4880-framing-cta-landscape');

      // 699/tablet/desktop widths are all clear of the mode-tab overflow (~548px),
      // so restore the strict overflow + evidence sweep there. ONLY the narrow
      // PORTRAIT widths (320-390) are deferred: the mode-tab row (Annotate / Focus /
      // Overlay) in the `flex-1 overflow-auto` pane extends to ~548px and overflows
      // them, which is T11740's scope, not this epic's — folding it in here would
      // fail a reachability spec on an unrelated, out-of-scope defect. The scoped
      // Epic-A overflow audit at 320-390 (our own elements, logged mode-tab offender)
      // lives in T11700-frame-unlock.qa.spec.js.
      for (const w of [699, 768, 1024, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(300);
        await assertNoHorizontalOverflow(page);
        await saveEvidence(page, `T4880-framing-desktop-${w}`);
      }
    } finally {
      if (rawClipId) await deleteClip(context, rawClipId);
      await context.close();
    }
  });

  test('Overlay: Create Reel control reachable + clickable (portrait & landscape)', async ({ browser }) => {
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
    await (await overlayTab.count() ? overlayTab : page.getByRole('button', { name: /Spotlight/ }).first()).click();

    // In overlay mode the primary export button is labelled "Create Reel" (T7580).
    const createReel = page.getByRole('button', { name: /Create Reel/ });

    // --- Portrait ---
    await page.setViewportSize(PORTRAIT);
    await createReel.waitFor({ timeout: 90000 });
    await assertReachableAndClickable(page, createReel, 'Create Reel (portrait)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-createreel-portrait');

    // --- Landscape ---
    await page.setViewportSize(LANDSCAPE);
    await assertReachableAndClickable(page, createReel, 'Create Reel (landscape)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-createreel-landscape');

    await responsiveSweep(page);
    await context.close();
  });
});
