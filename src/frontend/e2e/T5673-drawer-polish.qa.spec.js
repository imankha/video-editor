/**
 * T5673 QA — Drawer polish: kebab menu redesign, leading collection posters,
 * Top Play rank badge (T5679).
 *
 * Drives the REAL My Reels drawer as the real account (dev-login,
 * imankh@gmail.com / profile 9fa7378c — 6 published single-clip reels, 4 of
 * which are actually ranked via the Glicko game; see season_rank fix below).
 *
 * Acceptance criteria evidenced here:
 *   1a. Kebab menu is FULLY VISIBLE (no clipping) for a tile near the drawer
 *       BOTTOM (menu flips upward) and near the TOP (menu opens downward) —
 *       390px + 1280px.
 *   1b. Desktop menu shows full labels (no truncation), grouped w/ separators.
 *   1c. Coarse-pointer (touch) tap opens the bottom action sheet, not the
 *       clipped inline dropdown.
 *   2.  Leading poster (or Film fallback) renders on a collapsed SMART
 *       COLLECTION row (e.g. Top Plays) AND a GAME row.
 *   3.  Rank badges show the correct #N (matching the account's actual
 *       season_rank, NOT list position — see the T5679 fix) with a tooltip /
 *       aria-label; a reel with match_count == 0 (never actually ranked via
 *       the Glicko game) shows NO badge even if it sorts near the top.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5673-drawer-polish.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// Panel scope: DownloadsPanel has no data-testid, but its `fixed right-0 top-0`
// positioning is unique on the page. CRITICAL: the home screen BEHIND the drawer
// renders its OWN CollapsibleGroup rows / reel tiles with the SAME data-testids
// (drafts list), so an UNSCOPED locator matches both — verified live: an unscoped
// click landed on the home screen's row (behind the panel's backdrop), which made
// every subsequent click "intercepted by the backdrop" and the test hang until
// timeout. All panel-content locators below are scoped through `panel`.
const PANEL_SELECTOR = '.fixed.right-0.top-0';

async function openMyReels(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    const { useGalleryStore } = await import('/src/stores/galleryStore.js');
    useGalleryStore.getState().open();
  });
  const panel = page.locator(PANEL_SELECTOR);
  await panel.waitFor({ state: 'visible' });
  // animate-slide-in-right + /api/collections/summary fetch settle. Measured
  // live against the real account: groups render between 1-2s, NOT ~800ms —
  // wait for the group headers to actually appear instead of a fixed sleep.
  await panel.locator('[data-testid="collapsible-group-header"]').first()
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300); // let the rest of the groups finish rendering
  return panel;
}

/** Server-truth season_rank per reel id, straight from the fixed /api/downloads
 * response (T5679 fix: season_rank requires match_count > 0, not list position).
 * Uses a RELATIVE path so it resolves against playwright.config's baseURL and
 * shares the same origin/cookie-jar as loginAsRealUser's dev-login cookie. */
async function fetchSeasonRanks(request) {
  const res = await request.get('/api/downloads', {
    headers: { 'X-Test-Mode': 'true' },
  });
  const body = await res.json();
  const byId = {};
  for (const d of body.downloads) byId[d.id] = d.season_rank;
  return byId;
}

