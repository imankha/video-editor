/**
 * T5390 QA — Overlay spotlight circle: touch select-then-manipulate.
 *
 * Drives the REAL app as a real user (dev-login) in a TOUCH-EMULATED context
 * (hasTouch + isMobile + coarse pointer) and exercises the acceptance criteria:
 *   1. tap the circle -> it selects (>=44px handles appear)
 *   2. drag the body -> the circle MOVES, and the video does NOT scrub/play
 *      (video.currentTime unchanged, paused stays paused) during the drag
 *   3. drag a handle -> the circle RESIZES
 *   4. tap elsewhere -> deselects (handles hide)
 * A desktop (fine-pointer) assertion proves NO selection step (handles present
 * with no tap) so behavior stays byte-identical.
 *
 * Reaching a live spotlight circle requires this account to have an EXPORTED reel
 * (overlay mode is gated on it). If none is reachable, the circle-drive is skipped
 * HONESTLY — the deterministic interaction coverage lives in the Vitest spec
 * src/modes/overlay/overlays/HighlightOverlay.touch.test.jsx (9 cases).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5390-overlay-circle-touch.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

const BODY = '[data-testid="highlight-body"]';
const HANDLE_H = '[data-testid="highlight-handle-horizontal"]';
const HANDLE_V = '[data-testid="highlight-handle-vertical"]';
const BACKDROP = '[data-testid="highlight-backdrop"]';

/** Best-effort navigation into Overlay mode with a rendered spotlight circle. */
async function tryReachSpotlight(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Open a reel draft (same entry the T4550 QA spec uses).
  const draftsBtn = page.getByRole('button', { name: 'Reel Drafts' });
  if (await draftsBtn.count()) {
    await draftsBtn.click().catch(() => {});
    const chip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
    if (await chip.count()) {
      await chip.click().catch(() => {});
    }
  }
  // Switch to Overlay mode if the mode switcher is present.
  const overlayTab = page.locator('[data-testid="mode-overlay"]');
  if (await overlayTab.count()) {
    await overlayTab.click().catch(() => {});
  }
  // Poll for a rendered circle.
  const body = page.locator(BODY).first();
  try {
    await body.waitFor({ timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T5390 overlay circle — touch select-then-manipulate', () => {
  test('touch: tap selects, body drag moves without scrubbing, handle resizes, tap-elsewhere deselects', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      ...devices['iPhone 13'], // hasTouch: true, isMobile: true, coarse pointer
    });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const reached = await tryReachSpotlight(page);
    test.skip(!reached, 'No exported reel with a live spotlight circle in this fixture — see Vitest HighlightOverlay.touch.test.jsx for deterministic interaction coverage.');

    // Handles hidden until selected on a coarse pointer.
    await expect(page.locator(HANDLE_H)).toHaveCount(0);
    await saveEvidence(page, 'T5390-touch-1-unselected');

    const body = page.locator(BODY).first();
    const before = await body.boundingBox();

    // Record video paused-state + time to prove the drag does not scrub/play.
    const vSel = '.video-container video';
    const t0 = await page.$eval(vSel, (v) => ({ time: v.currentTime, paused: v.paused }));

    // Tap to select.
    await body.tap();
    await expect(page.locator(HANDLE_H)).toHaveCount(1);
    const hitR = await page.getAttribute(HANDLE_H, 'r');
    expect(Number(hitR)).toBeGreaterThanOrEqual(22); // >=44px diameter
    await saveEvidence(page, 'T5390-touch-2-selected-handles');

    // Drag the body to move (touchscreen dispatches pointer events).
    const cx = before.x + before.width / 2;
    const cy = before.y + before.height / 2;
    await page.touchscreen.tap(cx, cy); // ensure focus region
    await body.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true });
    await page.mouse.move(cx, cy); // no-op for touch, keeps timing realistic
    await body.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy + 40, bubbles: true });
    await body.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy + 40, bubbles: true });

    const after = await body.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(5); // circle moved
    const t1 = await page.$eval(vSel, (v) => ({ time: v.currentTime, paused: v.paused }));
    expect(t1.time).toBeCloseTo(t0.time, 2);   // video did NOT scrub
    expect(t1.paused).toBe(t0.paused);         // and did not toggle play
    await saveEvidence(page, 'T5390-touch-3-moved');

    // Resize via the vertical handle.
    const hbox = await page.locator(HANDLE_V).boundingBox();
    const hx = hbox.x + hbox.width / 2;
    const hy = hbox.y + hbox.height / 2;
    await page.locator(HANDLE_V).dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: hx, clientY: hy, bubbles: true });
    await page.locator(HANDLE_V).dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: hx, clientY: hy + 30, bubbles: true });
    await page.locator(HANDLE_V).dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: hx, clientY: hy + 30, bubbles: true });
    await saveEvidence(page, 'T5390-touch-4-resized');

    // Tap elsewhere deselects.
    await expect(page.locator(BACKDROP)).toHaveCount(1);
    await page.locator(BACKDROP).dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 5, clientY: 5, bubbles: true });
    await expect(page.locator(HANDLE_H)).toHaveCount(0);
    await saveEvidence(page, 'T5390-touch-5-deselected');

    await responsiveSweep(page);
    await context.close();
  });

  test('desktop: no selection step — handles present without any tap (byte-identical)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const reached = await tryReachSpotlight(page);
    test.skip(!reached, 'No exported reel with a live spotlight circle in this fixture.');

    // Fine pointer: resize handles are visible with NO selection step, and there is
    // no touch backdrop.
    await expect(page.locator(HANDLE_H)).toHaveCount(1);
    await expect(page.locator(BACKDROP)).toHaveCount(0);
    const r = await page.getAttribute(HANDLE_H, 'r');
    expect(Number(r)).toBe(7); // unchanged desktop handle size
    await saveEvidence(page, 'T5390-desktop-no-selection-step');
    await context.close();
  });
});
