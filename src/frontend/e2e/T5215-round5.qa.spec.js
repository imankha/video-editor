import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5215 round 5 QA — user feedback on round 4's shipped work:
 *   1. Profile photo thumbnail: bigger + rectangular (was a 32x32 circle).
 *   2. Reel-tile badge visibility (investigated live -- NOT a bug, see the
 *      round-5 report; no code change, so no dedicated test here beyond what
 *      item 3/5 already re-verify incidentally).
 *   3. Badge moves out of the name scrim into the top-left corner, next to
 *      the rank number when present.
 *   4. The collection-header badge is removed entirely.
 *   5. The picker's default selection: "No intro" reads as selected for a
 *      never-touched reel with no profile default; an explicit pick still
 *      shows correctly.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5215-round5.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /My Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
}

async function openGameGroup(page, matchText) {
  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    const text = await headers.nth(i).textContent();
    if (text && text.includes(matchText)) {
      await headers.nth(i).click();
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}

test.describe('T5215 round 5 (real account)', () => {
  test('item 1: profile photo thumbnail is bigger and rectangular, not a small circle', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    const profileButton = page.getByRole('button', { name: /switch sport or profile/i });
    await expect(profileButton).toBeVisible({ timeout: 20000 });

    const thumb = page.locator('img[aria-hidden="true"][class*="rounded-lg"]').first();
    const hasThumb = await thumb.isVisible().catch(() => false);
    test.skip(!hasThumb, 'this profile has no photo -- nothing to measure (item 1 is conditional on a photo existing)');

    const box = await thumb.boundingBox();
    console.log(`[T5215 round5] photo thumbnail box: ${JSON.stringify(box)}`);
    // Bigger than the old 32x32 circle, and RECTANGULAR (portrait, not square/circle).
    expect(box.width, 'thumbnail must be noticeably bigger than the old 32px circle').toBeGreaterThan(32);
    expect(box.height, 'thumbnail must be noticeably bigger than the old 32px circle').toBeGreaterThan(32);
    expect(box.height, 'thumbnail must be portrait-rectangular (taller than wide), not square/circular')
      .toBeGreaterThan(box.width);

    const className = await thumb.getAttribute('class');
    expect(className, 'must not still be the old rounded-full circle').not.toContain('rounded-full');

    await saveEvidence(page, 'T5215-round5-photo-thumbnail-bigger-rect');
  });

  test('item 3: intro badge sits top-left, next to the rank number when present', async ({ page }) => {
    await openDrawer(page);
    const opened = await openGameGroup(page, 'Legends');
    test.skip(!opened, 'no "at Legends Mar 28" group on this account');

    // Reel #2 in this group ("Brilliant Dribble and Pass", 24s) has an explicit
    // intro AND a rank badge -- the "next to the number" case.
    const rankedTile = page.getByTestId('reel-card').filter({ has: page.getByText('#2') }).first();
    const rankedVisible = await rankedTile.isVisible().catch(() => false);
    if (rankedVisible) {
      const rankBox = await rankedTile.getByText('#2').boundingBox();
      const badgeEl = rankedTile.getByTestId('intro-badge');
      const hasBadge = await badgeEl.isVisible().catch(() => false);
      if (hasBadge) {
        const badgeBox = await badgeEl.boundingBox();
        console.log(`[T5215 round5] rank box=${JSON.stringify(rankBox)} badge box=${JSON.stringify(badgeBox)}`);
        // Same row (top within a few px) and immediately to the right.
        expect(Math.abs(badgeBox.y - rankBox.y), 'badge must sit on the same row as the rank number').toBeLessThan(6);
        expect(badgeBox.x, 'badge must sit to the right of the rank number').toBeGreaterThan(rankBox.x);
      }
      // The name/h3 must no longer carry an inline badge svg (moved out).
      const h3 = rankedTile.locator('h3').first();
      expect(await h3.locator('svg').count(), 'the badge must no longer be inline with the reel name').toBe(0);
    }

    await saveEvidence(page, 'T5215-round5-badge-next-to-rank');
  });

  test('item 4: no intro badge renders on the collection header', async ({ page }) => {
    await openDrawer(page);
    const opened = await openGameGroup(page, 'Legends');
    test.skip(!opened, 'no "at Legends Mar 28" group on this account');

    // The CollectionCard/CollectionHeader title row for "Game Highlights".
    const header = page.locator('.animate-slide-in-right').getByText('Game Highlights').first();
    const visible = await header.isVisible().catch(() => false);
    test.skip(!visible, '"Game Highlights" card not present on this account');

    const titleH3 = header.locator('xpath=ancestor::h3').first();
    const svgCount = await titleH3.locator('svg').count().catch(() => 0);
    console.log(`[T5215 round5] collection header title svg count: ${svgCount}`);
    expect(svgCount, 'the collection header must not render any badge svg near its title').toBe(0);

    await saveEvidence(page, 'T5215-round5-no-collection-header-badge');
  });

  test('item 5: picker default selection -- "No intro" for a never-touched reel with no default, explicit id otherwise', async ({ page }) => {
    await openDrawer(page);

    // Never-touched reel (intro_card_id NULL) with no profile default set on
    // this account -- "No intro" must read as the selected starting point.
    const opened1 = await openGameGroup(page, 'LA Breakers Apr 25');
    test.skip(!opened1, 'no "at LA Breakers Apr 25" group on this account');
    const tile1 = page.getByTestId('reel-card').filter({ hasText: 'Good Dribble and Interception' }).first();
    const has1 = await tile1.isVisible().catch(() => false);
    if (has1) {
      await tile1.hover();
      await tile1.getByRole('button', { name: /More actions/i }).click();
      await page.getByRole('button', { name: 'Intro' }).click();
      const listbox = page.getByRole('listbox', { name: 'Intro card' });
      await expect(listbox).toBeVisible({ timeout: 10000 });
      const noIntro = listbox.getByRole('option', { name: 'No intro' });
      await expect(noIntro, '"No intro" must read as selected for a never-touched reel with no default')
        .toHaveAttribute('aria-selected', 'true');
      const cardOptions = listbox.getByRole('option').filter({ hasNotText: 'No intro' });
      const cardCount = await cardOptions.count();
      for (let i = 0; i < cardCount; i++) {
        await expect(cardOptions.nth(i), 'no card should read as selected in this state')
          .toHaveAttribute('aria-selected', 'false');
      }
      await saveEvidence(page, 'T5215-round5-picker-null-no-default-selects-no-intro');
      await page.getByRole('button', { name: 'Cancel' }).click();
    }

    // Explicit id reel -- must show its OWN card selected, not "No intro".
    await page.goto('/');
    await page.getByRole('button', { name: /My Reels/i }).first().click();
    await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first()).toBeVisible({ timeout: 15000 });
    const opened2 = await openGameGroup(page, 'Legends');
    test.skip(!opened2, 'no "at Legends Mar 28" group on this account');
    const tile2 = page.getByTestId('reel-card').filter({ hasText: 'Brilliant Dribble and Pass' }).first();
    const has2 = await tile2.isVisible().catch(() => false);
    test.skip(!has2, 'no reel with an explicit intro on this account to verify against');
    await tile2.hover();
    await tile2.getByRole('button', { name: /More actions/i }).click();
    await page.getByRole('button', { name: 'Intro' }).click();
    const listbox2 = page.getByRole('listbox', { name: 'Intro card' });
    await expect(listbox2).toBeVisible({ timeout: 10000 });
    const noIntro2 = listbox2.getByRole('option', { name: 'No intro' });
    await expect(noIntro2, '"No intro" must NOT be selected when an explicit card is attached')
      .toHaveAttribute('aria-selected', 'false');
    const cardOptions2 = listbox2.getByRole('option').filter({ hasNotText: 'No intro' });
    const states = await cardOptions2.evaluateAll((els) => els.map((el) => el.getAttribute('aria-selected')));
    const selectedCount = states.filter((s) => s === 'true').length;
    expect(selectedCount, 'exactly one explicit card must read as selected').toBe(1);
    await saveEvidence(page, 'T5215-round5-picker-explicit-id-selects-its-card');
  });
});
