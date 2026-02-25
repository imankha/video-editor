import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Game Loading E2E Test
 *
 * Tests the flow of loading a saved game into annotate mode.
 * This test captures console logs to debug the "blink" issue where
 * clicking a game doesn't transition to annotate mode.
 *
 * Test Isolation: Each test run uses a unique user ID via X-User-ID header.
 */

// Always use port 8000 - the dev backend port
const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;

// Unique test user ID for this test run (isolates E2E data from dev data)
const TEST_USER_ID = `e2e_gameload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

/**
 * Set up page to add X-User-ID header to all API requests.
 * This isolates test data from development data.
 */
async function setupTestUserContext(page) {
  // T85a: Call /api/auth/init to create profile and get profile_id
  const initResponse = await page.request.post(`${API_BASE}/auth/init`, {
    headers: { 'X-User-ID': TEST_USER_ID },
  });
  const { profile_id } = await initResponse.json();

  // Set X-User-ID + X-Profile-ID for test isolation
  await page.setExtraHTTPHeaders({
    'X-User-ID': TEST_USER_ID,
    'X-Profile-ID': profile_id,
  });
  // Strip custom headers from R2 presigned URL requests to avoid CORS preflight
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-user-id'];
    delete headers['x-profile-id'];
    await route.continue({ headers });
  });
}

test.describe('Game Loading Debug', () => {
  // Check backend is running before tests start
  test.beforeAll(async ({ request }) => {
    // Check if test files exist first (fast check)
    if (!fs.existsSync(TEST_VIDEO)) {
      throw new Error(`Test video not found: ${TEST_VIDEO}`);
    }
    if (!fs.existsSync(TEST_TSV)) {
      throw new Error(`Test TSV not found: ${TEST_TSV}`);
    }

    // Check if backend is running with retries (server might be starting up)
    let lastError = null;
    for (let i = 0; i < 30; i++) { // Try for up to 60 seconds
      try {
        const health = await request.get(`${API_BASE}/health`);
        if (health.ok()) {
          console.log(`[E2E] Backend health check passed`);
          break;
        }
      } catch (e) {
        lastError = e;
        if (i < 29) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    if (lastError) {
      throw new Error(`Backend not running on port ${API_PORT}. Start it with: cd src/backend && uvicorn app.main:app --port ${API_PORT}`);
    }
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
    console.log(`[E2E] Test user ID: ${TEST_USER_ID}`);
  });

  test('Load saved game into annotate mode', async ({ page }) => {
    // Collect all console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      // Print important logs immediately
      if (text.includes('[EditorStore]') || text.includes('[App] Render check') || text.includes('[AnnotateContainer]')) {
        console.log(`BROWSER: ${text}`);
      }
    });

    // Also capture any errors
    page.on('pageerror', error => {
      console.log(`PAGE ERROR: ${error.message}`);
      consoleLogs.push(`[error] ${error.message}`);
    });

    // Step 1: Go to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log('Step 1: Loaded home page');

    // Step 2: First we need to create a game by loading a video
    // Switch to Games tab
    await page.locator('button:has-text("Games")').click();
    console.log('Step 2: Switched to Games tab');

    // Wait for games to finish loading (wait for "Loading games..." to disappear)
    await page.waitForSelector('text="Loading games..."', { state: 'hidden', timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(500);

    // Check if there are existing games (count Load buttons - one per game)
    const existingGames = await page.locator('button:has-text("Load")').count();
    console.log(`Found ${existingGames} existing games`);

    let gameId;

    if (existingGames === 0) {
      // Create a game first via the Add Game modal
      console.log('No games found, creating one...');

      // Click "Add Game" button to open modal
      await page.locator('button:has-text("Add Game")').click();
      await page.waitForTimeout(500);

      // Fill in the Add Game modal form
      console.log('Filling Add Game modal...');
      await page.getByPlaceholder('e.g., Carlsbad SC').fill('Game Loading Test');
      const today = new Date().toISOString().split('T')[0];
      const dateInput = page.locator('input[type="date"]');
      await dateInput.fill(today);
      await page.getByRole('button', { name: 'Home' }).click();

      // Upload video via modal (inside the form)
      const videoInput = page.locator('form input[type="file"][accept*="video"]');
      await videoInput.setInputFiles(TEST_VIDEO);
      await page.waitForTimeout(1000);

      // Click Create Game
      const createButton = page.getByRole('button', { name: 'Create Game' });
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();

      // Wait for video to load in annotate mode
      await expect(page.locator('video')).toBeVisible({ timeout: 120000 });
      console.log('Video loaded in annotate mode');

      // Wait for video upload to complete BEFORE importing TSV
      // The clips/raw/save endpoint requires the video file to exist
      console.log('Waiting for video upload to complete...');
      const uploadingButton = page.locator('button:has-text("Uploading video")');
      await page.waitForTimeout(2000);
      const isUploading = await uploadingButton.isVisible().catch(() => false);
      if (isUploading) {
        console.log('Upload in progress, waiting...');
        await expect(uploadingButton).toBeHidden({ timeout: 300000 });
      }
      console.log('Video upload complete');

      // Import TSV to have some clips (wait for clips to appear)
      const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
      await tsvInput.setInputFiles(TEST_TSV);
      await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 10000 });
      console.log('TSV imported');

      // Wait for clip saves to complete (auto-save happens in background)
      // Check for the Create Annotated Video button to be enabled (indicates clips are saved)
      console.log('Waiting for clips to be saved...');
      await page.waitForTimeout(5000);

      // Go back to project manager (Home button)
      await page.locator('button[title="Home"]').click();
      await page.waitForLoadState('networkidle');
    }

    // Step 3: Switch to Games tab again
    await page.locator('button:has-text("Games")').click();

    // Wait for games to finish loading - more robust approach
    // First wait for loading to disappear (with longer timeout)
    await page.waitForSelector('text="Loading games..."', { state: 'hidden', timeout: 30000 }).catch(() => null);

    // Then wait for at least one Load button to appear (the game we just created)
    console.log('Waiting for game Load button to appear...');
    await expect(page.locator('button:has-text("Load")').first()).toBeVisible({ timeout: 15000 });

    // Verify games exist now (count Load buttons - one per game)
    const gamesCount = await page.locator('button:has-text("Load")').count();
    console.log(`Games count after setup: ${gamesCount}`);
    expect(gamesCount).toBeGreaterThan(0);

    // Step 4: Clear console logs to focus on the click
    consoleLogs.length = 0;
    console.log('\n=== CLICKING ON GAME ===\n');

    // Step 5: Click on the first game's Load button
    const loadButton = page.locator('button:has-text("Load")').first();
    await expect(loadButton).toBeVisible();

    // Log before click
    console.log('About to click Load button...');

    await loadButton.click();

    // Wait a moment for state changes
    await page.waitForTimeout(3000);

    // Step 6: Log all captured console messages
    console.log('\n=== CONSOLE LOGS AFTER CLICK ===');
    for (const log of consoleLogs) {
      console.log(log);
    }
    console.log('=== END LOGS ===\n');

    // Step 7: Check what mode we're in
    // The annotate mode indicator shows "Annotate" in a green badge
    const isInAnnotateMode = await page.locator('.text-green-400:has-text("Annotate")').isVisible().catch(() => false);
    const isInProjectManager = await page.locator('button:has-text("New Project")').isVisible().catch(() => false);
    const hasVideo = await page.locator('video').isVisible().catch(() => false);

    console.log(`State after click:`);
    console.log(`  - isInAnnotateMode (sees green "Annotate" badge): ${isInAnnotateMode}`);
    console.log(`  - isInProjectManager (sees "New Project"): ${isInProjectManager}`);
    console.log(`  - hasVideo: ${hasVideo}`);

    // The test should pass if we're in annotate mode (has video + annotate badge)
    expect(isInAnnotateMode || hasVideo).toBeTruthy();
    expect(isInProjectManager).toBeFalsy();
  });

  test('Debug: Check editorMode state changes on game load', async ({ page }) => {
    const modeChanges = [];

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[EditorStore] setEditorMode')) {
        modeChanges.push(text);
        console.log(`MODE CHANGE: ${text}`);
      }
      if (text.includes('[App] Render check')) {
        console.log(`RENDER: ${text}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to Games tab
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);

    // Check if games exist
    const hasGames = await page.locator('button:has-text("Load")').count() > 0;

    if (!hasGames) {
      console.log('No games available, skipping test');
      test.skip();
      return;
    }

    console.log('\n=== Starting game load test ===');
    modeChanges.length = 0;

    // Click load
    await page.locator('button:has-text("Load")').first().click();

    // Wait for any state changes
    await page.waitForTimeout(5000);

    console.log('\n=== Mode changes detected ===');
    for (const change of modeChanges) {
      console.log(change);
    }

    // Check final state
    const finalUrl = page.url();
    console.log(`Final URL: ${finalUrl}`);

    // Take a screenshot to see what's displayed
    await page.screenshot({ path: 'test-results/game-load-debug.png', fullPage: true });
    console.log('Screenshot saved to test-results/game-load-debug.png');

    // Verify we transitioned to annotate mode (check for video or annotate badge)
    const hasVideo = await page.locator('video').isVisible().catch(() => false);
    const hasAnnotateBadge = await page.locator('.text-green-400:has-text("Annotate")').isVisible().catch(() => false);
    expect(hasVideo || hasAnnotateBadge).toBeTruthy();
  });
});
