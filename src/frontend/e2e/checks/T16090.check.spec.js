import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T16090:C3 - after publishing a highlight and deleting its reel, Annotate no longer
 * lists that highlight for the play, and the play can make a new highlight that opens
 * in Frame with its video. Seeds a published highlight via the non-prod test seam
 * (`POST /test/seed-published-highlight`, which archives the project through the real
 * `archive_project` exactly like the publish gesture -- driving a full render+export
 * through the UI just to get a published project is what the seam exists to avoid,
 * see test_seams.py T13820), confirms Annotate lists it, then deletes the reel through
 * the real DELETE /downloads/{id} endpoint (the same one the UI's delete button calls)
 * and checks the play's highlight list and "Make highlight" card are back to the
 * no-highlight state, and that starting a new one actually loads a video in Frame.
 */
test.setTimeout(180000);

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1)).catch(() => -1);
}

test('T16090:C3 a deleted reel leaves no highlight behind in Annotate', async ({ context, page }) => {
  await loginForCheck(context);

  // Reuse a real, already-uploaded game + play (so Annotate has an actual video to
  // render), rather than the seam's own synthetic game (which has no video and
  // never renders clip rows). The play may already have other highlights -- this
  // check only needs its highlight-row for THIS seeded project to appear then
  // disappear, not for the play to start with zero highlights.
  const gamesRes = await page.request.get(checkApi('/games'));
  expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
  const games = await gamesRes.json();
  const gameList = games.games || games;
  let gameId = null;
  let rawClipId = null;
  for (const g of gameList.filter((g) => g.clip_count > 0)) {
    const loadRes = await page.request.get(checkApi(`/games/${g.id}/load`));
    if (!loadRes.ok()) continue;
    const loaded = await loadRes.json();
    const clip = (loaded.game?.annotations || [])[0];
    if (clip) { gameId = g.id; rawClipId = clip.raw_clip_id; break; }
  }
  expect(gameId && rawClipId, 'an existing game with at least one play').toBeTruthy();

  // Seed a published highlight on that exact play through the non-prod test seam
  // (archives the project through the real `archive_project`, exactly like the
  // publish gesture -- driving a full render+export through the UI just to get a
  // published project is what the seam exists to avoid, see test_seams.py T13820).
  const seedRes = await page.request.post(checkApi('/test/seed-published-highlight'), {
    data: { name: 'T16090 check highlight', game_id: gameId, raw_clip_id: rawClipId },
  });
  expect(seedRes.ok(), `seed-published-highlight -> ${seedRes.status()}`).toBeTruthy();
  const { project_id: projectId, final_video_id: finalVideoId } = await seedRes.json();
  expect(projectId && finalVideoId, 'seeded project/final_video ids').toBeTruthy();

  await page.goto(`/annotate/g/${gameId}`);
  const clipRows = page.getByTestId('clip-row');
  await expect.poll(() => clipRows.count(), { timeout: 30000 }).toBeGreaterThan(0);
  const rowCount = await clipRows.count();

  // The seeded play's row isn't named by the list API, so select it the way a user
  // would: click each play until the one that owns the seeded highlight reveals its
  // row (same technique as T16040.check.spec.js).
  const highlightRow = page.getByTestId(`highlight-row-${projectId}`);
  let rowIndex = -1;
  for (let i = 0; i < rowCount; i++) {
    await clipRows.nth(i).click();
    if (await highlightRow.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
      rowIndex = i;
      break;
    }
  }
  expect(rowIndex, `highlight-row-${projectId} (the seeded highlight's row) to appear`).toBeGreaterThanOrEqual(0);

  const deleteRes = await page.request.delete(checkApi(`/downloads/${finalVideoId}`));
  expect(deleteRes.ok(), `delete reel -> ${deleteRes.status()}`).toBeTruthy();

  // Re-select the same play: THAT highlight must be gone from Annotate's list.
  await page.goto(`/annotate/g/${gameId}`);
  await expect.poll(() => clipRows.count(), { timeout: 30000 }).toBeGreaterThan(0);
  await clipRows.nth(rowIndex).click();
  const makeButton = page.getByTestId('annotate-make-highlight');
  await makeButton.waitFor({ state: 'visible', timeout: 10000 });
  await expect(page.getByTestId(`highlight-row-${projectId}`)).toHaveCount(0);

  // The play can make a new highlight, and it opens Frame with its video.
  await makeButton.click();
  await expect.poll(() => /^\/(focus|overlay)\/p\/(\d+)/.test(new URL(page.url()).pathname), {
    timeout: 60000,
  }).toBe(true);
  const newProjectId = Number(new URL(page.url()).pathname.match(/\/p\/(\d+)/)[1]);
  expect(newProjectId).not.toBe(projectId);

  const stuck = page.getByTestId('focus-stuck-empty');
  await expect.poll(async () => (await videoTime(page)) >= 0 || (await stuck.count()) > 0, {
    timeout: 30000,
  }).toBe(true);
  expect(await stuck.count(), 'Frame did not show the stuck-empty fallback -- a real video loaded').toBe(0);
  expect(await videoTime(page)).toBeGreaterThanOrEqual(0);
});
