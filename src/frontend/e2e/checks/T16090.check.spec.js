import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16090:C3 - after publishing a highlight and deleting its reel, Annotate no longer
 * lists that highlight for the play, and the play can make a new highlight that opens
 * in Frame with its video.
 *
 * T16100: the highlight is made and published the way a parent does it, through routes
 * that exist on every target -- select a play in Annotate, "Make highlight", "Sharpen my
 * highlight" in Frame, then "Finish without spotlight" (renders and publishes in one
 * tap). The first version seeded it through a dev-only test seam, which 404s
 * on staging, so the staging check never reached the feature. Then the reel is deleted
 * through DELETE /downloads/{id} (the endpoint the UI's delete button calls), and the
 * play's highlight list and "Make highlight" card must be back to the no-highlight state,
 * with a new highlight that actually loads a video in Frame.
 */
test.setTimeout(1200000);

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1)).catch(() => -1);
}

function projectIdFromUrl(page) {
  const m = new URL(page.url()).pathname.match(/^\/(?:focus|overlay)\/p\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Call the API from inside the page, with the app's own session. On staging, page.request
 * calls made after the app had started its session got 401 while the app's own fetches
 * on the same account succeeded (2026-11-13 staging run).
 */
async function pageApi(page, method, path) {
  return page.evaluate(async ([url, m]) => {
    const res = await fetch(url, { method: m, credentials: 'include' });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, body };
  }, [checkApi(path), method]);
}

async function publishedReelFor(page, projectId) {
  const res = await pageApi(page, 'GET', '/downloads').catch(() => null);
  if (!res?.ok) return null;
  return (res.body.downloads || []).find((d) => d.project_id === projectId) || null;
}

test('T16090:C3 a deleted reel leaves no highlight behind in Annotate', async ({ context, page }) => {
  await loginForCheck(context);

  // A real, already-uploaded game with at least one play, so Annotate renders clip rows
  // and Frame has an actual video to sharpen.
  const gamesRes = await page.request.get(checkApi('/games'));
  expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
  const games = await gamesRes.json();
  const gameList = games.games || games;
  let gameId = null;
  for (const g of gameList.filter((g) => g.clip_count > 0)) {
    const loadRes = await page.request.get(checkApi(`/games/${g.id}/load`));
    if (!loadRes.ok()) continue;
    const loaded = await loadRes.json();
    if ((loaded.game?.annotations || []).length > 0) { gameId = g.id; break; }
  }
  expect(gameId, 'an existing game with at least one play').toBeTruthy();

  // --- Make and publish a highlight the way a parent does ---
  await page.goto(`/annotate/g/${gameId}`);
  await disableGuidanceForCheck(page);
  const clipRows = page.getByTestId('clip-row');
  await expect.poll(() => clipRows.count(), { timeout: 180000 }).toBeGreaterThan(0);
  const rowIndex = 0;
  await clipRows.nth(rowIndex).click();
  const makeButton = page.getByTestId('annotate-make-highlight');
  await makeButton.waitFor({ state: 'visible', timeout: 120000 });
  await makeButton.click();
  await expect.poll(() => projectIdFromUrl(page), { timeout: 180000 }).not.toBeNull();
  const projectId = projectIdFromUrl(page);

  await page.getByTestId('focus-video-stage').waitFor({ timeout: 180000 });
  await disableGuidanceForCheck(page);
  const sharpen = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 120000 });
  await sharpen.click();
  // A box nobody moved asks once "Is your athlete in the box?" (T14830); continue.
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
  }

  // The sharpen render lands on the publish action bar; "Finish without spotlight"
  // renders the final video and publishes it in one tap (T9590).
  const actionBar = page.getByTestId('focus-publish-action-bar');
  await actionBar.waitFor({ state: 'visible', timeout: 600000 });
  await actionBar.getByRole('button', { name: 'Finish without spotlight', exact: true }).click();

  let reel = null;
  await expect.poll(async () => {
    reel = await publishedReelFor(page, projectId);
    return !!reel;
  }, { timeout: 600000, intervals: [5000] }).toBe(true);
  const finalVideoId = reel.id;

  // Annotate lists the published highlight on that play.
  await page.goto(`/annotate/g/${gameId}`);
  await expect.poll(() => clipRows.count(), { timeout: 180000 }).toBeGreaterThan(0);
  await clipRows.nth(rowIndex).click();
  await expect(page.getByTestId(`highlight-row-${projectId}`)).toBeVisible({ timeout: 120000 });

  const deleteRes = await pageApi(page, 'DELETE', `/downloads/${finalVideoId}`);
  expect(deleteRes.ok, `delete reel -> ${deleteRes.status}`).toBeTruthy();

  // Re-select the same play: THAT highlight must be gone from Annotate's list.
  await page.goto(`/annotate/g/${gameId}`);
  await expect.poll(() => clipRows.count(), { timeout: 180000 }).toBeGreaterThan(0);
  await clipRows.nth(rowIndex).click();
  await makeButton.waitFor({ state: 'visible', timeout: 120000 });
  await expect(page.getByTestId(`highlight-row-${projectId}`)).toHaveCount(0);

  // The play can make a new highlight, and it opens Frame with its video.
  await makeButton.click();
  await expect.poll(() => projectIdFromUrl(page), { timeout: 180000 }).not.toBeNull();
  const newProjectId = projectIdFromUrl(page);
  expect(newProjectId).not.toBe(projectId);

  const stuck = page.getByTestId('focus-stuck-empty');
  await expect.poll(async () => (await videoTime(page)) >= 0 || (await stuck.count()) > 0, {
    timeout: 120000,
  }).toBe(true);
  expect(await stuck.count(), 'Frame did not show the stuck-empty fallback -- a real video loaded').toBe(0);
  expect(await videoTime(page)).toBeGreaterThanOrEqual(0);

  // Leave the account as it was: the new draft goes (DELETE /projects/{id}, the draft
  // card's delete).
  const cleanup = await pageApi(page, 'DELETE', `/projects/${newProjectId}`);
  expect(cleanup.ok, `delete new draft -> ${cleanup.status}`).toBeTruthy();
});
