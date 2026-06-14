import { test, expect } from '@playwright/test';

/**
 * Collection share public viewer E2E (T3620).
 *
 * The public /shared/collection/{token} route needs no auth. The resolve API is
 * network-mocked (page.route) so the test is data-independent and exercises the
 * mobile-PRIMARY viewer shell + its state machine. The live-data path (real
 * presigned membership, recipient email gate) is covered by the backend suite
 * (tests/test_collection_shares.py).
 *
 * Run with the dev frontend up (5173):
 *   cd src/frontend && npx playwright test e2e/collection-share.spec.js
 */

const TOKEN = 'abcdef01-2345-6789-abcd-ef0123456789';
const URL = `/shared/collection/${TOKEN}`;

test.use({ viewport: { width: 390, height: 844 } }); // mobile-primary

test.describe('Public collection viewer', () => {
  test('renders the story player with the frozen title and current members', async ({ page }) => {
    await page.route(`**/api/shared/collection/${TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Vs Carlsbad - Portrait',
          context_line: 'This link always shows the current reels for this game.',
          aspect_ratio: '9:16',
          members: [
            { id: 1, name: 'Goal', duration: 12.0, presigned_url: 'https://r2.example/a.mp4' },
            { id: 2, name: 'Assist', duration: 9.0, presigned_url: 'https://r2.example/b.mp4' },
          ],
        }),
      }));

    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'Vs Carlsbad - Portrait' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();

    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  });

  test('empty membership shows a no-highlights-yet state, not an error', async ({ page }) => {
    await page.route(`**/api/shared/collection/${TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Top Plays - Portrait',
          context_line: 'This link always shows the current top reels.',
          aspect_ratio: '9:16',
          members: [],
        }),
      }));

    await page.goto(URL);
    await expect(page.getByText('No highlights yet', { exact: false })).toBeVisible();
  });

  test('revoked link shows the revoked message', async ({ page }) => {
    await page.route(`**/api/shared/collection/${TOKEN}`, (route) =>
      route.fulfill({ status: 410, contentType: 'application/json',
        body: JSON.stringify({ detail: 'This share has been revoked' }) }));

    await page.goto(URL);
    await expect(page.getByText('no longer active', { exact: false })).toBeVisible();
  });

  test('restricted link prompts to sign in', async ({ page }) => {
    await page.route(`**/api/shared/collection/${TOKEN}`, (route) =>
      route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Access denied' }) }));

    await page.goto(URL);
    await expect(page.getByText('restricted', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });
});
