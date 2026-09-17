/**
 * T10310 — expanded settings-rail width sweep (DESKTOP).
 *
 * The bug (Finding 1): SettingsRail.jsx hard-coded the expanded desktop rail at
 * 300px, gated only by `hidden lg:flex`, so it never widened above the `lg`
 * breakpoint — 1280px and 1920px measured identically and the Spotlight controls
 * were too cramped to use. The fix bumps that fixed width to 380px.
 *
 * This spec asserts the RENDERED rail width with boundingBox() (real flex/viewport
 * layout, never jsdom — the unit test in SettingsRail.test.jsx already covers the
 * inline style) at the three widths the task pins: 1024 (the `lg` boundary where
 * the rail first appears), 1280, and 1920. The rail is the SAME shared component on
 * Focus and Overlay, so both screens are swept to prove the widen applies identically
 * (reviewer focus 1). NON-MUTATING: opens the draft, measures, never clicks the CTA.
 *
 * Target: local dev stack OR deployed staging (playwright.config.js). Logs in as the
 * seeded real account. Skips loudly when the account lacks a Focus/Overlay-openable
 * draft (repo honest-skip convention).
 *
 * NOTE (execution): this container has no Playwright browsers / backend venv, so this
 * spec is authored but run against a real stack / staging by the supervisor. See
 * .dotask-status.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

// The expanded desktop rail is a fixed 380px box (SettingsRail.jsx). It must NOT
// vary with viewport width above `lg` — that constancy is exactly what the bug broke
// in the other direction (never widening). A small tolerance covers sub-pixel rounding.
const EXPECTED_RAIL_WIDTH = 380;
const WIDTH_TOLERANCE = 1.5;

// 1024 is the `lg` breakpoint where the in-flow rail first renders (`hidden lg:flex`);
// 1280 and 1920 are the mid/large desktop widths the task pins. Fix the viewport at
// context creation so the app MOUNTS desktop (rail in-flow), not after a mid-test resize.
const DESKTOP_VIEWPORTS = [
  { name: '1024x800', width: 1024, height: 800 },
  { name: '1280x900', width: 1280, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(`T10310 rail width @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    });

    // Same opener contracts as T9270-cta-above-fold: openFramingDraft resolves void
    // and THROWS if no draft opens (wrapped to {ok,reason}); openLoadableOverlayDraft
    // RETURNS {ok, reason} and must be consumed by checking `.ok`.
    for (const screen of [
      {
        name: 'Focus',
        open: async (page) => {
          try { await openFramingDraft(page); return { ok: true }; }
          catch (e) { return { ok: false, reason: `no Focus-openable draft: ${e.message}` }; }
        },
      },
      { name: 'Overlay', open: (page) => openLoadableOverlayDraft(page) },
    ]) {
      test(`${screen.name}: expanded rail is ${EXPECTED_RAIL_WIDTH}px`, async ({ page }) => {
        const res = await screen.open(page);
        test.skip(!res.ok, res.reason || `no ${screen.name}-openable draft on this account`);

        const rail = page.getByTestId('settings-rail');
        await rail.waitFor({ state: 'visible', timeout: 20000 });

        // The rail may mount collapsed; ensure it is expanded before measuring.
        const toggle = page.getByTestId('rail-collapse-toggle');
        const box = await rail.boundingBox();
        if (box && box.width < EXPECTED_RAIL_WIDTH - 50 && (await toggle.count())) {
          await toggle.first().click();
          await page.waitForTimeout(450); // wait out the 320ms width tween
        }

        const expandedBox = await rail.boundingBox();
        expect(expandedBox, `${screen.name} @ ${vp.name}: rail has a bounding box`).toBeTruthy();
        expect(
          Math.abs(expandedBox.width - EXPECTED_RAIL_WIDTH),
          `${screen.name} @ ${vp.name}: expanded rail is ${EXPECTED_RAIL_WIDTH}px (got ${expandedBox.width})`,
        ).toBeLessThanOrEqual(WIDTH_TOLERANCE);
        await saveEvidence(page, `t10310-rail_${screen.name}_${vp.name}`);
      });
    }
  });
}
