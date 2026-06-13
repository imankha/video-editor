import { test, expect } from '@playwright/test';

/**
 * Collections tab E2E (T3610).
 *
 * Covers the tab SHELL behavior + mobile responsiveness (data-independent):
 *   - Collections is the default tab; the source-type filter pills are All-tab only
 *   - No horizontal overflow at 360px
 *
 * The data-dependent assertions (game attribution, ratio-as-identity eligibility,
 * member/summary count parity, story player) are covered by the backend suite
 * (tests/test_collections_summary.py) + the useCollections Vitest. Exercising them
 * here would require seeding published multi-ratio reels through the full
 * export/publish flow; that belongs to the manual Test & Fix stage with a seeded
 * account.
 *
 * Run with (dev servers up on 8000/5173):
 *   cd src/frontend && npx playwright test e2e/collections.spec.js
 */

const TEST_USER_ID = `e2e_collections_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function setupAndAuth(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'collections@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function openGallery(page) {
  // Click the real button so the app's own store instance opens the panel
  // (a page.evaluate import would resolve a separate Zustand module instance).
  await page.getByRole('button', { name: 'My Reels' }).click();
  await expect(page.getByRole('button', { name: 'Collections', exact: true })).toBeVisible();
}

test.afterEach(async ({ request }) => {
  try {
    await request.delete('/api/auth/user', { headers: { 'X-User-ID': TEST_USER_ID } });
  } catch { /* best-effort cleanup */ }
});

test.describe('Collections tab shell', () => {
  test('Collections is the default tab; filter pills are All-tab only', async ({ page }) => {
    await setupAndAuth(page);
    await openGallery(page);

    // Collections is the default tab -> the source-type filter pills (e.g.
    // "Custom Reels", which only exist on the All tab) are not present.
    await expect(page.getByRole('button', { name: 'Custom Reels' })).toHaveCount(0);

    // Switch to All -> the filter pills appear.
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Custom Reels' })).toBeVisible();

    // Back to Collections -> pills gone again.
    await page.getByRole('button', { name: 'Collections', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Custom Reels' })).toHaveCount(0);
  });

  test('No horizontal overflow at 360px with the panel open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await setupAndAuth(page);
    await openGallery(page);

    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  });
});
