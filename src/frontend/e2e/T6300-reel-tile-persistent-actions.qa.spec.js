/**
 * T6300 QA — ReelTile persistent actions (Highlight Reels drawer).
 *
 * The bug (user report): every action on a published-reel tile — including the
 * kebab — was invisible until hover (`opacity-0 pointer-events-none` at rest),
 * and `isMobile` (a UA sniff from useWebShare) misclassified a touch-Windows
 * device as desktop, wiring long-press (the hover replacement) only for
 * "mobile" — a functional dead end: no hover, no long-press, no way in at all.
 *
 * Approved treatment (docs/plans/tasks/T6300-design.md, user-approved 2026-08-01):
 *   - Play is a PERSISTENT primary — always visible, never hover-gated.
 *   - The kebab is corner-anchored (top-right): hover/focus-revealed on FINE
 *     pointers (unchanged from DraftTile's convention, explicit user decision:
 *     do NOT make it always-visible on fine pointers), and PERSISTENTLY
 *     opacity-100 on COARSE pointers (fixes touch-Windows — no long-press).
 *   - Copy Link / Share moved from a direct hover chip into the kebab.
 *   - NEW-dot shifts to `right-11` when present so it stacks left of the kebab
 *     (Option A, user-approved) instead of overlapping it.
 *
 * This spec drives the REAL account (dev-login) and proves:
 *   1. Discoverability without hovering (persistent Play chip).
 *   2. The touch-Windows dead end is GONE: hasTouch:true + a desktop (non-UA-
 *      sniffed-mobile) context reports a coarse pointer via `(pointer: coarse)`
 *      but NOT the isMobile UA sniff — exactly the T6300 bug repro — and every
 *      kebab item is reachable with NO hover and NO long-press.
 *   3. Kebab menu still positions correctly at the new top-right anchor (no
 *      clipping regression), both downward (near top) and flipped (near bottom).
 *   4. Every existing action still fires: Play, Copy Link, Share, Download,
 *      Rename, Delete (dialog dismissed, never actually deleting a real reel).
 *   5. Responsive sweep, no horizontal overflow.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6300-reel-tile-persistent-actions.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openMyReelsAndExpand(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /Highlight Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /Highlight Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
  const panel = page.locator('.animate-slide-in-right');
  const alreadyShown = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (!alreadyShown) {
    const headers = panel.getByTestId('collapsible-group-header');
    await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      const appeared = await panel.getByTestId('reel-card').first()
        .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
      if (appeared) break;
    }
  }
  return panel;
}

/** Computed opacity + pointer-events of a locator, read directly (not Playwright's
 * own visibility heuristic) — the exact repro method the original T6300 bug report
 * used (`opacity` / `pointer-events` at rest vs hovering). */
async function computedState(locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: parseFloat(s.opacity), pointerEvents: s.pointerEvents };
  });
}

