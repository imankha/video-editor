import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { waitForAppReady } from './helpers/appReady.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8330 — proactive, account-level storage-expiry banner. When a Reel Draft
 * depends on a source game that is expiring inside the 14-day window (or is
 * already in the rescuable grace window), the home screen shows one dismissible
 * banner with the at-risk game + dependent-draft counts, deep-linking to the
 * Games tab. A bare expiring game nothing is built from does NOT trigger it, and
 * a permanently-deleted (un-extendable) source is excluded — nothing to rescue.
 *
 * Pure render-time join (computeStorageExpiryRisk) over the games list + drafts'
 * game_ids the app already holds — no fetch, no persisted state. jsdom unit
 * tests pin the aggregation + copy; this proves it renders, dismisses, and
 * deep-links end-to-end in a real browser.
 *
 * Same seam as T8320: test-login bypass, then stub every path that fills the
 * games/projects stores (a grace/reclaimed source can't be produced live in a
 * fresh container). The component under test (ProjectManager banner) is real.
 *
 * Run:
 *   cd src/frontend && E2E_AUTOSTART=1 npx playwright test e2e/T8330-storage-expiry-banner.qa.spec.js
 */

const TEST_USER_ID = `e2e8330_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9_]/gi, '');

function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

function draftFor(game, id) {
  return {
    id,
    name: `Draft of ${game.name}`,
    aspect_ratio: '9:16',
    clip_count: 1,
    clips_in_progress: 0,
    clips_exported: 0,
    has_working_video: false,
    has_final_video: false,
    is_published: false,
    is_auto_created: true,
    game_ids: [game.id],
    clips: [{ id: id * 10, tags: [] }],
  };
}

async function seed(page, { games, projects }) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.route((url) => url.pathname.endsWith('/api/bootstrap'), async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.projects = projects;
    json.games = { games };
    await route.fulfill({ response: res, json });
  });
  await page.route((url) => url.pathname.endsWith('/api/games'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games }) });
  });
  await page.route((url) => url.pathname.endsWith('/api/projects'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false, isCheckingSession: false });
  });
}

skipOnDeployedTarget(test, 'imports /src/stores/*.js (Vite-dev seam) and needs the local stack');

const banner = (page) => page.locator('[data-testid="storage-expiry-banner"]');

test.describe('T8330 storage-expiry banner', () => {
  test('(a) no banner when no draft depends on an at-risk game', async ({ page }) => {
    // A healthy source with a dependent draft, PLUS a bare expiring game nothing
    // is built from — neither is data loss, so the banner stays hidden.
    const games = [
      { id: 9201, name: 'Healthy Source', status: 'ready', storage_status: 'active', storage_expires_at: iso(40), clip_count: 1 },
      { id: 9202, name: 'Bare Expiring', status: 'ready', storage_status: 'active', storage_expires_at: iso(3), clip_count: 0 },
    ];
    const projects = [draftFor(games[0], 8201)];
    await seed(page, { games, projects });

    await page.goto('/home/reels');
    await waitForAppReady(page);
    await expect(page.locator('[data-testid="project-card"]')).toHaveCount(1, { timeout: 15000 });
    await expect(banner(page)).toHaveCount(0);
    await saveEvidence(page, 'T8330-criterion-a-no-banner');
  });

  test('(b) banner renders with correct counts when a draft depends on an expiring game', async ({ page }) => {
    const games = [
      { id: 9211, name: 'Expiring Soon', status: 'ready', storage_status: 'active', storage_expires_at: iso(5), clip_count: 1 },
      { id: 9212, name: 'Healthy Source', status: 'ready', storage_status: 'active', storage_expires_at: iso(40), clip_count: 1 },
    ];
    const projects = [draftFor(games[0], 8211), draftFor(games[1], 8212)];
    await seed(page, { games, projects });

    await page.goto('/home/reels');
    await waitForAppReady(page);

    await expect(banner(page)).toBeVisible({ timeout: 15000 });
    const text = (await banner(page).innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('1 game expiring soon');
    expect(text).toContain('1 draft reel depends on it');
    await saveEvidence(page, 'T8330-criterion-b-banner-counts');

    // Deep-link: "Extend storage" switches to the Games tab (Add Game button is
    // Games-tab-only), then dismiss removes the banner for the session.
    await banner(page).getByRole('button', { name: 'Extend storage' }).click();
    await expect(page.getByRole('button', { name: /Add Game/i })).toBeVisible();
    await saveEvidence(page, 'T8330-criterion-b-deeplink-games-tab');

    await banner(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(page)).toHaveCount(0);
    await saveEvidence(page, 'T8330-criterion-b-dismissed');
  });

  test('(c) grace-window (expired but rescuable) game with a dependent draft still fires', async ({ page }) => {
    const games = [
      { id: 9221, name: 'In Grace', status: 'ready', storage_status: 'expired', storage_expires_at: null, can_extend: true, clip_count: 1 },
      { id: 9222, name: 'Permanently Gone', status: 'ready', storage_status: 'expired', storage_expires_at: null, can_extend: false, clip_count: 1 },
    ];
    const projects = [draftFor(games[0], 8221), draftFor(games[1], 8222)];
    await seed(page, { games, projects });

    await page.goto('/home/games');
    await waitForAppReady(page);

    await expect(banner(page)).toBeVisible({ timeout: 15000 });
    const text = (await banner(page).innerText()).replace(/\s+/g, ' ');
    // Only the grace game counts; the permanently-deleted one is excluded.
    expect(text).toContain('1 game expiring soon');
    expect(text).toContain('1 draft reel depends on it');
    await saveEvidence(page, 'T8330-criterion-c-grace-banner');
  });
});
