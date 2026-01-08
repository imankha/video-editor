import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Regression Tests for Video Editor
 *
 * Test Suites:
 * - Smoke Tests (@smoke): Fast, parallel, <30s total - run on every PR
 * - Full Coverage Tests (@full): Sequential, complete workflows - run before release
 *
 * Run commands:
 * - Smoke only: npx playwright test --grep @smoke
 * - Full only: npx playwright test --grep @full
 * - All tests: npx playwright test
 *
 * Port Configuration:
 * - Always uses dev ports 8000/5173
 * - Start your backend: cd src/backend && uvicorn app.main:app --port 8000
 */

// Always use port 8000 - the dev backend port
// UI mode: Uses your running dev server on 8000
// Headless mode: Tests go through Vite proxy on 5174 which forwards to backend
const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/12.6.carlsbad');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4');
const TEST_VIDEO_SHORT = path.join(TEST_DATA_DIR, 'test-short-2s.mp4'); // 2-second version for fast AI upscaling tests
const TEST_TSV = path.join(TEST_DATA_DIR, '12.6.carlsbad.tsv');

// ============================================================================
// Helpers
// ============================================================================

async function setupTestUserContext(page) {
  console.log(`[Test] Setting up route interceptor for user: ${TEST_USER_ID}`);
  await page.route('**/api/**', async (route) => {
    const headers = { ...route.request().headers(), 'X-User-ID': TEST_USER_ID };
    console.log(`[Test] Intercepted ${route.request().method()} ${route.request().url()} -> adding X-User-ID: ${TEST_USER_ID}`);
    await route.continue({ headers });
  });
}

/**
 * Clear browser storage and cache to prevent stale data issues.
 * Call this at the start of test suites or when tests fail due to cached state.
 */
async function clearBrowserState(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  // Clear service worker caches if any
  await page.evaluate(async () => {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
  });
}

async function cleanupTestData(request) {
  const headers = { 'X-User-ID': TEST_USER_ID };
  console.log(`[Cleanup] Deleting entire user folder: ${TEST_USER_ID}`);

  try {
    // Delete the entire user folder (database, videos, cache, everything)
    const res = await request.delete(`${API_BASE}/auth/user`, { headers });
    if (res.ok()) {
      const data = await res.json();
      console.log(`[Cleanup] ${data.message}`);
    } else {
      console.log(`[Cleanup] Warning: Delete returned ${res.status()}`);
    }
  } catch (e) {
    console.log(`[Cleanup] Warning: ${e.message}`);
  }
}

async function waitForVideoFirstFrame(page, timeout = 15000) {
  const video = page.locator('video');
  await expect(video).toBeVisible({ timeout });

  // Check video has src and is ready
  const state = await video.evaluate(v => ({ hasSrc: !!v.src, readyState: v.readyState }));
  expect(state.hasSrc).toBeTruthy();

  // Wait for video to have actual dimensions (means content loaded)
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.videoWidth > 0 && v.videoHeight > 0;
  }, { timeout });

  // Verify video has actual content (not all black/blank)
  const hasContent = await video.evaluate(v => {
    if (!v.videoWidth || !v.videoHeight) return false;

    // Sample video pixels to verify it's not blank
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0, 20, 20);

    const data = ctx.getImageData(0, 0, 20, 20).data;

    // Check if any pixel has color (not pure black)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 15 || data[i+1] > 15 || data[i+2] > 15) {
        return true; // Found non-black pixel
      }
    }
    return false; // All pixels are black
  });

  if (!hasContent) {
    throw new Error('Video element exists but content is all black/blank - video may not be loaded correctly');
  }

  return video;
}

