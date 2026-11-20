import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import { GAME_RETENTION_NOTE } from './helpers/retentionCopy.js';

/**
 * New User Flow E2E Test — a fresh user from the home page to a sharpened highlight.
 *
 *   Step 1: add a game, import plays, rate one 5 stars and make its highlight (full UI)
 *   Step 2: open the highlight, frame it (API shortcut) and sharpen it (real export)
 *   Step 3: add a spotlight when the environment can render one
 *
 * Progress is asserted from the games and projects the user's actions created.
 *
 * REDUNDANCY NOTES:
 *   - full-workflow.spec.js — tests "Add Game → Annotate → TSV import" flow (test #2)
 *     and "Watch plays" (test #4), which overlap with Step 1.
 *   - regression-tests.spec.js — "Annotate: video first frame loads" and "TSV import shows
 *     clips" smoke tests overlap with Step 1 game creation + annotation steps.
 *
 * Run with:
 *   cd src/frontend && npx playwright test e2e/new-user-flow.spec.js
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
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
  await page.waitForLoadState('domcontentloaded');
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

/** Get games via API (uses page session cookie for auth) */
async function getGames(page) {
  return await page.evaluate(async (apiBase) => {
    const res = await fetch(`${apiBase}/games`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.games || []);
  }, '/api');
}

/** Get projects via API (uses page session cookie for auth) */
async function getProjects(page) {
  return await page.evaluate(async (apiBase) => {
    const res = await fetch(`${apiBase}/projects`, { credentials: 'include' });
    if (!res.ok) return [];
    return res.json();
  }, '/api');
}

/** Frame all clips in a project via API (uses page session cookie for auth).
 * Runs entirely inside a single page.evaluate so all fetches share the session. */
