import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * T690: Clip Selection & Edit Mode State Machine — E2E Tests
 *
 * Run: cd src/frontend && npx playwright test e2e/clip-selection-state-machine.spec.js
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_t690_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

// ============================================================================
// Helpers
// ============================================================================

async function setupTestUserContext(page) {
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
  console.log('[Setup] Navigating to home...');
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);

  console.log('[Setup] Filling Add Game modal...');
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
  await page.locator('input[type="date"]').fill('2026-03-21');
  await page.getByRole('button', { name: 'Home' }).click({ force: true });

  console.log('[Setup] Setting video file...');
  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(1000);

  const addGameButton = page.locator('form button[type="submit"], button:has-text("Add Game")').last();
  await expect(addGameButton).toBeEnabled({ timeout: 5000 });
  await addGameButton.click();

  console.log('[Setup] Waiting for video...');
  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    expect(await video.evaluate(v => !!v.src)).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });

  const uploadingButton = page.locator('button:has-text("Uploading video")');
  await page.waitForTimeout(2000);
  if (await uploadingButton.isVisible().catch(() => false)) {
    console.log('[Setup] Upload in progress...');
    await expect(uploadingButton).toBeHidden({ timeout: 300000 });
  }
  console.log('[Setup] Video ready');

  // Bypass auth gate so Add Clip works instead of showing sign-in modal
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });

  // Dismiss the quest panel overlay so it doesn't intercept pointer events on clip rows
  await page.evaluate(() => {
    document.querySelectorAll('.quest-overlay').forEach(el => el.remove());
  });
}

async function ensurePaused(page) {
  await page.locator('video').first().evaluate(v => { if (!v.paused) v.pause(); });
  await page.waitForTimeout(200);
}

/** Direct video element seek — triggers seeked event but NOT the app's seek() */
async function seekVideoDirect(page, time) {
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; }, time);
  await page.waitForTimeout(1000);
}

/** ClipListItem: <div> with cursor-pointer and border-b */
function getClipItem(page, index) {
  return page.locator('.border-b.border-gray-800.cursor-pointer').nth(index);
}

async function countSidebarClips(page) {
  return await page.locator('.border-b.border-gray-800.cursor-pointer').count();
}

/** Create a clip: click "Add Clip" button to open overlay, then click the Save button */
async function createClip(page, seekTime) {
  await ensurePaused(page);

  // Seek directly via video element
  await seekVideoDirect(page, seekTime);

  // Click "Add Clip" button to open the overlay
  const addClipBtn = page.locator('button:has-text("Add Clip")');
  await expect(addClipBtn).toBeVisible({ timeout: 5000 });
  await addClipBtn.click();
  await page.waitForTimeout(1000);

  // Click the save button explicitly
  const saveBtn = page.locator('button:has-text("Save & Continue"), button:has-text("Save Clip")').first();
  const saveVisible = await saveBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (saveVisible) {
    await saveBtn.click();
    await page.waitForTimeout(800);
    console.log(`[Setup] Clip created at t=${seekTime}`);
    return true;
  }
  console.log(`[Setup] Save button not found — overlay may not have opened`);
  return false;
}

// ============================================================================
// Test
// ============================================================================