async function waitForExportComplete(page, maxTimeout = 600000, progressCheckInterval = 30000) {
  const startTime = Date.now();
  let exportStarted = false;

  // Progress-based SLA tracking
  // App SLA: must show progress increase periodically during long operations
  // This ensures the app keeps users informed and doesn't stall
  //
  // For AI upscaling, we use a longer threshold because each frame can take 2-3 seconds,
  // meaning progress only increases when frames complete (could be 60-90 seconds between updates)
  let lastProgress = -1;
  let checksWithoutIncrease = 0;
  let isAIUpscaling = false;
  // Normal operations: 4 checks * 30s = 2 minutes without progress = stall
  // AI upscaling: 10 checks * 30s = 5 minutes without progress = stall (frames are slow)
  const MAX_CHECKS_NORMAL = 4;
  const MAX_CHECKS_AI_UPSCALING = 10;

  // Wait for export to actually START (button shows "Exporting")
  // This ensures we don't exit early if Overlay button was already enabled
  console.log('[Full] Waiting for export to start...');
  for (let i = 0; i < 30; i++) { // 15 seconds max to see export start
    const exportingButton = page.locator('button:has-text("Exporting")');
    const loaderVisible = page.locator('.animate-spin').first();

    if (await exportingButton.isVisible({ timeout: 500 }).catch(() => false)) {
      exportStarted = true;
      console.log('[Full] Export started (Exporting button visible)');
      break;
    }
    if (await loaderVisible.isVisible({ timeout: 500 }).catch(() => false)) {
      exportStarted = true;
      console.log('[Full] Export started (loader visible)');
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!exportStarted) {
    console.log('[Full] Warning: Export may not have started, checking for completion anyway');
  }

  while (true) {
    const elapsed = Date.now() - startTime;

    // Check if export button returned to normal state (not "Exporting")
    const exportButton = page.locator('button:has-text("Export Video")').first();
    const exportingButton = page.locator('button:has-text("Exporting")');
    const loaderVisible = page.locator('.animate-spin').first();

    // Export is complete when:
    // 1. Export started (exportStarted=true)
    // 2. No "Exporting" button visible
    // 3. No loader visible
    // 4. "Export Video" button is back and enabled
    const isExporting = await exportingButton.isVisible({ timeout: 500 }).catch(() => false);
    const hasLoader = await loaderVisible.isVisible({ timeout: 500 }).catch(() => false);
    const exportButtonEnabled = await exportButton.isEnabled({ timeout: 500 }).catch(() => false);

    if (exportStarted && !isExporting && !hasLoader && exportButtonEnabled) {
      console.log('[Full] Export complete - Export button returned to normal state');
      // Give a moment for state to settle
      await page.waitForTimeout(1000);
      return;
    }

    // Also check Overlay button as secondary signal (for when we transition modes)
    const overlayButton = page.locator('button:has-text("Overlay")');
    const overlayEnabled = await overlayButton.isEnabled({ timeout: 500 }).catch(() => false);
    if (exportStarted && overlayEnabled && !isExporting && !hasLoader) {
      console.log('[Full] Export complete - Overlay button enabled');
      await page.waitForTimeout(1000);
      return;
    }

    // Track export activity - as long as we see export UI, the export is running
    let hasExportActivity = isExporting || hasLoader;
    let currentProgress = -1;
    let statusText = null;

    // Look for export progress specifically:
    // The ExportProgress component shows "AI Upscaling... X%" or "Overlay Export... X%"
    try {
      // Look for text containing both "Upscaling" or "Export" AND a percentage
      const exportProgressText = page.locator('text=/(?:Upscaling|Export).*\\d+%/i').first();
      if (await exportProgressText.isVisible({ timeout: 300 })) {
        hasExportActivity = true;
        statusText = await exportProgressText.textContent({ timeout: 300 }).catch(() => null);
        if (statusText) {
          const match = statusText.match(/(\d+)%/);
          if (match) {
            currentProgress = parseInt(match[1], 10);
          }
        }
      }
    } catch {
      // Ignore - export progress text not visible
    }

    // Fallback: check progress bar visibility (not just width)
    if (!hasExportActivity) {
      try {
        const progressBar = page.locator('.rounded-full .bg-green-600').first();
        if (await progressBar.isVisible({ timeout: 300 })) {
          hasExportActivity = true;
          const style = await progressBar.getAttribute('style');
          if (style) {
            const widthMatch = style.match(/width:\s*(\d+(?:\.\d+)?)/);
            if (widthMatch) {
              currentProgress = Math.round(parseFloat(widthMatch[1]));
            }
          }
        }
      } catch {
        // Ignore - progress bar not found
      }
    }

    // Check for status messages
    if (!statusText) {
      const statusIndicators = [
        page.locator('text=/AI Upscaling/i').first(),
        page.locator('text=/Overlay Export/i').first(),
        page.locator('text=/Processing frame/i').first(),
        page.locator('text=/Encoding/i').first(),
      ];
      for (const indicator of statusIndicators) {
        try {
          if (await indicator.isVisible({ timeout: 200 })) {
            hasExportActivity = true;
            statusText = await indicator.textContent({ timeout: 200 }).catch(() => null);
            break;
          }
        } catch {
          // Ignore
        }
      }
    }

    // Detect if we're in AI upscaling phase (need longer SLA threshold)
    if (statusText && /AI Upscaling/i.test(statusText)) {
      isAIUpscaling = true;
    }
    const maxChecks = isAIUpscaling ? MAX_CHECKS_AI_UPSCALING : MAX_CHECKS_NORMAL;

    // Progress-based SLA tracking
    // Check if progress increased since last check
    if (currentProgress > lastProgress) {
      // Progress increased - reset stall counter
      checksWithoutIncrease = 0;
      lastProgress = currentProgress;
      console.log(`[Full] Progress increased to ${currentProgress}%`);
    } else if (exportStarted && hasExportActivity) {
      // No progress increase but export UI is visible
      checksWithoutIncrease++;
      const phase = isAIUpscaling ? 'AI upscaling' : 'normal';
      console.log(`[Full] No progress increase (${checksWithoutIncrease}/${maxChecks} checks, ${phase} phase)`);
    }

    // Check for SLA violation - no progress for too many consecutive checks
    if (exportStarted && checksWithoutIncrease >= maxChecks) {
      const phase = isAIUpscaling ? 'AI upscaling' : 'normal';
      throw new Error(`SLA violation: Export stalled during ${phase} - no progress increase for ${maxChecks * 30}s (stuck at ${lastProgress}%)`);
    }

    // Hard timeout
    if (elapsed > maxTimeout) {
      throw new Error(`Export did not complete within ${maxTimeout / 1000}s (last progress: ${lastProgress}%)`);
    }

    // Log progress periodically
    const elapsedSec = Math.round(elapsed / 1000);
    const progressInfo = currentProgress >= 0 ? `${currentProgress}%` : 'unknown';
    const statusInfo = statusText ? ` - ${statusText.trim().substring(0, 40)}` : '';
    console.log(`[Full] Export check (${elapsedSec}s): progress=${progressInfo}${statusInfo}`);

    // Wait 30 seconds before next progress check (enforces SLA)
    await page.waitForTimeout(progressCheckInterval);
  }
}

async function navigateToProjectManager(page) {
  // Check if we're already on the project manager
  const newProjectButton = page.locator('button:has-text("New Project")');
  if (await newProjectButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    return; // Already on project manager
  }

  // Look for "← Projects" button (exists in both annotate and framing/overlay modes)
  const projectsButton = page.locator('button:has-text("Projects")');
  if (await projectsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await projectsButton.click();
    // Wait for navigation - New Project button should appear
    await expect(newProjectButton).toBeVisible({ timeout: 10000 });
    return;
  }

  // If we're still here, we might be on a screen without navigation buttons
  // This shouldn't happen in normal flow
  console.log('[Test] Warning: Could not find Projects button to navigate');
}

/**
 * Ensure we're in annotate mode with video and TSV loaded.
 * Navigates there if needed and loads test files.
 */
async function ensureAnnotateModeWithClips(page) {
  // Check if we're already in annotate mode with clips
  const clipsVisible = await page.locator('text=Good Pass').first().isVisible({ timeout: 1000 }).catch(() => false);
  if (clipsVisible) {
    console.log('[Test] Already in annotate mode with clips');
    return;
  }

  // Navigate to home and load video/TSV
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Load SHORT video (2s) for fast AI upscaling in tests
  const videoInput = page.locator('input[type="file"][accept*="video"]');
  await videoInput.setInputFiles(TEST_VIDEO_SHORT);
  await waitForVideoFirstFrame(page);

  // Import TSV
  const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
  await tsvInput.setInputFiles(TEST_TSV);
  await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });
  console.log('[Test] Loaded video and TSV in annotate mode');
}

