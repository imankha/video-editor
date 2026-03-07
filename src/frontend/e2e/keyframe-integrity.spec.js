import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * T340: Keyframe Integrity Guards - Playwright Tests
 *
 * Tests the three guards in the actual browser runtime:
 * 1. Permanent keyframe invariant (frame 0 + endFrame always exist)
 * 2. Minimum keyframe spacing (rejects overlapping keyframes)
 * 3. Selection disambiguation (closest match, not first)
 *
 * Run: npx playwright test keyframe-integrity --headed
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_kf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

async function setupTestUserContext(page) {
  const initResponse = await page.request.post(`${API_BASE}/auth/init`, {
    headers: { 'X-User-ID': TEST_USER_ID },
  });
  const { profile_id } = await initResponse.json();

  await page.setExtraHTTPHeaders({
    'X-User-ID': TEST_USER_ID,
    'X-Profile-ID': profile_id,
    'X-Test-Mode': 'true',
  });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-user-id'];
    delete headers['x-profile-id'];
    delete headers['x-test-mode'];
    await route.continue({ headers });
  });
}

async function cleanupTestData(request) {
  try {
    await request.delete(`${API_BASE}/test/cleanup/${TEST_USER_ID}`, {
      headers: { 'X-User-ID': TEST_USER_ID }
    });
  } catch { /* ignore */ }
}

