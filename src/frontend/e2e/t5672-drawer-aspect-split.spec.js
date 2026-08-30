import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T5672: My Reels drawer (GameCollectionGroup) aspect-split rows.
 *
 * The real account's game/mixes buckets are all single-aspect today (checked
 * live via GET /api/collections/summary -- every game reports only '9:16' in
 * ratio_counts, and Mixes has reel_count: 0), so this intercepts the summary
 * + per-game members responses to splice in one synthetic mixed-aspect game,
 * client-side only (no backend writes), to exercise + screenshot the split.
 */
async function injectMixedAspectGame(page) {
  await page.route('**/api/collections/summary*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.games = [
      {
        reel_count: 4,
        unwatched_count: 0,
        ratio_counts: { '9:16': 2, '16:9': 2 },
        ratio_durations: { '9:16': 40, '16:9': 40 },
        ratio_eligible: { '9:16': true, '16:9': true },
        total_duration: 80,
        has_null_durations: false,
        latest_published_at: '2026-07-17T01:22:54Z',
        game_id: 999,
        game_name: 'Mixed Aspect Test Game',
        game_date: '2026-03-28',
      },
      ...body.games,
    ];
    await route.fulfill({ response, json: body });
  });

  await page.route('**/api/downloads*game_id=999*', async (route) => {
    const makeReel = (id, ratio, i) => ({
      id,
      name: `Reel ${id}`,
      aspect_ratio: ratio,
      final_video_id: id,
      game_ids: [999],
      clip_game_start_time: i * 100,
      is_published: true,
      watched_at: null,
      tags: [],
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        makeReel(1001, '9:16', 1),
        makeReel(1002, '9:16', 2),
        makeReel(1003, '16:9', 3),
        makeReel(1004, '16:9', 4),
      ]),
    });
  });
}

test('T5672 drawer aspect split at 1280px: two rows, portrait first, legible chips', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width: 1280, height: 900 });
  await injectMixedAspectGame(page);

  await page.goto('/');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

  await page.getByRole('button', { name: 'My Reels', exact: true }).click();
  await page.waitForTimeout(800);

  const gameHeader = page.getByText('Mixed Aspect Test Game', { exact: false });
  await gameHeader.first().click();
  await page.waitForTimeout(1000);

  // Two carousel rows, portrait first.
  const rowLabels = await page.locator('[role="group"][aria-label*="reels"]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('aria-label')),
  );
  console.log(`Drawer row labels: ${JSON.stringify(rowLabels)}`);
  expect(rowLabels).toContain('Game Highlights 9:16 reels');
  expect(rowLabels).toContain('Game Highlights 16:9 reels');
  const portraitIdx = rowLabels.indexOf('Game Highlights 9:16 reels');
  const landscapeIdx = rowLabels.indexOf('Game Highlights 16:9 reels');
  expect(portraitIdx).toBeGreaterThanOrEqual(0);
  expect(landscapeIdx).toBeGreaterThan(portraitIdx);

  // Legible text chips, not just the glyph.
  const chip916 = page.getByText('9:16', { exact: true });
  const chip169 = page.getByText('16:9', { exact: true });
  await expect(chip916.first()).toBeVisible();
  await expect(chip169.first()).toBeVisible();

  await page.screenshot({ path: '/tmp/t5672-drawer-aspect-split-1280.png' });
  console.log('Screenshot saved: /tmp/t5672-drawer-aspect-split-1280.png');
});

test('T5672 drawer aspect split at 390px: two rows still legible on mobile', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width: 390, height: 844 });
  await injectMixedAspectGame(page);

  await page.goto('/');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

  await page.getByRole('button', { name: 'My Reels', exact: true }).click();
  await page.waitForTimeout(800);

  const gameHeader = page.getByText('Mixed Aspect Test Game', { exact: false });
  await gameHeader.first().click();
  await page.waitForTimeout(1000);

  const chip916 = page.getByText('9:16', { exact: true });
  const chip169 = page.getByText('16:9', { exact: true });
  await expect(chip916.first()).toBeVisible();
  await expect(chip169.first()).toBeVisible();

  await page.screenshot({ path: '/tmp/t5672-drawer-aspect-split-390.png' });
  console.log('Screenshot saved: /tmp/t5672-drawer-aspect-split-390.png');
});

test('T5672 drawer: single-aspect game shows no aspect chip (unchanged look)', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

  await page.getByRole('button', { name: 'My Reels', exact: true }).click();
  await page.waitForTimeout(800);

  // Scope to the My Reels drawer panel. The Reel Drafts screen BEHIND the drawer can
  // also render [data-testid="collapsible-group-header"] game groups (full-width,
  // x~64) when its own classification is switched to "By Game" (T8080 -- the screen
  // now defaults to "By Phase", which renders no such elements), so an unscoped
  // .first() is never safe to rely on -- and the drawer's z-40 backdrop intentionally
  // blocks the page behind it, so clicking that header hangs on the backdrop
  // intercept (it never receives the event). The real target is the first game
  // header INSIDE the panel (pinned right, above the backdrop), which is what a
  // user actually clicks.
  const drawer = page.locator('.max-w-md.bg-gray-800', {
    has: page.getByRole('heading', { name: 'My Reels', exact: true }),
  });

  // The real account's games are single-aspect today -- expand the first
  // real game and confirm no bare "9:16"/"16:9" text chip appears.
  const firstGame = drawer.locator('[data-testid="collapsible-group-header"]').first();
  const headerCountBefore = await firstGame.count();
  if (headerCountBefore > 0) {
    await firstGame.click();
    await page.waitForTimeout(1000);
    const chipCount = await drawer.getByText(/^(9:16|16:9)$/, { exact: true }).count();
    console.log(`Aspect chips on a single-aspect game: ${chipCount} (expect 0)`);
    expect(chipCount).toBe(0);
  }
});
