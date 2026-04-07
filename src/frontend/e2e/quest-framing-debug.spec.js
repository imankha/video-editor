import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Focused debug test: Frame Video → quest export_framing step update.
 *
 * Sets up ALL prerequisites via API, then clicks Frame Video in UI and
 * verifies the quest progress updates. Captures all [QuestDebug] logs.
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_questdbg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_HEADERS = { 'X-User-ID': TEST_USER_ID, 'Content-Type': 'application/json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAME1_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');

// ============================================================================
// Helpers
// ============================================================================

async function setupTestUser(page) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': TEST_USER_ID,
    'X-Test-Mode': 'true',
  });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
}

async function authenticateTestUser(page) {
  await page.goto('/');
  const result = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return await res.json();
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });

  if (result.error) throw new Error(`Auth failed: ${result.error}`);
  console.log(`[Auth] Authenticated: ${result.email} (${result.user_id})`);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function cleanupTestData(request) {
  try {
    await request.delete(`${API_BASE}/auth/user`, { headers: { 'X-User-ID': TEST_USER_ID } });
  } catch { /* best effort */ }
}

async function getQuestProgress(request) {
  const res = await request.get(`${API_BASE}/quests/progress`, { headers: TEST_HEADERS });
  if (!res.ok()) return null;
  return await res.json();
}

// ============================================================================
// Test
// ============================================================================