/**
 * Wait for video upload to complete by monitoring progress.
 * Continues waiting as long as progress is increasing.
 */
async function waitForUploadComplete(page, maxTimeout = 600000) {
  const startTime = Date.now();
  let lastLogTime = 0;
  let lastUploadProgress = -1;
  let lastProgressChangeTime = Date.now();
  const STALL_TIMEOUT = 120000; // 2 minutes without progress = stalled

  const importButton = page.locator('button:has-text("Import Into Projects")');

  console.log('[Test] Waiting for video upload to complete...');

  while (true) {
    const elapsed = Date.now() - startTime;

    // Check if upload is complete
    const isUploading = await page.locator('button:has-text("Uploading video")').isVisible({ timeout: 500 }).catch(() => false);
    const isEnabled = await importButton.isEnabled({ timeout: 500 }).catch(() => false);

    if (isEnabled && !isUploading) {
      console.log('[Test] Upload complete - Import button enabled');
      return true;
    }

    // Try to extract upload progress (if shown)
    // Upload progress might show as percentage or file size
    let currentProgress = -1;
    try {
      // Look for any percentage in the uploading button area
      const uploadingButton = page.locator('button:has-text("Uploading")').first();
      if (await uploadingButton.isVisible({ timeout: 300 })) {
        const buttonText = await uploadingButton.textContent({ timeout: 300 });
        const match = buttonText?.match(/(\d+)%/);
        if (match) {
          currentProgress = parseInt(match[1], 10);
        }
      }
    } catch {
      // Ignore
    }

    // Update progress tracking - even without percentage, just being in "uploading" state counts
    if (currentProgress > lastUploadProgress || isUploading) {
      if (currentProgress > lastUploadProgress) {
        lastUploadProgress = currentProgress;
      }
      lastProgressChangeTime = Date.now();
    }

    // Check for stall
    const timeSinceChange = Date.now() - lastProgressChangeTime;
    if (timeSinceChange > STALL_TIMEOUT) {
      console.log(`[Test] Upload stalled - no progress for ${STALL_TIMEOUT / 1000}s`);
      return false;
    }

    // Hard timeout with stall check
    if (elapsed > maxTimeout && timeSinceChange > 60000) {
      console.log(`[Test] Upload timeout after ${maxTimeout / 1000}s`);
      return false;
    }

    // Log progress every 30 seconds
    if (Date.now() - lastLogTime > 30000) {
      const elapsedSec = Math.round(elapsed / 1000);
      const progressInfo = lastUploadProgress >= 0 ? `${lastUploadProgress}%` : 'in progress';
      console.log(`[Test] Upload progress (${elapsedSec}s): ${progressInfo}`);
      lastLogTime = Date.now();
    }

    await page.waitForTimeout(2000);
  }
}

