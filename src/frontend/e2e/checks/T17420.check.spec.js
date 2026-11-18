import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { checkHomeTouchTargets } from '../helpers/homeTouchTargets';

// T17420: T17300:C1 timed out on staging clicking Games because an earlier check
// (T17290's) left the shared account in Annotate, and the flow's bare '/' restores
// that resume point (T14980) instead of opening Home. This leaves the account in
// Annotate the way a user does (open a game, close the tab), then runs T17300:C1's flow.
test.setTimeout(360000);

async function leaveAccountInAnnotate(browser) {
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
  await page.getByRole('button', { name: /Mark play/ }).first().waitFor({ timeout: 180000 });
  await page.close({ runBeforeUnload: true });
  await context.close();
}

test('T17420:C1 T17300:C1 passes after another check leaves the account in Annotate', async ({ browser }) => {
  await leaveAccountInAnnotate(browser);
  await checkHomeTouchTargets(browser, { width: 390, height: 844 });
});