test.describe('T340: Keyframe Integrity Guards', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  /**
   * Guard 1: Permanent keyframe invariant
   * Tests that RESTORE_KEYFRAMES reconstitutes missing frame 0 and endFrame
   */
  test('Guard 1: permanent keyframes reconstituted on restore', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Import and test the reducer directly in the browser
    const result = await page.evaluate(async () => {
      // Dynamic import of the controller module (Vite handles this)
      const { keyframeReducer, createInitialState, actions } = await import('/src/controllers/keyframeController.js');

      const state = createInitialState();

      // Test 1: Restore keyframes MISSING frame 0
      const savedMissingStart = [
        { frame: 10, origin: 'user', x: 120, y: 50, width: 200, height: 300 },
        { frame: 50, origin: 'user', x: 160, y: 60, width: 200, height: 300 },
        { frame: 90, origin: 'permanent', x: 200, y: 70, width: 200, height: 300 }
      ];
      const restored1 = keyframeReducer(state, actions.restoreKeyframes(savedMissingStart, 90, 30));

      // Test 2: Restore keyframes MISSING endFrame
      const savedMissingEnd = [
        { frame: 0, origin: 'permanent', x: 100, y: 50, width: 200, height: 300 },
        { frame: 60, origin: 'user', x: 180, y: 60, width: 200, height: 300 }
      ];
      const restored2 = keyframeReducer(state, actions.restoreKeyframes(savedMissingEnd, 90, 30));

      // Test 3: Restore keyframes with wrong origins at boundaries
      const savedWrongOrigins = [
        { frame: 0, origin: 'user', x: 100, y: 50, width: 200, height: 300 },
        { frame: 90, origin: 'user', x: 200, y: 70, width: 200, height: 300 }
      ];
      const restored3 = keyframeReducer(state, actions.restoreKeyframes(savedWrongOrigins, 90, 30));

      return {
        // Test 1: Missing start reconstituted
        test1_hasFrame0: restored1.keyframes[0].frame === 0,
        test1_frame0Permanent: restored1.keyframes[0].origin === 'permanent',
        test1_frame0Data: restored1.keyframes[0].x, // Should be 120 (from nearest)
        test1_count: restored1.keyframes.length, // Should be 4

        // Test 2: Missing end reconstituted
        test2_lastFrame: restored2.keyframes[restored2.keyframes.length - 1].frame,
        test2_lastPermanent: restored2.keyframes[restored2.keyframes.length - 1].origin === 'permanent',
        test2_count: restored2.keyframes.length, // Should be 3

        // Test 3: Wrong origins fixed
        test3_startOrigin: restored3.keyframes[0].origin,
        test3_endOrigin: restored3.keyframes[restored3.keyframes.length - 1].origin,
      };
    });

    // Guard 1a: Missing frame 0 is reconstituted
    expect(result.test1_hasFrame0, 'Frame 0 should be reconstituted').toBe(true);
    expect(result.test1_frame0Permanent, 'Frame 0 should be permanent').toBe(true);
    expect(result.test1_frame0Data, 'Frame 0 data from nearest keyframe').toBe(120);
    expect(result.test1_count, 'Should have 4 keyframes (0 + 3 original)').toBe(4);

    // Guard 1b: Missing endFrame is reconstituted
    expect(result.test2_lastFrame, 'Last frame should be endFrame=90').toBe(90);
    expect(result.test2_lastPermanent, 'End keyframe should be permanent').toBe(true);
    expect(result.test2_count, 'Should have 3 keyframes (2 + reconstituted end)').toBe(3);

    // Guard 1c: Wrong origins at boundaries are fixed
    expect(result.test3_startOrigin, 'Start should be permanent').toBe('permanent');
    expect(result.test3_endOrigin, 'End should be permanent').toBe('permanent');

    console.log('[T340] Guard 1 PASSED: permanent keyframes reconstituted on restore');
  });

  /**
   * Guard 2: Minimum keyframe spacing
   * Tests that new keyframes too close to existing ones are rejected or snapped
   */
  test('Guard 2: minimum keyframe spacing enforced', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { keyframeReducer, createInitialState, actions } = await import('/src/controllers/keyframeController.js');
      const { MIN_KEYFRAME_SPACING, FRAME_TOLERANCE } = await import('/src/utils/keyframeUtils.js');

      // Start with initialized state: keyframes at 0, 30, 90
      let state = createInitialState();
      state = keyframeReducer(state, actions.initialize(
        { x: 100, y: 50, width: 200, height: 300 }, 90, 30
      ));
      state = keyframeReducer(state, actions.addKeyframe(30,
        { x: 150, y: 60, width: 200, height: 300 }, 'user'
      ));

      const baseCount = state.keyframes.length; // 3: [0, 30, 90]

      // Test 1: Add at frame 33 (within FRAME_TOLERANCE=5 of 30) -> snaps to 30, updates
      const snapped = keyframeReducer(state, actions.addKeyframe(33,
        { x: 155, y: 65, width: 200, height: 300 }, 'user'
      ));

      // Test 2: Add at frame 50 (well away from 30 and 90) -> allowed
      const allowed = keyframeReducer(state, actions.addKeyframe(50,
        { x: 170, y: 70, width: 200, height: 300 }, 'user'
      ));

      // Test 3: Add at frame 86 (within FRAME_TOLERANCE of 90) -> snaps to 90
      const snappedEnd = keyframeReducer(state, actions.addKeyframe(86,
        { x: 195, y: 75, width: 200, height: 300 }, 'user'
      ));

      return {
        MIN_KEYFRAME_SPACING,
        FRAME_TOLERANCE,
        baseCount,

        // Test 1: Snapped to existing
        test1_count: snapped.keyframes.length,
        test1_frame30X: snapped.keyframes.find(kf => kf.frame === 30)?.x,

        // Test 2: New keyframe allowed
        test2_count: allowed.keyframes.length,
        test2_hasFrame50: allowed.keyframes.some(kf => kf.frame === 50),

        // Test 3: Snapped to end
        test3_count: snappedEnd.keyframes.length,
        test3_endX: snappedEnd.keyframes.find(kf => kf.frame === 90)?.x,
      };
    });

    expect(result.MIN_KEYFRAME_SPACING, 'MIN_KEYFRAME_SPACING should be 5').toBe(5);
    expect(result.FRAME_TOLERANCE, 'FRAME_TOLERANCE should be 5').toBe(5);

    // Test 1: Snapped — count unchanged, frame 30 updated
    expect(result.test1_count, 'Snap should not add new keyframe').toBe(result.baseCount);
    expect(result.test1_frame30X, 'Frame 30 should be updated to 155').toBe(155);

    // Test 2: Allowed — count increased
    expect(result.test2_count, 'Should have 4 keyframes').toBe(result.baseCount + 1);
    expect(result.test2_hasFrame50, 'Frame 50 should exist').toBe(true);

    // Test 3: Snapped to end — count unchanged
    expect(result.test3_count, 'Snap to end should not add new keyframe').toBe(result.baseCount);
    expect(result.test3_endX, 'Frame 90 should be updated to 195').toBe(195);

    console.log('[T340] Guard 2 PASSED: minimum keyframe spacing enforced');
  });

  /**
   * Guard 3: Selection disambiguation
   * Tests that findKeyframeIndexNearFrame returns closest match, not first
   */
  test('Guard 3: selection returns closest keyframe', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { findKeyframeIndexNearFrame } = await import('/src/utils/keyframeUtils.js');

      const keyframes = [
        { frame: 20 },
        { frame: 28 }
      ];

      return {
        // Frame 26 is 6 from frame 20, 2 from frame 28 — should pick index 1
        test1_index: findKeyframeIndexNearFrame(keyframes, 26, 7),

        // Frame 21 is 1 from frame 20, 7 from frame 28 — should pick index 0
        test2_index: findKeyframeIndexNearFrame(keyframes, 21, 7),

        // Frame 24 is 4 from frame 20, 4 from frame 28 — equidistant, picks first (index 0)
        test3_index: findKeyframeIndexNearFrame(keyframes, 24, 7),

        // Exact match always wins
        test4_index: findKeyframeIndexNearFrame(keyframes, 28, 7),
        test5_index: findKeyframeIndexNearFrame(keyframes, 20, 7),
      };
    });

    expect(result.test1_index, 'Frame 26 closer to 28 (index 1)').toBe(1);
    expect(result.test2_index, 'Frame 21 closer to 20 (index 0)').toBe(0);
    expect(result.test3_index, 'Frame 24 equidistant — first wins (index 0)').toBe(0);
    expect(result.test4_index, 'Exact match at 28 (index 1)').toBe(1);
    expect(result.test5_index, 'Exact match at 20 (index 0)').toBe(0);

    console.log('[T340] Guard 3 PASSED: selection returns closest keyframe');
  });

  /**
   * Integration: Full lifecycle test
   * Proves guards work together through a realistic sequence of operations
   */
  test('Integration: guards survive full keyframe lifecycle', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { keyframeReducer, createInitialState, actions, validateInvariants } = await import('/src/controllers/keyframeController.js');

      const cropData = { x: 100, y: 50, width: 200, height: 300 };

      // 1. Initialize
      let state = keyframeReducer(createInitialState(), actions.initialize(cropData, 90, 30));
      const v1 = validateInvariants(state);

      // 2. Add user keyframes
      state = keyframeReducer(state, actions.addKeyframe(30, { ...cropData, x: 150 }, 'user'));
      state = keyframeReducer(state, actions.addKeyframe(60, { ...cropData, x: 180 }, 'user'));
      const v2 = validateInvariants(state);

      // 3. Try to add overlapping keyframe (within spacing of frame 30)
      const beforeOverlap = state.keyframes.length;
      state = keyframeReducer(state, actions.addKeyframe(33, { ...cropData, x: 155 }, 'user'));
      const afterOverlap = state.keyframes.length;

      // 4. Remove a keyframe
      state = keyframeReducer(state, actions.removeKeyframe(60));
      const v4 = validateInvariants(state);

      // 5. Simulate restore with bad data (missing frame 0)
      state = keyframeReducer(state, actions.restoreKeyframes([
        { frame: 15, origin: 'user', ...cropData, x: 130 },
        { frame: 45, origin: 'user', ...cropData, x: 165 },
        { frame: 80, origin: 'user', ...cropData, x: 190 }
      ], 90, 30));
      const v5 = validateInvariants(state);

      // 6. Cleanup trim keyframes
      // First add a trim keyframe, then cleanup
      state = keyframeReducer(state, actions.addKeyframe(25, { ...cropData, x: 140 }, 'trim'));
      state = keyframeReducer(state, actions.cleanupTrimKeyframes());
      const v6 = validateInvariants(state);

      return {
        v1, v2, v4, v5, v6,
        overlapRejected: afterOverlap === beforeOverlap, // Snapped, not added
        finalFirst: state.keyframes[0],
        finalLast: state.keyframes[state.keyframes.length - 1],
        finalCount: state.keyframes.length,
      };
    });

    // Every step should have zero invariant violations
    expect(result.v1, 'After init: no violations').toEqual([]);
    expect(result.v2, 'After adds: no violations').toEqual([]);
    expect(result.v4, 'After remove: no violations').toEqual([]);
    expect(result.v5, 'After bad restore: no violations').toEqual([]);
    expect(result.v6, 'After trim cleanup: no violations').toEqual([]);

    // Overlap was handled (snapped to existing, not added as new)
    expect(result.overlapRejected, 'Overlapping keyframe snapped').toBe(true);

    // Final state has permanent boundaries
    expect(result.finalFirst.frame, 'First keyframe at frame 0').toBe(0);
    expect(result.finalFirst.origin, 'First keyframe is permanent').toBe('permanent');
    expect(result.finalLast.frame, 'Last keyframe at endFrame=90').toBe(90);
    expect(result.finalLast.origin, 'Last keyframe is permanent').toBe('permanent');

    console.log(`[T340] Integration PASSED: ${result.finalCount} keyframes, all invariants hold`);
  });
});
