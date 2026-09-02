/**
 * T5910 QA — Reel-draft tile action buttons must reveal on HOVER for a fine
 * pointer at ANY width (the narrow-desktop repro), and keep long-press reveal
 * for a coarse pointer.
 *
 * The bug: DraftTile picked its reveal MECHANISM from useIsMobile() (width OR
 * touch). A narrow *desktop* window (< 1024px) matched on width alone, so the
 * tile took the long-press branch — but long-press is wired to touch events
 * only, so a MOUSE user at ~478px had NO way to reveal the actions.
 *
 * A width-only test cannot catch this class of bug — the POINTER TYPE is the
 * variable that matters. So this spec drives:
 *   1. FINE pointer @ 478px  -> hover reveals the actions (the exact repro)
 *   2. FINE pointer @ 1280px -> hover reveals (wide desktop unchanged)
 *   3. COARSE pointer (iPhone) -> hover does NOT reveal; a long-press DOES.
 *
 * "Revealed" is measured by the computed opacity of [data-testid="tile-actions"]
 * (Playwright's isVisible ignores opacity:0, so we read the style directly).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5910-tile-hover-actions-pointer.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

const TILE = '[data-testid="project-card"]';
const ACTIONS = '[data-testid="tile-actions"]';

/** Navigate to the Clips tab and return the first draft tile locator. */
async function firstDraftTile(page) {
  await page.goto('/home/reels');
  await page.waitForLoadState('domcontentloaded');
  const tile = page.locator(TILE).first();
  await tile.waitFor({ timeout: 20000 });
  return tile;
}

/** Computed opacity of a tile's actions container (0 = hidden, 1 = revealed). */
async function actionsOpacity(tile) {
  return tile.locator(ACTIONS).first().evaluate((el) => parseFloat(getComputedStyle(el).opacity));
}

test.describe('T5910 tile hover actions — gate on pointer type, not width', () => {
  test('FINE pointer @ 478px: hover reveals the tile actions (the narrow-desktop repro)', async ({ browser }) => {
    test.setTimeout(120_000);
    // A desktop context (no hasTouch / no isMobile) reports a FINE pointer.
    const context = await browser.newContext({ viewport: { width: 478, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const tile = await firstDraftTile(page);

    // Before hover: actions hidden.
    const before = await actionsOpacity(tile);
    await saveEvidence(page, 'T5910-478px-fine-before-hover');

    // Hover the tile, then read the revealed state.
    await tile.hover();
    await page.waitForTimeout(300); // opacity transition
    const after = await actionsOpacity(tile);
    await saveEvidence(page, 'T5910-478px-fine-after-hover');

    console.log(`[T5910] 478px FINE pointer: opacity before=${before} after-hover=${after}`);
    expect(before).toBeCloseTo(0, 1);
    // The fix: hover reveals (opacity -> 1) at narrow desktop width with a mouse.
    expect(after).toBeGreaterThan(0.9);

    await context.close();
  });

  test('FINE pointer @ 1280px: hover reveals (wide desktop unchanged)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const tile = await firstDraftTile(page);
    expect(await actionsOpacity(tile)).toBeCloseTo(0, 1);
    await tile.hover();
    await page.waitForTimeout(300);
    const after = await actionsOpacity(tile);
    await saveEvidence(page, 'T5910-1280px-fine-after-hover');
    console.log(`[T5910] 1280px FINE pointer: opacity after-hover=${after}`);
    expect(after).toBeGreaterThan(0.9);

    await context.close();
  });

  test('COARSE pointer: hover does NOT reveal; a long-press DOES (touch unchanged)', async ({ browser }) => {
    test.setTimeout(120_000);
    // iPhone 13 -> hasTouch + isMobile + coarse pointer.
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const tile = await firstDraftTile(page);

    // Coarse pointer: a hover-equivalent must NOT reveal (long-press branch).
    await tile.hover().catch(() => {});
    await page.waitForTimeout(200);
    const afterHover = await actionsOpacity(tile);
    await saveEvidence(page, 'T5910-coarse-after-hover');
    console.log(`[T5910] COARSE pointer: opacity after-hover=${afterHover} (expected ~0)`);
    expect(afterHover).toBeCloseTo(0, 1);

    // Simulate a ~500ms long-press. Construct real Touch objects IN-PAGE (they
    // need an identifier + target) and dispatch touchstart, wait past the 500ms
    // long-press timer, then touchend — DraftTile's handlers only care that the
    // events fire, not their payload.
    await tile.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    });
    await page.waitForTimeout(650); // longer than the 500ms long-press timer
    await tile.evaluate((el) => {
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [] }));
    });
    await page.waitForTimeout(300);
    const afterLongPress = await actionsOpacity(tile);
    await saveEvidence(page, 'T5910-coarse-after-longpress');
    console.log(`[T5910] COARSE pointer: opacity after-longpress=${afterLongPress} (expected ~1)`);
    expect(afterLongPress).toBeGreaterThan(0.9);

    await context.close();
  });
});
