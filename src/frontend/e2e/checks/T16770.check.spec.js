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
 *      (marked at play 1's end + 0.25 s + 5 s; a play spans mark-6..mark+2).
 */
test.setTimeout(240000);

const SAVE_DELAY_MS = 8000;
const SKIPS = 1;
// Free timeline the two plays need: play 1 is marked 6-11 s into the window
// (a play spans mark-6..mark+2, and 5 s skips can only aim within 5 s), play 2
// is marked SKIPS x 5 s past play 1's end, and its end is 2 s past that mark.
// T16880: on staging the shared check account has one ready game whose
// largest free stretch is about 22 s, so the check must fit in that.
const WINDOW_S = 11 + 2 + 0.25 + SKIPS * 5 + 2 + 1;

// T16100: page.request after the app started its own session got 401 on
// staging, so every API call after the first navigation runs inside the page.
async function pageApi(page, apiPath, init = {}) {
  return page.evaluate(async ({ url, init: i }) => {
    const res = await fetch(url, { credentials: 'include', ...i });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  }, { url: checkApi(apiPath), init });
}

test.describe('T16770:C2 second play lands at the new playhead', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('T16770:C2 after "Keep marking plays", a play marked elsewhere is saved around the new playhead', async ({ context, page }) => {
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/games'));
    expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
    const games = (await res.json()).games || [];
    // Only a ready game: on staging the check account also holds a game stuck
    // at storage_status=uploading (T16810), whose video never loads.
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T16770] no active game to mark plays on');

    // Plays live in the game's FIRST video (offset 0, so play times equal
    // timeline times even in a multi-video game).
    const readClips = async () => {
      const r = await pageApi(page, `/games/${target.id}`);
      expect(r.status, `GET /games/${target.id}`).toBe(200);
      const detail = r.body;
      return {
        duration: detail.videos?.[0]?.duration ?? detail.video_duration ?? 0,
        clips: (detail.annotations || [])
          .filter((a) => (a.video_sequence ?? 1) === 1)
          .map((a) => ({ id: a.id, start: a.start_time, end: a.end_time })),
      };
    };

    await openGameInAnnotate(page, target.id);
    await expect(async () => {
      const readyState = await page.evaluate(() => document.querySelector('video')?.readyState ?? 0);
      expect(readyState).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 90000 });
    await disableGuidanceForCheck(page);

    // Two plays need a free window. Use the largest gap between existing clips.
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
    test.skip(!gap || gap[1] - gap[0] < WINDOW_S,
      `[T16770] no ${WINDOW_S} s free window left in this video (largest ${gap ? (gap[1] - gap[0]).toFixed(1) : 0} s)`);

    // Every play this check makes is deleted at the end, so repeated runs
    // do not use up the account's free timeline (T16880: leftovers had).
    const made = [];
    try {
      // Play 1: reach it with the transport buttons (as T15550's check does).
      // A raw <video>.currentTime write is not a user gesture: a multi-video
      // game only reads the element's time while playing, and a selected
      // play's editor loop pulls it back. Aim at the first 5 s step at or
      // after gap+6, so play 1 starts inside the window.
      const current = await page.evaluate(() => {
        const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
        return [...document.querySelectorAll('video')].sort((a, b) => area(b) - area(a))[0]?.currentTime ?? 0;
      });
      const steps = Math.ceil((gap[0] + 6 - current) / 5);
      const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
      const skip = steps >= 0 ? forward : page.getByTitle('Back 5 seconds (Left arrow)');
      for (let i = 0; i < Math.abs(steps); i++) {
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
      made.push(play1.id);
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
      made.push(added.id);
      // Fixed: marked at play 1's end + 0.25 + 5 s, so it starts ~0.75 s
      // before play 1's end. The old code put the playhead back at play 1's
      // end + 0.25, so the play started ~5.75 s before play 1's end.
      const expectedMark = play1.end + 0.25 + SKIPS * 5;
      expect(added.start, `second play ${added.start}-${added.end}, play 1 ${play1.start}-${play1.end}, expected ~${expectedMark - 6}`)
        .toBeGreaterThan(expectedMark - 7);
      expect(added.end, `second play end ${added.end}, expected ~${expectedMark + 2}`).toBeLessThan(expectedMark + 3);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // A play saved after the poll gave up (slow save) is caught here too.
      const leftovers = (await readClips().catch(() => ({ clips: [] }))).clips
        .filter((c) => !initialIds.has(c.id)).map((c) => c.id);
      for (const id of new Set([...made, ...leftovers])) {
        const del = await pageApi(page, `/clips/raw/${id}`, { method: 'DELETE' });
        expect([200, 404], `DELETE /clips/raw/${id}`).toContain(del.status);
      }
    }
  });
});
