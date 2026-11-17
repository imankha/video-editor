import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T16770: after "Keep marking plays", moving the playhead and marking again
 * must save the new play around the NEW playhead, not just past the first play.
 *
 * Staging QA 2026-11-16 saw a play marked at 0:45 saved at 16.5-24.5 s (just
 * past the first play, 14-22 s). Root cause: "Keep marking plays" returned to
 * Mark Play and moved the playhead past the first play only AFTER the
 * highlight save came back, so a seek made while the save was out was
 * overwritten. This check holds that save for a few seconds (a slow network),
 * moves the playhead with the transport while it is held, lets it land, then
 * marks the second play.
 *
 * C2 - the second play is saved around where the user moved the playhead
 *      (marked at play 1's end + 0.25 s + 4 x 5 s; a play spans mark-6..mark+2).
 */
test.setTimeout(240000);

const SAVE_DELAY_MS = 8000;
const SKIPS = 4;

test.describe('T16770:C2 second play lands at the new playhead', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('T16770:C2 after "Keep marking plays", a play marked elsewhere is saved around the new playhead', async ({ context, page }) => {
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/games'));
    expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T16770] no active game to mark plays on');

    // Plays live in the game's FIRST video (offset 0, so play times equal
    // timeline times even in a multi-video game).
    const readClips = async () => {
      const r = await page.request.get(checkApi(`/games/${target.id}`));
      expect(r.ok(), `GET /games/${target.id} -> ${r.status()}`).toBeTruthy();
      const detail = await r.json();
      return {
        duration: detail.videos?.[0]?.duration ?? detail.video_duration ?? 0,
        clips: (detail.annotations || [])
          .filter((a) => (a.video_sequence ?? 1) === 1)
          .map((a) => ({ id: a.id, start: a.start_time, end: a.end_time })),
      };
    };

    // Two plays need a free window: play 1 (8 s) at its start, play 2 (8 s)
    // well past it. Use the largest gap between existing clips.
    const { duration, clips } = await readClips();
    const initialIds = new Set(clips.map((c) => c.id));
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    const gaps = [];
    let cursor = 0;
    for (const c of sorted) {
      if (c.start > cursor) gaps.push([cursor, c.start]);
      cursor = Math.max(cursor, c.end);
    }
    if (duration > cursor) gaps.push([cursor, duration]);
    gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const gap = gaps[0];
    test.skip(!gap || gap[1] - gap[0] < 38, '[T16770] no 38 s free window left in this video');
    const firstMark = gap[0] + 10; // play 1 ~ [gap+4, gap+12] (+-2.5 s from 5 s skips); play 2 ~20 s later

    await openGameInAnnotate(page, target.id);
    await expect(async () => {
      const readyState = await page.evaluate(() => document.querySelector('video')?.readyState ?? 0);
      expect(readyState).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 90000 });
    await disableGuidanceForCheck(page);

    // Play 1: reach it with the transport buttons (as T15550's check does). A
    // raw <video>.currentTime write is not a user gesture: a multi-video game
    // only reads the element's time while playing, and a selected play's
    // editor loop pulls it back.
    const current = await page.evaluate(() => {
      const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
      return [...document.querySelectorAll('video')].sort((a, b) => area(b) - area(a))[0]?.currentTime ?? 0;
    });
    const delta = firstMark - current;
    const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
    const skip = delta >= 0
      ? forward
      : page.getByTitle('Back 5 seconds (Left arrow)');
    for (let i = 0; i < Math.round(Math.abs(delta) / 5); i++) {
      await skip.click({ timeout: 5000 });
    }
    const markBtn = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn).toBeVisible({ timeout: 60000 });
    await markBtn.click();

    // Rate it Highlight, Done -> "Make this a highlight now?" card.
    const fiveStars = page.getByRole('radio', { name: /5 stars/ });
    await expect(fiveStars).toBeVisible({ timeout: 30000 });
    await fiveStars.click();
    await page.getByTestId('play-editor-done').click();
    const later = page.getByTestId('highlight-choice-later');
    await expect(later).toBeVisible({ timeout: 30000 });

    // Hold the highlight save (PUT with create_project) like a slow network.
    let releasedSave;
    const saveReleased = new Promise((r) => { releasedSave = r; });
    await page.route('**/api/clips/raw/*', async (route) => {
      const req = route.request();
      if (req.method() === 'PUT' && (req.postData() || '').includes('create_project')) {
        await new Promise((r) => setTimeout(r, SAVE_DELAY_MS));
        await route.continue();
        releasedSave();
        return;
      }
      await route.continue();
    });

    // The card can show before play 1's save has committed: wait for play 1
    // itself rather than taking the highest id (a read that raced the save
    // took an older clip as play 1 and play 1 as the "second" play).
    let clipsWithPlay1;
    let play1;
    await expect.poll(async () => {
      clipsWithPlay1 = (await readClips()).clips;
      play1 = clipsWithPlay1.find((c) => !initialIds.has(c.id));
      return Boolean(play1);
    }, { timeout: 30000, message: 'play 1 saved' }).toBe(true);
    const before = new Set(clipsWithPlay1.map((c) => c.id));

    await later.click();
    // Back on Mark Play while the save is still held, and the playhead moves
    // with the transport (the old code kept the card up until the save
    // returned, then moved the playhead to just past play 1).
    await expect(markBtn).toBeVisible({ timeout: 3000 });
    for (let i = 0; i < SKIPS; i++) {
      await forward.click({ timeout: 3000 });
    }
    // Let the held save land, then mark, as QA did 0.8 s after moving.
    await saveReleased;
    await page.waitForTimeout(800);

    await expect(markBtn).toBeVisible({ timeout: 60000 });
    await markBtn.click();

    let added;
    await expect.poll(async () => {
      added = (await readClips()).clips.find((c) => !before.has(c.id));
      return Boolean(added);
    }, { timeout: 60000, message: 'second play saved' }).toBe(true);
    const expectedMark = play1.end + 0.25 + SKIPS * 5;
    expect(added.start, `second play ${added.start}-${added.end}, play 1 ${play1.start}-${play1.end}, expected ~${expectedMark - 6}`)
      .toBeGreaterThan(expectedMark - 7);
    expect(added.end, `second play end ${added.end}, expected ~${expectedMark + 2}`).toBeLessThan(expectedMark + 3);
  });
});
