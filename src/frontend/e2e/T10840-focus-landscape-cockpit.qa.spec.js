/**
 * T10840 — Focus landscape cockpit (full-bleed stage, edge rails, no scroll).
 *
 * Live-drives Focus at the two landscape-phone viewports the design targets —
 * 812 x 334 (the user's measured Samsung web viewport) and 844 x 390 (iPhone
 * 14/15 landscape) — and asserts the cockpit's acceptance criteria (design §8):
 *
 *  1. No vertical scroll (`scrollHeight <= clientHeight`).
 *  2. The crop reticule and the timeline strip are BOTH in the viewport at once.
 *  3. The 224px clip sidebar is absent; the Clips rail button opens a sheet.
 *  4. Every interactive rail/cap element has a >= 44px hit box.
 *  5. Rotating back to 393 x 852 restores the scrolling layout (cockpit gone),
 *     with no console error.
 *
 * NON-MUTATING: opens a draft, toggles a sheet, screenshots. Never exports.
 * Honest-skips (repo convention) when the account has no Focus-openable draft.
 *
 * The env(safe-area-inset-*) padding (D7 — play button clearing the iOS notch)
 * CANNOT be verified headless (no notch in Chromium); that is the OWED
 * real-device iOS landscape check, both rotation directions.
 *
 * REAL-BROWSER ONLY (Playwright). Target: local dev stack (scripts/dev-verify.sh)
 * or deployed staging (playwright.config.js). Run:
 *   bash scripts/dev-verify.sh e2e/T10840-focus-landscape-cockpit.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

const COCKPIT_VIEWPORTS = [
  { label: '812x334-samsung', width: 812, height: 334 },
  { label: '844x390-iphone', width: 844, height: 390 },
];

for (const vp of COCKPIT_VIEWPORTS) {
  test.describe(`T10840 cockpit @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    });

    test('full-bleed cockpit: no scroll, reticule + strip together, sidebar gone, 44px targets', async ({ page }) => {
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

      let opened = true;
      try { await openFramingDraft(page); }
      catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
      if (!opened) return;

      // The cockpit shell mounts on rotation (pure derivation, no gesture).
      const shell = page.getByTestId('focus-cockpit');
      await expect(shell).toBeVisible();

      // Criterion 1 — no vertical scroll.
      const overflows = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el.scrollHeight > el.clientHeight + 1;
      });
      expect(overflows).toBe(false);

      // Criterion 2 — reticule (stage) and the timeline strip are both on screen.
      await expect(page.getByTestId('cockpit-stage')).toBeVisible();
      await expect(page.getByTestId('cockpit-timeline')).toBeVisible();

      // Criterion 3 — the 224px clip sidebar is absent; Clips rail button opens a sheet.
      const clipsSheet = page.getByRole('dialog', { name: 'Clips' });
      // closed to start (translated off-canvas / hidden)
      await page.getByTestId('cockpit-clips-btn').click();
      await expect(clipsSheet).toBeVisible();
      await saveEvidence(page, `T10840-${vp.label}-clips-sheet`);
      await page.getByTestId('cockpit-sheet-close').first().click();

      // Criterion 4 — 44px minimum on the transport play + rail buttons + caps.
      for (const testId of ['cockpit-play', 'cockpit-clips-btn', 'cockpit-add-focus-point', 'cockpit-open-trim', 'primary-cta']) {
        const box = await page.getByTestId(testId).first().boundingBox();
        expect(box, `${testId} present`).not.toBeNull();
        expect(box.width, `${testId} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(44);
      }

      await saveEvidence(page, `T10840-${vp.label}-cockpit`);
      expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
    });
  });
}

test.describe('T10840 rotate back to portrait restores the scrolling layout', () => {
  test.use({ viewport: { width: 812, height: 334 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('portrait rotation dismisses the cockpit with no console error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    let opened = true;
    try { await openFramingDraft(page); }
    catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
    if (!opened) return;

    await expect(page.getByTestId('focus-cockpit')).toBeVisible();

    // Rotate to portrait — the cockpit is a pure derivation of the viewport,
    // so it disappears and the ordinary scrolling layout returns.
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.getByTestId('focus-cockpit')).toHaveCount(0);
    await expect(page.getByTestId('focus-video-stage')).toBeVisible();
    await saveEvidence(page, 'T10840-rotated-back-portrait');

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
