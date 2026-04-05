import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Debug test: Sidebar ClipScrubRegion handle dragging
 * Diagnoses why handles clamp during drag in the sidebar.
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_scrub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

async function setupTestUserContext(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    await route.continue({ headers });
  });
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

async function enterAnnotateMode(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
  await page.locator('input[type="date"]').fill('2026-03-21');
  await page.getByRole('button', { name: 'Home' }).click();
  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(1000);
  const addBtn = page.locator('form button[type="submit"], button:has-text("Add Game")').last();
  await expect(addBtn).toBeEnabled({ timeout: 5000 });
  await addBtn.click();
  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    expect(await video.evaluate(v => !!v.src)).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });
  const uploadingButton = page.locator('button:has-text("Uploading video")');
  await page.waitForTimeout(2000);
  if (await uploadingButton.isVisible().catch(() => false)) {
    await expect(uploadingButton).toBeHidden({ timeout: 300000 });
  }

  // Bypass auth gate so Add Clip works instead of showing sign-in modal
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
}

async function ensurePaused(page) {
  await page.locator('video').first().evaluate(v => { if (!v.paused) v.pause(); });
  await page.waitForTimeout(200);
}

async function createClip(page, seekTime) {
  await ensurePaused(page);
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; }, seekTime);
  await page.waitForTimeout(800);
  // Click "Add Clip" button to open the overlay (no keyboard shortcut)
  const addClipBtn = page.locator('button:has-text("Add Clip")');
  await addClipBtn.click();
  await page.waitForTimeout(1000);
  const saveBtn = page.locator('button:has-text("Save & Continue")').first();
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

test.describe('Sidebar scrub handle debug', () => {
  test.use({ viewport: { width: 900, height: 600 } });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
    // Clear browser storage to prevent stale cached data and dismiss modals
    await page.goto('/');
    await clearBrowserState(page);
  });

  test('Drag start handle in sidebar and check logs', async ({ page }) => {
    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[ClipDetails]') || text.includes('[AutoDeselect]')) {
        logs.push(text);
      }
    });

    await enterAnnotateMode(page);
    await ensurePaused(page);

    // Import TSV to create clips (Add Clip button requires fullscreen overlay)
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await expect(tsvInput).toBeAttached({ timeout: 10000 });
    await tsvInput.setInputFiles(TEST_TSV);
    await page.waitForTimeout(2000);

    // Deselect, then select the clip to show details
    await page.locator('video').first().evaluate(v => { v.currentTime = 2; });
    await page.waitForTimeout(800);
    const clip = page.locator('.border-b.border-gray-800.cursor-pointer').first();
    await expect(clip).toBeVisible({ timeout: 5000 });
    await clip.click();
    await page.waitForTimeout(1500);

    // ClipScrubRegion handles: div.cursor-col-resize.bg-green-500
    // Within the sidebar's ClipDetailsEditor (border-t-2 wrapper)
    const detailsPanel = page.locator('.border-t-2').first();
    const handles = detailsPanel.locator('.cursor-col-resize');
    const handleCount = await handles.count();
    console.log(`[Test] Found ${handleCount} scrub handles in sidebar`);

    if (handleCount >= 2) {
      const startHandle = handles.first(); // left handle = start
      const startBox = await startHandle.boundingBox();
      console.log(`[Test] Start handle: x=${startBox.x.toFixed(0)}, y=${startBox.y.toFixed(0)}, w=${startBox.width}, h=${startBox.height}`);

      // Also find the track for reference
      const track = detailsPanel.locator('.bg-gray-800.rounded-lg').first();
      const trackBox = await track.boundingBox();
      console.log(`[Test] Track: x=${trackBox.x.toFixed(0)}, w=${trackBox.width.toFixed(0)}`);

      // Clear logs before drag
      logs.length = 0;

      // Drag start handle to the left (earlier time)
      const dragStartX = startBox.x + startBox.width / 2;
      const dragStartY = startBox.y + startBox.height / 2;
      const dragEndX = dragStartX - 50; // 50px to the left

      console.log(`[Test] Dragging start handle from x=${dragStartX.toFixed(0)} to x=${dragEndX.toFixed(0)} (50px left)`);

      await page.mouse.move(dragStartX, dragStartY);
      await page.mouse.down();
      await page.waitForTimeout(100);

      // Move in small steps to simulate real drag
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x = dragStartX + (dragEndX - dragStartX) * (i / steps);
        await page.mouse.move(x, dragStartY);
        await page.waitForTimeout(50);
      }

      await page.mouse.up();
      await page.waitForTimeout(500);

      // Print all logs
      console.log(`\n[Test] === DRAG LOGS (${logs.length} events) ===`);
      logs.forEach((l, i) => console.log(`  [${i}] ${l}`));
      console.log(`[Test] === END DRAG LOGS ===\n`);

      // Check for auto-deselect during drag
      const deselects = logs.filter(l => l.includes('[AutoDeselect]'));
      console.log(`[Test] Auto-deselects during drag: ${deselects.length}`);
      if (deselects.length > 0) {
        console.log('[Test] BUG CONFIRMED: Auto-deselect fired during sidebar scrub drag!');
      }

      // Check for scrub time changes
      const scrubChanges = logs.filter(l => l.includes('[ClipDetails]'));
      console.log(`[Test] Scrub change callbacks: ${scrubChanges.length}`);
    } else {
      console.log('[Test] Could not find scrub handles in sidebar');
      await page.screenshot({ path: '/tmp/sidebar-scrub-debug.png' });
    }
  });
});
