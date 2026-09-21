/**
 * T10820 — the mobile settings panel now builds UPWARD FROM THE ROW THE USER
 * TAPPED, instead of animating in above the top of the scrolled-past stage row
 * (T9270's original geometry). This spec proves the acceptance criterion itself,
 * independent of T9270-mobile-drawer.qa.spec.js's broader panel-mechanics/
 * touch-target/overflow coverage:
 *
 *   Overlay and Focus, at 393x852 and 360x740: scroll until `mobile-settings-row`
 *   is near the bottom of the viewport (the real-world state a phone user is in
 *   before they ever tap it), record the row's box, tap it, then assert:
 *     (a) the panel's box is fully inside the viewport
 *     (b) the panel's top edge is ABOVE the row's recorded top (it grew upward
 *         past the tap point, not off-screen above it)
 *     (c) the CTA/action-band box is unchanged and not covered by the panel
 *     (d) the stage box is unchanged while the panel is open (T9270 invariant)
 *     (e) closing returns to the parked state with scroll position unchanged
 *
 * Real-account login + viewport/skip pattern follows the current house standard
 * for mobile e2e specs (T10810-mobile-marker-disc.qa.spec.js /
 * T10780-mobile-timeline-zoom.qa.spec.js): imankh+devfixture@gmail.com,
 * skipOnDeployedTarget (dev-login is dev-only), hasTouch+isMobile. Draft-opening
 * mechanics reuse the shared T9270 helpers (openFramingDraft /
 * openLoadableOverlayDraft), which skip loudly rather than fail when the account
 * has no openable draft for that screen.
 */
import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

const VIEWPORTS = [
  { name: '393x852', width: 393, height: 852 },
  { name: '360x740', width: 360, height: 740 },
];

const SCREENS = [
  {
    name: 'Overlay',
    open: (page) => openLoadableOverlayDraft(page),
    stageTestId: 'overlay-video-stage',
  },
  {
    name: 'Focus',
    open: async (page) => {
      try { await openFramingDraft(page); return { ok: true }; }
      catch (e) { return { ok: false, reason: `no Focus-openable draft: ${e.message}` }; }
    },
    stageTestId: 'focus-video-stage',
  },
];

function assertBoxInViewport(box, label, vp) {
  expect(box, `${label}: has a box`).toBeTruthy();
  expect(box.x, `${label}: left >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label}: top >= 0`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: right within viewport`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height, `${label}: bottom within viewport`).toBeLessThanOrEqual(vp.height + 0.5);
}

function assertBoxesEqual(a, b, label) {
  for (const k of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(a[k] - b[k]), `${label}: ${k} unchanged`).toBeLessThanOrEqual(0.5);
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`T10820 mobile settings panel anchor @ ${vp.name}`, () => {
    skipOnDeployedTarget(test, 'dev-login is dev-only');
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    });

    for (const screen of SCREENS) {
      test(`${screen.name}: panel grows upward from the tapped row, fully on-screen, CTA and stage untouched`, async ({ page }) => {
        const res = await screen.open(page);
        test.skip(!res.ok, res.reason || `no ${screen.name}-openable draft on this account`);

        const row = page.getByTestId('mobile-settings-row');
        await row.waitFor({ state: 'visible', timeout: 20000 });

        // Scroll the row down near the bottom of the viewport — the real state a
        // phone user is in (the row sits below the timeline, well past the fold)
        // before they ever tap it. scrollIntoViewIfNeeded finds the app's actual
        // inner scroll container (App.jsx's `flex-1 overflow-auto` pane).
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);

        const scrollBefore = await page.evaluate(() => {
          const scroller = document.querySelector('.overflow-auto') || document.scrollingElement;
          return scroller ? scroller.scrollTop : 0;
        });

        const rowBox = await row.boundingBox();
        expect(rowBox, `${screen.name}: settings row has a box`).toBeTruthy();

        const cta = page.getByTestId('primary-cta');
        await cta.waitFor({ state: 'visible', timeout: 20000 });
        const ctaClosed = await cta.boundingBox();

        const stage = page.getByTestId(screen.stageTestId);
        await stage.waitFor({ state: 'visible', timeout: 20000 });
        const stageClosed = await stage.boundingBox();

        // aria-expanded reflects the panel's open state on the row itself (T10820
        // design doc §2.1: the row stays put, flips state, rotates its chevron).
        await expect(row, `${screen.name}: row not expanded before tap`).toHaveAttribute('aria-expanded', 'false');

        await row.tap();
        await page.waitForTimeout(450); // 320ms translateY tween

        await expect(row, `${screen.name}: row reports expanded after tap`).toHaveAttribute('aria-expanded', 'true');

        const panel = page.getByTestId('settings-drawer');
        await panel.waitFor({ state: 'attached', timeout: 10000 });
        const panelBox = await panel.boundingBox();

        // (a) the panel's box is fully inside the viewport.
        assertBoxInViewport(panelBox, `${screen.name} panel (open)`, vp);

        // (b) the panel's top edge is ABOVE the row's recorded top — it grew
        // upward past the tap point, not off-screen somewhere else.
        expect(panelBox.y, `${screen.name}: panel top rose above the row's tapped position`).toBeLessThan(rowBox.y);

        // (c) the CTA/action-band box is unchanged and not covered by the panel.
        const ctaOpen = await cta.boundingBox();
        assertBoxesEqual(ctaClosed, ctaOpen, `${screen.name} CTA (panel open)`);
        expect(panelBox.y + panelBox.height, `${screen.name}: panel bottom does not cover the CTA`).toBeLessThanOrEqual(ctaOpen.y + 0.5);

        // (d) the stage box is unchanged while the panel is open (T9270 invariant:
        // the mobile panel's presence never alters the stage box).
        const stageOpen = await stage.boundingBox();
        assertBoxesEqual(stageClosed, stageOpen, `${screen.name} stage (panel open)`);

        await saveEvidence(page, `t10820-anchor_${screen.name}_${vp.name}_open`);

        // (e) closing returns to the parked state with scroll position unchanged.
        const close = page.getByTestId('drawer-close');
        await close.click();
        await page.waitForTimeout(450);

        await expect(row, `${screen.name}: row reports collapsed after close`).toHaveAttribute('aria-expanded', 'false');

        const tyParked = await panel.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
        expect(tyParked, `${screen.name}: panel parked below the fold after close`).toBeGreaterThan(20);

        const scrollAfter = await page.evaluate(() => {
          const scroller = document.querySelector('.overflow-auto') || document.scrollingElement;
          return scroller ? scroller.scrollTop : 0;
        });
        expect(Math.abs(scrollAfter - scrollBefore), `${screen.name}: scroll position unchanged after close`).toBeLessThanOrEqual(1);

        await saveEvidence(page, `t10820-anchor_${screen.name}_${vp.name}_closed`);
      });
    }
  });
}