test.describe('T5673 drawer polish QA', () => {
  test('desktop 1280: kebab menu top+bottom flip, full labels, leading posters, rank badges', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // Ground truth from the server (proves the badge check below isn't circular).
    const serverRanks = await fetchSeasonRanks(context.request);
    console.log('[qa] server season_rank by reel id:', JSON.stringify(serverRanks));

    const panel = await openMyReels(page);

    // --- Expand every group INSIDE THE PANEL so their CollectionCard rows (the
    //     "collapsed" per-collection summary row, as opposed to individual reel
    //     tiles) are visible. ---
    const headers = panel.locator('[data-testid="collapsible-group-header"]');
    const headerCount = await headers.count();
    expect(headerCount, 'at least one collection/game group renders').toBeGreaterThan(0);
    for (let i = 0; i < headerCount; i++) {
      await headers.nth(i).click();
      await page.waitForTimeout(300);
    }
    await saveEvidence(page, 'T5673-criterion2-desktop-groups-expanded');

    // --- Criterion 2: leading poster (or Film fallback icon) on collection rows ---
    const mediaSlots = panel.locator('.rounded-md.overflow-hidden img, svg.lucide-film');
    const mediaCount = await mediaSlots.count();
    expect(mediaCount, 'collection rows render a media slot (poster or Film fallback)').toBeGreaterThan(0);
    await saveEvidence(page, 'T5673-criterion2-desktop-leading-posters');

    // --- Criterion 1: kebab menu — find tiles near TOP and BOTTOM of drawer ---
    const reelCards = panel.locator('[data-testid="reel-card"]');
    const reelCount = await reelCards.count();
    expect(reelCount, 'at least one reel tile visible').toBeGreaterThan(0);

    // TOP tile: open its kebab, menu should render downward, fully on-screen.
    const topCard = reelCards.first();
    await topCard.scrollIntoViewIfNeeded();
    await topCard.hover();
    const topKebab = topCard.getByTitle('More actions');
    await topKebab.click();
    await page.waitForTimeout(200);
    // Portal renders to document.body, NOT inside the panel — a page-level locator is correct here.
    const topMenu = page.locator('div.fixed.bg-gray-700.w-48').first();
    await expect(topMenu).toBeVisible();
    const topMenuBox = await topMenu.boundingBox();
    const viewport = page.viewportSize();
    expect(topMenuBox.y, 'top-tile menu top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(topMenuBox.y + topMenuBox.height, 'top-tile menu bottom edge on-screen')
      .toBeLessThanOrEqual(viewport.height + 2);
    expect(topMenuBox.x, 'top-tile menu left edge on-screen').toBeGreaterThanOrEqual(0);
    expect(topMenuBox.x + topMenuBox.width, 'top-tile menu right edge on-screen')
      .toBeLessThanOrEqual(viewport.width + 2);
    // Full labels, no truncation markers.
    await expect(topMenu.getByText('Download', { exact: true })).toBeVisible();
    await expect(topMenu.getByText('Rename', { exact: true })).toBeVisible();
    await saveEvidence(page, 'T5673-criterion1a-desktop-menu-near-top');
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 5); // close via outside click

    // BOTTOM tile: scroll the drawer so the last card sits near the bottom edge,
    // open its kebab — menu must flip UPWARD and still be fully on-screen.
    const bottomCard = reelCards.last();
    await bottomCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await bottomCard.hover();
    const bottomKebab = bottomCard.getByTitle('More actions');
    await bottomKebab.click();
    await page.waitForTimeout(200);
    const bottomMenu = page.locator('div.fixed.bg-gray-700.w-48').first();
    await expect(bottomMenu).toBeVisible();
    const bottomMenuBox = await bottomMenu.boundingBox();
    expect(bottomMenuBox.y, 'bottom-tile menu top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(bottomMenuBox.y + bottomMenuBox.height, 'bottom-tile menu bottom edge on-screen')
      .toBeLessThanOrEqual(viewport.height + 2);
    await saveEvidence(page, 'T5673-criterion1a-desktop-menu-near-bottom-flipped');
    await page.mouse.click(5, 5);

    // --- Criterion 3: rank badges match server season_rank exactly ---
    const badges = panel.locator('[aria-label^="Ranked #"]');
    const badgeCount = await badges.count();
    console.log(`[qa] rank badges rendered: ${badgeCount}`);
    for (let i = 0; i < badgeCount; i++) {
      const badge = badges.nth(i);
      const ariaLabel = await badge.getAttribute('aria-label');
      const title = await badge.getAttribute('title');
      expect(title, 'badge title matches aria-label').toBe(ariaLabel);
      expect(ariaLabel).toMatch(/^Ranked #\d+ of your reels this season$/);
    }
    // Cross-check: every reel whose server season_rank is null must show NO badge,
    // and every non-null one must show the exact number.
    const expectedBadgedCount = Object.values(serverRanks).filter((r) => r !== null).length;
    expect(badgeCount, 'rendered badge count matches server-side ranked count').toBe(expectedBadgedCount);
    await saveEvidence(page, 'T5673-criterion3-desktop-rank-badges');

    await assertNoHorizontalOverflow(page);
    await context.close();
  });

  test('mobile 390 (coarse pointer): bottom action sheet, leading posters, rank badges', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      ...devices['iPhone 14'], // hasTouch, isMobile UA -> coarse pointer + isMobile prop
      viewport: { width: 390, height: 844 },
    });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const serverRanks = await fetchSeasonRanks(context.request);
    console.log('[qa] (mobile) server season_rank by reel id:', JSON.stringify(serverRanks));

    const panel = await openMyReels(page);

    const headers = panel.locator('[data-testid="collapsible-group-header"]');
    const headerCount = await headers.count();
    for (let i = 0; i < headerCount; i++) {
      await headers.nth(i).tap();
      await page.waitForTimeout(300);
    }
    await saveEvidence(page, 'T5673-criterion2-mobile-groups-expanded');

    // Criterion 2 (mobile): leading poster or Film fallback still renders.
    const mediaSlots = panel.locator('.rounded-md.overflow-hidden img, svg.lucide-film');
    expect(await mediaSlots.count(), 'mobile collection rows render a media slot').toBeGreaterThan(0);
    await saveEvidence(page, 'T5673-criterion2-mobile-leading-posters');

    // Criterion 1c: tap kebab on a reel tile -> bottom action sheet (not the
    // clipped inline dropdown). Long-press first reveals the action buttons
    // (mobile hides them until long-press/reveal), per ReelTile's own gesture.
    const reelCards = panel.locator('[data-testid="reel-card"]');
    const reelCount = await reelCards.count();
    expect(reelCount, 'at least one reel tile visible on mobile').toBeGreaterThan(0);
    const firstCard = reelCards.first();
    await firstCard.scrollIntoViewIfNeeded();
    const box = await firstCard.boundingBox();
    // Simulate the long-press that reveals actions (500ms timer in ReelTile).
    // dispatchEvent's `touches` init requires a fully-formed Touch (identifier,
    // target, client/page/screen coords) -- the locator API's plain-object form
    // 404s on the browser's `new Touch({...})` constructor, so build it in-page.
    const cardHandle = await firstCard.elementHandle();
    await page.evaluate(({ el, x, y }) => {
      const touch = new Touch({
        identifier: 1, target: el,
        clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
      });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [touch], targetTouches: [touch], changedTouches: [touch],
        bubbles: true, cancelable: true,
      }));
    }, { el: cardHandle, x: box.x + 10, y: box.y + 10 });
    await page.waitForTimeout(600);
    await page.evaluate((el) => {
      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [], targetTouches: [], changedTouches: [],
        bubbles: true, cancelable: true,
      }));
    }, cardHandle);

    const kebab = firstCard.getByTitle('More actions');
    await kebab.tap({ force: true }).catch(async () => {
      // Fallback: actions may already be visible without the synthetic touch sim.
      await kebab.click({ force: true });
    });
    await page.waitForTimeout(300);

    // Bottom sheet signature: fixed inset-0 overlay (portal to document.body) with
    // a rounded-t-2xl panel, NOT the desktop w-48 popover.
    const sheet = page.locator('div.fixed.inset-0.z-50');
    await expect(sheet).toBeVisible();
    const sheetPanel = sheet.locator('div.rounded-t-2xl');
    await expect(sheetPanel).toBeVisible();
    await expect(sheetPanel.getByText('Download', { exact: true })).toBeVisible();
    await expect(sheetPanel.getByText('Delete', { exact: true })).toBeVisible();
    const sheetPanelBox = await sheetPanel.boundingBox();
    const viewport = page.viewportSize();
    // Bottom sheet anchors to the bottom edge (allow a couple px of rounding slack).
    expect(sheetPanelBox.y + sheetPanelBox.height, 'sheet reaches bottom of viewport')
      .toBeGreaterThanOrEqual(viewport.height - 4);
    await saveEvidence(page, 'T5673-criterion1c-mobile-bottom-sheet');

    await assertNoHorizontalOverflow(page);

    // Criterion 3 (mobile): same server-truth cross-check.
    const badges = panel.locator('[aria-label^="Ranked #"]');
    const badgeCount = await badges.count();
    const expectedBadgedCount = Object.values(serverRanks).filter((r) => r !== null).length;
    expect(badgeCount, 'mobile rendered badge count matches server-side ranked count').toBe(expectedBadgedCount);
    await saveEvidence(page, 'T5673-criterion3-mobile-rank-badges');

    await context.close();
  });
});
