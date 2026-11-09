import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T15430:C1 - In landscape fullscreen Annotate at 844x390, elementFromPoint at Mark's centre
 * returns Mark, and no floating control overlaps it.
 *
 * Reproduces the staging QA finding: the GuidanceToggle's fixed floating switch sat over the
 * right cockpit strip's Mark button, so a tap at Mark's centre toggled Guidance instead.
 */
test.setTimeout(240000);
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

test('T15430:C1 Mark button is hit-testable at its centre in landscape fullscreen', async ({ context, page }) => {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  test.skip(!target, '[T15430] no active game with clips');

  await openGameInAnnotate(page, target.id);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

  await page.getByTitle('Fullscreen').first().click({ force: true, timeout: 5000 });
  const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
  await expect(leftStrip).toBeVisible();

  await page.locator('.clip-marker').first().click({ force: true });
  const markBtn = page.getByTestId('annotate-mark-play-button');
  await expect(markBtn).toBeVisible();
  const box = await markBtn.boundingBox();
  expect(box, 'Mark button has a bounding box').not.toBeNull();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const hitTestId = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-testid]')?.getAttribute('data-testid') : null;
  }, [cx, cy]);
  expect(hitTestId, 'elementFromPoint at Mark centre resolves to Mark, not a floating control').toBe('annotate-mark-play-button');

  const guidanceLayer = page.getByTestId('guidance-toggle-layer');
  if (await guidanceLayer.count().catch(() => 0)) {
    const guidanceBox = await guidanceLayer.boundingBox();
    const overlaps = guidanceBox
      && cx >= guidanceBox.x && cx <= guidanceBox.x + guidanceBox.width
      && cy >= guidanceBox.y && cy <= guidanceBox.y + guidanceBox.height;
    expect(overlaps, 'Guidance toggle does not overlap Mark\'s centre').toBe(false);
  }
});
