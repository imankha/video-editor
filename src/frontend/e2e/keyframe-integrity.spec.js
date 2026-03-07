import { test, expect } from '@playwright/test';

/**
 * T340: Keyframe Integrity Guards - Playwright Tests
 *
 * Uses user "a" with real projects/games to test guards in the actual app.
 * Tests three guards:
 * 1. Permanent keyframe invariant (frame 0 + endFrame always exist)
 * 2. Minimum keyframe spacing (rejects overlapping keyframes)
 * 3. Selection disambiguation (closest match, not first)
 *
 * Run: npx playwright test keyframe-integrity --headed
 */

const USER_ID = 'a';
const PROFILE_ID = 'ac040a85';

async function setupUserA(page) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': USER_ID,
    'X-Profile-ID': PROFILE_ID,
  });
  // Strip custom headers from R2 presigned URL requests to avoid CORS preflight
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-user-id'];
    delete headers['x-profile-id'];
    await route.continue({ headers });
  });
}

/**
 * Navigate to framing mode for a project with working video.
 */
async function navigateToFramingProject(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Go to Projects tab
  const projectsBtn = page.locator('button:has-text("Projects")');
  await expect(projectsBtn).toBeVisible({ timeout: 10000 });
  await projectsBtn.click();
  await page.waitForTimeout(1000);

  // Click the first visible project card — user "a" has projects like "Great Touch Pass"
  const projectCard = page.locator('text="Great Touch Pass"').first();
  await expect(projectCard).toBeVisible({ timeout: 10000 });
  await projectCard.click();
  await page.waitForTimeout(2000);

  // Wait for framing mode UI — the "Framing" button or video should appear
  const framingBtn = page.locator('button:has-text("Framing")');
  await expect(framingBtn).toBeVisible({ timeout: 15000 });

  // Wait for video to appear and load
  const video = page.locator('video');
  await expect(video).toBeVisible({ timeout: 30000 });
  await video.evaluate(async (v) => {
    if (v.readyState < 2) {
      await new Promise(resolve => {
        v.addEventListener('loadeddata', resolve, { once: true });
        setTimeout(resolve, 15000);
      });
    }
  });

  // Let crop overlay initialize
  await page.waitForTimeout(2000);

  return 'Great Touch Pass';
}

