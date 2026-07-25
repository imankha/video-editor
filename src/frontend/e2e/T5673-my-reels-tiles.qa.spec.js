import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5673 (visual tiles) + T5678 (no batch Select) — live QA on the REAL account.
 *
 * Drives the My Reels drawer as imankh@gmail.com (dev-login) at 390 (mobile) and
 * 1280+ (desktop) and evidences the acceptance criteria of BOTH bundled tasks:
 *
 *   T5678-c1  no Select button / selection mode anywhere in My Reels
 *   T5678-c2  each reel exposes "Move to profile…" -> a CONFIRM step
 *   T5673-c1  collection/game groups show poster imagery (tiles, not text rows)
 *   T5673-c2  play / copy-link / kebab actions present and working per tile
 *   T5673-c3  poster-less entries show the branded fallback, never a broken image
 *   T5673-c4  mobile 390px: tiles are >=44px touch targets, no horizontal overflow
 *
 * Poster COVERAGE (approved Q6): the spec counts loaded posters vs branded
 * fallbacks across the expanded reels and logs the tally so the user can decide
 * whether to run the admin backfill for pre-T5280 reels.
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /My Reels/i }).first().click();
  // The drawer header is the stable anchor (reels themselves live in collapsed groups).
  await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
}

// Expand the first collapsed game/mix group so its reel tiles mount into a carousel.
// Groups collapse by default; their headers carry data-testid="collapsible-group-header".
async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  // Scope to the drawer panel: the home "Reel Drafts" section renders its OWN
  // CollapsibleGroups behind the backdrop, and those are not clickable (covered).
  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  // Wait for the collections summary to render at least one group header before
  // iterating (the drawer heading appears before the summary finishes fetching).
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    // Bounded click: a covered/animating header must not stall on the 5-min test timeout.
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

test.describe('T5673 + T5678 — My Reels visual tiles (real account)', () => {
  test('c1: NO Select button anywhere in the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);
    // T5678: the batch Select affordance is gone at BOTH widths.
    await expect(page.getByRole('button', { name: /^Select$/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /^Select$/ })).toHaveCount(0);
    await saveEvidence(page, 'T5678-criterion-1-no-select-button');
  });

  test('T5673-c1/c3: reels render as poster tiles; poster-less show branded fallback (+coverage)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);

    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile (drawer empty)');

    const tiles = page.getByTestId('reel-card');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);

    // Posters are lazy (loading="lazy") — scroll the carousel so off-screen tiles
    // request, then let the network settle before tallying so the count is truthful.
    for (let i = 0; i < count; i++) await tiles.nth(i).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    // Each tile is a poster surface: either a loaded <img> or the branded fallback
    // (Film icon + name) — NEVER a broken image. Tally coverage for Q6.
    let loaded = 0;
    let fallback = 0;
    for (let i = 0; i < count; i++) {
      const tile = tiles.nth(i);
      const img = tile.locator('img');
      const imgOk = await img.count()
        ? await img.first().evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false)
        : false;
      if (imgOk) { loaded++; continue; }
      // No decoded image -> the branded fallback (Film svg + name) must be present.
      const fallbackText = await tile.locator('.line-clamp-3, svg').count();
      expect(fallbackText, `tile ${i} shows a fallback, not a broken image`).toBeGreaterThan(0);
      fallback++;
    }
    console.log(`[T5673][coverage] posters loaded=${loaded} fallback=${fallback} of ${count} expanded tiles`);
    // This account has T5280 posters, so the tiles must actually display imagery
    // end-to-end (not just the fallback). Proves the owner poster endpoint is wired.
    expect(loaded, 'at least one real poster rendered in the drawer').toBeGreaterThan(0);
    await saveEvidence(page, 'T5673-criterion-1-poster-tiles-desktop');
  });

  test('T5673-c2 + T5678-c2: tile actions incl. Move-to-profile CONFIRM flow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const tile = page.getByTestId('reel-card').first();
    await tile.hover();
    // Play + copy-link (desktop) are direct actions on the tile.
    await expect(tile.getByRole('button', { name: /Play video/i })).toBeVisible();
    await expect(tile.getByRole('button', { name: /Copy link/i })).toBeVisible();
    // Kebab opens the overflow set.
    await tile.getByRole('button', { name: /More actions/i }).click();
    await expect(page.getByRole('button', { name: /^Download$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Rename$/ })).toBeVisible();
    await saveEvidence(page, 'T5673-criterion-2-tile-kebab');

    // T5678: "Move to profile…" -> picker -> CONFIRM (multi-profile account only).
    const moveItem = page.getByRole('button', { name: /Move to profile/ });
    if (await moveItem.count()) {
      await moveItem.click();
      const modal = page.locator('div.z-\\[80\\]');
      await expect(modal.getByRole('heading', { name: /Move .* to/i })).toBeVisible();
      // Pick a target profile (a button carrying a color avatar) -> confirm step appears.
      const options = modal.getByRole('button').filter({ has: page.locator('span.rounded-full') });
      await options.first().click();
      await expect(page.getByRole('button', { name: /^Move reel/ })).toBeVisible();
      await saveEvidence(page, 'T5678-criterion-2-move-confirm-step');
      await page.keyboard.press('Escape'); // step back from confirm
      await page.keyboard.press('Escape'); // close picker (no move committed)
    } else {
      console.log('[T5678] single-profile account: no Move-to-profile item (expected)');
    }
  });

  test('T5673-c4: mobile 390px tiles are >=44px touch targets, no overflow; responsive sweep', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    await assertNoHorizontalOverflow(page);
    const tile = page.getByTestId('reel-card').first();
    const box = await tile.boundingBox();
    // The tile itself is the primary touch target (tap-to-hover-reveal); it clears
    // the 44px floor at 390px. NOTE: this `chromium` project is Desktop Chrome (a
    // FINE pointer), so the `coarse-pointer:` 44px floor on the per-tile action
    // buttons does NOT apply here — that guarantee is validated by the T4930
    // usability audit, which runs on real coarse-pointer device projects
    // (iphone/android/tablet). Here we assert the tile size + no overflow only.
    expect(box.width, 'tile width >= 44px').toBeGreaterThanOrEqual(44);
    expect(box.height, 'tile height >= 44px').toBeGreaterThanOrEqual(44);
    await saveEvidence(page, 'T5673-criterion-4-mobile-touch-targets');
    await responsiveSweep(page);
  });
});