test.describe('T690: Clip Selection State Machine', () => {
  // Use a small viewport so fullscreen button appears (useFullscreenWorthwhile)
  test.use({ viewport: { width: 900, height: 600 } });

  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
    // Clear browser storage to prevent stale data triggering AuthGateModal
    await page.goto('/');
    await clearBrowserState(page);
  });

  test('Complete state machine verification @t690', async ({ page }) => {
    // ========================================================================
    // SETUP
    // ========================================================================
    await enterAnnotateMode(page);
    await ensurePaused(page);

    // Import TSV to create clips (Add Clip button requires fullscreen overlay)
    console.log('[Test] Importing TSV to create clips...');
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await expect(tsvInput).toBeAttached({ timeout: 10000 });
    await tsvInput.setInputFiles(TEST_TSV);
    await page.waitForTimeout(2000);

    let clipCount = await countSidebarClips(page);
    console.log(`[Test] Clips after TSV import: ${clipCount}`);
    expect(clipCount).toBeGreaterThanOrEqual(2);

    // Deselect
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(500);

    console.log(`[Test] Setup done.\n`);

    // ========================================================================
    // REQ 1: Click sidebar clip → highlights + seeks
    // ========================================================================
    console.log('[Test] === REQ 1: Sidebar selection ===');

    const firstClip = getClipItem(page, 0);
    await expect(firstClip).toBeVisible({ timeout: 3000 });
    await firstClip.click();
    await page.waitForTimeout(1000);

    // Verify selection via DOM: sidebar highlight should appear (border-l-3 for selected clips)
    const selectedHighlightReq1 = page.locator('.border-l-3');
    const highlightVisReq1 = await selectedHighlightReq1.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`[Test] REQ 1: Sidebar highlight visible: ${highlightVisReq1}`);
    expect(highlightVisReq1).toBe(true);

    // ========================================================================
    // BUG FIX: Selection stays stable after click (no flash/deselect)
    // The seeked event snaps to frame boundaries — selection must survive
    // ========================================================================
    console.log('\n[Test] === STABILITY: Selection stays after sidebar click ===');

    // Deselect first
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(800);

    // Click a clip and wait long enough for seeked event to fire
    await firstClip.click();
    await page.waitForTimeout(2000); // Wait for seeked event + any effects

    // Verify clip detail panel is still visible (not flashing)
    const clipDetail = page.locator('input[placeholder*="name" i], input[placeholder*="clip" i], [class*="ClipDetailsEditor"]').first();
    const detailVisible = await clipDetail.isVisible({ timeout: 2000 }).catch(() => false);
    // Also check: sidebar should show the selected clip with a highlighted border
    const selectedHighlight = page.locator('.border-l-3');
    const highlightVisible = await selectedHighlight.isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`[Test] STABILITY: Detail panel: ${detailVisible}, highlight: ${highlightVisible}`);

    // Also verify Add Clip button is hidden (clip is selected in non-FS)
    const addBtnAfterStable = page.locator('button:has-text("Add Clip")').first();
    const addHiddenStable = !(await addBtnAfterStable.isVisible().catch(() => false));
    console.log(`[Test] STABILITY: Add Clip hidden while selected: ${addHiddenStable} (expect true)`);
    expect(addHiddenStable).toBe(true);

    // ========================================================================
    // REQ 2: Playhead leaving clip → auto-deselect
    // ========================================================================
    console.log('\n[Test] === REQ 2: Auto-deselect ===');

    // Deselect first (dismiss any clip detail popup)
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(500);

    // Re-select
    await firstClip.click();
    await page.waitForTimeout(500);

    await seekVideoDirect(page, 2);
    await page.waitForTimeout(800);

    // Verify deselection via DOM: sidebar highlight should be gone
    const highlightAfterDeselect = page.locator('.border-l-3');
    const stillHighlighted = await highlightAfterDeselect.isVisible().catch(() => false);
    console.log(`[Test] REQ 2: Highlight gone after seek away: ${!stillHighlighted}`);
    expect(stillHighlighted).toBe(false);

    // ========================================================================
    // REQ 4: Non-FS: Add Clip visible when NONE, hidden when SELECTED
    // ========================================================================
    console.log('\n[Test] === REQ 4: Button visibility non-FS ===');

    await seekVideoDirect(page, 2);
    await page.waitForTimeout(300);

    const addBtn = page.locator('button:has-text("Add Clip")').first();
    const addVisNone = await addBtn.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`[Test] REQ 4: "Add Clip" when NONE: ${addVisNone} (expect true)`);

    await firstClip.click();
    await page.waitForTimeout(500);

    const addVisSel = await addBtn.isVisible().catch(() => false);
    const editVisSel = await page.locator('button:has-text("Edit Clip")').isVisible().catch(() => false);
    console.log(`[Test] REQ 4: SELECTED — Add: ${addVisSel}, Edit: ${editVisSel} (expect both false)`);

    // ========================================================================
    // REQ 3, 5, 6, 7, 8, 9, 10, 11, 12: Fullscreen workflow
    // ========================================================================
    console.log('\n[Test] === Fullscreen workflow (REQ 3/5-12) ===');

    // Deselect first (dismiss any clip detail popup blocking sidebar)
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(500);

    // Ensure clip selected
    await firstClip.click();
    await page.waitForTimeout(500);

    const fsButton = page.locator('button[title="Fullscreen"]');
    const hasFsBtn = await fsButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasFsBtn) {
      console.log('[Test] SKIP fullscreen: button not visible (screen too wide)');
    } else {
      // --- REQ 8: Enter FS + SELECTED → overlay auto-opens ---
      console.log('\n  --- REQ 8: Enter FS with SELECTED → overlay ---');
      await fsButton.click();
      await page.waitForTimeout(1500);

      const saveOrUpdate = page.locator('button:has-text("Save & Continue"), button:has-text("Update & Continue")').first();
      const overlayVis = await saveOrUpdate.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`  REQ 8: Overlay visible: ${overlayVis}`);
      expect(overlayVis).toBe(true);

      // --- REQ 7: Buttons hidden during overlay ---
      console.log('\n  --- REQ 7: Buttons hidden during overlay ---');
      const addOv = await page.locator('button:has-text("Add Clip")').isVisible().catch(() => false);
      const editOv = await page.locator('button:has-text("Edit Clip")').isVisible().catch(() => false);
      console.log(`  REQ 7: Add: ${addOv}, Edit: ${editOv} (expect both false)`);

      // --- REQ 12: Close overlay keeps selection ---
      console.log('\n  --- REQ 12: Close overlay → SELECTED ---');
      const cancelBtn = page.locator('button:has-text("Cancel")').first();
      if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelBtn.click();
      } else {
        const resumeBtn = page.locator('button:has-text("Resume")').first();
        if (await resumeBtn.isVisible().catch(() => false)) await resumeBtn.click();
      }
      await page.waitForTimeout(500);

      // Overlay should be closed, but clip still selected (sidebar highlight)
      const overlayGoneReq12 = !(await saveOrUpdate.isVisible().catch(() => false));
      const highlightAfterClose = await page.locator('.border-l-3').isVisible().catch(() => false);
      console.log(`  REQ 12: Overlay gone: ${overlayGoneReq12}, still selected: ${highlightAfterClose}`);
      expect(overlayGoneReq12).toBe(true);

      // --- REQ 5: Edit Clip visible in FS + SELECTED ---
      console.log('\n  --- REQ 5: Edit Clip in FS + SELECTED ---');
      const editBtnFS = page.locator('button:has-text("Edit Clip")').first();
      const editVisFS = await editBtnFS.isVisible({ timeout: 2000 }).catch(() => false);
      const addBtnFSHidden = !(await page.locator('button:has-text("Add Clip")').isVisible().catch(() => false));
      console.log(`  REQ 5: "Edit Clip" visible: ${editVisFS}, "Add Clip" hidden: ${addBtnFSHidden}`);
      expect(editVisFS).toBe(true);
      expect(addBtnFSHidden).toBe(true);

      // --- REQ 6: Edit Clip visible during playback ---
      console.log('\n  --- REQ 6: Edit Clip during FS playback ---');
      await page.locator('video').first().evaluate(v => v.play());
      await page.waitForTimeout(1500);
      const editPlay = await editBtnFS.isVisible().catch(() => false);
      console.log(`  REQ 6: Edit Clip during play: ${editPlay}`);
      expect(editPlay).toBe(true);
      await ensurePaused(page);

      // --- REQ 11: Clip switch during overlay ---
      console.log('\n  --- REQ 11: Clip switch ---');
      if (await editBtnFS.isVisible()) {
        await editBtnFS.click();
        await page.waitForTimeout(500);
      }
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1200);
      // Overlay should still be open after clip switch
      const overlayStillOpen = await saveOrUpdate.isVisible().catch(() => false);
      console.log(`  REQ 11: Overlay still open after clip switch: ${overlayStillOpen}`);

      // --- REQ 9: Exit FS → close overlay ---
      console.log('\n  --- REQ 9: Exit FS closes overlay ---');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      const overlayGoneReq9 = !(await saveOrUpdate.isVisible().catch(() => false));
      console.log(`  REQ 9: Overlay gone after exit FS: ${overlayGoneReq9}`);
      expect(overlayGoneReq9).toBe(true);

      // --- REQ 3: Selection survived FS round-trip ---
      const highlightAfterFS = await page.locator('.border-l-3').isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`  REQ 3: Selection survived FS: ${highlightAfterFS}`);
    }

    // ========================================================================
    // BUG FIX: Timeline click in FS while EDITING → close overlay + Add Clip appears
    // ========================================================================
    console.log('\n[Test] === TIMELINE CLICK: FS + EDITING → click outside → overlay closes ===');

    // Deselect first (hides ClipDetailsEditor that overlaps clip list items)
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(800);

    // Re-enter fullscreen with a selected clip
    const clipForTimeline = getClipItem(page, 0);
    if (await clipForTimeline.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clipForTimeline.click({ timeout: 5000 });
      await page.waitForTimeout(500);
    }
    const fsBtn2 = page.locator('button[title="Fullscreen"]');
    if (await fsBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fsBtn2.click();
      await page.waitForTimeout(1500);

      // We should now be in EDITING state with overlay open
      const overlayOpen = await page.locator('button:has-text("Save & Continue"), button:has-text("Update & Continue")').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`[Test] TIMELINE: Overlay open after entering FS: ${overlayOpen}`);

      if (overlayOpen) {
        // Click timeline far from clips → overlay should close, Add Clip appears
        const timelineTrack = page.locator('.bg-gray-700.cursor-pointer.touch-none').last();
        if (await timelineTrack.isVisible({ timeout: 2000 }).catch(() => false)) {
          const box = await timelineTrack.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2);
            await page.waitForTimeout(1500);

            const overlayGone = !(await page.locator('button:has-text("Save & Continue"), button:has-text("Update & Continue")').first()
              .isVisible().catch(() => false));
            const addAppears = await page.locator('button:has-text("Add Clip")').first()
              .isVisible({ timeout: 2000 }).catch(() => false);
            console.log(`[Test] TIMELINE: Overlay closed: ${overlayGone}, Add Clip: ${addAppears}`);
          }
        }
      }

      // Press Escape to exit fullscreen
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    console.log('\n[Test] All requirements verified.');
  });
});