test.describe('Quest: Frame Video → export_framing step', () => {
  test.setTimeout(600000); // 10 minutes

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
    if (!fs.existsSync(GAME1_VIDEO)) throw new Error(`Video not found: ${GAME1_VIDEO}`);
    console.log(`[Setup] Test user: ${TEST_USER_ID}`);
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('Frame Video click updates quest export_framing step', async ({ page, request }) => {
    // Collect ALL console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      if (text.includes('QuestDebug') || text.includes('handleExport')) {
        console.log(`[BROWSER] ${text}`);
      }
    });
    page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

    // Capture network requests to /api/quests/progress
    const questProgressResponses = [];
    page.on('response', async (response) => {
      if (response.url().includes('/api/quests/progress')) {
        try {
          const data = await response.json();
          const q2 = data.quests?.find(q => q.id === 'quest_2');
          console.log(`[NETWORK] GET /api/quests/progress -> export_framing=${q2?.steps?.export_framing}`);
          questProgressResponses.push(data);
        } catch { /* ignore */ }
      }
    });

    // Also capture /api/export/render requests
    page.on('response', async (response) => {
      if (response.url().includes('/api/export/render')) {
        console.log(`[NETWORK] POST /api/export/render -> status=${response.status()}`);
      }
    });

    await setupTestUser(page);
    await authenticateTestUser(page);

    // Keep auth across reloads
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user_id: TEST_USER_ID, email: 'e2e-questdbg@test.local' }),
      });
    });

    // =========================================================================
    // STEP 1: Set up everything via API
    // =========================================================================
    console.log('\n=== SETUP: All prerequisites via API ===');

    // 1a. Create game via API with video upload
    console.log('[Setup] Creating game...');
    const formData = new FormData();
    // We need to upload the game via the UI since the API requires multipart
    // Let's use the page to create the game instead
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('e.g., Carlsbad SC').fill('Quest Debug FC');
    const today = new Date().toISOString().split('T')[0];
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Home' }).click();

    const videoInput = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput).toBeAttached({ timeout: 10000 });
    await videoInput.setInputFiles(GAME1_VIDEO);
    await page.waitForTimeout(1000);

    const createButton = page.getByRole('button', { name: 'Add Game' }).last();
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Wait for video to load in annotate mode
    await expect(async () => {
      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      expect(await video.evaluate(v => !!v.src)).toBeTruthy();
    }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });
    console.log('[Setup] Video loaded in annotate mode');

    // Wait for upload
    const uploadingBtn = page.locator('button:has-text("Uploading video")');
    await page.waitForTimeout(2000);
    if (await uploadingBtn.isVisible().catch(() => false)) {
      console.log('[Setup] Upload in progress...');
      await expect(uploadingBtn).toBeHidden({ timeout: 300000 });
    }
    console.log('[Setup] Upload complete');

    // 1b. Get game ID, create a 5-star clip via API
    const gamesRes = await request.get(`${API_BASE}/games`, { headers: TEST_HEADERS });
    const games = (await gamesRes.json()).games;
    expect(games.length).toBeGreaterThan(0);
    const gameId = games[0].id;
    console.log(`[Setup] Game ID: ${gameId}`);

    // Create 5-star clip via API (triggers auto-project creation)
    const clipRes = await request.post(`${API_BASE}/clips/raw/save`, {
      headers: TEST_HEADERS,
      data: { game_id: gameId, start_time: 2, end_time: 8, name: 'Great Goal', rating: 5, tags: ['Goal'], notes: '' },
    });
    expect(clipRes.ok()).toBeTruthy();
    console.log('[Setup] 5-star clip created via API');

    // 1c. Wait for auto-project to be created
    await page.waitForTimeout(2000);
    const projectsRes = await request.get(`${API_BASE}/projects`, { headers: TEST_HEADERS });
    const projects = await projectsRes.json();
    console.log(`[Setup] Projects: ${projects.length}`);
    expect(projects.length).toBeGreaterThan(0);
    const projectId = projects[0].id;
    console.log(`[Setup] Project ID: ${projectId}`);

    // 1d. Frame the clip via API
    const clipsRes = await request.get(`${API_BASE}/clips/projects/${projectId}/clips`, { headers: TEST_HEADERS });
    const clips = await clipsRes.json();
    console.log(`[Setup] Clips in project: ${clips.length}`);
    for (const clip of clips) {
      const res = await request.post(`${API_BASE}/clips/projects/${projectId}/clips/${clip.id}/actions`, {
        headers: TEST_HEADERS,
        data: {
          action: 'add_crop_keyframe',
          data: { frame: 0, x: 0.25, y: 0.1, width: 0.5, height: 0.8, origin: 'user' },
        },
      });
      console.log(`[Setup] Framed clip ${clip.id}: ${res.ok()}`);
    }

    // 1e. Complete Quest 1 prereqs and claim via API
    await request.post(`${API_BASE}/quests/achievements/played_annotations`, { headers: TEST_HEADERS });
    const q1claim = await request.post(`${API_BASE}/quests/quest_1/claim-reward`, { headers: TEST_HEADERS });
    console.log(`[Setup] Quest 1 claimed: ${q1claim.ok()}`);

    // 1f. Record open_framing achievement (Q2 step 1)
    await request.post(`${API_BASE}/quests/achievements/opened_framing_editor`, { headers: TEST_HEADERS });
    console.log('[Setup] open_framing achievement recorded');

    // =========================================================================
    // STEP 2: Verify quest progress before Frame Video
    // =========================================================================
    console.log('\n=== PRE-CHECK: Quest progress before Frame Video ===');

    const preProgress = await getQuestProgress(request);
    const preQ2 = preProgress?.quests?.find(q => q.id === 'quest_2');
    console.log(`[Pre] Quest 2 steps: ${JSON.stringify(preQ2?.steps)}`);
    expect(preQ2?.steps?.export_framing).toBe(false);
    expect(preQ2?.steps?.open_framing).toBe(true);
    console.log('[Pre] export_framing=false, open_framing=true (expected)');

    // =========================================================================
    // STEP 3: Navigate to project and click Frame Video
    // =========================================================================
    console.log('\n=== ACTION: Navigating to project ===');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(2000);

    // Click the project — try multiple selectors
    const projectCard = page.locator('[class*="bg-gray"] h3, [class*="project"] h3, text=Great Goal').first();
    const projectVisible = await projectCard.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[Action] Project card visible: ${projectVisible}`);

    if (!projectVisible) {
      // Take screenshot for debugging
      await page.screenshot({ path: 'C:/tmp/quest-debug-projects.png' });
      console.log('[Action] Screenshot saved to C:/tmp/quest-debug-projects.png');
      // Try clicking any project-like element
      const allH3 = await page.locator('h3').allTextContents();
      console.log(`[Action] All h3 elements: ${JSON.stringify(allH3)}`);
    }

    await projectCard.click();
    await page.waitForTimeout(3000);

    // Wait for framing video
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30000 });
    console.log('[Action] Framing video loaded');

    // Wait for Frame Video button
    const frameVideoBtn = page.locator('button:has-text("Frame Video"):not([disabled])');
    await expect(frameVideoBtn.first()).toBeVisible({ timeout: 15000 });
    console.log('[Action] Frame Video button visible');

    // Clear logs before critical action
    consoleLogs.length = 0;
    questProgressResponses.length = 0;

    // =========================================================================
    // STEP 4: Click Frame Video
    // =========================================================================
    console.log('\n=== CRITICAL: Clicking Frame Video ===');
    await frameVideoBtn.first().click();
    console.log('[Action] Frame Video CLICKED');

    // Wait for the render POST to complete and fetchProgress to run
    // The render endpoint returns 202 for async processing
    await page.waitForTimeout(10000);

    // =========================================================================
    // STEP 5: Check quest progress AFTER Frame Video
    // =========================================================================
    console.log('\n=== POST-CHECK ===');

    // Check via direct API call (bypasses frontend)
    const postProgress = await getQuestProgress(request);
    const postQ2 = postProgress?.quests?.find(q => q.id === 'quest_2');
    console.log(`[Post-API] Quest 2 steps: ${JSON.stringify(postQ2?.steps)}`);
    console.log(`[Post-API] export_framing = ${postQ2?.steps?.export_framing}`);

    // Dump all browser console logs from the critical section
    console.log('\n=== BROWSER CONSOLE LOGS (after Frame Video click) ===');
    for (const log of consoleLogs) {
      console.log(`  ${log}`);
    }

    // Dump quest progress network responses
    console.log('\n=== QUEST PROGRESS NETWORK RESPONSES ===');
    for (const resp of questProgressResponses) {
      const q2 = resp.quests?.find(q => q.id === 'quest_2');
      console.log(`  export_framing=${q2?.steps?.export_framing}, all_steps=${JSON.stringify(q2?.steps)}`);
    }

    // Analysis
    console.log('\n=== ANALYSIS ===');
    const fetchProgressCalled = consoleLogs.some(l => l.includes('fetchProgress called'));
    const fetchProgressResolved = consoleLogs.some(l => l.includes('fetchProgress resolved'));
    const fetchProgressFailed = consoleLogs.some(l => l.includes('fetchProgress FAILED'));
    const fetchProgressException = consoleLogs.some(l => l.includes('fetchProgress exception'));
    const handleExportCalled = consoleLogs.some(l => l.includes('handleExport called'));
    const renderPosted = consoleLogs.some(l => l.includes('POSTing to /api/export/render'));

    console.log(`[Analysis] handleExport called: ${handleExportCalled}`);
    console.log(`[Analysis] render POST made: ${renderPosted}`);
    console.log(`[Analysis] fetchProgress called: ${fetchProgressCalled}`);
    console.log(`[Analysis] fetchProgress resolved: ${fetchProgressResolved}`);
    console.log(`[Analysis] fetchProgress failed: ${fetchProgressFailed}`);
    console.log(`[Analysis] fetchProgress exception: ${fetchProgressException}`);
    console.log(`[Analysis] Quest progress responses: ${questProgressResponses.length}`);
    console.log(`[Analysis] API says export_framing: ${postQ2?.steps?.export_framing}`);

    // The assertion
    expect(postQ2?.steps?.export_framing).toBe(true);
  });
});
