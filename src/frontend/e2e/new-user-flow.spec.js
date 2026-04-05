import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * New User Flow E2E Test — Complete quest journey from landing page to "Vamos!" dialog.
 *
 * Walks a fresh user through all 4 quests:
 *   Quest 1: Get Started — add game, annotate 5-star clip, playback annotations
 *   Quest 2: Export Highlights — open project, frame, export, overlay, view gallery
 *   Quest 3: Annotate More Clips — more 5-star clips, more exports, watch highlights
 *   Quest 4: Highlight Reel — second game, custom multi-game project, export reel
 *
 * After all quests are complete, claiming Quest 4 shows the "Vamos!" completion modal.
 *
 * Strategy:
 *   - Quest 1: Full UI interaction (the core new user onboarding)
 *   - Quests 2-4: API shortcuts for data setup + real exports where needed
 *   - Quest 4 claim: Via QuestPanel UI to trigger the "Vamos!" modal
 *
 * REDUNDANCY NOTES:
 *   The following existing tests have partial overlap with this test:
 *   - quest-walkthrough.spec.js — covers the same 4-quest flow but as a report-generating
 *     walkthrough, not an assertion-based test. Generates screenshots + markdown report.
 *   - full-workflow.spec.js — tests "Add Game → Annotate → TSV import" flow (test #2)
 *     and "Playback Annotations" (test #4), which overlap with Quest 1 steps.
 *   - regression-tests.spec.js — "Annotate: video first frame loads" and "TSV import shows
 *     clips" smoke tests overlap with Quest 1 game creation + annotation steps.
 *
 * Run with:
 *   cd src/frontend && npx playwright test e2e/new-user-flow.spec.js
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_newuser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_HEADERS = { 'X-User-ID': TEST_USER_ID, 'Content-Type': 'application/json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Test data — short 1.5 min video for fast execution
const GAME1_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');
const GAME1_TSV = path.resolve(__dirname, '../../../formal annotations/test.short/test.short.tsv');
const GAME2_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/game2-test.mp4');

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

  if (result.error) {
    console.warn(`[Auth] ${result.error}`);
  } else {
    console.log(`[Auth] Authenticated: ${result.email} (${result.user_id})`);
  }

  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function clearBrowserState(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(async () => {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
  });
}

async function cleanupTestData(request) {
  const headers = { 'X-User-ID': TEST_USER_ID };
  try {
    const res = await request.delete(`${API_BASE}/auth/user`, { headers });
    if (res.ok()) {
      const data = await res.json();
      console.log(`[Cleanup] ${data.message}`);
    }
  } catch (e) {
    console.log(`[Cleanup] Warning: ${e.message}`);
  }
}

/** Wait for quest progress API to show a step as complete */
async function waitForQuestStep(request, stepId, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await request.get(`${API_BASE}/quests/progress`, { headers: TEST_HEADERS });
      if (res.ok()) {
        const data = await res.json();
        for (const quest of data.quests) {
          if (quest.steps[stepId] === true) return true;
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

/** Get all quest progress */
async function getQuestProgress(request) {
  const res = await request.get(`${API_BASE}/quests/progress`, { headers: TEST_HEADERS });
  if (!res.ok()) return null;
  return await res.json();
}

/** Get game list via API */
async function getGames(request) {
  const res = await request.get(`${API_BASE}/games`, { headers: TEST_HEADERS });
  const data = await res.json();
  return data.games || [];
}

/** Get projects via API */
async function getProjects(request) {
  const res = await request.get(`${API_BASE}/projects`, { headers: TEST_HEADERS });
  return await res.json();
}

/** Create a raw clip via API */
async function createClipViaAPI(request, gameId, { start_time, end_time, name, rating, tags = [], notes = '' }) {
  return await request.post(`${API_BASE}/clips/raw/save`, {
    headers: TEST_HEADERS,
    data: { game_id: gameId, start_time, end_time, name, rating, tags, notes },
  });
}

/** Set crop data on a clip via API */
async function frameClipViaAPI(request, projectId, clipId) {
  return await request.post(`${API_BASE}/clips/projects/${projectId}/clips/${clipId}/actions`, {
    headers: TEST_HEADERS,
    data: {
      action: 'add_crop_keyframe',
      data: { frame: 0, x: 0.25, y: 0.1, width: 0.5, height: 0.8, origin: 'user' },
    },
  });
}

/** Frame all clips in a project via API */
async function frameAllClipsInProject(request, projectId) {
  const clipsRes = await request.get(`${API_BASE}/clips/projects/${projectId}/clips`, { headers: TEST_HEADERS });
  if (!clipsRes.ok()) return 0;
  const clips = await clipsRes.json();
  let framed = 0;
  for (const clip of clips) {
    const res = await frameClipViaAPI(request, projectId, clip.id);
    if (res.ok()) framed++;
  }
  return framed;
}

/** Record an achievement via API */
async function recordAchievement(request, key) {
  return await request.post(`${API_BASE}/quests/achievements/${key}`, { headers: TEST_HEADERS });
}

/** Claim a quest reward via API */
async function claimQuestReward(request, questId) {
  return await request.post(`${API_BASE}/quests/${questId}/claim-reward`, { headers: TEST_HEADERS });
}

/**
 * Wait for a condition with progress detection.
 * Keeps waiting as long as the page shows signs of activity.
 */
async function waitWithProgress(page, checkFn, { label = 'condition', stallTimeout = 30000, maxTimeout = 600000 } = {}) {
  const start = Date.now();
  let lastSnapshot = '';
  let lastChangeTime = Date.now();

  while (Date.now() - start < maxTimeout) {
    const done = await checkFn().catch(() => false);
    if (done) return true;

    const snapshot = await page.evaluate(() => {
      const indicators = [];
      document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="bg-green"], [class*="bg-purple"]').forEach(el => {
        indicators.push(el.style?.width || el.getAttribute('aria-valuenow') || el.className.slice(0, 50));
      });
      document.querySelectorAll('[class*="text-gray"], [class*="text-green"], [class*="text-yellow"], [class*="animate-spin"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length < 100 && /\d|%|progress|extract|export|process|wait|load|complet/i.test(t)) {
          indicators.push(t);
        }
      });
      document.querySelectorAll('.animate-spin, [class*="spinner"], [class*="loading"]').forEach(() => {
        indicators.push('spinner-active');
      });
      return indicators.join('|');
    }).catch(() => '');

    if (snapshot !== lastSnapshot) {
      if (lastSnapshot) console.log(`[${label}] Progress: ${snapshot.slice(0, 120)}`);
      lastSnapshot = snapshot;
      lastChangeTime = Date.now();
    }

    if (Date.now() - lastChangeTime > stallTimeout) {
      console.log(`[${label}] No progress for ${stallTimeout / 1000}s`);
      return false;
    }

    await page.waitForTimeout(5000);
  }
  console.log(`[${label}] Max timeout reached`);
  return false;
}

// ============================================================================
// Test
// ============================================================================

test.describe('New User Flow — Landing Page to Vamos!', () => {
  // This test involves video uploads and exports — needs extended timeout
  test.setTimeout(1200000); // 20 minutes

  test.beforeAll(async ({ request }) => {
    // Health check
    let healthy = false;
    for (let i = 0; i < 15; i++) {
      try {
        const res = await request.get(`${API_BASE}/health`);
        if (res.ok()) { healthy = true; break; }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!healthy) throw new Error(`Backend not running on port ${API_PORT}`);

    // Verify test files
    if (!fs.existsSync(GAME1_VIDEO)) throw new Error(`Game 1 video not found: ${GAME1_VIDEO}`);
    if (!fs.existsSync(GAME1_TSV)) throw new Error(`Game 1 TSV not found: ${GAME1_TSV}`);

    // Generate second game video via ffmpeg (different hash from game 1)
    if (!fs.existsSync(GAME2_VIDEO)) {
      console.log('[Setup] Generating game 2 test video via ffmpeg...');
      try {
        execSync(
          `ffmpeg -y -f lavfi -i color=c=green:s=640x480:d=5 -f lavfi -i anullsrc=r=44100:cl=mono ` +
          `-c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${GAME2_VIDEO}"`,
          { stdio: 'pipe', timeout: 30000 }
        );
      } catch {
        try {
          execSync(
            `ffmpeg -y -f lavfi -i color=c=green:s=640x480:d=5 -c:v libx264 -pix_fmt yuv420p "${GAME2_VIDEO}"`,
            { stdio: 'pipe', timeout: 30000 }
          );
        } catch {
          throw new Error('ffmpeg not available — needed to generate game 2 test video');
        }
      }
    }

    console.log(`[Setup] Test user: ${TEST_USER_ID}`);
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('Complete all 4 quests and see Vamos dialog', async ({ page, request }) => {
    test.slow(); // This is a long workflow test

    await setupTestUser(page);

    // Capture browser errors for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('Error')) {
        console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

    // Authenticate test user
    await authenticateTestUser(page);

    // Intercept /api/auth/me to keep user authenticated across reloads
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user_id: TEST_USER_ID, email: 'e2e@test.local' }),
      });
    });

    // =========================================================================
    // QUEST 1: GET STARTED (15 credits)
    // Full UI flow — this is the core new user onboarding experience
    // =========================================================================

    console.log('\n=== QUEST 1: GET STARTED ===');

    // --- Q1 Step 1: Add Your First Game ---
    console.log('[Q1.1] Add Your First Game');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify fresh user sees the home page with Games tab
    await expect(page.locator('button:has-text("Games")')).toBeVisible();

    // Click Games tab and Add Game
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    // Fill the Add Game form
    await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
    const today = new Date().toISOString().split('T')[0];
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Home' }).click();

    // Upload video
    const videoInput = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput).toBeAttached({ timeout: 10000 });
    await videoInput.setInputFiles(GAME1_VIDEO);
    await page.waitForTimeout(1000);

    // Click Create Game (button text is "Add Game" inside the form)
    const createButton = page.getByRole('button', { name: 'Add Game' }).last();
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Wait for video to load in annotate mode
    await expect(async () => {
      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      expect(await video.evaluate(v => !!v.src)).toBeTruthy();
    }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });
    console.log('[Q1.1] Video loaded in annotate mode');

    // Wait for video upload to complete
    const uploadingBtn = page.locator('button:has-text("Uploading video")');
    await page.waitForTimeout(2000);
    if (await uploadingBtn.isVisible().catch(() => false)) {
      console.log('[Q1.1] Upload in progress, waiting...');
      await expect(uploadingBtn).toBeHidden({ timeout: 300000 });
    }
    console.log('[Q1.1] Video upload complete');

    // Import TSV for clips (3 clips rated 4)
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await expect(tsvInput).toBeAttached({ timeout: 10000 });
    await tsvInput.setInputFiles(GAME1_TSV);
    await expect(page.locator('text=Great Control Pass').first()).toBeVisible({ timeout: 15000 });
    console.log('[Q1.1] TSV imported, clips visible');

    // Verify quest step: upload_game
    const q1s1 = await waitForQuestStep(request, 'upload_game');
    expect(q1s1).toBeTruthy();
    console.log('[Q1.1] upload_game step verified');

    // --- Q1 Step 2: Annotate a 5 Star Play ---
    console.log('[Q1.2] Annotate a 5 Star Play');

    // Click on the first clip to select it
    const firstClip = page.locator('[title*="Great Control Pass"]').first();
    await firstClip.click({ force: true });
    await page.waitForTimeout(800);

    // Rate it 5 stars — find star rating UI and click the 5th star
    const stars = page.locator('[data-testid="rating-star"], svg.lucide-star').filter({ has: page.locator('..') });
    const starCount = await stars.count();
    expect(starCount).toBeGreaterThanOrEqual(5);
    await stars.nth(4).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify quest step: annotate_brilliant
    const q1s2 = await waitForQuestStep(request, 'annotate_brilliant');
    expect(q1s2).toBeTruthy();
    console.log('[Q1.2] annotate_brilliant step verified');

    // --- Q1 Step 3: Watch Your Clips Back ---
    console.log('[Q1.3] Watch Your Clips Back (Playback Annotations)');

    const playbackBtn = page.locator('button:has-text("Playback Annotations")');
    await expect(playbackBtn).toBeVisible({ timeout: 10000 });
    await playbackBtn.click();
    // Wait for playback mode to record the achievement (triggers after 0.5s)
    await page.waitForTimeout(4000);

    // Exit playback mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify quest step: playback_annotations
    const q1s3 = await waitForQuestStep(request, 'playback_annotations');
    expect(q1s3).toBeTruthy();
    console.log('[Q1.3] playback_annotations step verified');

    // Verify Quest 1 is fully complete
    let progress = await getQuestProgress(request);
    const q1Progress = progress.quests.find(q => q.id === 'quest_1');
    expect(Object.values(q1Progress.steps).every(Boolean)).toBeTruthy();
    console.log('[Q1] All Quest 1 steps complete');

    // Claim Quest 1 reward via API
    const q1claim = await claimQuestReward(request, 'quest_1');
    expect(q1claim.ok()).toBeTruthy();
    const q1data = await q1claim.json();
    console.log(`[Q1] Reward claimed: ${q1data.credits_granted} credits`);

    // =========================================================================
    // QUEST 2: EXPORT HIGHLIGHTS (25 credits)
    // Uses API shortcuts for framing + real exports
    // =========================================================================

    console.log('\n=== QUEST 2: EXPORT HIGHLIGHTS ===');

    // --- Q2 Step 1: Open a Project ---
    console.log('[Q2.1] Open a Project');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);

    // Click the auto-generated project from the 5-star clip
    const projectCards = page.locator('.bg-gray-800.rounded-lg h3.text-white');
    const projectCount = await projectCards.count();
    expect(projectCount).toBeGreaterThan(0);
    await projectCards.first().click();
    await page.waitForTimeout(3000);

    // Wait for framing screen video to load
    const videoLoaded = await waitWithProgress(page,
      async () => await page.locator('video').first().isVisible().catch(() => false),
      { label: 'Q2.1-video', stallTimeout: 30000 }
    );
    expect(videoLoaded).toBeTruthy();

    // Verify quest step: open_framing
    const q2s1 = await waitForQuestStep(request, 'open_framing');
    expect(q2s1).toBeTruthy();
    console.log('[Q2.1] open_framing step verified');

    // --- Q2 Step 2-3: Frame Video + Wait For Export ---
    console.log('[Q2.2-3] Frame Video + Export');

    // Frame clips via API so the export button enables
    const projects = await getProjects(request);
    expect(projects.length).toBeGreaterThan(0);
    const framed = await frameAllClipsInProject(request, projects[0].id);
    console.log(`[Q2.2] Framed ${framed} clip(s) via API`);

    // Reload to pick up framing data, re-enter project
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);
    await page.locator('.bg-gray-800.rounded-lg h3.text-white').first().click();
    await page.waitForTimeout(3000);

    // Click Frame Video to start export
    const frameVideoBtn = page.locator('button:has-text("Frame Video"):not([disabled])');
    await expect(frameVideoBtn.first()).toBeVisible({ timeout: 10000 });
    await frameVideoBtn.first().click();
    await page.waitForTimeout(2000);

    // Wait for framing export to complete
    const q2s3 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_export', 5000),
      { label: 'Q2.3-framing-export', stallTimeout: 60000 }
    );
    expect(q2s3).toBeTruthy();
    console.log('[Q2.3] Framing export complete');

    // --- Q2 Step 4: Add Overlay ---
    console.log('[Q2.4] Add Overlay');

    // Switch to overlay mode
    const overlayModeBtn = page.locator('button:has-text("Overlay"):not([disabled])');
    const overlayVisible = await overlayModeBtn.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (overlayVisible) {
      await overlayModeBtn.first().click();
      await page.waitForTimeout(3000);

      // Click Add Overlay to start overlay export
      const addOverlayBtn = page.locator('button:has-text("Add Overlay")');
      if (await addOverlayBtn.first().isVisible().catch(() => false)) {
        await addOverlayBtn.first().click();
        await page.waitForTimeout(2000);

        // Wait for overlay export to complete
        const q2s4 = await waitWithProgress(page,
          async () => await waitForQuestStep(request, 'export_overlay', 5000),
          { label: 'Q2.4-overlay-export', stallTimeout: 60000 }
        );
        expect(q2s4).toBeTruthy();
        console.log('[Q2.4] Overlay export complete');
      }
    }

    // --- Q2 Step 5: Watch Your Highlight ---
    console.log('[Q2.5] Watch Your Highlight (Gallery)');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Record achievement via API (viewing gallery is hard to automate reliably)
    await recordAchievement(request, 'viewed_gallery_video');

    const q2s5 = await waitForQuestStep(request, 'view_gallery_video');
    expect(q2s5).toBeTruthy();
    console.log('[Q2.5] view_gallery_video step verified');

    // Claim Quest 2 reward via API
    const q2claim = await claimQuestReward(request, 'quest_2');
    expect(q2claim.ok()).toBeTruthy();
    console.log('[Q2] Quest 2 reward claimed');

    // =========================================================================
    // QUEST 3: ANNOTATE MORE CLIPS (40 credits)
    // Uses API to create clips + runs second export
    // =========================================================================

    console.log('\n=== QUEST 3: ANNOTATE MORE CLIPS ===');

    const games = await getGames(request);
    const game1Id = games[0]?.id;
    expect(game1Id).toBeTruthy();

    // Create a second 5-star clip via API (need 2+ five-star clips on first game)
    await createClipViaAPI(request, game1Id, {
      start_time: 15, end_time: 21, name: 'Amazing Dribble', rating: 5, tags: ['Dribble'],
      notes: 'Incredible footwork',
    });

    // Verify annotate_second_5_star and annotate_5_more (3+ clips on first game)
    const q3s1 = await waitForQuestStep(request, 'annotate_second_5_star');
    expect(q3s1).toBeTruthy();
    console.log('[Q3.1] annotate_second_5_star verified');

    const q3s2 = await waitForQuestStep(request, 'annotate_5_more');
    expect(q3s2).toBeTruthy();
    console.log('[Q3.2] annotate_5_more verified');

    // Second export: frame + export the second auto-project
    const allProjects = await getProjects(request);
    let secondProject = allProjects.length >= 2 ? allProjects[1] : allProjects[0];
    if (allProjects.length >= 2) {
      const framedCount = await frameAllClipsInProject(request, secondProject.id);
      console.log(`[Q3.3] Framed ${framedCount} clip(s) in project ${secondProject.id}`);
    }

    // Navigate to project and trigger export
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);

    const q3ProjectCards = page.locator('.bg-gray-800.rounded-lg h3.text-white');
    const q3ProjCount = await q3ProjectCards.count();
    if (q3ProjCount >= 2) {
      await q3ProjectCards.nth(1).click();
    } else {
      await q3ProjectCards.first().click();
    }
    await page.waitForTimeout(3000);

    // Frame Video export
    const fvBtn2 = page.locator('button:has-text("Frame Video"):not([disabled])');
    if (await fvBtn2.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await fvBtn2.first().click();
      await page.waitForTimeout(2000);
    }

    // Wait for second framing export
    const q3s4 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_export_2', 5000),
      { label: 'Q3.4-framing-export-2', stallTimeout: 60000 }
    );
    expect(q3s4).toBeTruthy();
    console.log('[Q3.4] Second framing export complete');

    // Second overlay export
    const overlayBtn2 = page.locator('button:has-text("Overlay"):not([disabled])');
    if (await overlayBtn2.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await overlayBtn2.first().click();
      await page.waitForTimeout(3000);

      const addOverlay2 = page.locator('button:has-text("Add Overlay")');
      if (await addOverlay2.first().isVisible().catch(() => false)) {
        await addOverlay2.first().click();
        await page.waitForTimeout(2000);

        await waitWithProgress(page,
          async () => await waitForQuestStep(request, 'overlay_second_highlight', 5000),
          { label: 'Q3.5-overlay-export-2', stallTimeout: 60000 }
        );
      }
    }

    // Record gallery watching achievement
    await recordAchievement(request, 'watched_gallery_video_1s');

    const q3s6 = await waitForQuestStep(request, 'watch_second_highlight');
    expect(q3s6).toBeTruthy();
    console.log('[Q3.6] watch_second_highlight verified');

    // Claim Quest 3 reward via API
    const q3claim = await claimQuestReward(request, 'quest_3');
    expect(q3claim.ok()).toBeTruthy();
    console.log('[Q3] Quest 3 reward claimed');

    // =========================================================================
    // QUEST 4: HIGHLIGHT REEL (45 credits)
    // Second game + custom multi-game project + export
    // =========================================================================

    console.log('\n=== QUEST 4: HIGHLIGHT REEL ===');

    // --- Q4 Step 1: Add Second Game ---
    console.log('[Q4.1] Add Second Game');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('e.g., Carlsbad SC').fill('SD Surf');
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Away' }).click();

    const videoInput2 = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput2).toBeAttached({ timeout: 10000 });
    await videoInput2.setInputFiles(GAME2_VIDEO);
    await page.waitForTimeout(1000);

    const createBtn2 = page.getByRole('button', { name: 'Add Game' }).last();
    await expect(createBtn2).toBeEnabled({ timeout: 5000 });
    await createBtn2.click();

    // Wait for video to load
    await expect(async () => {
      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      expect(await video.evaluate(v => !!v.src)).toBeTruthy();
    }).toPass({ timeout: 60000, intervals: [1000, 2000, 5000] });

    // Wait for upload
    await page.waitForTimeout(2000);
    const uploadBtn2 = page.locator('button:has-text("Uploading video")');
    if (await uploadBtn2.isVisible().catch(() => false)) {
      await expect(uploadBtn2).toBeHidden({ timeout: 120000 });
    }

    const q4s1 = await waitForQuestStep(request, 'upload_game_2');
    expect(q4s1).toBeTruthy();
    console.log('[Q4.1] upload_game_2 verified');

    // --- Q4 Step 2: Annotate a 4+ Star Clip on Game 2 ---
    console.log('[Q4.2] Annotate 4+ star on game 2');

    const gamesNow = await getGames(request);
    const game2 = gamesNow.find(g => g.id !== game1Id);
    expect(game2).toBeTruthy();

    await createClipViaAPI(request, game2.id, {
      start_time: 1, end_time: 4, name: 'Strong Run', rating: 4, tags: ['Dribble'],
      notes: 'Great effort',
    });

    const q4s2 = await waitForQuestStep(request, 'annotate_game_2');
    expect(q4s2).toBeTruthy();
    console.log('[Q4.2] annotate_game_2 verified');

    // --- Q4 Step 3: Create a Custom Multi-Game Project ---
    console.log('[Q4.3] Create custom project');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);

    const newProjectBtn = page.locator('button:has-text("New Project")');
    await expect(newProjectBtn).toBeVisible();
    await newProjectBtn.click();
    await page.waitForTimeout(1500);

    // Select clips from both games — check all available checkboxes
    const gameCheckboxes = page.locator('[data-testid="game-checkbox"], input[type="checkbox"]');
    const cbCount = await gameCheckboxes.count();
    for (let i = 0; i < cbCount && i < 10; i++) {
      const cb = gameCheckboxes.nth(i);
      if (await cb.isVisible().catch(() => false)) {
        await cb.click({ force: true });
        await page.waitForTimeout(300);
      }
    }

    // Create the project
    const createProjectBtn = page.locator('button:has-text("Create Project"), button:has-text("Create")').last();
    if (await createProjectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createProjectBtn.click();
      await page.waitForTimeout(3000);
    }

    const q4s3 = await waitForQuestStep(request, 'create_reel', 15000);
    expect(q4s3).toBeTruthy();
    console.log('[Q4.3] create_reel verified');

    // --- Q4 Step 4-5: Frame + Export the Reel ---
    console.log('[Q4.4-5] Frame and export reel');

    // Frame clips in the custom project via API
    const latestProjects = await getProjects(request);
    const customProject = latestProjects.find(p => !p.is_auto_created);
    expect(customProject).toBeTruthy();

    const reelFramed = await frameAllClipsInProject(request, customProject.id);
    console.log(`[Q4.4] Framed ${reelFramed} clip(s) in custom project`);

    // Navigate to the custom project and click Frame Video
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);

    const reelCards = page.locator('.bg-gray-800.rounded-lg h3.text-white');
    const reelCount = await reelCards.count();
    if (reelCount > 0) {
      // Custom project is usually the most recent — click last
      await reelCards.last().click();
      await page.waitForTimeout(3000);
    }

    const fvBtn3 = page.locator('button:has-text("Frame Video"):not([disabled])');
    if (await fvBtn3.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await fvBtn3.first().click();
      await page.waitForTimeout(2000);
    }

    // Wait for reel export
    const q4s5 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_reel', 5000),
      { label: 'Q4.5-reel-export', stallTimeout: 60000 }
    );
    expect(q4s5).toBeTruthy();
    console.log('[Q4.5] Reel framing export complete');

    // --- Q4 Step 6: Overlay on Reel ---
    console.log('[Q4.6] Overlay on reel');

    const overlayBtn3 = page.locator('button:has-text("Overlay"):not([disabled])');
    if (await overlayBtn3.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await overlayBtn3.first().click();
      await page.waitForTimeout(3000);

      const addOverlay3 = page.locator('button:has-text("Add Overlay")');
      if (await addOverlay3.first().isVisible().catch(() => false)) {
        await addOverlay3.first().click();
        await page.waitForTimeout(2000);

        await waitWithProgress(page,
          async () => await waitForQuestStep(request, 'overlay_reel', 5000),
          { label: 'Q4.6-overlay-reel', stallTimeout: 60000 }
        );
      }
    }

    const q4s6 = await waitForQuestStep(request, 'overlay_reel');
    expect(q4s6).toBeTruthy();
    console.log('[Q4.6] overlay_reel verified');

    // --- Q4 Step 7: Watch Your Reel ---
    console.log('[Q4.7] Watch reel in gallery');

    await recordAchievement(request, 'viewed_custom_project_video');
    const q4s7 = await waitForQuestStep(request, 'watch_reel');
    expect(q4s7).toBeTruthy();
    console.log('[Q4.7] watch_reel verified');

    // =========================================================================
    // CLAIM QUEST 4 VIA UI — triggers "Vamos!" completion modal
    // =========================================================================

    console.log('\n=== CLAIMING QUEST 4 VIA UI — expecting Vamos! dialog ===');

    // Reload page so QuestPanel picks up latest progress (Quest 4 fully complete)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Force a quest progress refresh in the frontend store
    await page.evaluate(async () => {
      const { useQuestStore } = await import('/src/stores/questStore.js');
      await useQuestStore.getState().fetchProgress({ force: true });
    });
    await page.waitForTimeout(2000);

    // The QuestPanel should show Quest 4 as complete with a "Claim" button
    // Quest 4 reward is 45 credits
    const claimButton = page.locator('button:has-text("Claim 45 Credits")');
    await expect(claimButton).toBeVisible({ timeout: 15000 });
    console.log('[Final] Claim button visible');

    // Click the claim button to trigger the Vamos! modal
    await claimButton.click();
    await page.waitForTimeout(2000);

    // Verify the "Vamos!" completion modal appears
    const congratsHeading = page.locator('text=Congratulations!');
    await expect(congratsHeading).toBeVisible({ timeout: 10000 });

    const vamosButton = page.locator('button:has-text("Vamos!")');
    await expect(vamosButton).toBeVisible({ timeout: 5000 });
    console.log('[Final] Vamos! dialog is visible');

    // Verify reward text
    const rewardText = page.locator('text=+45 credits earned');
    await expect(rewardText).toBeVisible();

    // Dismiss the modal
    await vamosButton.click();
    await page.waitForTimeout(1000);

    // Verify the modal is gone
    await expect(congratsHeading).toBeHidden({ timeout: 5000 });
    console.log('[Final] Vamos! dialog dismissed');

    // Final verification: all quests are claimed
    const finalProgress = await getQuestProgress(request);
    for (const quest of finalProgress.quests) {
      expect(quest.reward_claimed).toBeTruthy();
      console.log(`[Final] ${quest.id}: completed=${quest.completed}, claimed=${quest.reward_claimed}`);
    }

    console.log('\n=== NEW USER FLOW COMPLETE ===');
  });
});
