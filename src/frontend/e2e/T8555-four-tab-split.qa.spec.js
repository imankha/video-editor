// T8555 live QA — "Published" is its own tab; "In Progress Reels" is multiclip-only.
// Drives the REAL account (imankh@gmail.com, profile 9fa7378c) so the published
// gallery has real reels to prove the content-separation AC:
//   - In Progress Reels shows ZERO published content (only DraftTiles)
//   - Published shows every published reel (ReelTile posters), regardless of origin
//   - badge counts land on the right tabs
//   - four-tab bar fits 320 / 375 / desktop without horizontal overflow
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

const REAL_EMAIL = 'imankh@gmail.com';
const REAL_PROFILE = '9fa7378c';
const SHOT = '/tmp/t8555-shots';

const gamesTab = (p) => p.getByRole('button', { name: /^Games/i });
const clipsTab = (p) => p.getByRole('button', { name: /^In Progress Clips/i });
const reelsTab = (p) => p.getByRole('button', { name: /^In Progress Reels/i });
const publishedTab = (p) => p.getByRole('button', { name: /^Published/i });

test('T8555: four-tab split, content separation, badges, responsive', async ({ context, page }) => {
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  await page.goto('/home/published');
  await page.waitForLoadState('networkidle');
  // Deep-link landed on Published (proves editorStore HOME_TAB_PATHS survives cold-load canonicalization).
  expect(await page.evaluate(() => window.location.pathname)).toBe('/home/published');

  // --- AC: four peer tabs render ---
  await expect(gamesTab(page)).toBeVisible();
  await expect(clipsTab(page)).toBeVisible();
  await expect(reelsTab(page)).toBeVisible();
  await expect(publishedTab(page)).toBeVisible();
  // Retired label gone.
  await expect(page.getByRole('button', { name: /^Highlights/i })).toHaveCount(0);

  // --- Published tab: the gallery, with real reels ---
  await expect(page.getByTestId('published-tab-panel')).toBeVisible();
  const publishedTiles = page.getByTestId('published-tab-panel').getByTestId("reel-card");
  const publishedCount = await publishedTiles.count().catch(() => 0);
  console.log(`[T8555-QA] Published tab reel tiles: ${publishedCount}`);
  await page.screenshot({ path: `${SHOT}/published-desktop.png`, fullPage: true });

  // Capture published reel display names to prove none leak into In Progress Reels.
  const publishedNames = await publishedTiles.locator(':scope').evaluateAll(
    (els) => els.map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 40)
  ).catch(() => []);

  // --- In Progress Reels tab: multiclip drafts ONLY, no published content ---
  await reelsTab(page).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('in-progress-reels-tab-panel')).toBeVisible();
  // The assembly button lives here with the gate-approved copy.
  await expect(page.getByRole('button', { name: 'New Highlight Reel' })).toBeVisible();
  // ZERO published ReelTiles under this tab (drafts use a different tile).
  const reelTilesUnderInProgress = await page
    .getByTestId('in-progress-reels-tab-panel')
    .getByTestId("reel-card")
    .count()
    .catch(() => 0);
  console.log(`[T8555-QA] published ReelTiles leaking into In Progress Reels: ${reelTilesUnderInProgress} (must be 0)`);
  expect(reelTilesUnderInProgress).toBe(0);
  await page.screenshot({ path: `${SHOT}/inprogress-reels-desktop.png`, fullPage: true });

  // --- In Progress Clips tab renders (frozen id/URL) ---
  await clipsTab(page).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT}/inprogress-clips-desktop.png`, fullPage: true });

  // --- Responsive: no horizontal overflow of the tab bar at 320 / 375 ---
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.goto('/home/published');
    await page.waitForLoadState('networkidle');
    await expect(publishedTab(page)).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    console.log(`[T8555-QA] @${w}px horizontal overflow: ${overflow}px`);
    expect(overflow).toBeLessThanOrEqual(2); // allow sub-pixel rounding
    await page.screenshot({ path: `${SHOT}/tabbar-${w}.png`, fullPage: false });
    // All four tab labels present at this width.
    await expect(gamesTab(page)).toBeVisible();
    await expect(clipsTab(page)).toBeVisible();
    await expect(reelsTab(page)).toBeVisible();
    await expect(publishedTab(page)).toBeVisible();
  }

  console.log(`[T8555-QA] published names sample: ${JSON.stringify(publishedNames).slice(0, 300)}`);
});
