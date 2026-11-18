/**
 * T17180 - per-criterion acceptance checks (group checks protocol).
 *
 * C1: a parent opens a highlight from Highlights on a phone and sees a labeled Add spotlight
 * (Edit spotlight once one exists) button in the player, without opening any menu.
 * C2 is a code check (T17180.checks.json): the dev preset's highlights have no stored video on a
 * local stack ("This highlight's video is no longer available"), so the pick walk never starts there.
 *
 * Every id is read from the account's own list (GET /downloads), so the same file runs on the dev
 * preset and the staging account.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17180.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

test.setTimeout(300000);

const PHONE = { width: 390, height: 844 };

test('T17180:C1 at 390x844 the Highlights player shows a labeled Add spotlight or Edit spotlight button without opening a menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await loginForCheck(page);
  const res = await page.request.get(checkApi('/downloads'));
  expect(res.ok(), `GET /downloads -> ${res.status()}`).toBeTruthy();
  const { downloads } = await res.json();
  const editable = downloads.find((d) => d.project_id && !(d.clip_count > 1));
  expect(editable, 'the account has a finished single-play highlight').toBeTruthy();

  await page.goto(`/home/published/${editable.id}`);
  await disableGuidanceForCheck(page);
  const spotlight = page.getByTestId('player-spotlight');
  await expect(spotlight).toBeVisible({ timeout: 60000 });
  await expect(spotlight).toHaveText(/^(Add|Edit) spotlight$/);
  await expect(spotlight).toBeInViewport({ ratio: 1 });
  // Nothing was opened to reach it: no menu is showing.
  await expect(page.getByRole('menu')).toHaveCount(0);
  // The pencil now says what it does.
  await expect(page.getByTestId('player-edit-highlight')).toHaveText('Edit highlight');
});
