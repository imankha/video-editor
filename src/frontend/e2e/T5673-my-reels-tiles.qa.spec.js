import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5673 (visual tiles) + T5678 (no batch Select) — live QA on the REAL account.
 *
 * Drives the Highlight Reels drawer as imankh@gmail.com (dev-login) at 390 (mobile) and
 * 1280+ (desktop) and evidences the acceptance criteria of BOTH bundled tasks:
 *
 *   T5678-c1  no Select button / selection mode anywhere in Highlight Reels
 *   T5678-c2  each reel EXPOSES "Move to profile…" (the picker->confirm->commit WALK
 *             is owned by T4850-move-reels; T7770 dropped the duplicated uncommitted walk)
 *   T5673-c1  collection/game groups show poster imagery (tiles, not text rows)
 *   T5673-c2  play / copy-link / kebab actions present and working per tile
 *             (reel-rename is owned by T6890-rename-icon-placement; T7770 de-dup)
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
  await page.getByRole('button', { name: /^Published/ }).first().click();
  // The drawer header is the stable anchor (reels themselves live in collapsed groups).
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

// Expand the first collapsed game/mix group so its reel tiles mount into a carousel.
// Groups collapse by default; their headers carry data-testid="collapsible-group-header".
async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  // Scope to the drawer panel: the home "Clips" section renders its OWN
  // CollapsibleGroups behind the backdrop, and those are not clickable (covered).
  const headers = page.getByTestId('published-tab-panel').getByTestId('collapsible-group-header');
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

test.describe('T5673 + T5678 — Highlight Reels visual tiles (real account)', () => {
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
    // A `networkidle` settle used to sit here. It is banned (helpers/appReady.js): it
    // never fires against a CDN, so even wrapped in .catch() it burned the whole
    // navigation timeout and ate this test's 60s budget on a deployed target. The
    // fixed settle below is what the lazy posters actually need.
    await page.waitForTimeout(2500);

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

  test('T5673-c2 + T5678-c2: tile actions present incl. Move-to-profile affordance', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const tile = page.getByTestId('reel-card').first();
    // T6300: Play is the persistent primary (no hover needed to discover it);
    // Copy Link / Share moved into the kebab (previously a direct hover chip).
    await expect(tile.getByRole('button', { name: /Play video/i })).toBeVisible();
    // T6890 owns reel-rename now (pencil beside the name + inline rename start): its
    // canonical spec is T6890-rename-icon-placement's "ReelTile" test. The kebab no
    // longer carries a Rename item, so this tile-action check asserts only the
    // remaining overflow set; reel-rename is deferred to T6890 (T7770 de-dup).
    // Kebab opens the remaining overflow set (hover-revealed on a fine pointer, T6300).
    await tile.hover();
    await tile.getByRole('button', { name: /More actions/i }).click();
    await expect(page.getByRole('button', { name: /^Download$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Share$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Copy Link$/ })).toBeVisible();
    // T5678: the per-reel "Move to profile…" affordance is present (multi-profile
    // account only). The full picker->confirm->commit WALK is owned by
    // T4850-move-reels (which seeds two profiles and asserts the reel actually
    // moves); here we assert only that the tile EXPOSES the action, then close the
    // menu without committing (T7770 de-dup: the uncommitted picker walk was a
    // strict subset of T4850's committed flow).
    const moveItem = page.getByRole('button', { name: /Move to profile/ });
    if (await moveItem.count()) {
      await expect(moveItem).toBeVisible();
    } else {
      console.log('[T5678] single-profile account: no Move-to-profile item (expected)');
    }
    await saveEvidence(page, 'T5673-criterion-2-tile-kebab');
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
