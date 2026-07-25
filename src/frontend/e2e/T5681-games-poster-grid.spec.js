/**
 * T5681 — Games tab poster grid (chronological landscape tiles).
 *
 * Drives the REAL app as the real account (dev-login) and verifies the
 * approved PRIMARY design end to end:
 *   - Games render as a landscape (16:9) tile grid, not text rows
 *   - Chronological month grouping with a game-count badge per month
 *   - Minimal overlay (date + clip count) always visible on the tile
 *   - Expiry chip (top-right) on near/expired games
 *   - Expired games render the grayscale tile variant
 *   - Desktop hover reveals the action cluster; mobile long-press reveals it
 *   - Edit action still opens the existing GameDetailsModal-family modal
 *     (rich metadata lives there, NOT in a new hover card, per the approved
 *     design)
 *   - A poster 404 (no recap, or R2 unavailable in this env) renders the
 *     branded fallback tile, never a broken image
 *
 * Responsive matrix: 390 (mobile), 768 (tablet), 1280+ (desktop) per the
 * task's acceptance criteria. Evidence is saved per criterion into qa/.
 *
 * HONESTY CAVEAT: this sandbox has no R2 credentials configured (no .env /
 * get_r2_client() returns None), so /api/games/{id}/poster.jpg 404s for
 * EVERY game here regardless of whether a real recap exists in production
 * R2. That is a real, useful test of the branded-fallback path (which must
 * render correctly when a poster is unavailable) but it does NOT exercise
 * the "poster loads successfully" branch — that needs an environment with
 * live R2 access (staging/prod) to confirm end-to-end.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

/** Navigate to the Games tab and wait for the grid (or empty state) to settle. */
async function openGamesTab(page) {
  await page.goto('/home/games');
  await page.waitForLoadState('domcontentloaded');
  // Either the grid's month header or the empty-state copy must appear.
  await Promise.race([
    page.getByText(/^\d{4}$|January|February|March|April|May|June|July|August|September|October|November|December/).first().waitFor({ timeout: 30000 }),
    page.getByText('No games yet').waitFor({ timeout: 30000 }),
  ]);
  // The app boot preloader (#preloader, index.html) overlays the DOM while it
  // fade-out animates; assertions against the underlying grid can pass while
  // it's still visually on top, which makes screenshots misleading. Wait for
  // it to be fully removed before any evidence capture.
  await page.locator('#preloader').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}

