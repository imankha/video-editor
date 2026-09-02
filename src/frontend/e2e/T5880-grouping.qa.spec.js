import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5880 QA - derived tournament/month grouping in Highlight Reels, in a REAL browser
 * at 390px and 1280px.
 *
 * The grouping/eligibility LOGIC (which games form which group, no fabricated
 * bucket, aggregate counts) is covered against a real DB by the backend suite
 * (tests/test_collections_summary.py::TestGameGroups). Here we assert what the
 * user SEES: the axis toggle, the rendered group HEADINGS, and the game rows
 * NESTED beneath a heading (two-level shape). The summary response is stubbed so
 * the tournament/month metadata is deterministic without seeding a full
 * export/publish flow -- the real CollectionsTab / GameAxisGroup / CollapsibleGroup
 * component tree renders it.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5880-grouping.qa.spec.js
 */

const TEST_USER_ID = `e2e_t5880_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const BUCKET = {
  reel_count: 2, unwatched_count: 1, ratio_counts: { '9:16': 2 },
  ratio_durations: { '9:16': 40 }, ratio_eligible: { '9:16': true },
  total_duration: 40, has_null_durations: false, latest_published_at: null,
  leading_reel_id: null,
};
const game = (id, name) => ({ ...BUCKET, game_id: id, game_name: name, game_date: null });

const SUMMARY = {
  smart_collections: [],
  games: [game(7, 'Vs Alpha'), game(8, 'Vs Bravo'), game(9, 'Vs Charlie')],
  game_groups: [
    { axis: 'tournament', key: 'tournament:Summer Cup', label: 'Summer Cup',
      game_ids: [7, 8], reel_count: 4, unwatched_count: 2 },
    { axis: 'month', key: 'month:2026-07', label: 'July 2026',
      game_ids: [7, 8, 9], reel_count: 6, unwatched_count: 3 },
  ],
  mixes: { ...BUCKET, reel_count: 0, ratio_counts: {}, ratio_durations: {}, ratio_eligible: {} },
  season_totals: [], tag_totals: [], total_reel_count: 6,
};

async function setupAndAuth(page) {
  // Deterministic grouping data (stubbed summary) for the real component tree.
  await page.route('**/api/collections/summary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY) }));
  // Empty member lists for any lazy game-expand fetch.
  await page.route('**/api/downloads*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ downloads: [], total_count: 0 }) }));

  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 't5880@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Highlight Reels' }).click();
  await expect(page.getByRole('heading', { name: 'Highlight Reels' })).toBeVisible();
}

test.afterEach(async ({ request }) => {
  try { await request.delete('/api/auth/user', { headers: { 'X-User-ID': TEST_USER_ID } }); }
  catch { /* best-effort */ }
});

test.describe('T5880 tournament/month grouping', () => {
  skipOnDeployedTarget(test, 'import()s /src/stores/authStore.js for an empty test-login session (Vite-dev path)');

  for (const { label, width, height } of [
    { label: '1280px', width: 1280, height: 900 },
    { label: '390px', width: 390, height: 844 },
  ]) {
    test(`groups by tournament then month at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await setupAndAuth(page);

      // Flat default: all three games visible, toggle offers all three axes.
      await expect(page.getByRole('button', { name: 'Vs Alpha' })).toBeVisible();
      const toggle = page.getByRole('group', { name: /group reels by/i });
      await expect(toggle.getByRole('button', { name: 'By game' })).toBeVisible();
      await expect(toggle.getByRole('button', { name: 'By tournament' })).toBeVisible();
      await expect(toggle.getByRole('button', { name: 'By month' })).toBeVisible();

      // By tournament: the "Summer Cup" heading appears; the tournamentless game
      // (Charlie) stays visible as a flat row (no fabricated bucket).
      await toggle.getByRole('button', { name: 'By tournament' }).click();
      await expect(page.getByRole('button', { name: /Summer Cup/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vs Charlie' })).toBeVisible();
      // Nested games are hidden until the heading is expanded (two-level shape).
      await expect(page.getByRole('button', { name: 'Vs Alpha' })).toHaveCount(0);
      await page.getByRole('button', { name: /Summer Cup/ }).click();
      await expect(page.getByRole('button', { name: 'Vs Alpha' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vs Bravo' })).toBeVisible();

      await page.screenshot({ path: `/tmp/t5880-tournament-${label}.png`, fullPage: true });

      // By month: the "July 2026" heading groups all three dated games.
      await toggle.getByRole('button', { name: 'By month' }).click();
      await expect(page.getByRole('button', { name: /July 2026/ })).toBeVisible();
      await page.getByRole('button', { name: /July 2026/ }).click();
      await expect(page.getByRole('button', { name: 'Vs Charlie' })).toBeVisible();

      await page.screenshot({ path: `/tmp/t5880-month-${label}.png`, fullPage: true });

      // No horizontal overflow at this width.
      const overflows = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflows).toBe(false);
    });
  }
});
