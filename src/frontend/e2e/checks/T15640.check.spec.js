import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T15640: Jump to play lands at the end of the play (C1), and Mark play at
 * 0:00 makes a 2s play instead of the normal 8s one (C2).
 *
 * C1 - on a mobile portrait viewport, tapping "Jump to play" on a play with a
 *      multi-second duration seeks the video to the play's START, not its end.
 * C2 - Mark play tapped near 0:00 still creates a play DEFAULT_CLIP_DURATION
 *      (8s) long, not a truncated one.
 */
test.setTimeout(240000);

test.describe('T15640:C1 Jump to play seeks to the play start', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('T15640:C1 tapping Jump to play lands the playhead at the play start', async ({ context, page }) => {
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/games'));
    expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    test.skip(!target, '[T15640] no active game with clips');

    const gameRes = await page.request.get(checkApi(`/games/${target.id}`));
    expect(gameRes.ok(), `GET /games/${target.id} -> ${gameRes.status()}`).toBeTruthy();
    const annotations = (await gameRes.json()).annotations || [];
    // A play with real separation between start/end so seeking to the wrong
    // end is unambiguous (the bug report's 14-22s repro).
    const sorted = [...annotations].sort((a, b) => {
      const seqA = a.video_sequence ?? 1;
      const seqB = b.video_sequence ?? 1;
      if (seqA !== seqB) return seqA - seqB;
      return a.start_time - b.start_time;
    });
    const rowIndex = sorted.findIndex((a) => (a.end_time - a.start_time) >= 4 && a.start_time >= 2);
    test.skip(rowIndex === -1, '[T15640] no play with enough start/end separation to disambiguate');
    const play = sorted[rowIndex];

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

    // Open the mobile plays drawer (portrait -> off-canvas list, same list order
    // ClipsSidePanel renders: sorted by videoSequence then startTime).
    await page.getByTitle('Show plays').click();
    const drawer = page.getByTestId('annotate-plays-drawer');
    await expect(drawer).toBeVisible();

    const row = drawer.getByTestId('clip-row').nth(rowIndex);
    await row.getByTitle('Jump to play').click();

    await expect.poll(async () => {
      return page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
    }, { timeout: 15000 }).not.toBeNull();

    const landedAt = await page.evaluate(() => document.querySelector('video')?.currentTime);
    expect(landedAt, `jumped to ${landedAt}, expected near start ${play.start_time} (not end ${play.end_time})`)
      .toBeLessThan(play.start_time + 1.5);
    expect(landedAt).toBeGreaterThanOrEqual(Math.max(0, play.start_time - 1.5));
  });
});

test.describe('T15640:C2 Mark play near 0:00 still makes a full-length play', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('T15640:C2 Mark play tapped near 0:00 creates an 8s play, not a 2s one', async ({ context, page }) => {
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/games'));
    expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T15640] no active game to mark a play on');

    const gameRes0 = await page.request.get(checkApi(`/games/${target.id}`));
    const existing = (await gameRes0.json()).annotations || [];
    // Any t < DEFAULT_CLIP_BEFORE (6s) reproduces the clamp bug — find a 5s-aligned
    // landing spot not already covered by an existing play (which would select it
    // instead of rendering the Mark play CTA).
    const candidateT = [5, 0].find(
      (t) => !existing.some((a) => t >= a.start_time - 0.5 && t <= a.end_time + 0.5)
    );
    test.skip(candidateT === undefined, '[T15640] no 5s-aligned gap near 0:00 free of an existing play');

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

    // Drive real seek gestures (the transport's 5s step buttons), same as the
    // other checks in this group: forward well past every existing play, then
    // back down to the 5s-aligned free spot near 0:00.
    const maxEnd = existing.reduce((m, a) => Math.max(m, a.end_time), 0);
    const forwardTarget = Math.ceil((maxEnd + 10) / 5) * 5;
    const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
    for (let i = 0; i < forwardTarget / 5; i++) {
      await forward.click({ timeout: 5000 });
    }
    const backward = page.getByTitle('Back 5 seconds (Left arrow)');
    for (let i = 0; i < (forwardTarget - candidateT) / 5; i++) {
      await backward.click({ timeout: 5000 });
    }

    await expect.poll(
      () => page.evaluate(() => document.querySelector('video')?.currentTime ?? -1),
      { timeout: 10000 }
    ).toBeLessThan(candidateT + 1);

    const markBtn = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn).toBeVisible({ timeout: 90000 });
    await markBtn.click();

    await expect.poll(async () => {
      const gameRes = await page.request.get(checkApi(`/games/${target.id}`));
      const annotations = (await gameRes.json()).annotations || [];
      return annotations.length;
    }, { timeout: 60000, intervals: [1000] }).toBe(existing.length + 1);

    const gameRes = await page.request.get(checkApi(`/games/${target.id}`));
    const annotations = (await gameRes.json()).annotations || [];
    const play = annotations.find((a) => !existing.some((e) => e.id === a.id));
    expect(play, 'newly created play found').toBeTruthy();
    expect(play.start_time).toBe(0);
    expect(play.end_time - play.start_time, `play was ${play.end_time - play.start_time}s, expected 8s`).toBe(8);
  });
});
