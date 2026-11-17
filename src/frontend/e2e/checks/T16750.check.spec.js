/**
 * T16750 - per-criterion acceptance checks (group checks protocol).
 *
 * A parent presses Preview in Frame and then "Sharpen my highlight" while the preview plays.
 * When the Finished panel opens over Frame, the Frame editor's video must stop: it used to keep
 * looping, unmuted, behind the Finished player. Closing Finished must not start it again.
 *
 * One login, one new highlight and ONE real sharpen in beforeAll, shared by both criteria
 * (flow in ../helpers/sharpenWhilePreviewing, shared with the T16810 check).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16750.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';
import { waitForAppLoaded, frameVideoStaysPaused, sharpenNewHighlightWhilePreviewing } from '../helpers/sharpenWhilePreviewing';

let context;
let page;
let sharpened = false;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(600000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  page = await context.newPage();

  await page.goto('/home');
  await waitForAppLoaded(page);
  await disableGuidanceForCheck(page);
  sharpened = await sharpenNewHighlightWhilePreviewing(page);
});

test.afterAll(async () => {
  await context?.close();
});

test('T16750:C1 - with Preview playing, Sharpen, then Finished opens: the Frame video is paused', async () => {
  test.skip(!sharpened, '[T16750] no game with a ready video and a play in this account');
  await expect(page.getByTestId('focus-publish-action-bar')).toBeVisible();
  const state = await frameVideoStaysPaused(page);
  expect(state.ok, `Frame video playing behind Finished: ${JSON.stringify(state.samples)}`).toBe(true);
});

test('T16750:C2 - closing Finished back to Frame does not auto-resume the Frame video', async () => {
  test.skip(!sharpened, '[T16750] the setup sharpened no highlight');
  await page.getByTestId('player-close').click();
  await expect(page.getByTestId('focus-publish-action-bar')).toHaveCount(0, { timeout: 30000 });
  const state = await frameVideoStaysPaused(page);
  expect(state.ok, `Frame video resumed after closing Finished: ${JSON.stringify(state.samples)}`).toBe(true);
});
