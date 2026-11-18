import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T17240: tell same-named highlights apart. The check account may not have enough
 * published highlights in BOTH shapes for "My highlights" to unlock twice, so the test
 * serves the account's own /api/collections/summary with My highlights eligible in
 * portrait AND landscape (the case the QA pass found), then reads the card names the
 * Published tab shows.
 */
test.setTimeout(240000);
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

const BOTH_SHAPES = {
  reel_count: 6,
  unwatched_count: 0,
  ratio_counts: { '9:16': 3, '16:9': 3 },
  ratio_durations: { '9:16': 40, '16:9': 45 },
  ratio_eligible: { '9:16': true, '16:9': true },
  total_duration: 85,
  has_null_durations: false,
  leading_reel_id: null,
  latest_published_at: null,
};

test('T17240:C1 the portrait and landscape "My highlights" cards have different names', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginForCheck(page.context());
  let served = false;
  await page.route(/\/api\/collections\/summary(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const others = (data.smart_collections || []).filter((sc) => sc.key !== 'top_plays');
    const topPlays = (data.smart_collections || []).find((sc) => sc.key === 'top_plays');
    data.smart_collections = [
      { ...BOTH_SHAPES, key: 'top_plays', name: topPlays?.name ?? 'My highlights', tags: null, nudge_when_locked: true },
      ...others,
    ];
    served = true;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/home/published');
  await expect.poll(() => served, { timeout: 90000, message: 'the Published tab loaded its summary' }).toBe(true);
  const titles = page.locator('h3', { hasText: /^My highlights/ });
  await expect(titles).toHaveCount(2, { timeout: 60000 });
  const names = await titles.allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['My highlights (portrait)', 'My highlights (landscape)']);
  // No two reel cards on the tab share a name.
  const all = (await page.locator('h3').allTextContents()).map((n) => n.trim()).filter(Boolean);
  expect(new Set(all).size).toBe(all.length);
});
