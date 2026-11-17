import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16530: redo a finished highlight from the Finished screen. A parent opens a
 * highlight from the Highlights tab, taps its edit button and lands on the Finished
 * screen, where Add (or Redo) spotlight and Edit zoom sit with Download and Share,
 * reachable without scrolling past the video (C1, phone and desktop). Edit zoom states
 * the credit cost and the balance before anything is sharpened (C3).
 *
 * The highlight is read from the account's own Highlights list (GET /downloads), so the
 * same file runs on the dev preset and the staging account.
 */
test.setTimeout(240000);

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function finishedHighlightId(page) {
  const response = await page.request.get(checkApi('/downloads'));
  expect(response.ok(), `GET /downloads -> ${response.status()}`).toBeTruthy();
  const { downloads } = await response.json();
  const editable = downloads.find((d) => d.project_id && !(d.clip_count > 1));
  expect(editable, 'the account has a finished single-play highlight').toBeTruthy();
  return editable.id;
}

async function openFinishedScreen(page, viewport) {
  await page.setViewportSize(viewport);
  await loginForCheck(page);
  const id = await finishedHighlightId(page);
  await page.goto(`/home/published/${id}`);
  await disableGuidanceForCheck(page);
  const edit = page.getByTitle('Edit highlight').first();
  await expect(edit).toBeVisible({ timeout: 60000 });
  await edit.click();
  await expect(page.getByTestId('finished-redo-actions')).toBeVisible({ timeout: 60000 });
}

for (const [label, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`T16530:C1 the Finished screen shows Add or Redo spotlight and Edit zoom without scrolling (${label})`, async ({ page }) => {
    await openFinishedScreen(page, viewport);
    const spotlight = page.getByTestId('finished-redo-spotlight');
    const editZoom = page.getByTestId('finished-edit-zoom');
    await expect(spotlight).toHaveText(/(Add|Redo) spotlight/);
    await expect(editZoom).toHaveText(/Edit zoom/);
    await expect(spotlight).toBeInViewport({ ratio: 1 });
    await expect(editZoom).toBeInViewport({ ratio: 1 });
    // Beside Download and Share, on the same screen.
    await expect(page.getByTestId('finished-share-action')).toBeVisible();
    await expect(page.getByTestId('player-download')).toBeVisible();
  });
}

test('T16530:C3 Edit zoom states the credit cost and balance before the parent commits', async ({ page }) => {
  await openFinishedScreen(page, PHONE);
  await page.getByTestId('finished-edit-zoom').click();
  const sheet = page.getByTestId('edit-zoom-sheet');
  await expect(sheet).toBeVisible({ timeout: 60000 });
  const expired = await sheet.getByText('Edit zoom is unavailable').isVisible();
  if (expired) {
    // A game video past its paid storage: Edit zoom says it cannot run instead.
    await expect(sheet).toContainText('has expired');
    return;
  }
  await expect(sheet).toContainText(/Cost: \d+ credits?/);
  await expect(sheet).toContainText(/Balance: \d+ credits?/);
  await expect(sheet).toContainText('sharpen it again');
  // Nothing was sharpened or opened yet: still on the Finished screen.
  await expect(page.getByTestId('finished-redo-actions')).toBeVisible();
});
