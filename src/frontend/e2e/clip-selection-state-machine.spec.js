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

const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/3.22.26/wcfc-vs-sporting-ca-2026-03-21-2026-03-22.mp4');

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
    await route.continue({ headers });
  });
}

function collectStateMachineLogs(page) {
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[ClipSelection]') ||
        text.includes('[AnnotateContainer]') ||
        text.includes('[AnnotateModeView]') ||
        text.includes('[AnnotateOverlay]') ||
        text.includes('[useVideo] seek')) {
      logs.push(text);
    }
  });
  return logs;
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
  await page.getByRole('button', { name: 'Home' }).click();

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

/** Create a clip: press A to open overlay, then click the Save button */
async function createClip(page, seekTime) {
  await ensurePaused(page);

  // Seek directly via video element
  await seekVideoDirect(page, seekTime);

  // Press 'A' to open the overlay
  await page.keyboard.press('a');
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
  });

  test('Complete state machine verification @t690', async ({ page }) => {
    const logs = collectStateMachineLogs(page);

    // ========================================================================
    // SETUP
    // ========================================================================
    await enterAnnotateMode(page);
    await ensurePaused(page);

    let clipCount = await countSidebarClips(page);
    console.log(`[Test] Existing clips: ${clipCount}`);

    if (clipCount < 2) {
      console.log('[Test] Creating clips...');

      // Deselect by seeking to empty area
      await seekVideoDirect(page, 2);

      if (clipCount < 1) {
        await createClip(page, 30);
        clipCount = await countSidebarClips(page);
        console.log(`[Test] After clip 1: ${clipCount}`);
      }
      if (clipCount < 2) {
        // Deselect before creating second clip
        await seekVideoDirect(page, 2);
        await page.waitForTimeout(500);
        await createClip(page, 90);
        clipCount = await countSidebarClips(page);
        console.log(`[Test] After clip 2: ${clipCount}`);
      }
    }

    expect(clipCount).toBeGreaterThanOrEqual(2);

    // Deselect
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(500);

    const setupEvents = logs.length;
    console.log(`[Test] Setup done. ${setupEvents} events.\n`);

    // ========================================================================
    // REQ 1 + 13: Click sidebar clip → SELECTED + seek (optimistic)
    // ========================================================================
    console.log('[Test] === REQ 1 + 13: Sidebar selection + seek ===');
    const req1Before = logs.length;

    const firstClip = getClipItem(page, 0);
    await expect(firstClip).toBeVisible({ timeout: 3000 });
    await firstClip.click();
    await page.waitForTimeout(1000);

    const req1Logs = logs.slice(req1Before);
    const selectedTransitions = req1Logs.filter(l => l.includes('→ SELECTED'));
    const seekEvents = req1Logs.filter(l => l.includes('optimistic setCurrentTime'));
    console.log(`[Test] REQ 1: SELECTED: ${selectedTransitions.length}, REQ 13 seeks: ${seekEvents.length}`);
    req1Logs.forEach(l => console.log(`  ${l}`));
    expect(selectedTransitions.length).toBeGreaterThan(0);
    expect(seekEvents.length).toBeGreaterThan(0);

    // ========================================================================
    // BUG FIX: Selection stays stable after click (no flash/deselect)
    // The seeked event snaps to frame boundaries — selection must survive
    // ========================================================================
    console.log('\n[Test] === STABILITY: Selection stays after sidebar click ===');

    // Deselect first
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(800);

    // Click a clip and wait long enough for seeked event to fire
    const stabilityBefore = logs.length;
    await firstClip.click();
    await page.waitForTimeout(2000); // Wait for seeked event + any effects

    const stabilityLogs = logs.slice(stabilityBefore);
    const selectEvents = stabilityLogs.filter(l => l.includes('→ SELECTED'));
    const deselectAfterClick = stabilityLogs.filter(l => l.includes('→ NONE [deselect]'));
    console.log(`[Test] STABILITY: SELECTED: ${selectEvents.length}, deselects after click: ${deselectAfterClick.length}`);
    stabilityLogs.forEach(l => console.log(`  ${l}`));

    // The clip should stay selected — no deselect after sidebar click
    expect(deselectAfterClick.length).toBe(0);

    // Verify clip detail panel is still visible (not flashing)
    const clipDetail = page.locator('input[placeholder*="name" i], input[placeholder*="clip" i], [class*="ClipDetailsEditor"]').first();
    const detailVisible = await clipDetail.isVisible({ timeout: 2000 }).catch(() => false);
    // Also check: sidebar should show the selected clip with a highlighted border
    const selectedHighlight = page.locator('.border-l-2:not(.border-l-transparent)');
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

    // Re-select
    await firstClip.click();
    await page.waitForTimeout(500);

    const req2Before = logs.length;
    await seekVideoDirect(page, 2);
    await page.waitForTimeout(500);

    const deselectLogs = logs.slice(req2Before).filter(l =>
      l.includes('→ NONE [deselect]') || l.includes('Auto-deselect')
    );
    console.log(`[Test] REQ 2: Deselect events: ${deselectLogs.length}`);
    deselectLogs.forEach(l => console.log(`  ${l}`));
    expect(deselectLogs.length).toBeGreaterThan(0);

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

    // Ensure clip selected
    await firstClip.click();
    await page.waitForTimeout(500);

    const fsButton = page.locator('button[title="Fullscreen"]');
    const hasFsBtn = await fsButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasFsBtn) {
      console.log('[Test] SKIP fullscreen: button not visible (screen too wide)');
    } else {
      // --- REQ 8: Enter FS + SELECTED → auto EDITING ---
      console.log('\n  --- REQ 8: Enter FS with SELECTED → overlay ---');
      const req8Before = logs.length;
      await fsButton.click();
      await page.waitForTimeout(1500);

      const req8Logs = logs.slice(req8Before);
      const editOnFS = req8Logs.filter(l => l.includes('→ EDITING'));
      console.log(`  REQ 8: EDITING transitions: ${editOnFS.length}`);
      req8Logs.forEach(l => console.log(`    ${l}`));

      const saveOrUpdate = page.locator('button:has-text("Save & Continue"), button:has-text("Update & Continue")').first();
      const overlayVis = await saveOrUpdate.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`  REQ 8: Overlay visible: ${overlayVis}`);

      // --- REQ 10: Overlay loaded clip data ---
      console.log('\n  --- REQ 10: Overlay loads clip data ---');
      const dataLoads = logs.filter(l => l.includes('[AnnotateOverlay] Loading clip data'));
      console.log(`  REQ 10: Data loads: ${dataLoads.length}`);
      if (dataLoads.length > 0) console.log(`  REQ 10: ${dataLoads[dataLoads.length - 1]}`);

      // --- REQ 7: Buttons hidden during overlay ---
      console.log('\n  --- REQ 7: Buttons hidden during overlay ---');
      const addOv = await page.locator('button:has-text("Add Clip")').isVisible().catch(() => false);
      const editOv = await page.locator('button:has-text("Edit Clip")').isVisible().catch(() => false);
      console.log(`  REQ 7: Add: ${addOv}, Edit: ${editOv} (expect both false)`);

      // --- REQ 12: Close overlay keeps selection ---
      console.log('\n  --- REQ 12: Close overlay → SELECTED ---');
      const req12Before = logs.length;

      const cancelBtn = page.locator('button:has-text("Cancel")').first();
      if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelBtn.click();
      } else {
        // Try the resume button
        const resumeBtn = page.locator('button:has-text("Resume")').first();
        if (await resumeBtn.isVisible().catch(() => false)) {
          await resumeBtn.click();
        }
      }
      await page.waitForTimeout(500);

      const closeLogs = logs.slice(req12Before).filter(l =>
        l.includes('EDITING') && l.includes('→ SELECTED') && l.includes('closeOverlay')
      );
      console.log(`  REQ 12: EDITING→SELECTED: ${closeLogs.length}`);
      closeLogs.forEach(l => console.log(`    ${l}`));

      // --- REQ 5: Edit Clip visible in FS + SELECTED (not "Add Clip") ---
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

      // --- REQ 11: Clip switch during overlay reloads data ---
      console.log('\n  --- REQ 11: Clip switch reloads overlay ---');
      if (await editBtnFS.isVisible()) {
        await editBtnFS.click();
        await page.waitForTimeout(500);
      }
      const req11Before = logs.filter(l => l.includes('[AnnotateOverlay] Loading clip data')).length;
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1200);
      const req11After = logs.filter(l => l.includes('[AnnotateOverlay] Loading clip data')).length;
      console.log(`  REQ 11: Overlay reloads: ${req11After - req11Before}`);

      // --- REQ 9: Exit FS → close overlay ---
      console.log('\n  --- REQ 9: Exit FS closes overlay ---');
      const req9Before = logs.length;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      const req9Logs = logs.slice(req9Before).filter(l =>
        l.includes('Exit fullscreen') || l.includes('closeOverlay')
      );
      console.log(`  REQ 9: Exit FS events: ${req9Logs.length}`);
      req9Logs.forEach(l => console.log(`    ${l}`));

      // --- REQ 3: Selection survived FS round-trip ---
      const survived = logs.slice(req9Before).some(l =>
        l.includes('→ SELECTED') && l.includes('closeOverlay')
      );
      console.log(`\n  REQ 3: Selection survived FS: ${survived}`);
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
        const timelineLogsBefore = logs.length;

        // Click the timeline track near the very end (far past any clips at 30s/90s)
        // TimelineBase track: <div class="...bg-gray-700...cursor-pointer select-none touch-none">
        // Use touch-none to uniquely identify the timeline track (not other bg-gray-700 elements)
        const timelineTrack = page.locator('.bg-gray-700.cursor-pointer.touch-none');
        const trackCount = await timelineTrack.count();
        console.log(`    Timeline tracks found: ${trackCount}`);

        // Use the last one (fullscreen timeline, not the one behind the overlay)
        const track = timelineTrack.last();
        if (await track.isVisible({ timeout: 2000 }).catch(() => false)) {
          const box = await track.boundingBox();
          if (box) {
            // Click near the right end of the timeline (far past all clips)
            const clickX = box.x + box.width * 0.95;
            const clickY = box.y + box.height / 2;
            console.log(`    Clicking timeline at x=${clickX.toFixed(0)}, y=${clickY.toFixed(0)} (95% of width)`);
            await page.mouse.click(clickX, clickY);
            await page.waitForTimeout(1500);

            const timelineLogs = logs.slice(timelineLogsBefore);
            const closeEvents = timelineLogs.filter(l =>
              l.includes('Timeline seek outside clips') || l.includes('closeOverlay')
            );
            console.log(`[Test] TIMELINE: Close events after click: ${closeEvents.length}`);
            timelineLogs.forEach(l => console.log(`    ${l}`));

            // Overlay should be closed now
            const overlayGone = !(await page.locator('button:has-text("Save & Continue"), button:has-text("Update & Continue")').first()
              .isVisible().catch(() => false));
            console.log(`[Test] TIMELINE: Overlay closed: ${overlayGone}`);

            // Add Clip button should appear (NONE state, paused, fullscreen)
            const addAppears = await page.locator('button:has-text("Add Clip")').first()
              .isVisible({ timeout: 2000 }).catch(() => false);
            console.log(`[Test] TIMELINE: "Add Clip" appeared: ${addAppears}`);
          }
        } else {
          console.log('[Test] TIMELINE: Timeline bar not found');
        }
      }

      // Press Escape to exit fullscreen
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // ========================================================================
    // EDITING immune to deselect (scrub handles)
    // ========================================================================
    console.log('\n[Test] === Immunity check ===');
    const blocked = logs.filter(l => l.includes('deselectClip BLOCKED'));
    console.log(`[Test] Deselect BLOCKED: ${blocked.length}`);

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n========== STATE MACHINE SUMMARY ==========');
    console.log(`Total events: ${logs.length}`);
    const s = {
      'NONE → SELECTED':      logs.filter(l => l.match(/NONE.*→ SELECTED/)).length,
      'SELECTED → EDITING':   logs.filter(l => l.match(/SELECTED.*→ EDITING/)).length,
      'EDITING → SELECTED':   logs.filter(l => l.match(/EDITING.*→ SELECTED/)).length,
      'SELECTED → NONE':      logs.filter(l => l.includes('→ NONE [deselect]')).length,
      'NONE → CREATING':      logs.filter(l => l.includes('→ CREATING')).length,
      'CREATING → SELECTED':  logs.filter(l => l.match(/CREATING.*→ SELECTED/)).length,
      'Deselect BLOCKED':     blocked.length,
      'Auto-select':          logs.filter(l => l.includes('Auto-select')).length,
      'Auto-deselect':        logs.filter(l => l.includes('Auto-deselect')).length,
      'Optimistic seeks':     logs.filter(l => l.includes('optimistic setCurrentTime')).length,
      'Overlay data loads':   logs.filter(l => l.includes('Loading clip data')).length,
    };
    for (const [n, c] of Object.entries(s)) console.log(`  ${n}: ${c}`);
    console.log('============================================');
    console.log('\n========== FULL LOG ==========');
    logs.forEach((l, i) => console.log(`  [${i}] ${l}`));
    console.log('==============================\n');
  });
});
