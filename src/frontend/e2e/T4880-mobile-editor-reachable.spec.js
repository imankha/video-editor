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
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
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
    // control is the crop box, present on EVERY
    // layout; proving IT reachable+clickable is the current-flow form of this
    // regression guard. The disabled Generate CTA / compact locked band is proven
    // in T8510 + T11700-frame-unlock.
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
      // is the draggable crop box (guided step 1) — it must stay reachable under
      // the inline layout, the exact thing the old fullscreen takeover hid. ---
      await page.setViewportSize(PORTRAIT);
      const cropBox = page.locator('[data-testid="focus-video-stage"] .cursor-move').first();
      await cropBox.waitFor({ timeout: 10000 });
      await assertReachableAndClickable(page, cropBox, 'Crop box (portrait)');
      // T11740 (merged) fixed the editor header overflow that previously made this
      // check fail at 390 (the two-row compact header replaced the one-row
      // non-wrapping header whose mode tabs ran to ~548px); T11740's own spec
      // (T11740-editor-header-no-overflow.qa.spec.js) proves zero overflow for the
      // Focus editor at 320/360/375/390/768 live. Restored to parity with this
      // spec's original (pre-Epic-A) assertion, which checked overflow after every
      // reachability step.
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, 'T4880-framing-setfocus-portrait');

      // Actually frame the clip (drag the box, then press play: the guided steps)
      // so the primary CTA enables. This also lets the LANDSCAPE check assert an
      // ENABLED control: landscape mobile early-returns to the cockpit layout
      // (FocusCockpit), whose reachable primary control is the cockpit CTA
      // (`primary-cta`), disabled while unframed, so we frame first.
      const cb = await cropBox.boundingBox();
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.down();
      await page.mouse.move(cb.x + cb.width / 2 + 20, cb.y + cb.height / 2 + 8, { steps: 6 });
      await page.mouse.up();
      await page.locator('button[title="Play"]').click();
      // After unlock the real primary CTA (Generate Highlight) takes over the band
      // in PORTRAIT. Restore the original T4880 guarantee for it: not just enabled,
      // but REACHABLE + clickable + in the viewport (the sticky band keeps it
      // on-screen) — the whole point of the regression was a takeover hiding it.
      const portraitCta = page.locator('[data-testid="primary-cta"]:visible').first();
      await assertReachableAndClickable(page, portraitCta, 'primary CTA after unlock (portrait)');
      await expect(portraitCta, 'unlocked CTA sits in the viewport at 390').toBeInViewport();
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, 'T4880-framing-cta-portrait-unlocked');

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

      // Full responsive sweep (360/390/699/768/1024/1440), restored to parity with
      // this spec's pre-Epic-A original: T11740 (merged) fixed the mode-tab-row
      // overflow at the narrow widths (previously deferred here as "T11740's scope,
      // not yet merged" — it is merged now and live-proven clean by T11740's own
      // spec, see the note above).
      await responsiveSweep(page);
    } finally {
      if (rawClipId) await deleteClip(context, rawClipId);
      await context.close();
    }
  });

  test('Overlay: primary CTA reachable + clickable (portrait & landscape)', async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();

    // T11905: open a Spotlight draft through the shared helper (tile actions found by test id)
    // instead of the account's first Framing draft, which may never have been exported.
    const opened = await openLoadableOverlayDraft(page, { minReadyState: 2 });
    expect(opened.ok, `no Spotlight draft opened: ${opened.reason}`).toBe(true);

    // The overlay primary CTA ('Add spotlight to highlight'; once 'Create Reel', T7580/T7700),
    // found by test id so a label change cannot hide it from this spec.
    const overlayCta = page.locator('[data-testid="primary-cta"]:visible').first();

    // --- Portrait ---
    await page.setViewportSize(PORTRAIT);
    await overlayCta.waitFor({ timeout: 90000 });
    await assertReachableAndClickable(page, overlayCta, 'Overlay primary CTA (portrait)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-createreel-portrait');

    // --- Landscape ---
    await page.setViewportSize(LANDSCAPE);
    await assertReachableAndClickable(page, overlayCta, 'Overlay primary CTA (landscape)');
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T4880-overlay-createreel-landscape');

    await responsiveSweep(page);
    await context.close();
  });
});
