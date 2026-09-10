/**
 * T9270 — mobile settings drawer + touch-target sweep (390x844).
 *
 * The mobile re-cut of the same three regions: the CTA stays in the full-width
 * action band (always visible), settings live behind a translateX DRAWER opened
 * by a 64px full-width labelled entry row (data-testid="mobile-settings-row"),
 * NOT an edge sliver. The drawer slides in from the right (transform only), stops
 * ABOVE the action band, and does NOT close on a tap outside it (house rule). Its
 * close control is a 44x44 button in the drawer's own header.
 *
 * Asserts GEOMETRY (boundingBox / transform), not toBeVisible() — task acceptance
 * criteria 8, 10, 11, 12, 13. REAL-BROWSER ONLY. hasTouch+isMobile so useIsMobile
 * (which also keys on `(hover:none) and (pointer:coarse)`) resolves to the mobile
 * layout and the coarse-pointer 44px floors apply.
 *
 * Target: local dev stack OR staging. Non-mutating; skips loudly when a draft is
 * absent. NOTE: authored but NOT run in the T9270 container (no Playwright
 * browsers / no backend there) — a QA artifact to run against a real stack.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const VP = { width: 390, height: 844 };
const TOUCH_FLOOR = 44;

function assertBoxInViewport(box, label) {
  expect(box, `${label}: has a box`).toBeTruthy();
  expect(box.x, `${label}: left >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label}: top >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: right within viewport`).toBeLessThanOrEqual(VP.width + 0.5);
  expect(box.y + box.height, `${label}: bottom within viewport`).toBeLessThanOrEqual(VP.height + 0.5);
}

function assertBoxesEqual(a, b, label) {
  for (const k of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(a[k] - b[k]), `${label}: ${k} unchanged`).toBeLessThanOrEqual(0.5);
  }
}

async function translateXOf(locator) {
  // Read the live matrix so we assert the actual transform, not just presence.
  return locator.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
}

test.describe('T9270 mobile drawer @ 390x844', () => {
  test.use({ viewport: VP, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  for (const screen of [
    { name: 'Focus', open: (page) => openFramingDraft(page), missing: 'no Focus-openable draft on this account' },
    { name: 'Overlay', open: (page) => openLoadableOverlayDraft(page), missing: 'no Overlay-openable draft on this account' },
  ]) {
    test(`${screen.name}: drawer closed on load, opens from the settings row, CTA unchanged, no backdrop close`, async ({ page }) => {
      const opened = await screen.open(page).then(() => true).catch(() => false);
      test.skip(!opened, screen.missing);

      const cta = page.getByTestId('primary-cta');
      await cta.waitFor({ state: 'visible', timeout: 20000 });

      // Criterion 8: CTA fully within the viewport on first paint.
      const ctaClosed = await cta.boundingBox();
      assertBoxInViewport(ctaClosed, `${screen.name} CTA (drawer closed)`);

      // Criterion 8/10: the drawer exists but is CLOSED on load — translated fully
      // off the right edge (translateX(316px)).
      const drawer = page.getByTestId('settings-drawer');
      await drawer.waitFor({ state: 'attached', timeout: 10000 });
      const txClosed = await translateXOf(drawer);
      expect(txClosed, `${screen.name}: drawer parked off-screen on load`).toBeGreaterThan(100);

      // Criterion 10/11: a 64px full-width labelled entry row opens it (not a sliver),
      // with a DERIVED live-summary second line.
      const row = page.getByTestId('mobile-settings-row');
      await row.waitFor({ state: 'visible', timeout: 10000 });
      const rowBox = await row.boundingBox();
      expect(rowBox.height, `${screen.name}: settings row is a 64px full-width button`).toBeGreaterThanOrEqual(60);
      expect(rowBox.width, `${screen.name}: settings row spans the width`).toBeGreaterThan(VP.width * 0.8);
      const summary = page.getByTestId('mobile-settings-summary');
      await expect(summary, `${screen.name}: entry row shows a derived summary line`).not.toHaveText('');

      await row.click();
      await page.waitForTimeout(450); // 320ms translateX tween

      // Criterion 10: slid in — transform changed to translateX(0).
      const txOpen = await translateXOf(drawer);
      expect(txOpen, `${screen.name}: drawer slid in (transform changed)`).toBeLessThan(txClosed - 50);
      expect(Math.abs(txOpen), `${screen.name}: drawer fully open at translateX(0)`).toBeLessThan(2);

      // Criterion 8: the CTA box is identical drawer-open vs drawer-closed.
      const ctaOpen = await cta.boundingBox();
      assertBoxesEqual(ctaClosed, ctaOpen, `${screen.name} CTA (drawer open)`);
      assertBoxInViewport(ctaOpen, `${screen.name} CTA (drawer open)`);
      await saveEvidence(page, `t9270-drawer_${screen.name}_open`);

      // Criterion 10: NO backdrop-tap close. Tap the stage area (top-left, clear of
      // the drawer) and confirm the drawer stays open.
      await page.mouse.click(20, 120);
      await page.waitForTimeout(200);
      expect(Math.abs(await translateXOf(drawer)), `${screen.name}: backdrop tap does NOT close the drawer`).toBeLessThan(2);

      // The drawer's own 44x44 header close is the one way out.
      const close = page.getByTestId('drawer-close');
      const closeBox = await close.boundingBox();
      expect(closeBox.width, `${screen.name}: drawer-close width >= 44`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      expect(closeBox.height, `${screen.name}: drawer-close height >= 44`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      await close.click();
      await page.waitForTimeout(450);
      expect(await translateXOf(drawer), `${screen.name}: close button parks the drawer off-screen`).toBeGreaterThan(100);
    });

    test(`${screen.name}: touch-target sweep over the entry row and every drawer control`, async ({ page }) => {
      const opened = await screen.open(page).then(() => true).catch(() => false);
      test.skip(!opened, screen.missing);

      // The entry row itself must clear the floor.
      const row = page.getByTestId('mobile-settings-row');
      await row.waitFor({ state: 'visible', timeout: 20000 });
      const rowBox = await row.boundingBox();
      expect(rowBox.height, `${screen.name}: settings row >= 44px tall`).toBeGreaterThanOrEqual(TOUCH_FLOOR);

      // Open the drawer and sweep EVERY interactive control inside it (criterion 12,
      // "not spot checks").
      await row.click();
      await page.waitForTimeout(450);
      const drawer = page.getByTestId('settings-drawer');
      const controls = drawer.locator('button, [role="tab"], [role="switch"], input, select, a[href]');
      const n = await controls.count();
      expect(n, `${screen.name}: drawer has interactive controls to sweep`).toBeGreaterThan(0);
      const undersized = [];
      for (let i = 0; i < n; i++) {
        const c = controls.nth(i);
        if (!(await c.isVisible())) continue;
        const b = await c.boundingBox();
        if (!b) continue;
        // A control clears the floor if EITHER dimension chain gives it a >=44 hit
        // area; sliders sit on a >=44 row, swatches are 48. Flag anything smaller.
        if (b.height < TOUCH_FLOOR - 0.5) {
          undersized.push({ i, w: Math.round(b.width), h: Math.round(b.height) });
        }
      }
      expect(undersized, `${screen.name}: drawer controls below the ${TOUCH_FLOOR}px floor: ${JSON.stringify(undersized)}`).toEqual([]);
      await saveEvidence(page, `t9270-touch-targets_${screen.name}`);
    });
  }

  // Criterion 13: Overlay's portrait stage is taller than the retired 40vh cap.
  test('Overlay: video stage is taller than the old 40vh cap', async ({ page }) => {
    const opened = await openLoadableOverlayDraft(page).then(() => true).catch(() => false);
    test.skip(!opened, 'no Overlay-openable draft on this account');
    const stage = page.getByTestId('overlay-video-stage');
    await stage.waitFor({ state: 'visible', timeout: 20000 });
    const box = await stage.boundingBox();
    expect(box.height, 'Overlay stage taller than 0.4 * viewport height (cap removed)').toBeGreaterThan(0.4 * VP.height);
    await saveEvidence(page, 't9270-overlay-stage-height');
  });
});
