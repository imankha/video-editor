/**
 * T9270 — CTA above the fold + rail collapse geometry (DESKTOP).
 *
 * The governing rule of T9270: ONE saturated element per screen, and it is the
 * primary CTA (data-testid="primary-cta") — it lives in the full-width action
 * band, NEVER inside the settings rail, and its rendered box must be byte-
 * identical whether the rail is expanded or collapsed.
 *
 * This spec asserts GEOMETRY with boundingBox(), not toBeVisible() — presence is
 * what the old mobileReachable tests proved and it is NOT enough here (task
 * acceptance criteria 1, 2, 7). REAL-BROWSER ONLY (Playwright headed), never
 * jsdom — the whole point is real flex/viewport layout.
 *
 * Target: local dev stack OR deployed staging (playwright.config.js). Logs in as
 * the seeded real account and OPENS Focus / Overlay; it is NON-MUTATING (never
 * clicks the CTA, never exports). Skips loudly when the account lacks a
 * Focus-openable / Overlay-openable draft (repo honest-skip convention).
 *
 * NOTE (execution): the T9270 container had no Playwright browsers and no backend
 * venv, so this spec was authored but NOT run there — it is a QA artifact to run
 * against a real stack / staging. See docs/plans/tasks/T9270-* and .dotask-status.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

// The three desktop viewports the task pins (criterion 1). test.use fixes the
// viewport at context creation so the app MOUNTS desktop (rail in-flow), not
// after a mid-test resize.
const DESKTOP_VIEWPORTS = [
  { name: '1280x900', width: 1280, height: 900 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x768', width: 1280, height: 768 },
];

/** A box is fully inside the viewport (no scrolling) when every edge is within it. */
function assertBoxInViewport(box, vp, label) {
  expect(box, `${label}: CTA has a bounding box`).toBeTruthy();
  expect(box.x, `${label}: left edge >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label}: top edge >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: right edge within viewport`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height, `${label}: bottom edge within viewport`).toBeLessThanOrEqual(vp.height + 0.5);
}

/** Two boxes are byte-identical (the CTA must not move/resize on rail toggle). */
function assertBoxesEqual(a, b, label) {
  for (const k of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(a[k] - b[k]), `${label}: CTA ${k} unchanged`).toBeLessThanOrEqual(0.5);
  }
}

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(`T9270 CTA above the fold @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    });

    for (const screen of [
      { name: 'Focus', open: (page) => openFramingDraft(page), missing: 'no Focus-openable draft on this account' },
      { name: 'Overlay', open: (page) => openLoadableOverlayDraft(page), missing: 'no Overlay-openable draft on this account' },
    ]) {
      test(`${screen.name}: CTA above the fold and box invariant across rail collapse`, async ({ page }) => {
        const opened = await screen.open(page).then(() => true).catch(() => false);
        test.skip(!opened, screen.missing);

        const cta = page.getByTestId('primary-cta');
        await cta.waitFor({ state: 'visible', timeout: 20000 });

        // Criterion 1: CTA fully within the viewport on first paint, no scroll.
        const boxExpanded = await cta.boundingBox();
        assertBoxInViewport(boxExpanded, vp, `${screen.name} rail-expanded`);
        await saveEvidence(page, `t9270-cta_${screen.name}_${vp.name}_expanded`);

        // Criterion 7: collapsing the rail changes the rail box; the main column
        // reflows for free. Capture the rail width before/after to prove the tween
        // ran on the rail (not the CTA).
        const rail = page.getByTestId('settings-rail');
        const hadRail = await rail.count();
        let railWidthBefore = null;
        if (hadRail) railWidthBefore = (await rail.boundingBox())?.width ?? null;

        const toggle = page.getByTestId('rail-collapse-toggle');
        if (await toggle.count()) {
          await toggle.first().click();
          // Wait out the 320ms width tween before re-measuring.
          await page.waitForTimeout(450);

          // Criterion 2: the CTA box is byte-identical collapsed vs expanded.
          const boxCollapsed = await cta.boundingBox();
          assertBoxesEqual(boxExpanded, boxCollapsed, `${screen.name} CTA collapsed`);
          assertBoxInViewport(boxCollapsed, vp, `${screen.name} rail-collapsed`);

          // Criterion 7: the rail itself narrowed (300px -> 64px strip).
          if (hadRail && railWidthBefore != null) {
            const railWidthAfter = (await rail.boundingBox())?.width ?? null;
            expect(railWidthAfter, `${screen.name}: rail narrowed on collapse`).toBeLessThan(railWidthBefore);
          }
          await saveEvidence(page, `t9270-cta_${screen.name}_${vp.name}_collapsed`);
        }
      });
    }
  });
}
