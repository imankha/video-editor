import { test, expect } from '@playwright/test';

/**
 * Profile Switch Isolation E2E Test
 *
 * Verifies that game data is correctly isolated between profiles.
 * Uses API calls to create profiles and games, then verifies via both
 * API and the browser that switching profiles shows the right data.
 *
 * This test doesn't require authentication UI — it uses X-User-ID
 * and X-Profile-ID headers directly.
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;

const TEST_USER_ID = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe('Profile Switch — Game Isolation', () => {
  let defaultProfileId;
  let secondProfileId;

  test.beforeAll(async ({ request }) => {
    // Health check
    for (let i = 0; i < 10; i++) {
      try {
        const health = await request.get(`${API_BASE}/health`);
        if (health.ok()) break;
      } catch {
        if (i === 9) throw new Error(`Backend not running on port ${API_PORT}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 1. Init session — creates default profile
    const initRes = await request.post(`${API_BASE}/auth/init`, {
      headers: { 'X-User-ID': TEST_USER_ID },
    });
    expect(initRes.ok()).toBeTruthy();
    const initData = await initRes.json();
    defaultProfileId = initData.profile_id;
    console.log(`[E2E] User: ${TEST_USER_ID}, default profile: ${defaultProfileId}`);

    // 2. Add a game to the default profile
    const gameRes = await request.post(`${API_BASE}/games`, {
      headers: {
        'X-User-ID': TEST_USER_ID,
        'X-Profile-ID': defaultProfileId,
        'Content-Type': 'application/json',
      },
      data: {
        opponent_name: 'IsolationTest',
        game_date: '2026-01-15',
        game_type: 'home',
        videos: [],
      },
    });
    expect(gameRes.ok()).toBeTruthy();
    console.log(`[E2E] Created game in default profile`);

    // 3. Create a second profile
    const profileRes = await request.post(`${API_BASE}/profiles`, {
      headers: {
        'X-User-ID': TEST_USER_ID,
        'X-Profile-ID': defaultProfileId,
        'Content-Type': 'application/json',
      },
      data: { name: 'P2', color: '#10B981' },
    });
    expect(profileRes.ok()).toBeTruthy();
    secondProfileId = (await profileRes.json()).id;
    console.log(`[E2E] Created second profile: ${secondProfileId}`);

    // Switch back to default for UI test
    await request.put(`${API_BASE}/profiles/current`, {
      headers: {
        'X-User-ID': TEST_USER_ID,
        'X-Profile-ID': defaultProfileId,
        'Content-Type': 'application/json',
      },
      data: { profileId: defaultProfileId },
    });
  });

  test('API returns correct games per profile', async ({ request }) => {
    // Default profile should have 1 game
    const defaultGames = await request.get(`${API_BASE}/games`, {
      headers: { 'X-User-ID': TEST_USER_ID, 'X-Profile-ID': defaultProfileId },
    });
    const defaultData = await defaultGames.json();
    console.log(`[E2E] Default profile games: ${defaultData.games.length}`);
    expect(defaultData.games.length).toBe(1);
    expect(defaultData.games[0].name).toContain('IsolationTest');

    // Second profile should have 0 games
    const p2Games = await request.get(`${API_BASE}/games`, {
      headers: { 'X-User-ID': TEST_USER_ID, 'X-Profile-ID': secondProfileId },
    });
    const p2Data = await p2Games.json();
    console.log(`[E2E] P2 profile games: ${p2Data.games.length}`);
    expect(p2Data.games.length).toBe(0);
  });

  test('browser shows correct games after profile switch via header', async ({ page }) => {
    // Log /api/games requests and responses
    page.on('response', async (response) => {
      if (response.url().includes('/api/games') && response.request().method() === 'GET') {
        try {
          const data = await response.json();
          const profileHeader = response.request().headers()['x-profile-id'];
          console.log(`[E2E] /api/games: profile=${profileHeader} games=${data.games?.length}`);
        } catch {}
      }
    });

    // Load app with default profile headers
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': defaultProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should see the game from default profile
    const gameCard = page.locator('.text-white').filter({ hasText: 'IsolationTest' }).first();
    await expect(gameCard).toBeVisible({ timeout: 15000 });
    console.log('[E2E] Default profile: game visible (correct)');

    // Now switch to P2 by changing headers and reloading
    // (simulates what happens after profile switch — frontend sends new X-Profile-ID)
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': secondProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should NOT see the game — it belongs to default profile
    // Wait for the page to fully load then check
    await page.waitForTimeout(2000);
    const gameVisible = await page.locator('.text-white').filter({ hasText: 'IsolationTest' }).count();
    console.log(`[E2E] P2 profile: game visible count = ${gameVisible}`);
    expect(gameVisible).toBe(0);
    console.log('[E2E] P2 profile: game not visible (correct)');

    // Switch back to default
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': defaultProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Game should be visible again
    await expect(
      page.locator('.text-white').filter({ hasText: 'IsolationTest' }).first()
    ).toBeVisible({ timeout: 15000 });
    console.log('[E2E] Default profile restored: game visible again (correct)');
  });
});
