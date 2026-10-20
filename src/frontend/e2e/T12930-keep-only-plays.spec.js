/**
 * T12930 - "Keep only marked plays": tile kebab -> confirm sheet -> Plays only tile ->
 * tap opens Watch plays -> Restore full video returns the tile to normal.
 *
 * Seeds via the dev-only `/api/test/seed-recap-game` seam (skips loudly on a deployed
 * target). Local evidence only: Branch CI does not run Playwright specs.
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const TEST_USER_ID = `e2e_t12930_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_HEADERS = { 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' };

async function authenticateTestUser(page) {
  await page.goto('/');
  const result = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include', headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return res.json();
  }, TEST_HEADERS);
  if (result.error) throw new Error(`[T12930] ${result.error}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('T12930 keep only marked plays @gate-c', () => {
  skipOnDeployedTarget(test, 'seeds via the dev-only /api/test/seed-recap-game seam');

  test('keep -> Plays only tile -> Watch plays -> Restore', async ({ page }) => {
    test.setTimeout(150_000);
    await authenticateTestUser(page);
    const res = await page.request.post(`${API_BASE}/test/seed-recap-game`, {
      headers: { 'X-Test-Mode': 'true', 'Content-Type': 'application/json' },
      data: { name: 'T12930 Game', athlete_clips: 2, team_clips: 0 },
    });
    expect(res.ok(), `seed failed: ${res.status()}`).toBeTruthy();
    const seed = await res.json();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /^Games/ }).first().click();
    const tile = page.locator(`[data-game-id="${seed.game_id}"]`);
    await tile.waitFor({ timeout: 30000 });

    // Cancel writes nothing; the sheet never closes on backdrop click.
    await tile.hover();
    await tile.locator('[data-game-kebab]').click();
    await page.getByRole('button', { name: 'Keep only marked plays' }).click();
    await page.getByTestId('plays-only-sheet-backdrop').click({ position: { x: 5, y: 5 }, force: true });
    await expect(page.getByText('Keep the marked plays only?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(tile.getByText('Plays only')).toHaveCount(0);

    // Confirm.
    await tile.hover();
    await tile.locator('[data-game-kebab]').click();
    await page.getByRole('button', { name: 'Keep only marked plays' }).click();
    await page.getByRole('button', { name: 'Keep plays only' }).click();
    await expect(tile.getByText('Plays only')).toBeVisible({ timeout: 30000 });
    await saveEvidence(page, 'T12930-plays-only-tile');

    // Tap opens Watch plays (a video), not Annotate.
    await tile.click();
    await page.locator('video').first().waitFor({ timeout: 30000 });
    await expect(page.getByTestId('recap-restore-footer')).toBeVisible();
    await page.getByTestId('recap-restore-footer').getByRole('button', { name: 'Restore full video' }).click();

    // Restore (from the footer) opens no sheet by design of the modal footer gesture;
    // the tile returns to normal once the list refetches.
    await expect(tile.getByText('Plays only')).toHaveCount(0, { timeout: 30000 });
    await saveEvidence(page, 'T12930-restored');
  });
});