test.describe('T5681 games tab poster grid', () => {
  test('renders chronological landscape grid with month captions + counts (desktop)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    // Month header + count badge, e.g. "September 2026" + "6 games".
    const monthHeader = page.locator('h3').filter({ hasText: /\d{4}/ }).first();
    await expect(monthHeader, 'month header visible').toBeVisible();
    const countBadge = page.locator('span').filter({ hasText: /\d+ games?$/ }).first();
    await expect(countBadge, 'game-count badge visible').toBeVisible();
    await saveEvidence(page, 'criterion-1-month-captions-with-counts-desktop');

    // Landscape tiles, not text rows: every game renders as a [data-game-id]
    // tile with an aspect-video shell. The <img> itself unmounts once a poster
    // 404s (replaced by the branded-fallback div, see GameTile.jsx), so assert
    // on the tile container -- not the <img>, which may be transient in an
    // R2-unavailable environment like this sandbox.
    const firstTile = page.locator('[data-game-id]').first();
    await expect(firstTile, 'at least one game tile renders').toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'criterion-2-landscape-poster-tiles-desktop');

    await context.close();
  });

  test('grid is scannable + no overflow at 390/768/1280 (responsiveSweep)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: MOBILE });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    await responsiveSweep(page, async (vp) => {
      // Grid column count changes by breakpoint but must never overflow
      // (assertNoHorizontalOverflow runs inside responsiveSweep already).
      const grid = page.locator('.grid').filter({ has: page.locator('[data-game-id]') }).first();
      await expect(grid, `grid renders at ${vp.name}`).toBeVisible();
    });

    // Explicit tablet check (responsiveSweep's matrix is mobile/desktop only).
    await page.setViewportSize(TABLET);
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-3-responsive-grid-tablet-768');

    await context.close();
  });

  test('tile shows minimal overlay (date + clip count) and expiry chip', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    const firstTile = page.locator('[data-game-id]').first();
    await expect(firstTile).toBeVisible();
    // Clip count text ("N clips" / "1 clip") is always rendered in the overlay.
    await expect(firstTile.getByText(/clip/i)).toBeVisible();
    await saveEvidence(page, 'criterion-4-minimal-overlay-date-clipcount');

    // Expiry chip only guaranteed to exist if a near/expired game is present;
    // probe without failing the suite when the account has none in that state.
    const expiryChip = page.locator('[data-game-id]').getByText(/Expired|\d+d$/).first();
    if (await expiryChip.count() > 0) {
      await expect(expiryChip).toBeVisible();
      await saveEvidence(page, 'criterion-5-expiry-chip-top-right');
    } else {
      console.log('[T5681] no near/expired game in this account snapshot -- expiry chip not exercised');
    }

    await context.close();
  });

  test('expired game renders the grayscale tile variant', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    const expiredTile = page.locator('[data-game-id]', { has: page.getByText('Expired') }).first();
    if (await expiredTile.count() > 0) {
      const img = expiredTile.locator('img');
      if (await img.count() > 0) {
        const classAttr = await img.first().getAttribute('class');
        expect(classAttr, 'expired poster has grayscale class').toMatch(/grayscale/);
      }
      await saveEvidence(page, 'criterion-6-expired-grayscale-variant');
    } else {
      console.log('[T5681] no expired game in this account snapshot -- grayscale variant not exercised');
    }

    await context.close();
  });

  test('desktop hover reveals the action cluster (edit reachable)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    const firstTile = page.locator('[data-game-id]').first();
    await firstTile.hover();
    const editBtn = firstTile.getByTitle('Edit game');
    await expect(editBtn, 'edit action reachable on hover').toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'criterion-7-desktop-hover-actions');

    // Edit opens the EXISTING details modal -- rich metadata lives there, not
    // in a new hover meta card (approved-design constraint). EditGameModal has
    // no ARIA dialog role; assert on its heading instead.
    await editBtn.click();
    const modalHeading = page.getByText('Edit Game Details');
    await expect(modalHeading, 'edit game modal opens').toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'criterion-8-edit-opens-existing-details-modal');

    await context.close();
  });

  test('mobile long-press reveals the action sheet', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    const firstTile = page.locator('[data-game-id]').first();
    await expect(firstTile).toBeVisible();

    // page.touchscreen.tap() only sends a quick down+up (a real tap), which
    // GameTile's handleTouchStart/handleTouchMove/handleTouchEnd logic reads
    // as a normal tap (clears the 500ms longPressTimer before it fires) --
    // it does NOT exercise the long-press path. locator.dispatchEvent('touchstart',
    // ...) ALSO doesn't work: Playwright constructs a generic Event for
    // unrecognized types, not a real TouchEvent, so React's touch listeners
    // never fire. Use the CDP Input domain directly (Input.dispatchTouchEvent)
    // to send a genuine touchStart, hold past the 500ms threshold, then
    // touchEnd -- this is what actually reaches React's onTouchStart handler.
    const box = await firstTile.boundingBox();
    expect(box, 'first tile has a bounding box').toBeTruthy();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy }],
    });
    await page.waitForTimeout(650); // > GameTile's 500ms long-press threshold
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    const editBtn = firstTile.getByTitle('Edit game');
    await expect(editBtn, 'long-press reveals the edit action').toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'criterion-9-mobile-longpress-actions');

    await context.close();
  });

  test('poster-less game shows the branded fallback tile, never a broken image', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    await loginAsRealUser(context, EMAIL);
    const page = await context.newPage();
    await openGamesTab(page);

    const firstTile = page.locator('[data-game-id]').first();
    await expect(firstTile).toBeVisible();
    // Give the poster <img> time to resolve to onLoad or onError.
    await page.waitForTimeout(2000);

    // Either the poster image is visible (loaded) OR the branded fallback
    // ("No poster" text) is visible -- never neither (that would be a
    // hanging skeleton or a broken image icon).
    const posterImg = firstTile.locator('img');
    const fallback = firstTile.getByText('No poster');
    const posterVisible = await posterImg.first().isVisible().catch(() => false);
    const fallbackVisible = await fallback.isVisible().catch(() => false);
    expect(posterVisible || fallbackVisible, 'poster OR branded fallback renders (never neither)').toBe(true);
    await saveEvidence(page, 'criterion-10-poster-or-branded-fallback');

    await context.close();
  });
});
