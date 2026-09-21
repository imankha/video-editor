/**
 * T9270 — mobile settings panel + touch-target sweep (390x844).
 *
 * T10820 rewrite: the panel is no longer a right-edge translateX drawer. It is
 * now an anchored bottom sheet — `absolute bottom-full inset-x-0` inside the
 * sticky action-band wrapper, sliding up with `transform: translateY()` ONLY
 * (`translateY(100%)` parked -> `translateY(0)` open), capped at 55dvh. It is
 * opened by the same 64px full-width labelled entry row
 * (data-testid="mobile-settings-row"), NOT an edge sliver, and it does NOT close
 * on a tap outside it (house rule). Its close control is still a 44x44 button in
 * the panel's own header, and the testid stays `settings-drawer` (T10820 design
 * doc §2.1: every locator in this spec and the touch-target sweep is preserved;
 * only the geometry assertions change).
 *
 * Asserts GEOMETRY (boundingBox / transform), not toBeVisible() — task acceptance
 * criteria 8, 10, 11, 12, 13 (T9270) plus T10820's "panel fully inside the
 * viewport" criterion. REAL-BROWSER ONLY. hasTouch+isMobile so useIsMobile
 * (which also keys on `(hover:none) and (pointer:coarse)`) resolves to the mobile
 * layout and the coarse-pointer 44px floors apply.
 *
 * Target: local dev stack OR staging. Non-mutating; skips loudly when a draft is
 * absent. NOTE: authored but NOT run in the T9270/T10820 container (no Playwright
 * browsers / no backend there) — a QA artifact to run against a real stack.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const VP = { width: 390, height: 844 };
const TOUCH_FLOOR = 44;

function assertBoxInViewport(box, label, vp = VP) {
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

// The action band is `sticky bottom-0`: it only pins to the viewport bottom once
// scrolled within its own height of the scroll container's end. App's mobile-only
// `pb-48` (48 * 4 = 192px) content padding means a scroll landing anywhere in that
// last 192px un-sticks the band by up to that much — a real, pre-existing (T8790)
// mobile quirk, NOT something this panel change can move (the panel is `absolute`,
// contributes zero in-flow height). A baseline taken before vs after an
// auto-scrolling `.click()` straddles that un-stick range and reads as a CTA
// "shift" that never happened at a fixed scroll position. Settle the scroll BEFORE
// the baseline (mirrors T10820-mobile-settings-anchor.qa.spec.js) and assert the
// gesture itself doesn't scroll, so this failure mode can't come back silently.
function scrollTopOf(locator) {
  return locator.evaluate((el) => {
    let n = el.parentElement;
    while (n && !(n.scrollHeight > n.clientHeight && /(auto|scroll)/.test(getComputedStyle(n).overflowY))) {
      n = n.parentElement;
    }
    return n ? n.scrollTop : 0;
  });
}

async function translateYOf(locator) {
  // Read the live matrix so we assert the actual transform, not just presence.
  // m42 is the vertical translation component (m41 is horizontal, used pre-T10820).
  return locator.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
}

test.describe('T9270/T10820 mobile settings panel @ 390x844', () => {
  test.use({ viewport: VP, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  // openFramingDraft resolves void / throws; openLoadableOverlayDraft RETURNS
  // {ok, reason}. Normalize both to {ok, reason} and skip on !ok — do NOT
  // `.then(()=>true)` the Overlay opener (a {ok:false} result is truthy, which is
  // what made the supervisor QA time out on the home board instead of skipping).
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
    test(`${screen.name}: panel closed on load, opens from the settings row fully inside the viewport, CTA unchanged, no backdrop close`, async ({ page }) => {
      const res = await screen.open(page);
      test.skip(!res.ok, res.reason || `no ${screen.name}-openable draft on this account`);

      // Criterion 10/11: a 64px full-width labelled entry row opens it (not a sliver),
      // with a DERIVED live-summary second line. Find it and settle the scroll on
      // it BEFORE taking any "closed" baseline — see scrollTopOf's comment above:
      // the action band's stuck/unstuck state depends on scroll position, so the
      // closed and open measurements must share one settled scroll position or the
      // comparison is meaningless.
      const row = page.getByTestId('mobile-settings-row');
      await row.waitFor({ state: 'visible', timeout: 10000 });
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const rowBox = await row.boundingBox();
      expect(rowBox.height, `${screen.name}: settings row is a 64px full-width button`).toBeGreaterThanOrEqual(60);
      expect(rowBox.width, `${screen.name}: settings row spans the width`).toBeGreaterThan(VP.width * 0.8);
      const summary = page.getByTestId('mobile-settings-summary');
      await expect(summary, `${screen.name}: entry row shows a derived summary line`).not.toHaveText('');

      const cta = page.getByTestId('primary-cta');
      await cta.waitFor({ state: 'visible', timeout: 20000 });

      // Criterion 8: CTA fully within the viewport once scrolled to the row.
      const ctaClosed = await cta.boundingBox();
      assertBoxInViewport(ctaClosed, `${screen.name} CTA (panel closed)`);

      // Criterion 8/10: the panel exists but is CLOSED on load — translated fully
      // below the fold (translateY(100%)).
      const drawer = page.getByTestId('settings-drawer');
      await drawer.waitFor({ state: 'attached', timeout: 10000 });
      const tyClosed = await translateYOf(drawer);
      expect(tyClosed, `${screen.name}: panel parked below the fold on load`).toBeGreaterThan(20);

      const scrollBefore = await scrollTopOf(row);
      await row.click();
      await page.waitForTimeout(450); // 320ms translateY tween

      // The panel is `absolute` (zero in-flow height) and its slide animates only
      // transform/opacity/visibility — opening it must not scroll the page. This is
      // what actually guarantees the CTA comparison below is apples-to-apples.
      const scrollAfter = await scrollTopOf(row);
      expect(
        Math.abs(scrollAfter - scrollBefore),
        `${screen.name}: opening the panel does not scroll the page`
      ).toBeLessThanOrEqual(1);

      // Criterion 10: slid up — transform changed to translateY(0).
      const tyOpen = await translateYOf(drawer);
      expect(tyOpen, `${screen.name}: panel slid up (transform changed)`).toBeLessThan(tyClosed - 50);
      expect(Math.abs(tyOpen), `${screen.name}: panel fully open at translateY(0)`).toBeLessThan(2);

      // T10820: the open panel's bounding box is fully inside the viewport — the
      // assertion that never existed before this task (the whole point of the
      // anchor fix: nothing rises off the top of a phone screen any more).
      const panelBox = await drawer.boundingBox();
      assertBoxInViewport(panelBox, `${screen.name} panel (open)`);

      // Criterion 8: the CTA box is identical panel-open vs panel-closed.
      const ctaOpen = await cta.boundingBox();
      assertBoxesEqual(ctaClosed, ctaOpen, `${screen.name} CTA (panel open)`);
      assertBoxInViewport(ctaOpen, `${screen.name} CTA (panel open)`);
      await saveEvidence(page, `t10820-panel_${screen.name}_open`);

      // Criterion 10: NO backdrop-tap close. Tap the stage area (top-left, clear of
      // the panel) and confirm the panel stays open.
      await page.mouse.click(20, 120);
      await page.waitForTimeout(200);
      expect(Math.abs(await translateYOf(drawer)), `${screen.name}: backdrop tap does NOT close the panel`).toBeLessThan(2);

      // The panel's own 44x44 header close is the one way out.
      const close = page.getByTestId('drawer-close');
      const closeBox = await close.boundingBox();
      expect(closeBox.width, `${screen.name}: drawer-close width >= 44`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      expect(closeBox.height, `${screen.name}: drawer-close height >= 44`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      await close.click();
      await page.waitForTimeout(450);
      expect(await translateYOf(drawer), `${screen.name}: close button parks the panel below the fold`).toBeGreaterThan(20);
    });

    test(`${screen.name}: touch-target sweep over the entry row and every panel control`, async ({ page }) => {
      const res = await screen.open(page);
      test.skip(!res.ok, res.reason || `no ${screen.name}-openable draft on this account`);

      // The entry row itself must clear the floor.
      const row = page.getByTestId('mobile-settings-row');
      await row.waitFor({ state: 'visible', timeout: 20000 });
      const rowBox = await row.boundingBox();
      expect(rowBox.height, `${screen.name}: settings row >= 44px tall`).toBeGreaterThanOrEqual(TOUCH_FLOOR);

      // Open the panel and sweep EVERY interactive control inside it (criterion 12,
      // "not spot checks"). This is also where known-failures row 32 (a 28px
      // control inside Focus's panel body) must now come back clean — T10820
      // fixes it as part of the same surface rewrite, not deferred.
      await row.click();
      await page.waitForTimeout(450);
      const drawer = page.getByTestId('settings-drawer');
      const controls = drawer.locator('button, [role="tab"], [role="switch"], input, select, a[href]');
      const n = await controls.count();
      expect(n, `${screen.name}: panel has interactive controls to sweep`).toBeGreaterThan(0);
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
      expect(undersized, `${screen.name}: panel controls below the ${TOUCH_FLOOR}px floor: ${JSON.stringify(undersized)}`).toEqual([]);
      await saveEvidence(page, `t10820-touch-targets_${screen.name}`);
    });

    // T9920 Bug A regression, extended for T10820: the PARKED (closed) settings
    // panel is translated translateY(100%) below the sticky action-band wrapper's
    // own height. Without `overflow-x-clip` on that wrapper it could grow a
    // horizontal scrollbar on the app's inner `flex-1 overflow-auto` pane (never
    // the shell, so the old document.scrollingElement check failed open). T10820
    // risk (§7): `inset-x-0` inside the `-mx-3 sm:-mx-4` bled wrapper is the exact
    // T9920 leak geometry at the 768/1024 container boundaries — and this time the
    // leak risk exists with the panel OPEN too (full-width `inset-x-0`, not a
    // parked-only transform), so this sweep now runs BOTH states at every width.
    test(`${screen.name}: settings panel never overflows horizontally, parked or open (narrow + boundary widths)`, async ({ page }) => {
      const res = await screen.open(page);
      test.skip(!res.ok, res.reason || `no ${screen.name}-openable draft on this account`);

      const drawer = page.getByTestId('settings-drawer');
      await drawer.waitFor({ state: 'attached', timeout: 20000 });
      const row = page.getByTestId('mobile-settings-row');
      const close = page.getByTestId('drawer-close');

      // Includes the md (768) and lg (1024) container boundaries, where the content
      // container hits full width with a zero mx-auto gutter — the widths where an
      // over-bled sticky action band leaks (T9920 residual fix).
      for (const width of [360, 390, 699, 768, 1023, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(300); // let the responsive reflow settle

        // 1) Parked (closed) — confirm, then assert no horizontal overflow.
        const tyParked = await translateYOf(drawer);
        expect(tyParked, `${screen.name} @ ${width}px: panel parked below the fold`).toBeGreaterThan(20);
        await assertNoHorizontalOverflow(page);

        // 2) T10820: OPEN at this same width — the new leak risk (`inset-x-0`
        // full-width sheet), where the old spec never looked.
        await row.click();
        await page.waitForTimeout(450);
        expect(Math.abs(await translateYOf(drawer)), `${screen.name} @ ${width}px: panel opened`).toBeLessThan(2);
        await assertNoHorizontalOverflow(page);

        // Reset to parked before the next width so every iteration starts clean.
        await close.click();
        await page.waitForTimeout(450);
      }
      await saveEvidence(page, `t10820-bugA_${screen.name}_no-overflow`);
    });
  }

  // Criterion 13: Overlay's portrait stage is taller than the retired 40vh cap.
  // Unchanged by T10820 (the panel is out of the stage row entirely).
  test('Overlay: video stage is taller than the old 40vh cap', async ({ page }) => {
    const res = await openLoadableOverlayDraft(page);
    test.skip(!res.ok, res.reason || 'no Overlay-openable draft on this account');
    const stage = page.getByTestId('overlay-video-stage');
    await stage.waitFor({ state: 'visible', timeout: 20000 });
    const box = await stage.boundingBox();
    expect(box.height, 'Overlay stage taller than 0.4 * viewport height (cap removed)').toBeGreaterThan(0.4 * VP.height);
    await saveEvidence(page, 't9270-overlay-stage-height');
  });
});
