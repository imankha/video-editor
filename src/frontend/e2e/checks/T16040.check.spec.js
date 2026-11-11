import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T16040:C3 - clicking an in-progress highlight in Annotate's highlight list opens
 * Frame with the video within 10s. Finds a project that is not yet published (an
 * "in-progress highlight"), navigates to its game in Annotate, selects the play that
 * owns it, opens the highlight row, and watches Frame actually load the video rather
 * than hang on "Loading..." (the owner's T16040 report).
 */
test.setTimeout(90000);

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1)).catch(() => -1);
}

test('T16040:C3 opening an in-progress highlight from Annotate opens Frame within 10s', async ({ context, page }) => {
  await loginForCheck(context);

  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const projects = await res.json();
  const inProgress = projects.find((p) => !p.is_published && p.clip_count > 0 && p.game_ids?.length > 0);
  expect(inProgress, 'an in-progress project with at least one clip and a game').toBeTruthy();

  await page.goto(`/annotate/g/${inProgress.game_ids[0]}`);
  const clipRows = page.getByTestId('clip-row');
  await expect.poll(() => clipRows.count(), { timeout: 30000 }).toBeGreaterThan(0);
  const rowCount = await clipRows.count();

  // Click each play until the one that owns this project reveals its highlight row --
  // the play that owns the in-progress highlight is not named by the list API, so find
  // it the way a user would: select plays until the right highlight shows up. `waitFor`
  // (not a bare `.count()`) gives each selection's React re-render time to land before
  // moving to the next play, instead of racing a stale DOM read.
  const highlightRow = page.getByTestId(`highlight-row-${inProgress.id}`);
  let found = false;
  for (let i = 0; i < rowCount && !found; i++) {
    await clipRows.nth(i).click();
    found = await highlightRow.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
  }
  expect(found, `highlight-row-${inProgress.id} (the in-progress highlight's row) to appear`).toBeTruthy();

  await highlightRow.click();
  await expect.poll(() => /^\/(focus|overlay)\/p\/\d+/.test(new URL(page.url()).pathname), {
    timeout: 20000,
  }).toBe(true);

  const stuck = page.getByTestId('focus-stuck-empty');
  await expect.poll(async () => (await videoTime(page)) >= 0 || (await stuck.count()) > 0, {
    timeout: 10000,
  }).toBe(true);
  expect(await stuck.count(), 'Frame did not show the stuck-empty fallback -- a real video loaded').toBe(0);
  expect(await videoTime(page)).toBeGreaterThanOrEqual(0);
});
