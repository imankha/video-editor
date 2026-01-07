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

// E2E tests use dev port 8000 (see playwright.config.js)
const API_BASE = 'http://localhost:8000/api';

// Unique test user ID for this test run (isolates E2E data from dev data)
const TEST_USER_ID = `e2e_gameload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/12.6.carlsbad');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, '12.6.carlsbad.tsv');

/**
 * Set up page to add X-User-ID header to all API requests.
 * This isolates test data from development data.
 */
async function setupTestUserContext(page) {
  await page.route('**/api/**', async (route) => {
    const headers = {
      ...route.request().headers(),
      'X-User-ID': TEST_USER_ID,
    };
    await route.continue({ headers });
  });
}

test.describe('Game Loading Debug', () => {
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
    await page.waitForTimeout(500);
    console.log('Step 2: Switched to Games tab');

    // Check if there are existing games
    const existingGames = await page.locator('.group.relative:has-text("clips")').count();
    console.log(`Found ${existingGames} existing games`);

    let gameId;

    if (existingGames === 0) {
      // Create a game first by uploading a video
      console.log('No games found, creating one...');

      // Click "Add Game" which triggers file picker
      const videoInput = page.locator('input[type="file"][accept*="video"]');
      await videoInput.setInputFiles(TEST_VIDEO);

      // Wait for video to load and annotate mode
      await expect(page.locator('video')).toBeVisible({ timeout: 120000 });
      console.log('Video loaded in annotate mode');

      // Import TSV to have some clips
      const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
      await tsvInput.setInputFiles(TEST_TSV);
      await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });
      console.log('TSV imported');

      // Wait a bit for auto-save
      await page.waitForTimeout(2000);

      // Go back to project manager
      await page.locator('button:has-text("← Projects")').click();
      await page.waitForTimeout(1000);

      // Should be back at project manager
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    }

    // Step 3: Switch to Games tab again
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);

    // Verify games exist now
    const gamesCount = await page.locator('.group.relative:has-text("clip")').count();
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
    const isInAnnotateMode = await page.locator('text=Annotate Game').isVisible().catch(() => false);
    const isInProjectManager = await page.locator('button:has-text("New Project")').isVisible().catch(() => false);
    const hasVideo = await page.locator('video').isVisible().catch(() => false);

    console.log(`State after click:`);
    console.log(`  - isInAnnotateMode (sees "Annotate Game"): ${isInAnnotateMode}`);
    console.log(`  - isInProjectManager (sees "New Project"): ${isInProjectManager}`);
    console.log(`  - hasVideo: ${hasVideo}`);

    // The test should pass if we're in annotate mode
    expect(isInAnnotateMode).toBeTruthy();
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

    // Verify we transitioned to annotate mode
    const annotateHeader = page.locator('h1:has-text("Annotate Game")');
    await expect(annotateHeader).toBeVisible({ timeout: 10000 });
  });
});