test.describe('T340: Keyframe Integrity Guards', () => {
  test.beforeEach(async ({ page }) => {
    await setupUserA(page);
  });

  /**
   * Load user a's project in framing mode, then verify all three guards
   * via the actual Vite-served modules in the browser.
   */
  test('Live: all guards verified with user a project in framing mode', async ({ page }) => {
    const projectName = await navigateToFramingProject(page);
    console.log(`[T340] Loaded project: ${projectName}`);

    // Verify framing mode is active — video visible, crop overlay should exist
    await expect(page.locator('video')).toBeVisible();
    console.log('[T340] Video loaded in framing mode');

    // Screenshot: framing mode loaded
    await page.screenshot({ path: 'test-results/t340-framing-loaded.png' });

    // Run all guard tests via the actual browser-served modules
    const result = await page.evaluate(async () => {
      const { keyframeReducer, createInitialState, actions, validateInvariants } =
        await import('/src/controllers/keyframeController.js');
      const { findKeyframeIndexNearFrame, MIN_KEYFRAME_SPACING, FRAME_TOLERANCE } =
        await import('/src/utils/keyframeUtils.js');

      const cropData = { x: 100, y: 50, width: 200, height: 300 };

      // ====== Guard 1: Permanent keyframe invariant ======

      const state = createInitialState();

      // 1a: Restore with MISSING frame 0 (the bug from T330)
      const restored1 = keyframeReducer(state, actions.restoreKeyframes([
        { frame: 10, origin: 'user', ...cropData, x: 120 },
        { frame: 50, origin: 'user', ...cropData, x: 160 },
        { frame: 90, origin: 'permanent', ...cropData, x: 200 }
      ], 90, 30));

      // 1b: Restore with MISSING endFrame
      const restored2 = keyframeReducer(state, actions.restoreKeyframes([
        { frame: 0, origin: 'permanent', ...cropData },
        { frame: 60, origin: 'user', ...cropData, x: 180 }
      ], 90, 30));

      // 1c: Restore with WRONG origins at boundaries
      const restored3 = keyframeReducer(state, actions.restoreKeyframes([
        { frame: 0, origin: 'user', ...cropData },
        { frame: 90, origin: 'user', ...cropData, x: 200 }
      ], 90, 30));

      // ====== Guard 2: Minimum keyframe spacing ======

      let spacingState = keyframeReducer(createInitialState(), actions.initialize(cropData, 90, 30));
      spacingState = keyframeReducer(spacingState, actions.addKeyframe(30, { ...cropData, x: 150 }, 'user'));
      const baseCount = spacingState.keyframes.length;

      const snapped = keyframeReducer(spacingState, actions.addKeyframe(33, { ...cropData, x: 155 }, 'user'));
      const allowed = keyframeReducer(spacingState, actions.addKeyframe(50, { ...cropData, x: 170 }, 'user'));

      // ====== Guard 3: Selection disambiguation ======

      const closeKfs = [{ frame: 20 }, { frame: 28 }];

      // ====== Full lifecycle ======

      let lc = keyframeReducer(createInitialState(), actions.initialize(cropData, 90, 30));
      lc = keyframeReducer(lc, actions.addKeyframe(30, { ...cropData, x: 150 }, 'user'));
      lc = keyframeReducer(lc, actions.addKeyframe(60, { ...cropData, x: 180 }, 'user'));
      lc = keyframeReducer(lc, actions.removeKeyframe(60));
      lc = keyframeReducer(lc, actions.restoreKeyframes([
        { frame: 15, origin: 'user', ...cropData, x: 130 },
        { frame: 45, origin: 'user', ...cropData, x: 165 },
        { frame: 80, origin: 'user', ...cropData, x: 190 }
      ], 90, 30));
      lc = keyframeReducer(lc, actions.addKeyframe(25, { ...cropData, x: 140 }, 'trim'));
      lc = keyframeReducer(lc, actions.cleanupTrimKeyframes());

      return {
        // Guard 1
        g1a_frame0: restored1.keyframes[0].frame,
        g1a_origin: restored1.keyframes[0].origin,
        g1a_x: restored1.keyframes[0].x,
        g1a_count: restored1.keyframes.length,
        g1a_v: validateInvariants(restored1),
        g1b_end: restored2.keyframes[restored2.keyframes.length - 1].frame,
        g1b_origin: restored2.keyframes[restored2.keyframes.length - 1].origin,
        g1b_v: validateInvariants(restored2),
        g1c_startOrigin: restored3.keyframes[0].origin,
        g1c_endOrigin: restored3.keyframes[restored3.keyframes.length - 1].origin,

        // Guard 2
        MIN_KEYFRAME_SPACING, FRAME_TOLERANCE,
        g2_baseCount: baseCount,
        g2_snappedCount: snapped.keyframes.length,
        g2_snappedX: snapped.keyframes.find(kf => kf.frame === 30)?.x,
        g2_allowedCount: allowed.keyframes.length,

        // Guard 3
        g3_closest: findKeyframeIndexNearFrame(closeKfs, 26, 7),
        g3_first: findKeyframeIndexNearFrame(closeKfs, 21, 7),
        g3_exact: findKeyframeIndexNearFrame(closeKfs, 28, 7),

        // Lifecycle
        lc_first: lc.keyframes[0],
        lc_last: lc.keyframes[lc.keyframes.length - 1],
        lc_v: validateInvariants(lc),
        lc_count: lc.keyframes.length,
      };
    });

    // === Guard 1: Permanent keyframe invariant ===
    expect(result.g1a_frame0, 'Missing frame 0 reconstituted').toBe(0);
    expect(result.g1a_origin, 'Frame 0 is permanent').toBe('permanent');
    expect(result.g1a_x, 'Frame 0 data from nearest').toBe(120);
    expect(result.g1a_count, '4 keyframes after reconstitution').toBe(4);
    expect(result.g1a_v, 'Zero violations').toEqual([]);
    expect(result.g1b_end, 'Missing endFrame reconstituted').toBe(90);
    expect(result.g1b_origin, 'End is permanent').toBe('permanent');
    expect(result.g1b_v, 'Zero violations').toEqual([]);
    expect(result.g1c_startOrigin, 'Wrong origin fixed at start').toBe('permanent');
    expect(result.g1c_endOrigin, 'Wrong origin fixed at end').toBe('permanent');
    console.log('[T340] Guard 1 PASSED: permanent keyframes reconstituted on restore');

    // === Guard 2: Minimum keyframe spacing ===
    expect(result.MIN_KEYFRAME_SPACING).toBe(10);
    expect(result.g2_snappedCount, 'Snap keeps count').toBe(result.g2_baseCount);
    expect(result.g2_snappedX, 'Snap updates data').toBe(155);
    expect(result.g2_allowedCount, 'Distant add works').toBe(result.g2_baseCount + 1);
    console.log('[T340] Guard 2 PASSED: minimum keyframe spacing enforced');

    // === Guard 3: Selection disambiguation ===
    expect(result.g3_closest, 'Picks closer keyframe').toBe(1);
    expect(result.g3_first, 'Picks first when closer').toBe(0);
    expect(result.g3_exact, 'Exact match wins').toBe(1);
    console.log('[T340] Guard 3 PASSED: selection returns closest keyframe');

    // === Lifecycle ===
    expect(result.lc_first.frame).toBe(0);
    expect(result.lc_first.origin).toBe('permanent');
    expect(result.lc_last.frame).toBe(90);
    expect(result.lc_last.origin).toBe('permanent');
    expect(result.lc_v).toEqual([]);
    console.log(`[T340] Lifecycle PASSED: ${result.lc_count} keyframes, all invariants hold`);

    // Final screenshot
    await page.screenshot({ path: 'test-results/t340-guards-verified.png' });
  });
});
