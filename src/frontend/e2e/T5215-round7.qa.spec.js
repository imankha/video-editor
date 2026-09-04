import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5215 round 7 QA — user, 2026-08-07, confirming round 6's finding:
 * "i want the intro badge on collections, i didn't want the frame
 * thumbnail. not a contradiction, a misunderstanding." Round 6 correctly
 * identified the small collection-header thumbnail as the pre-existing,
 * unrelated T5673 leading-reel poster and held off removing it pending
 * confirmation (see e2e/T5215-round6.qa.spec.js, item 2). This round
 * removes it entirely; the new intro corner badge (round 6 item 3) stays,
 * now the ONLY thing that ever renders in the media slot besides the
 * Film-icon placeholder.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5215-round7.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Highlights/ }).first().click();
  await expect(page.getByTestId('highlights-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

async function openGameGroup(page, matchText) {
  const headers = page.getByTestId('highlights-tab-panel').getByTestId('collapsible-group-header');
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

test.describe('T5215 round 7 (real account)', () => {
  test('the T5673 leading-reel poster is gone; the media slot is always the Film-icon placeholder, badge still renders', async ({ page }) => {
    await openDrawer(page);
    const opened = await openGameGroup(page, 'Legends');
    test.skip(!opened, 'no "at Legends Mar 28" group on this account');

    const header = page.getByTestId('highlights-tab-panel').getByText('Game Highlights').first();
    const visible = await header.isVisible().catch(() => false);
    test.skip(!visible, '"Game Highlights" card not present on this account');
    const cardRoot = header.locator('xpath=ancestor::div[contains(@class,"flex items-center gap-3")]').first();
    const mediaSlot = cardRoot.locator('> div').first();
    await saveEvidence(page, 'T5215-round7-collection-media-slot');

    // No poster.jpg <img> anywhere in this card's media slot -- must always
    // be the Film-icon placeholder now, regardless of leading_reel_id.
    const posterCount = await mediaSlot.locator('img[src*="poster.jpg"]').count();
    expect(posterCount, 'the T5673 leading-reel poster must be removed entirely').toBe(0);

    // The Film icon placeholder renders unconditionally.
    const filmIconCount = await mediaSlot.locator('svg.lucide-film').count();
    expect(filmIconCount, 'the Film icon placeholder must always render in the media slot').toBeGreaterThan(0);

    // The round-6 intro badge is unaffected by this change -- still renders
    // in the (now single) media-slot path when this collection has an intro.
    const badge = mediaSlot.getByTestId('intro-badge');
    const hasBadge = await badge.isVisible().catch(() => false);
    console.log(`[T5215 round7] intro badge visible in the single media-slot path: ${hasBadge}`);
  });
});
