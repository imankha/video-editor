import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17040: with Guidance on, the coach on a finished highlight's edit sheet (Highlights ->
 * the highlight's player -> pencil) says "Tap <button> to send it, or Download to save it."
 * Every button it names must be on screen. On a phone the sheet shows Share link (and
 * Share video), never a Get link button.
 *
 * Guidance is turned off to open the sheet (the Home coach's shade would take the clicks),
 * then on again on the sheet: switching it on resets the once-per-run acknowledgements, so
 * the card shows even if this account already dismissed it.
 */
test.setTimeout(240000);

async function finishedHighlight(page) {
  const response = await page.request.get(checkApi('/downloads'));
  expect(response.ok(), `GET /downloads -> ${response.status()}`).toBeTruthy();
  const { downloads } = await response.json();
  const highlight = downloads.find((d) => d.project_id);
  expect(highlight, 'the account has a finished highlight').toBeTruthy();
  return highlight;
}

async function coachNamesVisibleButtons(page) {
  await loginForCheck(page);
  const highlight = await finishedHighlight(page);
  await page.goto(`/home/published/${highlight.id}`);
  await disableGuidanceForCheck(page);
  const edit = page.getByTitle('Edit highlight').first();
  await expect(edit).toBeVisible({ timeout: 60000 });
  await edit.click();
  await expect(page.getByTestId('finished-share-action')).toBeVisible({ timeout: 60000 });

  const toggle = page.getByTestId('guidance-toggle').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });

  const coach = page.getByTestId('finished-guide');
  await expect(coach).toBeVisible({ timeout: 60000 });
  const sentence = (await coach.innerText()).trim();
  const named = sentence.match(/Tap (.+?) to send it/);
  expect(named, `coach sentence names a share button: "${sentence}"`).not.toBeNull();
  await expect(page.getByRole('button', { name: named[1], exact: true }).first(),
    `"${named[1]}" named by "${sentence}" is on the sheet`).toBeVisible();
  if (/\bDownload\b/.test(sentence)) {
    await expect(page.getByRole('button', { name: 'Download', exact: true }).first(), `Download named by "${sentence}" is on the sheet`).toBeVisible();
  }
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('T17040:C1 at 390x844 the finished sheet coach names only buttons on the sheet', async ({ page }) => {
    await coachNamesVisibleButtons(page);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('T17040:C2 at 1440x900 the finished sheet coach names only buttons on the sheet', async ({ page }) => {
    await coachNamesVisibleButtons(page);
  });
});