/**
 * Ensure projects exist with clips. Creates them via API if needed.
 */
async function ensureProjectsExist(page) {
  // Navigate to app first so relative URLs work in page.evaluate
  const url = page.url();
  if (!url || url === 'about:blank' || !url.includes('localhost')) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  }

  // Use page.evaluate(fetch) with relative URL so it goes through Vite proxy + route interceptor
  const projects = await page.evaluate(async () => {
    const res = await fetch('/api/projects');
    return res.json();
  });

  if (projects.length > 0) {
    console.log(`[Test] Found ${projects.length} existing projects`);
    return projects;
  }

  // No projects - need to create them via the full import flow
  console.log('[Test] No projects found, creating via import flow...');

  await ensureAnnotateModeWithClips(page);

  // Wait for upload to complete with progress monitoring
  const uploadSuccess = await waitForUploadComplete(page);
  if (!uploadSuccess) {
    throw new Error('Video upload failed or timed out');
  }

  // Click import
  const importButton = page.locator('button:has-text("Import Into Projects")');
  page.once('dialog', async dialog => {
    console.log(`[Test] Alert: ${dialog.message()}`);
    await dialog.accept();
  });
  await importButton.click();
  await expect(page.locator('button:has-text("New Project")')).toBeVisible({ timeout: 60000 });

  // Return the created projects
  const newProjects = await page.evaluate(async () => {
    const res = await fetch('/api/projects');
    return res.json();
  });
  return newProjects;
}

