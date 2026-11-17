import { expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from './checkAuth';
import { waitForAppLoaded, makeNewHighlight } from './sharpenWhilePreviewing';

/**
 * portraitPreviewLayout - the T16760:C1 check, shared by the T16760 and T16820 checks: in Frame,
 * Preview on a portrait (9:16) highlight must keep the whole stage and its play control above
 * the fixed action band, without scrolling.
 *
 * T16820: the highlight is made fresh each run on a game whose video is ready (makeNewHighlight).
 * Reusing an existing draft picked, on staging, one on a game stuck uploading, where Frame shows
 * "Game video still uploading" and no Preview toggle, so the check timed out.
 */

/** Bounding boxes of the preview stage, its play control and the fixed action band. */
async function layout(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      stage: box('[data-testid="focus-video-stage"]'),
      play: box('[data-testid="focus-video-stage"] [data-testid="play-button"]'),
      band: box('[data-testid="action-band"]'),
      scrolled: Math.max(0, ...[...document.querySelectorAll('.overflow-auto')].map((el) => el.scrollTop)),
    };
  });
}

/**
 * Log in at the given window size, make a new highlight, make sure it is Portrait, press Preview,
 * and assert the stage and play control sit above the action band with nothing scrolled.
 *
 * @param {import('@playwright/test').Browser} browser
 */
export async function expectPortraitPreviewAboveBand(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  await loginForCheck(context);
  const page = await context.newPage();
  await page.goto('/home');
  await waitForAppLoaded(page);
  await disableGuidanceForCheck(page);
  expect(await makeNewHighlight(page), 'a game with a ready video and a play in this account').toBe(true);

  // A new highlight starts Portrait; pick Portrait the way a parent does if it is not.
  const portrait = page.getByTestId('focus-shape-option-portrait');
  if ((await portrait.isVisible()) && (await portrait.getAttribute('aria-pressed')) !== 'true') {
    await portrait.click();
    const confirm = page.getByTestId('focus-shape-switch-confirm-button');
    if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  }
  await page.getByTestId('framing-preview-toggle').click({ timeout: 60000 });

  // Wait for the stage to take the portrait shape (taller than wide) and the video to size it.
  await expect.poll(async () => {
    const l = await layout(page);
    return !!(l.stage && l.play && l.band && l.stage.height > l.stage.width && l.stage.width > 100);
  }, { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(1500);
  const l = await layout(page);
  const msg = JSON.stringify(l);
  expect(l.scrolled, `editor scrolled: ${msg}`).toBe(0);
  expect(l.stage.top, `stage starts above the window: ${msg}`).toBeGreaterThanOrEqual(0);
  expect(l.stage.bottom, `preview runs under the action bar: ${msg}`).toBeLessThanOrEqual(l.band.top);
  expect(l.play.bottom, `play control under the action bar: ${msg}`).toBeLessThanOrEqual(l.band.top);
  await context.close();
}
