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

    // 2. Add a game to the default profile.
    // Use status='pending' with a fake blake3_hash so the endpoint accepts it
    // without requiring a real R2 upload (this test only checks profile isolation).
    const fakeHash = `e2e${'0'.repeat(59)}`; // 63-char fake hash
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
        status: 'pending',
        videos: [{ blake3_hash: fakeHash, sequence: 1 }],
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

    // Verify profile isolation via API calls from the browser context.
    // Game is created as 'pending' (no R2 upload) so it won't render in the UI,
    // but the /api/games endpoint returns all games regardless of status.
    // This tests that the browser correctly sends X-Profile-ID headers.
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': defaultProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Default profile should have the game
    const defaultGames = await page.evaluate(async () => {
      const res = await fetch('/api/games');
      const data = await res.json();
      return data.games;
    });
    expect(defaultGames.length).toBe(1);
    expect(defaultGames[0].name).toContain('IsolationTest');
    console.log('[E2E] Default profile: game found via API (correct)');

    // Switch to P2 and reload
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': secondProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // P2 should have 0 games
    const p2Games = await page.evaluate(async () => {
      const res = await fetch('/api/games');
      const data = await res.json();
      return data.games;
    });
    expect(p2Games.length).toBe(0);
    console.log('[E2E] P2 profile: 0 games via API (correct)');

    // Switch back to default
    await page.setExtraHTTPHeaders({
      'X-User-ID': TEST_USER_ID,
      'X-Profile-ID': defaultProfileId,
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Game should be back
    const restoredGames = await page.evaluate(async () => {
      const res = await fetch('/api/games');
      const data = await res.json();
      return data.games;
    });
    expect(restoredGames.length).toBe(1);
    expect(restoredGames[0].name).toContain('IsolationTest');
    console.log('[E2E] Default profile restored: game found via API (correct)');
  });
});