/**
 * Ensure we're in framing mode for a project with clips.
 * Creates project if needed, navigates to framing mode.
 */
async function ensureFramingMode(page) {
  // First ensure projects exist
  await ensureProjectsExist(page);

  // Navigate to project manager
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await navigateToProjectManager(page);

  // Find and click a project with clips
  const projectCard = page.locator('.bg-gray-800').filter({ has: page.locator('text=/\\d+ clip/i') }).first();
  await expect(projectCard).toBeVisible({ timeout: 10000 });
  await projectCard.click();

  // Wait for framing mode to fully load - the Export button appears when mode is ready
  const exportButton = page.locator('button:has-text("Export")').first();
  await expect(exportButton).toBeVisible({ timeout: 15000 });
  console.log('[Test] Framing mode loaded - Export button visible');

  // Load video if needed (framing mode may prompt for video)
  // Use short video for faster AI upscaling in tests
  const videoInput = page.locator('input[type="file"][accept*="video"]');
  if (await videoInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await videoInput.setInputFiles(TEST_VIDEO_SHORT);
    await waitForVideoFirstFrame(page);
    // Wait for video to be processed and timeline to initialize
    await page.waitForTimeout(2000);
  }

  // Wait for project context to be fully initialized
  // The Overlay button being visible indicates the project is properly loaded
  const overlayButton = page.locator('button:has-text("Overlay")');
  await expect(overlayButton).toBeVisible({ timeout: 10000 });

  // Extra wait for React context to propagate
  // This ensures selectedProjectId is set in ExportButton before we click it
  await page.waitForTimeout(2000);
  console.log('[Test] In framing mode with project loaded');
}

/**
 * Ensure working video exists for overlay mode.
 * Runs framing export if needed.
 */
async function ensureWorkingVideoExists(page) {
  // Navigate to app first so relative URLs work in page.evaluate
  const url = page.url();
  if (!url || url === 'about:blank' || !url.includes('localhost')) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  }

  // Use page.evaluate(fetch) with relative URL so it goes through Vite proxy + route interceptor
  const projects = await page.evaluate(async () => {
    const res = await fetch('/api/projects');
    return res.json();
  });
  const projectWithVideo = projects.find(p => p.working_video_path);

  if (projectWithVideo) {
    console.log(`[Test] Found project with working video: ${projectWithVideo.id}`);
    return projectWithVideo;
  }

  // No working video - need to export from framing
  // ensureFramingMode uses TEST_VIDEO_SHORT (2s) for fast AI upscaling
  console.log('[Test] No working video found, running framing export...');
  await ensureFramingMode(page);

  // Export (video is already 2s from TEST_VIDEO_SHORT)
  const exportButton = page.locator('button:has-text("Export")').first();
  await exportButton.click();
  await waitForExportComplete(page, 300000); // 5 min timeout, 30s SLA checks

  // Return updated project info
  const newProjects = await page.evaluate(async () => {
    const res = await fetch('/api/projects');
    return res.json();
  });
  return newProjects.find(p => p.working_video_path);
}

// ============================================================================
// SMOKE TESTS - Fast, parallel, first-frame only
// Run: npx playwright test --grep @smoke
// ============================================================================

