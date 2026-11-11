import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { waitForAppReady } from '../helpers/appReady.js';

/**
 * T15760:C1 - the finished highlight player has its own URL that cold-loads to the
 * same highlight. Bug: opening a finished reel from the Published tab (Home) never
 * touched the URL, which stayed at /home -- it could not be linked or resumed.
 */
// T15760 fix round 1: the cold `page.goto(playedPath)` below is a full page
// reload -- it re-runs the entire bootstrap sequence (session init, profile
// ready, /api/bootstrap, cache warming, etc), which this stack has been
// observed to take 60-170s wall-clock under load (SLOW FETCH warnings on
// nearly every request). 90s/240s matches every other check in this
// directory that reloads the app cold (e.g. T15550, T15360, T15430, T15640).
test.setTimeout(240000);

test.describe('T15760 finished highlight player keeps a deep-linkable URL', () => {
  test('T15760:C1 Play updates the URL, Close restores it, and reopening the URL cold-loads the player', async ({ context, page }) => {
    await loginForCheck(context);

    // Navigate the way a user actually reaches the player -- the Highlights (Published)
    // tab gesture, not a cold hit to /home/published (a stale/empty tab there settles
    // on Games until the real count loads, see ProjectManager.jsx's T15480 guard --
    // unrelated to this task, so sidestep it instead of racing it here).
    // Open Home explicitly: '/' restores the account's resume point (T15340), so on staging, where the
    // seeded account has left an Annotate game open, '/' lands inside Annotate and there is no
    // Highlights tab to click (T16020).
    await page.goto('/home');
    await waitForAppReady(page, { ready: page.getByRole('button', { name: /^Highlights/ }), timeout: 60000 });
    await page.getByRole('button', { name: /^Highlights/ }).click();
    await expect(page.getByTestId('published-tab-panel')).toBeVisible({ timeout: 15000 });

    const playButton = page.getByRole('button', { name: 'Watch marked plays' }).first();
    await expect(playButton).toBeVisible({ timeout: 60000 });
    await playButton.click();

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 })
      .toMatch(/^\/home\/published\/\d+$/);
    const playedPath = new URL(page.url()).pathname;

    await page.getByTestId('player-close').click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe('/home/published');

    // The user can't be linked to or resume a play without copying this exact URL and
    // reopening it cold -- reproduce that directly instead of inferring it from in-app state.
    await page.goto(playedPath);
    await expect(page.getByTestId('player-close')).toBeVisible({ timeout: 150000 });
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe(playedPath);
  });
});
