/**
 * screen-usability.selfcheck.spec.js — proves the usability audit is not vacuous.
 *
 * ACCEPTANCE CRITERION #2 (T4930): the audit must FAIL on the pre-T4880 layout,
 * i.e. it would have caught the reported mobile blocker. Rather than depend on a
 * live account and network (which the real-user matrix in screen-usability.spec.js
 * does), this runs the audit invariants against SYNTHETIC pages built with
 * `setContent`, so it is deterministic and runs anywhere with just chromium — no
 * backend, no dev-login, no fixtures.
 *
 * It pins the invariants both ways:
 *   - GOOD layout (scrollable, action reachable)      -> audit PASSES
 *   - BAD "scroll trap" (100vh overflow-hidden shell,
 *     action below an unscrollable fold = T4880)      -> audit FAILS
 *   - BAD "covered" (action under a fixed overlay)     -> audit FAILS
 *   - BAD "horizontal overflow" (body wider than vw)   -> audit FAILS
 *
 * If someone weakens the helper so it stops catching these, THIS spec goes red —
 * the audit can never silently rot into a green rubber-stamp.
 */
import { test, expect } from '@playwright/test';
import {
  assertReachable,
  assertNoDeadScrollTrap,
  assertNoHorizontalOverflow,
  assertTouchTargetSizes,
} from './helpers/usabilityAudit.js';

const PHONE = { width: 390, height: 844 };

const ACTION = `<button id="primary" style="padding:12px 20px">Primary Action</button>`;

/** A single-action manifest around #primary — lets the size assertion run against
 *  a synthetic page exactly as it runs against a real screen manifest. */
const sizeManifest = { name: 'synthetic', actions: [{ label: 'primary', locator: (p) => p.locator('#primary') }] };

/** The T5360 defect shape: an icon-only control that renders ~26px on touch (the
 *  tablet regression). Explicit box so the measurement is deterministic. */
const SMALL_26 = `<!doctype html><html><head><style>
  html,body{margin:0}
  #primary{width:26px;height:26px;padding:0;border:0;display:inline-flex;align-items:center;justify-content:center}
</style></head><body>${ACTION}</body></html>`;

/** The fixed shape: the same control floored to the 44px touch minimum. */
const TARGET_44 = `<!doctype html><html><head><style>
  html,body{margin:0}
  #primary{width:44px;height:44px;padding:0;border:0;display:inline-flex;align-items:center;justify-content:center}
</style></head><body>${ACTION}</body></html>`;

/** Reachable in a normal scrollable document, well below the fold. */
const GOOD = `<!doctype html><html><head><style>
  html,body{margin:0} #spacer{height:1600px;background:#eee}
  #primary{display:block;margin:24px auto}
</style></head><body>
  <header>Top</header><div id="spacer"></div>${ACTION}
</body></html>`;

/** The T4880 shape: a 100vh overflow-hidden shell with the action below a fold
 *  that nothing scrolls to expose. */
const BAD_TRAP = `<!doctype html><html><head><style>
  html,body{margin:0}
  body{height:100vh;overflow:hidden}
  #tall{height:220vh;position:relative}
  #primary{position:absolute;top:205vh;left:20px}
</style></head><body>
  <div id="tall"><header>Top visible</header>${ACTION}</div>
</body></html>`;

/** The action exists but a fixed full-viewport overlay covers it (the fullscreen
 *  video takeover class of the original T4880 report). */
const BAD_COVERED = `<!doctype html><html><head><style>
  html,body{margin:0;height:100%}
  #primary{position:absolute;top:20px;left:20px}
  #overlay{position:fixed;inset:0;background:#000;z-index:9999}
</style></head><body>
  ${ACTION}<div id="overlay"></div>
</body></html>`;

/** Body wider than the viewport — the classic sideways-scroll breakage. */
const BAD_HOVERFLOW = `<!doctype html><html><head><style>
  html,body{margin:0} #wide{width:200vw;height:80px;background:#f00}
</style></head><body>
  <div id="wide">too wide</div>${ACTION}
</body></html>`;

async function expectThrows(fn, what) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  expect(threw, what).toBe(true);
}

test.describe('usability audit self-check (synthetic layouts, no backend)', () => {
  test.use({ viewport: PHONE });

  test('GOOD layout passes all three invariants', async ({ page }) => {
    await page.setContent(GOOD);
    await assertNoHorizontalOverflow(page);
    await assertNoDeadScrollTrap(page);
    // Reachable by scrolling even though it starts far below the fold.
    await assertReachable(page, page.locator('#primary'), 'good primary');
  });

  test('BAD scroll-trap (pre-T4880 layout) is caught', async ({ page }) => {
    await page.setContent(BAD_TRAP);
    // The T4880 signal: a control clipped below the fold of a shell-sized
    // overflow-hidden container that nothing scrolls to expose. (Reachability
    // alone would NOT catch this — Playwright's scrollIntoView uses a
    // PROGRAMMATIC scroll that bypasses overflow:hidden, which is exactly why the
    // dead-scroll-trap invariant exists as a separate, complementary check.)
    await expectThrows(() => assertNoDeadScrollTrap(page), 'scroll trap should be detected');
  });

  test('BAD covered action (fixed overlay) is caught', async ({ page }) => {
    await page.setContent(BAD_COVERED);
    await expectThrows(
      () => assertReachable(page, page.locator('#primary'), 'covered primary'),
      'covered action should fail the trial click',
    );
  });

  test('BAD horizontal overflow is caught', async ({ page }) => {
    await page.setContent(BAD_HOVERFLOW);
    await expectThrows(() => assertNoHorizontalOverflow(page), 'horizontal overflow should be detected');
  });

  // T5360 invariant #4: the touch-target-size assertion must catch a sub-44px
  // control (the reported tablet regression) and pass a floored one — both
  // directions, or it could silently rubber-stamp under-sized buttons.
  test('BAD 26px touch target is caught', async ({ page }) => {
    await page.setContent(SMALL_26);
    await expectThrows(
      () => assertTouchTargetSizes(page, sizeManifest, { min: 44 }),
      '26px control should fail the 44px touch-target floor',
    );
  });

  test('GOOD 44px touch target passes', async ({ page }) => {
    await page.setContent(TARGET_44);
    await assertTouchTargetSizes(page, sizeManifest, { min: 44 });
  });
});
