/**
 * T16810 - the T16750:C1 staging check, which failed because its setup reused an existing draft:
 * on staging the only unsharpened draft sat on a game stuck uploading (no frame rate), so Frame
 * showed no Sharpen button. The setup now makes a fresh highlight on a ready game.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16810.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';
import { waitForAppLoaded, frameVideoStaysPaused, sharpenNewHighlightWhilePreviewing } from '../helpers/sharpenWhilePreviewing';

test('T16810:C1 - with Preview playing, Sharpen, then Finished opens: the Frame video is paused', async ({ browser }) => {
  test.setTimeout(600000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  const page = await context.newPage();

  await page.goto('/home');
  await waitForAppLoaded(page);
  await disableGuidanceForCheck(page);
  expect(await sharpenNewHighlightWhilePreviewing(page), 'a game with a ready video and a play in this account').toBe(true);

  await expect(page.getByTestId('focus-publish-action-bar')).toBeVisible();
  const state = await frameVideoStaysPaused(page);
  expect(state.ok, `Frame video playing behind Finished: ${JSON.stringify(state.samples)}`).toBe(true);
  await context.close();
});