test.describe('T6300 ReelTile persistent actions (real account)', () => {
  test('criterion 1: Play is discoverable WITHOUT hovering (FINE pointer, at rest)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const tile = panel.getByTestId('reel-card').first();
    const play = tile.getByRole('button', { name: 'Play video' });
    const { opacity, pointerEvents } = await computedState(play);
    console.log(`[T6300][c1] Play at rest (no hover): opacity=${opacity} pointer-events=${pointerEvents}`);
    // The whole point: Play requires NO hover to be discoverable or clickable.
    expect(opacity).toBeCloseTo(1, 1);
    expect(pointerEvents).not.toBe('none');
    await saveEvidence(page, 'T6300-criterion1-play-persistent-no-hover');
    await context.close();
  });

  test('criterion 1b: consistent with T6180 brief — persistent Play + kebab, no other direct action chip', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const tile = panel.getByTestId('reel-card').first();
    await expect(tile.getByRole('button', { name: 'Play video' })).toBeVisible();
    await expect(tile.getByRole('button', { name: 'More actions' })).toHaveCount(1);
    // The old direct Copy link / Share chip is gone from the tile surface —
    // those actions now live exclusively in the kebab (T6180 "main button + kebab").
    await expect(tile.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(tile.getByRole('button', { name: 'Share video' })).toHaveCount(0);
    await saveEvidence(page, 'T6300-criterion1b-main-button-plus-kebab');
    await context.close();
  });

  test('criterion 2 (CRITICAL): touch-Windows repro — coarse pointer with NO UA-sniffed isMobile still reaches every action, no hover, no long-press', async ({ browser }) => {
    test.setTimeout(120_000);
    // The exact T6300 bug repro: hasTouch:true registers `(pointer: coarse)` /
    // `(hover: none)` via Chromium's touch emulation, but the desktop viewport +
    // default (non-mobile) UA means useWebShare's isMobileDevice() UA sniff
    // returns false — precisely a touchscreen Windows laptop.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
    });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // Confirm the repro condition actually holds in this context before trusting
    // the rest of the test: coarse pointer true, but UA does not match the sniff.
    const capability = await page.evaluate(() => ({
      coarse: window.matchMedia('(pointer: coarse)').matches,
      uaSniffMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)),
    }));
    console.log(`[T6300][c2] repro capability: coarse=${capability.coarse} uaSniffMobile=${capability.uaSniffMobile}`);
    expect(capability.coarse, 'context reports a coarse pointer').toBe(true);
    expect(capability.uaSniffMobile, 'UA sniff does NOT classify this as mobile (the touch-Windows trap)').toBe(false);

    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    // AT REST — no hover simulated, no long-press dispatched. Read computed
    // opacity/pointer-events directly (the same method the original bug report used).
    // IMPORTANT ORDERING: a full-page `page.screenshot()` was found (by direct
    // matchMedia probing) to itself flip Chromium's DYNAMIC `pointer: coarse`
    // media feature to fine on this hybrid hasTouch context — Playwright's own
    // screenshot machinery, not any click/tap of mine, was the confound. So every
    // assertion and interaction that depends on the coarse-pointer state runs
    // BEFORE any screenshot; evidence is captured only at the very end.
    const play = await computedState(tile.getByRole('button', { name: 'Play video' }));
    const kebab = await computedState(tile.getByRole('button', { name: 'More actions' }));
    console.log(`[T6300][c2] AT REST: play=${JSON.stringify(play)} kebab=${JSON.stringify(kebab)}`);
    expect(play.opacity, 'Play reachable at rest').toBeCloseTo(1, 1);
    expect(play.pointerEvents).not.toBe('none');
    expect(kebab.opacity, 'kebab reachable at rest on a coarse pointer — the dead end is gone').toBeCloseTo(1, 1);
    expect(kebab.pointerEvents).not.toBe('none');
    // T6890 moved Rename OUT of the kebab/bottom-sheet to a standalone always-present
    // pencil beside the name — assert it on the tile (not inside the sheet below).
    await expect(tile.getByRole('button', { name: 'Rename reel' })).toBeVisible();

    // Every kebab item reachable — no hover, no long-press. A native DOM click()
    // (not Playwright's .click()/.tap(), and definitely no screenshot beforehand)
    // keeps the coarse-pointer state intact through the interaction.
    await tile.getByRole('button', { name: 'More actions' }).evaluate((el) => el.click());
    // Coarse pointer -> bottom sheet (not the desktop popover).
    const sheet = page.locator('div.fixed.inset-0.z-50');
    await expect(sheet, 'bottom sheet opens on a coarse pointer').toBeVisible();
    await expect(sheet.getByText('Download', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Share', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Copy Link', { exact: true })).toBeVisible();
    // Rename left the sheet for the tile's pencil (T6890, asserted above).
    await expect(sheet.getByText('Delete', { exact: true })).toBeVisible();
    // Evidence captured LAST, now that every coarse-pointer-dependent assertion
    // has already passed — the screenshot's own side effect can't taint them.
    await saveEvidence(page, 'T6300-criterion2-touch-windows-kebab-reachable');
    await context.close();
  });

  test('criterion 2b: a real coarse-pointer device (iPhone) also has the kebab persistently visible at rest', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();
    const kebab = await computedState(tile.getByRole('button', { name: 'More actions' }));
    console.log(`[T6300][c2b] iPhone kebab at rest: ${JSON.stringify(kebab)}`);
    expect(kebab.opacity).toBeCloseTo(1, 1);
    expect(kebab.pointerEvents).not.toBe('none');
    await saveEvidence(page, 'T6300-criterion2b-iphone-kebab-at-rest');
    await context.close();
  });

  test('criterion (fine pointer): kebab is hover-revealed, NOT persistent, on a mouse (approved decision)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();
    const kebab = tile.getByRole('button', { name: 'More actions' });

    const before = await computedState(kebab);
    console.log(`[T6300][fine] kebab before hover: ${JSON.stringify(before)}`);
    expect(before.opacity, 'fine pointer: kebab hidden at rest (approved, matches DraftTile)').toBeCloseTo(0, 1);

    await tile.hover();
    await page.waitForTimeout(300);
    const after = await computedState(kebab);
    console.log(`[T6300][fine] kebab after hover: ${JSON.stringify(after)}`);
    expect(after.opacity, 'hover reveals the kebab on a fine pointer').toBeGreaterThan(0.9);
    await saveEvidence(page, 'T6300-fine-pointer-hover-reveal');
    await context.close();
  });

  test('criterion 3: kebab menu positions correctly at the new top-right anchor — top tile (downward) and bottom tile (flipped), no clipping', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const tiles = panel.getByTestId('reel-card');
    const count = await tiles.count();
    test.skip(count === 0, 'no published reels on this account/profile');
    const viewport = page.viewportSize();

    // Expand every group so more than one tile is available where possible.
    const headers = panel.getByTestId('collapsible-group-header');
    const headerCount = await headers.count();
    for (let i = 0; i < headerCount; i++) await headers.nth(i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);

    const topTile = tiles.first();
    await topTile.scrollIntoViewIfNeeded();
    await topTile.hover();
    await topTile.getByRole('button', { name: 'More actions' }).click();
    const topMenu = page.locator('div.fixed.bg-gray-700.w-48').first();
    await expect(topMenu, 'menu opens for the top tile').toBeVisible();
    const topBox = await topMenu.boundingBox();
    expect(topBox.y, 'top menu top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(topBox.y + topBox.height, 'top menu bottom edge on-screen').toBeLessThanOrEqual(viewport.height + 2);
    expect(topBox.x, 'top menu left edge on-screen').toBeGreaterThanOrEqual(0);
    expect(topBox.x + topBox.width, 'top menu right edge on-screen').toBeLessThanOrEqual(viewport.width + 2);
    await saveEvidence(page, 'T6300-criterion3-kebab-top-tile-no-clip');
    await page.mouse.click(5, 5);

    const bottomTile = tiles.last();
    await bottomTile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await bottomTile.hover();
    await bottomTile.getByRole('button', { name: 'More actions' }).click();
    const bottomMenu = page.locator('div.fixed.bg-gray-700.w-48').first();
    await expect(bottomMenu, 'menu opens for the bottom tile').toBeVisible();
    const bottomBox = await bottomMenu.boundingBox();
    expect(bottomBox.y, 'bottom (flipped) menu top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(bottomBox.y + bottomBox.height, 'bottom (flipped) menu bottom edge on-screen').toBeLessThanOrEqual(viewport.height + 2);
    await saveEvidence(page, 'T6300-criterion3-kebab-bottom-tile-flipped-no-clip');
    await page.mouse.click(5, 5);
    await context.close();
  });

  test('criterion 4: every existing action still fires (Play, Copy Link, Share, Download, Rename, Delete-dialog)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    // Play -> opens the preview player (portaled MediaPlayer / video element).
    await tile.getByRole('button', { name: 'Play video' }).click();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'T6300-criterion4-play-opens-player');
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('button[aria-label="Close"], button:has-text("Close")').first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);

    // Copy Link -> toast.
    await tile.hover();
    await tile.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: '^Copy Link$' }).click({ timeout: 1000 }).catch(async () => {
      await page.getByText('Copy Link', { exact: true }).click();
    });
    await expect(page.getByText('Link copied to clipboard')).toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'T6300-criterion4-copy-link-toast');

    // Rename -> inline input appears (do not commit a change; Escape cancels).
    await tile.hover();
    await tile.getByRole('button', { name: 'More actions' }).click();
    await page.getByText('Rename', { exact: true }).click();
    const renameInput = tile.locator('input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T6300-criterion4-rename-input');
    await renameInput.press('Escape');

    // Delete -> the native confirm dialog fires (proves reachability); DISMISS it,
    // never actually deleting a real reel on the live account.
    let dialogSeen = false;
    page.once('dialog', async (dialog) => {
      dialogSeen = true;
      console.log(`[T6300][c4] Delete confirm dialog: "${dialog.message()}" -> dismissing (no real delete)`);
      await dialog.dismiss();
    });
    await tile.hover();
    await tile.getByRole('button', { name: 'More actions' }).click();
    await page.getByText('Delete', { exact: true }).click();
    await page.waitForTimeout(500);
    expect(dialogSeen, 'Delete reaches the native confirm dialog').toBe(true);
    await saveEvidence(page, 'T6300-criterion4-delete-dialog-dismissed');
    await context.close();
  });

  test('criterion (edge case): NEW-dot stacks left of the kebab, does not overlap it', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const panel = await openMyReelsAndExpand(page);
    const tiles = panel.getByTestId('reel-card');
    const count = await tiles.count();
    test.skip(count === 0, 'no published reels on this account/profile');

    // Find a tile with the unwatched NEW dot, if any exist on this account.
    let unwatchedTile = null;
    for (let i = 0; i < count; i++) {
      const dot = tiles.nth(i).locator('[title="New"]');
      if (await dot.count()) { unwatchedTile = tiles.nth(i); break; }
    }
    test.skip(!unwatchedTile, 'no unwatched reel on this account to evidence the dot/kebab coexistence');

    const dotBox = await unwatchedTile.locator('[title="New"]').boundingBox();
    const kebabBox = await unwatchedTile.getByRole('button', { name: 'More actions' }).boundingBox();
    console.log(`[T6300][edge] dot=${JSON.stringify(dotBox)} kebab=${JSON.stringify(kebabBox)}`);
    // No horizontal overlap between the dot and the kebab's bounding box.
    const overlap = dotBox.x < kebabBox.x + kebabBox.width && dotBox.x + dotBox.width > kebabBox.x
      && dotBox.y < kebabBox.y + kebabBox.height && dotBox.y + dotBox.height > kebabBox.y;
    expect(overlap, 'NEW dot does not overlap the kebab').toBe(false);
    await saveEvidence(page, 'T6300-edge-new-dot-kebab-stack');
    await context.close();
  });

  test('responsive sweep: Highlight Reels drawer has no horizontal overflow at 375px + desktop', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    await openMyReelsAndExpand(page);
    await assertNoHorizontalOverflow(page);
    await responsiveSweep(page);
    await context.close();
  });
});