async function frameAllClipsInProject(page, projectId) {
  return await page.evaluate(async ({ apiBase, projectId }) => {
    const clipsRes = await fetch(`${apiBase}/clips/projects/${projectId}/clips`, { credentials: 'include' });
    if (!clipsRes.ok) return 0;
    const clips = await clipsRes.json();
    let framed = 0;
    for (const clip of clips) {
      const res = await fetch(`${apiBase}/clips/projects/${projectId}/clips/${clip.id}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_crop_keyframe',
          data: { frame: 0, x: 240, y: 108, width: 480, height: 864, origin: 'user' },
        }),
      });
      if (res.ok) framed++;
    }
    return framed;
  }, { apiBase: '/api', projectId });
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

test.describe('New User Flow — home page to a sharpened highlight', () => {
  // T5420: drives an EMPTY new-user session (X-User-ID + test-login), uploads local
  // test-data video and shells out (execSync). Skip loudly on a deployed target.
  skipOnDeployedTarget(test, "empty new-user flow: import()s /src/stores/*.js + uploads local test video (Vite-dev paths 404 on a deployed build)");
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

  test('adds a game, makes a highlight and sharpens it', async ({ page }) => {
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
    // STEP 1: ADD A GAME AND MAKE A HIGHLIGHT (full UI)
    // =========================================================================

    console.log('\n=== STEP 1: ADD A GAME ===');

    // --- Q1 Step 1: Add Your First Game ---
    console.log('[Q1.1] Add Your First Game');

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify fresh user sees the home page with Games tab
    await expect(page.locator('button:has-text("Games")')).toBeVisible();

    // Click Games tab and Add Game
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Upload game")').click();
    await page.waitForTimeout(500);

    // T8500: cost line + 30-day expiry render BEFORE any file is selected.
    // T8955: the metadata fields (incl. Game Type) are all always-visible now,
    // no collapsed disclosure to check.
    await expect(page.getByText(GAME_RETENTION_NOTE)).toBeVisible({ timeout: 10000 });

    // T8810: one universal footage dropzone (no Per Game / Per Half toggle).
    await expect(page.getByText('Drop any game video here.')).toBeVisible({ timeout: 10000 });

    // Fill the Add Game form (typed metadata still wins over the defaults)
    await openGameDetailsDisclosure(page);
    await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
    const today = new Date().toISOString().split('T')[0];
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Home' }).click({ force: true });

    // Upload video
    const videoInput = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput).toBeAttached({ timeout: 10000 });
    await videoInput.setInputFiles(GAME1_VIDEO);
    await page.waitForTimeout(1000);

    // Click Create Game (button text is "Upload game" inside the form)
    const createButton = page.getByRole('button', { name: 'Upload game' }).last();
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

    expect((await getGames(page)).length, 'the uploaded game exists').toBeGreaterThan(0);
    console.log('[Q1.1] game created');

    // --- Q1 Step 2: Create a Reel ---
    console.log('[Q1.2] Create a Reel');

    // Click the first clip row in the sidebar to select it.
    // ClipListItem renders each clip as a <div> with cursor-pointer; the title attribute
    // is on an inner text node, not the outer clickable div.  Use the clip list row
    // selector that matches how clip-selection-state-machine.spec.js clicks clips.
    const firstClipRow = page.locator('[data-sidebar="clips"] .border-b.border-gray-800').first();
    await firstClipRow.click({ force: true });
    await page.waitForTimeout(800);

    // Wait for the ClipDetailsEditor to appear (it has data-clip-details on the root div).
    await expect(page.locator('[data-clip-details]')).toBeVisible({ timeout: 10000 });

    // Rate it 5 stars — each star button has an exact title like "1 star", "2 stars", ..., "5 stars".
    // Use exact match to avoid matching "Auto-created from 5-star clips" in ProjectManager.
    const fiveStarBtn = page.locator('[data-clip-details] button[title="5 stars"]').first();
    await expect(fiveStarBtn).toBeVisible({ timeout: 5000 });
    await fiveStarBtn.click({ force: true });
    await page.waitForTimeout(1000);

    // A 5-star rating may or may not have already made the highlight by now
    // (caption "highlight already made"); otherwise the explicit make-highlight CTA
    // (T11910: the Portrait slot's Make button) creates it and opens it in Focus.
    // Accept either; the project check below verifies a highlight exists.
    const makeHighlightBtn = page.getByTestId('annotate-make-highlight-portrait');
    const alreadyMade = page.locator('[data-clip-details]').getByText(/highlight already made/i);
    await expect(makeHighlightBtn.or(alreadyMade)).toBeVisible({ timeout: 10000 });
    if (await makeHighlightBtn.isVisible().catch(() => false)) {
      await expect(makeHighlightBtn).toBeEnabled({ timeout: 10000 });
      await makeHighlightBtn.click();
    }

    await expect.poll(async () => (await getProjects(page)).length,
      { message: 'the 5-star play made a highlight project', timeout: 30000 }).toBeGreaterThan(0);
    console.log('[Q1.2] highlight project created');

    // =========================================================================
    // STEP 2: FRAME AND SHARPEN THE HIGHLIGHT
    // Uses an API shortcut for framing + a real export
    // =========================================================================

    console.log('\n=== STEP 2: FRAME AND SHARPEN ===');

    // --- Q2 Step 1: Open a Project ---
    console.log('[Q2.1] Open a Project');

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /^Plays/ }).click();
    await page.waitForTimeout(1000);

    // Click the auto-generated project from the 5-star clip
    const projectCards = page.locator('[data-testid="project-card"]');
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
    console.log('[Q2.1] framing screen open');

    // --- Q2 Step 2-3: Frame Video + Wait For Export ---
    console.log('[Q2.2-3] Frame Video + Export');

    // Frame clips via API so the export button enables
    const projects = await getProjects(page);
    expect(projects.length).toBeGreaterThan(0);
    const projectId = projects[0].id;
    const framed = await frameAllClipsInProject(page, projectId);
    console.log(`[Q2.2] Framed ${framed} clip(s) via API`);

    // Reload to pick up framing data, re-enter project
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /^Plays/ }).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="project-card"]').first().click({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // Click Generate Highlight to start export
    const frameVideoBtn = page.locator('button:has-text("Sharpen!"):not([disabled])');
    // A project that already has a rendered highlight opens its preview instead of
    // the editor, so only start the export when the editor is showing the button;
    // the working-video check below is the real assertion either way.
    if (await frameVideoBtn.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await frameVideoBtn.first().click();
      await page.waitForTimeout(2000);
    }

    const projectHas = async (field) =>
      !!(await getProjects(page)).find((p) => p.id === projectId)?.[field];

    // Wait for framing export to complete
    const sharpened = await waitWithProgress(page,
      async () => await projectHas('has_working_video'),
      { label: 'Q2.3-framing-export', stallTimeout: 60000 }
    );
    expect(sharpened).toBeTruthy();
    console.log('[Q2.3] Framing export complete');

    // =========================================================================
    // STEP 3: ADD A SPOTLIGHT (needs a real overlay render)
    // =========================================================================

    console.log('\n=== STEP 3: ADD A SPOTLIGHT ===');

    // Reload so the framing export result is reflected, then try a real overlay export.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /^Plays/ }).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="project-card"]').first().click({ timeout: 15000 });
    await page.waitForTimeout(3000);

    let overlayExportDone = false;
    const overlayModeBtn = page.locator('button:has-text("Spotlight"):not([disabled])');
    if (await overlayModeBtn.first().isVisible().catch(() => false)) {
      await overlayModeBtn.first().click();
      await page.waitForTimeout(3000);
      const generateOverlayBtn = page.locator('button:has-text("Add spotlight to highlight"):not([disabled])');
      if (await generateOverlayBtn.first().isVisible().catch(() => false)) {
        await generateOverlayBtn.first().click();
        await page.waitForTimeout(2000);
        overlayExportDone = await waitWithProgress(page,
          async () => await projectHas('has_final_video'),
          { label: 'Q3-overlay-export', stallTimeout: 60000 }
        );
      }
    }
    console.log(`[Q3] Overlay export done: ${overlayExportDone}`);

    console.log('\n=== NEW USER FLOW COMPLETE ===');
  });
});
