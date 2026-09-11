import { test, expect } from '@playwright/test';

/**
 * T9390 QA drive: the four home-tab empty guides after the copy/strip simplify +
 * Decision 3 tab gating. Empty test-login session (no games, no clips), driven at
 * 320/390/768/1024. Captures screenshots to qa/ and asserts the new binding copy,
 * the 3-node-plus-optional-pill flow strip (sm+ only), and the disabled
 * Reels/Published tabs + visible caption.
 *
 * The throttled-network Published first-paint fix (Step 6) needs an account that
 * HAS a clip but nothing published (so Published is reachable AND its list is
 * empty); that shape is not constructible from an empty test-login session, so it
 * is verified by the useCollections eager-at-mount unit test + supervisor-side
 * live check, noted in the QA status. An empty account's Published tab is disabled
 * by design here.
 */

const TEST_USER_ID = `e2e_t9390_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const CAPTION = 'Reels and Published unlock once you have a clip. Cut one from a game, or use Add Video on Clips.';
const VIEWPORTS = [
  { w: 320, h: 720, label: '320' },
  { w: 390, h: 844, label: '390' },
  { w: 768, h: 1024, label: '768' },
  { w: 1024, h: 768, label: '1024' },
];

async function authEmptyUser(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test('T9390: four-tab empty guides, strip, and gating across viewports', async ({ page }) => {
  await authEmptyUser(page);

  // Scope to the tab bar: at narrow widths the accessible name is the SHORT label
  // ("Reels"/"Clips"), because a real browser excludes the display:none full label
  // from name computation. Match the short label (a substring of the full one) and
  // scope to the tab-bar grid so the "Skip ahead on Clips." footer button (outside
  // the bar) never collides.
  const tabBar = page.locator('div.grid.grid-cols-4').first();
  const gamesTab = tabBar.getByRole('button', { name: /Games/ });
  const clipsTab = tabBar.getByRole('button', { name: /Clips/ });
  const reelsTab = tabBar.getByRole('button', { name: /Reels/ });
  const publishedTab = tabBar.getByRole('button', { name: /Published/ });

  await expect(gamesTab).toBeVisible({ timeout: 30000 });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(150);

    // --- Games tab (default landing, empty) ---
    // New shortened headline + kept Games-only footer link.
    await expect(page.getByText('Start with a game')).toBeVisible();
    await expect(page.getByText('Upload a recording, then tap Mark play on the moments worth keeping.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip ahead on Clips.' })).toBeVisible();

    // Decision 3: Reels + Published disabled; Games + Clips reachable; caption shown.
    await expect(reelsTab).toBeDisabled();
    await expect(publishedTab).toBeDisabled();
    await expect(gamesTab).toBeEnabled();
    await expect(clipsTab).toBeEnabled();
    await expect(page.getByText(CAPTION)).toBeVisible();

    // Flow strip is sm+ only. Tailwind `sm` = 640px.
    const optionalPill = page.getByText('· optional');
    if (vp.w >= 640) {
      await expect(optionalPill).toBeVisible();
      // Published renumbered to 3 (Reels unnumbered); there is no "4". Scope to
      // the strip's own <ol> so unrelated on-screen digits can't interfere.
      const strip = page.locator('ol', { has: page.getByText('· optional') });
      await expect(strip.getByText('3', { exact: true })).toBeVisible();
      await expect(strip.getByText('4', { exact: true })).toHaveCount(0);
    } else {
      await expect(optionalPill).not.toBeVisible();
    }

    await page.screenshot({ path: `qa/t9390-games-${vp.label}.png`, fullPage: true });

    // --- Clips tab (games = 0): Add Video ALONE, "No game needed.", no Add Game ---
    await clipsTab.click();
    await expect(page.getByText('Cut a clip, or upload one')).toBeVisible();
    await expect(page.getByText('No game needed.')).toBeVisible();
    const addVideo = page.locator('[data-tutorial-target="clips-add-video"]');
    await expect(addVideo).toHaveCount(1); // T8380 invariant: exactly one node
    await expect(page.getByRole('button', { name: 'Add Game' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Go to Games' })).toHaveCount(0); // games=0

    await page.screenshot({ path: `qa/t9390-clips-${vp.label}.png`, fullPage: true });

    // Back to Games for the next viewport iteration.
    await gamesTab.click();
  }
});
