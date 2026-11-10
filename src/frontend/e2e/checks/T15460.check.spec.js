import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T15460: Landscape Annotate outside fullscreen is unusable on a phone (C1), and wastes
 * space on iPad (C2).
 *
 * C1 - at 844x390 non-fullscreen Annotate, Mark play is fully on screen without scrolling.
 * C2 - on iPad landscape the video uses most of the available height.
 */
test.setTimeout(240000);

async function openFirstClippedGame(context, page) {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  if (!target) return null;
  await openGameInAnnotate(page, target.id);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });
  return target;
}

test.describe('T15460:C1 phone landscape (non-fullscreen)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('T15460:C1 Mark play is fully on screen without scrolling', async ({ context, page }) => {
    const target = await openFirstClippedGame(context, page);
    test.skip(!target, '[T15460] no active game with clips');

    // The playhead starts at 0:00, which the auto-select-at-playhead effect resolves to
    // whichever clip covers it, swapping the Mark play CTA for Edit play. Jump well past the
    // early cluster of short clips into open video (30 x 5s = 150s) so nothing is selected and
    // Mark play (the bug report's actual CTA) renders.
    const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
    for (let i = 0; i < 30; i++) {
      await forward.click({ timeout: 5000 });
    }

    const markBtn = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn).toBeVisible();
    const box = await markBtn.boundingBox();
    expect(box, 'Mark play has a bounding box').not.toBeNull();
    const viewport = page.viewportSize();
    expect(box.y, 'Mark button top is on screen').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'Mark button bottom is on screen without scrolling').toBeLessThanOrEqual(viewport.height);
  });
});

test.describe('T15460:C2 iPad landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

  test('T15460:C2 the video uses most of the available height', async ({ context, page }) => {
    const target = await openFirstClippedGame(context, page);
    test.skip(!target, '[T15460] no active game with clips');

    const stage = page.getByTestId('annotate-video-stage');
    await expect(stage).toBeVisible();
    const box = await stage.boundingBox();
    expect(box, 'stage has a bounding box').not.toBeNull();
    const viewport = page.viewportSize();
    expect(box.height / viewport.height, 'stage height is most of the viewport').toBeGreaterThan(0.45);
  });
});
