import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T17130 - the whole "Upload didn't finish. Retry to resume, or discard." sentence on a
 * failed-upload tile sits above its Retry/Discard bar, at desktop, tablet and phone sizes.
 *
 * Either target's account may have no unfinished upload, so (as T16780's check does) the
 * check answers the app's own games list with the server's list and marks one ready game
 * upload_failed with no marked plays (the state that shows this sentence).
 */
test.setTimeout(180000);

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function markOneGameFailed(page) {
  let failedId = null;
  const markFailed = (list) => {
    const games = list?.games || [];
    const game = games.find((g) => g.id === failedId) || games.find((g) => g.status === 'ready');
    if (game) {
      failedId = game.id;
      game.status = 'upload_failed';
      game.clip_count = 0;
    }
  };
  await page.route((url) => /\/api\/(bootstrap|games)$/.test(url.pathname), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    markFailed(new URL(route.request().url()).pathname.endsWith('/bootstrap') ? body.games : body);
    return route.fulfill({ response: res, json: body });
  });
}

async function expectSentenceClearOfButtons(page) {
  await markOneGameFailed(page);
  await page.goto('/');
  await page.getByTestId('home-tab-games').first().click();
  const tile = page.getByTestId('home-failed-game').first();
  await expect(tile).toBeVisible({ timeout: 60000 });
  await tile.scrollIntoViewIfNeeded();

  const sentence = tile.getByText("Upload didn't finish. Retry to resume, or discard.");
  await expect(sentence).toBeVisible();
  const retry = tile.getByRole('button', { name: /^Retry upload of/ });
  await expect(retry).toBeVisible();

  const boxes = await tile.evaluate((el) => {
    const p = [...el.querySelectorAll('p')].find((n) => n.textContent.includes("Upload didn't finish"));
    const bar = [...el.querySelectorAll('button')].find((b) => /^Retry upload of/.test(b.getAttribute('aria-label') || '')).parentElement;
    const r = (n) => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
    return { tile: r(el), sentence: r(p), bar: r(bar) };
  });
  expect(boxes.sentence.bottom, `sentence bottom ${boxes.sentence.bottom} must be above the button bar top ${boxes.bar.top}`)
    .toBeLessThanOrEqual(boxes.bar.top);
  expect(boxes.sentence.top, 'sentence top inside the tile').toBeGreaterThanOrEqual(boxes.tile.top);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('T17130:C1 at 1440x900 the failed-upload sentence is not covered by Retry/Discard', async ({ page }) => {
    await loginForCheck(page);
    await expectSentenceClearOfButtons(page);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('T17130:C2 at 390x844 the failed-upload sentence is not covered by Retry/Discard', async ({ page }) => {
    await loginForCheck(page);
    await expectSentenceClearOfButtons(page);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  test('T17130:C2 at 768x1024 the failed-upload sentence is not covered by Retry/Discard', async ({ page }) => {
    await loginForCheck(page);
    await expectSentenceClearOfButtons(page);
  });
});
