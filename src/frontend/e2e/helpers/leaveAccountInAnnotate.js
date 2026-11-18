import { expect } from '@playwright/test';
import { loginForCheck, checkApi } from './checkAuth';

/**
 * Leaves the check account's resume point in Annotate the way a user does: open the first
 * ready game in Annotate, wait for it to load, close the tab. Staging checks run one after
 * another on one shared account, and an earlier check doing this is what made the Home
 * touch-target checks open Annotate on a bare '/' (T14980 resume point; T17420, T17430).
 */
export async function leaveAccountInAnnotate(browser) {
  const context = await browser.newContext();
  await loginForCheck(context);
  const page = await context.newPage();
  // Before the first navigation: page.request after the app starts its session gets 401 on staging (T16100).
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const game = (body.games || body).find((g) => g.status !== 'pending');
  expect(game, 'a ready game').toBeTruthy();
  await page.goto(`/annotate/g/${game.id}`);
  // Desktop opens the plays panel, so "Mark play" (not "Show plays") marks Annotate as loaded.
  await page.getByRole('button', { name: /Mark play/ }).first().waitFor({ timeout: 180000 });
  await page.close({ runBeforeUnload: true });
  await context.close();
}
