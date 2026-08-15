import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5215 round 4 QA — two user notes from testing :5176:
 *   1. A profile-photo thumbnail should appear under the profile indicator
 *      (ProfileSportButton) when the profile has one.
 *   2. The intro badge glyph should look like a card + face silhouette, not
 *      a generic sparkle -- verified by inspecting the rendered SVG shape
 *      (a <rect> card frame + <circle> head), not just "an svg exists".
 *
 * Run: bash scripts/dev-verify.sh e2e/T5215-round4.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// A tiny but genuinely-decodable 1x1 JPEG (base64) -- same fixture as
// T5190-intro-upload-consent.spec.js (the backend rejects by decoding).
const JPEG_1x1_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
const JPEG_1x1 = Buffer.from(JPEG_1x1_B64, 'base64');

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /My Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
}

async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

test.describe('T5215 round 4 (real account)', () => {
  test('item 1: profile photo thumbnail appears under the profile indicator, persists after reload', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');

    const profileButton = page.getByRole('button', { name: /switch sport or profile/i });
    await expect(profileButton).toBeVisible({ timeout: 20000 });

    await profileButton.click();
    await expect(page.getByText('Manage Profiles')).toBeVisible({ timeout: 10000 });
    await page.getByTitle(/Edit name, color/i).first().click();
    await expect(page.getByText('Player intro card')).toBeVisible({ timeout: 10000 });

    // Ensure a photo exists (upload one via the real UI if this profile has none).
    const hasPhoto = await page.getByAltText('Intro card').isVisible().catch(() => false);
    if (!hasPhoto) {
      await page.setInputFiles('[data-testid="intro-image-input"]', {
        name: 'photo.jpg', mimeType: 'image/jpeg', buffer: JPEG_1x1,
      });
      await expect(page.getByAltText('Intro card'), 'uploaded preview renders')
        .toBeVisible({ timeout: 30000 });
    }
    const profileImgSrc = await page.getByAltText('Intro card').getAttribute('src');

    await page.keyboard.press('Escape');

    const thumb = page.locator('img[aria-hidden="true"][class*="rounded-lg"]');
    await expect(thumb, 'a rounded thumbnail must appear under the profile indicator').toBeVisible({ timeout: 10000 });
    expect(await thumb.getAttribute('src')).toBe(profileImgSrc);
    await saveEvidence(page, 'T5215-round4-photo-thumbnail');

    // RELOAD -- real persistence check, not a same-session echo.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /switch sport or profile/i })).toBeVisible({ timeout: 20000 });
    const thumbAfterReload = page.locator('img[aria-hidden="true"][class*="rounded-lg"]');
    await expect(thumbAfterReload, 'the thumbnail must still show after reload').toBeVisible({ timeout: 10000 });
    expect(await thumbAfterReload.getAttribute('src')).toBe(profileImgSrc);
    await saveEvidence(page, 'T5215-round4-photo-thumbnail-after-reload');
  });

  test('item 2: intro badge is the card+silhouette glyph, not a generic sparkle', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist');
    const targetCard = cards[0];

    const tile = page.getByTestId('reel-card').first();
    await tile.hover();
    await tile.getByRole('button', { name: /More actions/i }).click();
    const introItem = page.getByRole('button', { name: 'Intro' });
    test.skip(await introItem.count() === 0, '"Intro" kebab item not present (UI drift)');
    await introItem.click();

    const listbox = page.getByRole('listbox', { name: 'Intro card' });
    await expect(listbox).toBeVisible({ timeout: 10000 });
    const optionLocator = listbox.getByRole('option', {
      name: targetCard.is_default ? `${targetCard.name} (your default)` : targetCard.name,
    });
    await optionLocator.click();
    await expect(listbox).toBeVisible(); // select-then-OK (round 3): still open

    const patchResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    await patchResp;
    await expect(listbox).toHaveCount(0);

    // The badge glyph itself: our custom shape has a <rect> card frame (rx
    // rounded) + a <circle> head -- lucide's Sparkles is built entirely from
    // <path> elements with no <rect>, so this distinguishes the two shapes,
    // not just "some svg exists".
    const badgeSvg = tile.getByTestId('intro-badge').locator('svg').first();
    await expect(badgeSvg, 'the reel tile must show the intro badge').toBeVisible({ timeout: 10000 });
    const rectCount = await badgeSvg.locator('rect').count();
    const circleCount = await badgeSvg.locator('circle').count();
    console.log(`[T5215 round4] reel badge shape: rect=${rectCount} circle=${circleCount}`);
    expect(rectCount, 'badge must render the card-frame rect (not the old Sparkles glyph)').toBeGreaterThan(0);
    expect(circleCount, 'badge must render the face-silhouette head circle').toBeGreaterThan(0);
    await saveEvidence(page, 'T5215-round4-badge-glyph-reel');
  });
});
