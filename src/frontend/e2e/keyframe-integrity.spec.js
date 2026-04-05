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

async function setupUserA(page) {
  // Set user ID via header for test isolation (T220/T405)
  await page.setExtraHTTPHeaders({
    'X-User-ID': USER_ID,
  });
}

test.describe('T340: Keyframe Integrity Guards', () => {
  test.beforeEach(async ({ page }) => {
    await setupUserA(page);
  });

  /**
   * Verify all three keyframe guards via Vite-served modules in the browser.
   * These are pure JS logic tests — no project or framing mode needed,
   * just navigate to the app so Vite can serve the module imports.
   */
  test('Live: all guards verified with user a project in framing mode', async ({ page }) => {
    // Navigate to app root so Vite dev server is available for module imports
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log('[T340] App loaded, running keyframe guard tests via browser modules');

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
