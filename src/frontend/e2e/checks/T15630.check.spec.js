import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T15630: the full-screen "What sport is this?" question is asked at most
 * once per game, and a skip is remembered for that game (it must not
 * re-appear after leaving Annotate and coming back on a mobile no_sport
 * profile).
 *
 * Setup (not the asserted gesture): PUT /profiles/{id} with sport=no_sport
 * so the profile is in the state the question requires, mirroring how a
 * real user who skipped sport in the upload modal arrives here.
 */
test.setTimeout(240000);

test.describe('T15630:C1 sport question remembers a skip per game', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('T15630:C1 - sport question is not re-asked after a reload once skipped for a game', async ({ context, page }) => {
    await loginForCheck(context);

    const profilesRes = await page.request.get(checkApi('/profiles'));
    expect(profilesRes.ok(), `GET /profiles -> ${profilesRes.status()}`).toBeTruthy();
    const profiles = (await profilesRes.json()).profiles || [];
    const current = profiles.find((p) => p.isCurrent) || profiles[0];
    test.skip(!current, '[T15630] no current profile');

    const putRes = await page.request.put(checkApi(`/profiles/${current.id}`), {
      data: { sport: 'no_sport' },
    });
    expect(putRes.ok(), `PUT /profiles/${current.id} -> ${putRes.status()}`).toBeTruthy();

    const gamesRes = await page.request.get(checkApi('/games'));
    expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
    const games = (await gamesRes.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T15630] no active game to mark a play on');

    const gameRes0 = await page.request.get(checkApi(`/games/${target.id}`));
    const existing = (await gameRes0.json()).annotations || [];
    // A 5s-aligned spot not already covered by an existing play, so Mark play
    // creates a NEW play (and thus goes through the about-to-create gate) both
    // times, rather than selecting an existing one.
    const freeSpots = [5, 15, 25, 35, 45].filter(
      (t) => !existing.some((a) => t >= a.start_time - 1 && t <= a.end_time + 1)
    );
    test.skip(freeSpots.length < 2, '[T15630] not enough free 5s-aligned spots to mark two new plays');

    async function seekTo(target5s) {
      const current0 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
      const diff = target5s - current0;
      const btn = diff >= 0
        ? page.getByTitle('Forward 5 seconds (Right arrow)')
        : page.getByTitle('Back 5 seconds (Left arrow)');
      for (let i = 0; i < Math.round(Math.abs(diff) / 5); i++) {
        await btn.click({ timeout: 5000 });
      }
      await expect.poll(
        () => page.evaluate(() => document.querySelector('video')?.currentTime ?? -1),
        { timeout: 10000 }
      ).toBeLessThan(target5s + 1);
    }

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

    await seekTo(freeSpots[0]);
    const markBtn = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn).toBeVisible({ timeout: 90000 });
    await markBtn.click();

    const dialog = page.getByRole('dialog', { name: 'What sport is this?' });
    await expect(dialog, 'sport question appears on the first Mark play while no_sport').toBeVisible({ timeout: 15000 });
    await dialog.getByText('Skip for now').click();
    await expect(dialog).toBeHidden();

    // Leave Annotate and come back for the SAME game (the remount a user hits
    // navigating away and returning, or reloading).
    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

    await seekTo(freeSpots[1]);
    const markBtn2 = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn2).toBeVisible({ timeout: 90000 });
    await markBtn2.click();

    await expect(
      page.getByRole('dialog', { name: 'What sport is this?' }),
      'sport question must NOT re-appear for the same game after a remembered skip'
    ).toBeHidden({ timeout: 5000 });
  });
});