test.describe('Smoke Tests @smoke', () => {
  // Run smoke tests in parallel for speed
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ request }) => {
    const health = await request.get(`${API_BASE}/health`).catch(() => null);
    if (!health?.ok()) throw new Error(`Backend not running on port ${API_PORT}`);
    if (!fs.existsSync(TEST_VIDEO)) throw new Error(`Test video not found: ${TEST_VIDEO}`);
    console.log(`[Smoke] Test user: ${TEST_USER_ID}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
    // Clear browser storage to prevent stale cached data
    await page.goto('/');
    await clearBrowserState(page);
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('Annotate: video first frame loads @smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);

    await waitForVideoFirstFrame(page);
    console.log('[Smoke] Annotate video loaded');
  });

  test('Annotate: TSV import shows clips @smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Load video first
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await waitForVideoFirstFrame(page);

    // Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);

    // Verify clips imported
    await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });
    console.log('[Smoke] TSV import successful');
  });

  test('Annotate: timeline click moves playhead @smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Load video and TSV
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await waitForVideoFirstFrame(page);

    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });

    // Get initial time
    const video = page.locator('video');
    const initialTime = await video.evaluate(v => v.currentTime);

    // Click timeline at 50%
    const timeline = page.locator('.timeline-container .bg-gray-700.cursor-pointer').first();
    await expect(timeline).toBeVisible({ timeout: 5000 });
    const box = await timeline.boundingBox();
    await timeline.click({ position: { x: box.width * 0.5, y: box.height / 2 }, force: true });

    // Wait for seek and verify
    await page.waitForFunction(
      (initial) => document.querySelector('video')?.currentTime !== initial,
      initialTime,
      { timeout: 5000 }
    );

    const newTime = await video.evaluate(v => v.currentTime);
    const duration = await video.evaluate(v => v.duration);
    expect(newTime).toBeGreaterThan(duration * 0.3);
    console.log(`[Smoke] Timeline click: ${initialTime.toFixed(1)}s → ${newTime.toFixed(1)}s`);
  });

  test('Framing: video first frame loads @smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create project
    await page.locator('button:has-text("New Project")').click();
    await page.locator('input[type="text"]').first().fill(`Smoke Test ${Date.now()}`);
    await page.locator('button:has-text("Create")').or(page.locator('button:has-text("Save")')).click();

    // Wait for framing mode
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await expect(videoInput).toBeAttached({ timeout: 10000 });
    await videoInput.setInputFiles(TEST_VIDEO);

    await waitForVideoFirstFrame(page);
    console.log('[Smoke] Framing video loaded');
  });
});

// ============================================================================
// FULL COVERAGE TESTS - Sequential, complete workflows
// Run: npx playwright test --grep @full
// ============================================================================

test.describe('Full Coverage Tests @full', () => {
  // Run full tests sequentially - they depend on shared state
  test.describe.configure({ mode: 'serial' });

  // Track if we've cleared browser state (only do it once for serial tests)
  let browserStateCleared = false;

  test.beforeAll(async ({ request }) => {
    // Reset browser state flag for each test run (important for UI mode reruns)
    browserStateCleared = false;

    const health = await request.get(`${API_BASE}/health`).catch(() => null);
    if (!health?.ok()) throw new Error(`Backend not running on port ${API_PORT}`);
    if (!fs.existsSync(TEST_VIDEO_SHORT)) throw new Error(`Short test video not found: ${TEST_VIDEO_SHORT}`);
    if (!fs.existsSync(TEST_TSV)) throw new Error(`Test TSV not found: ${TEST_TSV}`);
    console.log(`[Full] Test user: ${TEST_USER_ID}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
    // Clear browser storage once at the start of serial test suite
    // browserStateCleared is reset in beforeAll for each test run
    if (!browserStateCleared) {
      await page.goto('/');
      await clearBrowserState(page);
      browserStateCleared = true;
      console.log('[Full] Cleared browser storage (once per test suite)');
    }
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('Import Into Projects creates projects @full', async ({ page }) => {
    test.slow();

    // Go to home page (annotate mode) - don't navigate to project manager
    // Video loading happens on the home/annotate screen, not project manager
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Load SHORT video (2s) for fast AI upscaling in subsequent export tests
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO_SHORT);
    await waitForVideoFirstFrame(page);

    // Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });

    // Wait for backend upload - check for upload indicator or Import button enabled
    // The upload runs in background after video is loaded in annotate mode
    const importButton = page.locator('button:has-text("Import Into Projects")');
    const uploadingSpinner = page.locator('button:has-text("Uploading video")');

    // Wait for upload to start (button shows uploading) or already be done (button enabled)
    console.log('[Full] Waiting for video upload...');

    // Poll until Import button is enabled (upload complete)
    for (let i = 0; i < 150; i++) { // 5 min max (150 * 2s)
      const isUploading = await uploadingSpinner.isVisible({ timeout: 500 }).catch(() => false);
      const isEnabled = await importButton.isEnabled({ timeout: 500 }).catch(() => false);

      if (isEnabled && !isUploading) {
        console.log('[Full] Upload complete - Import button enabled');
        break;
      }

      if (i % 15 === 0) { // Log every 30s
        console.log(`[Full] Upload in progress... (${i * 2}s)`);
      }
      await page.waitForTimeout(2000);
    }

    await expect(importButton).toBeEnabled({ timeout: 10000 });

    // Wait for ALL video uploads to complete
    // The frontend creates multiple games and uploads videos in parallel
    // Import button may enable when first video is done, but export may use a different game
    console.log('[Full] Waiting for all video uploads to complete...');
    let allUploadsComplete = false;
    for (let i = 0; i < 60; i++) { // 60 seconds max for remaining uploads
      // Check if any "Uploading video" indicator is visible
      const stillUploading = await page.locator('text=/Uploading video/i').isVisible({ timeout: 500 }).catch(() => false);
      if (!stillUploading) {
        allUploadsComplete = true;
        console.log('[Full] All video uploads complete');
        break;
      }
      if (i % 10 === 0) {
        console.log(`[Full] Still uploading... (${i}s)`);
      }
      await page.waitForTimeout(1000);
    }

    if (!allUploadsComplete) {
      console.log('[Full] Warning: Some uploads may still be in progress');
    }

    // Extra buffer for any async operations
    await page.waitForTimeout(3000);

    // Click Import - this triggers an alert when done

    // Set up alert handler before clicking
    page.once('dialog', async dialog => {
      console.log(`[Full] Alert: ${dialog.message()}`);
      await dialog.accept();
    });

    await importButton.click();

    // Wait for navigation to project manager (alert triggers before navigation)
    await expect(page.locator('button:has-text("New Project")')).toBeVisible({ timeout: 60000 });
    console.log('[Full] Navigated to project manager');

    // Verify projects created
    // Use page.evaluate(fetch) with relative URL so it goes through Vite proxy + route interceptor
    const projects = await page.evaluate(async () => {
      const res = await fetch('/api/projects');
      return res.json();
    });
    console.log(`[Full] Created ${projects.length} projects`);
    expect(projects.length).toBeGreaterThan(0);
  });

  test('Framing: export creates working video @full', async ({ page }) => {
    test.slow();

    // Ensure we're in framing mode (creates projects if needed)
    // Uses TEST_VIDEO_SHORT (2s) for fast AI upscaling
    await ensureFramingMode(page);

    // Check initial state - Overlay button should be disabled (no working video yet)
    const overlayButton = page.locator('button:has-text("Overlay")');
    const overlayInitiallyEnabled = await overlayButton.isEnabled({ timeout: 1000 }).catch(() => false);
    if (overlayInitiallyEnabled) {
      console.log('[Full] Warning: Overlay button was already enabled - may have working video from previous run');
    }

    // Click export button to trigger FFmpeg export
    const exportButton = page.locator('button:has-text("Export")').first();
    await expect(exportButton).toBeVisible({ timeout: 10000 });
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    console.log('[Full] Clicking export button...');
    await exportButton.click();

    // Verify export actually started by waiting for button state change
    const exportingButton = page.locator('button:has-text("Exporting")');
    const loaderSpinner = page.locator('.animate-spin').first();

    // Wait up to 10 seconds for export to start
    let exportStarted = false;
    for (let i = 0; i < 20; i++) {
      if (await exportingButton.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('[Full] Export started - "Exporting" button visible');
        exportStarted = true;
        break;
      }
      if (await loaderSpinner.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('[Full] Export started - loader visible');
        exportStarted = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!exportStarted) {
      // Try clicking again in case first click didn't register
      console.log('[Full] Warning: Export may not have started, trying again...');
      await exportButton.click();
      await page.waitForTimeout(2000);
    }

    // Wait for export to complete - AI upscaling can take a while
    // maxTimeout: 5 minutes, SLA check every 30 seconds (default)
    await waitForExportComplete(page, 300000);

    // Verify export succeeded by checking if we're now in Overlay mode with a video loaded
    // The Export button triggers transition to Overlay mode upon completion
    const overlayMode = page.locator('text=/Overlay Settings/i');
    const isInOverlayMode = await overlayMode.isVisible({ timeout: 5000 }).catch(() => false);

    if (isInOverlayMode) {
      // Verify video is playing in Overlay mode
      const video = page.locator('video');
      await expect(video).toBeVisible({ timeout: 10000 });
      const duration = await video.evaluate(v => v.duration);
      expect(duration, 'Exported video must have duration').toBeGreaterThan(0);
      console.log(`[Full] Export created working video (duration: ${duration.toFixed(2)}s)`);
    } else {
      // Fallback: check database for working_video_path
      const projects = await page.evaluate(async () => {
        const res = await fetch('/api/projects');
        return res.json();
      });
      const projectWithVideo = projects.find(p => p.working_video_path);
      expect(projectWithVideo, 'Export must create a working video').toBeTruthy();
      console.log(`[Full] Working video created: ${projectWithVideo.working_video_path}`);
    }
  });

  test('Overlay: video loads after framing export @full', async ({ page }) => {
    test.slow();

    // Ensure working video exists (runs framing export if needed)
    await ensureWorkingVideoExists(page);

    // Navigate to project manager and open overlay mode
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToProjectManager(page);

    // Click on project with clips
    const projectCard = page.locator('.bg-gray-800').filter({ has: page.locator('text=/\\d+ clip/i') }).first();
    await expect(projectCard).toBeVisible({ timeout: 10000 });
    await projectCard.click();

    // Switch to overlay mode
    const overlayButton = page.locator('button:has-text("Overlay")');
    await expect(overlayButton).toBeEnabled({ timeout: 10000 });
    await overlayButton.click();

    // Verify video loads
    await waitForVideoFirstFrame(page, 30000);
    console.log('[Full] Overlay video loaded');
  });

  test('Overlay: highlight region initializes @full', async ({ page }) => {
    test.slow();

    // Ensure working video exists (runs framing export if needed)
    await ensureWorkingVideoExists(page);

    // Navigate to project manager and open overlay mode
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToProjectManager(page);

    // Navigate to overlay mode
    const projectCard = page.locator('.bg-gray-800').filter({ has: page.locator('text=/\\d+ clip/i') }).first();
    await expect(projectCard).toBeVisible({ timeout: 10000 });
    await projectCard.click();

    const overlayButton = page.locator('button:has-text("Overlay")');
    await expect(overlayButton).toBeEnabled({ timeout: 10000 });
    await overlayButton.click();

    // Wait for overlay mode to load
    await waitForVideoFirstFrame(page, 30000);

    // Check for highlight region UI elements - use specific text to avoid matching multiple elements
    const highlightUI = page.locator('text="Highlight Effect"');
    await expect(highlightUI).toBeVisible({ timeout: 5000 });
    console.log('[Full] Highlight UI visible');
  });
});
