import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * Keyframe Integrity Guards — flat-list model (re-pinned by T6050, 2026-07-27).
 *
 * WHAT THIS GUARDS
 * ----------------
 * The crop-keyframe data model has produced two real corruption incidents:
 *   - T350: origin corruption from reactive persistence (runtime fixups written back).
 *   - The keyframe identity divergence healed by profile_db v014 (display snapped,
 *     persistence sent the raw frame -> near-duplicate keyframes accumulated).
 * This spec is the standing alarm for that class. It exercises the REAL browser-served
 * controller + utils modules (imported straight from the Vite dev server) so a drift
 * in the shipped logic — not just a unit fixture — trips it.
 *
 * HISTORY: this file used to encode the T340-era "permanent boundary" model, where
 * RESTORE reconstituted a permanent frame-0 keyframe from the nearest one and frame 0 /
 * endFrame were protected boundaries. That model was removed ~2026-06-21. The keyframe
 * list is now a FLAT LIST WITH NO PERMANENT BOUNDARIES: any keyframe is deletable
 * (including the first), an empty list means a centered crop, and trim boundaries are
 * virtual. T6050 re-derived the invariants of the flat-list model and re-pinned each
 * assertion. Per-assertion disposition (re-pinned to which invariant, or retired with
 * the old model) is inline at each block below and summarized here:
 *
 *   OLD ASSERTION                              -> DISPOSITION
 *   g1a_frame0 === 0 (reconstitute frame 0)    -> RETIRED. Restore no longer manufactures
 *                                                 a frame-0 boundary. Replaced by INV-1
 *                                                 (restore round-trips exactly, no
 *                                                 manufactured entries).
 *   g1a_origin === 'permanent'                 -> RETIRED. New/restored keyframes are never
 *                                                 'permanent'. Replaced by INV-2 (origins
 *                                                 normalized to 'user'/'trim').
 *   g1a_x === 120 (frame-0 data from nearest)  -> RETIRED with the reconstitution logic.
 *   g1a_count === 3 (reconstitution + dedup)   -> RETIRED. Replaced by INV-1 exact round-trip
 *                                                 count + INV-3 (redundant-duplicate collapse).
 *   g1b_end (end derived from last keyframe)   -> RE-PINNED into INV-1: the last keyframe is
 *                                                 preserved as-is; there is no managed end.
 *   g1b_origin === 'permanent'                 -> RETIRED -> INV-2.
 *   g1c start/end origin === 'permanent'       -> RETIRED -> INV-2.
 *   g2_* (min spacing + snap-to-update)        -> RE-PINNED VERBATIM (INV-6): still a live
 *                                                 invariant.
 *   g3_* (selection disambiguation)            -> RE-PINNED VERBATIM (INV-7): still the
 *                                                 identity-selection primitive.
 *   lc_first.frame === 0 / origin permanent    -> RETIRED. Replaced by INV-8 (lifecycle keeps
 *   lc_last.frame === 80 / origin permanent       validateInvariants clean; trim cleanup works;
 *                                                 no manufactured boundaries).
 *
 * NEW invariants with no T340 predecessor (the flat-list model's own rules):
 *   INV-3 dedup is spatial-identity-based, never proximity-based (distinct near-edge survives).
 *   INV-4 empty list is a legal state (INITIALIZE seeds zero; empty restore is a no-op).
 *   INV-5 any keyframe is deletable, including the first and the last remaining one.
 *
 * KNOWN LATENT BUG surfaced while re-deriving (reported by T6050, NOT fixed here — spec-only
 * task): removeBoundaryDuplicates compares keyframes[0] against ITSELF, so a restored FIRST
 * keyframe at frame 1..29 with no other duplicate is silently dropped (data loss on restore).
 * INV-1 deliberately uses a first keyframe at frame 35 (> the 30-frame edge window) so it
 * round-trips honestly; INV-3's distinct-near-edge case pins the safe boundary of the dedup.
 * See .claude/knowledge/keyframes-framing.md for the follow-up.
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

test.describe('Keyframe integrity — flat-list model', () => {
  test.beforeEach(async ({ page }) => {
    await setupUserA(page);
  });

  /**
   * Verify the flat-list invariants against the Vite-served modules in the browser.
   * Pure JS logic — no project or framing mode needed, just navigate so Vite can serve
   * the /src module imports.
   */
  test('restore/spacing/identity/delete invariants hold for the flat-list model', async ({ page }) => {
    // This test import()s /src/controllers/keyframeController.js + /src/utils/keyframeUtils.js
    // straight from the Vite dev server. Those source paths exist only under `npm run dev`;
    // on a deployed CF Pages BUILD the code is bundled/hashed, so the import 404s. Skip
    // loudly on a deployed target (the same logic is also covered by Vitest). A "pass" on
    // staging means it SKIPPED — run locally with the dev stack up. See helpers/targetEnv.js.
    skipOnDeployedTarget(test, 'import()s /src Vite-dev module paths that do not exist on a deployed build');

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    console.log('[keyframe-integrity] App loaded, running flat-list invariant checks via browser modules');

    const result = await page.evaluate(async () => {
      const { keyframeReducer, createInitialState, actions, validateInvariants } =
        await import('/src/controllers/keyframeController.js');
      const { findKeyframeIndexNearFrame, resolveTargetFrame, MIN_KEYFRAME_SPACING, FRAME_TOLERANCE } =
        await import('/src/utils/keyframeUtils.js');

      const crop = { x: 100, y: 50, width: 200, height: 300 };
      const s = createInitialState();
      const framesOf = (st) => st.keyframes.map((kf) => kf.frame);
      const originsOf = (st) => st.keyframes.map((kf) => kf.origin);

      // ===== INV-1: restore round-trips exactly — NO manufactured entries =====
      // First keyframe is at frame 35 (deliberately NOT frame 0, and > the 30-frame edge
      // window) to prove restore does NOT reconstitute a frame-0 boundary and does NOT
      // drop the real first keyframe. Distinct crop data per keyframe so nothing is a
      // redundant duplicate.
      const inv1 = keyframeReducer(s, actions.restoreKeyframes([
        { frame: 35, origin: 'user', ...crop, x: 120 },
        { frame: 60, origin: 'user', ...crop, x: 160 },
        { frame: 90, origin: 'user', ...crop, x: 200 },
      ]));

      // ===== INV-2: origin normalization ('permanent' legacy -> 'user'; 'trim' preserved) =====
      const inv2 = keyframeReducer(s, actions.restoreKeyframes([
        { frame: 0, origin: 'permanent', ...crop, x: 100 },
        { frame: 45, origin: 'trim', ...crop, x: 130 },
        { frame: 90, origin: 'user', ...crop, x: 200 },
      ]));

      // ===== INV-3: dedup is spatial-identity-based, never proximity-based =====
      // 3a: a REDUNDANT near-boundary keyframe (identical crop to the boundary) collapses —
      //     cosmetic, output-preserving (interpolation between two identical points is a no-op).
      const inv3a = keyframeReducer(s, actions.restoreKeyframes([
        { frame: 0, origin: 'user', ...crop, x: 100 },
        { frame: 5, origin: 'user', ...crop, x: 100 }, // identical to frame 0, within edge window
        { frame: 45, origin: 'user', ...crop, x: 160 },
        { frame: 90, origin: 'user', ...crop, x: 200 },
      ]));
      // 3b: a DISTINCT near-boundary keyframe SURVIVES — proximity alone must never drop data.
      const inv3b = keyframeReducer(s, actions.restoreKeyframes([
        { frame: 0, origin: 'user', ...crop, x: 100 },
        { frame: 5, origin: 'user', ...crop, x: 999 }, // distinct crop -> real data, must survive
        { frame: 45, origin: 'user', ...crop, x: 160 },
        { frame: 90, origin: 'user', ...crop, x: 200 },
      ]));

      // ===== INV-4: empty list is a legal state =====
      const inv4_init = keyframeReducer(createInitialState(), actions.initialize(crop, 90));
      const inv4_emptyRestore = keyframeReducer(inv4_init, actions.restoreKeyframes([]));

      // ===== INV-5: any keyframe deletable, including the first and the last remaining =====
      let del = keyframeReducer(createInitialState(), actions.initialize(crop, 90));
      del = keyframeReducer(del, actions.addKeyframe(0, { ...crop, x: 100 }, 'user'));
      del = keyframeReducer(del, actions.addKeyframe(30, { ...crop, x: 150 }, 'user'));
      del = keyframeReducer(del, actions.addKeyframe(60, { ...crop, x: 180 }, 'user'));
      const delBefore = framesOf(del);
      del = keyframeReducer(del, actions.removeKeyframe(0)); // delete the FIRST keyframe
      const delAfterFirst = framesOf(del);
      let delOnly = keyframeReducer(createInitialState(), actions.addKeyframe(30, { ...crop, x: 1 }, 'user'));
      delOnly = keyframeReducer(delOnly, actions.removeKeyframe(30)); // delete the last remaining
      const delOnlyCount = delOnly.keyframes.length;

      // ===== INV-6: minimum spacing + snap-to-update (re-pinned from old Guard 2) =====
      let sp = keyframeReducer(createInitialState(), actions.initialize(crop, 90));
      sp = keyframeReducer(sp, actions.addKeyframe(30, { ...crop, x: 150 }, 'user'));
      const g2_baseCount = sp.keyframes.length;
      const snapped = keyframeReducer(sp, actions.addKeyframe(33, { ...crop, x: 155 }, 'user'));
      const allowed = keyframeReducer(sp, actions.addKeyframe(50, { ...crop, x: 170 }, 'user'));

      // ===== INV-7: identity SSOT — resolveTargetFrame arbitrates, reducer agrees =====
      const closeKfs = [{ frame: 20 }, { frame: 28 }];
      // reducer agreement: an edit at 23 (within tolerance of 20) must SNAP to 20,
      // not create a new frame-23 keyframe — the identity-divergence guard (v014 class).
      let idn = keyframeReducer(createInitialState(), actions.addKeyframe(20, { ...crop, x: 111 }, 'user'));
      idn = keyframeReducer(idn, actions.addKeyframe(60, { ...crop, x: 222 }, 'user'));
      const idnSnap = keyframeReducer(idn, actions.addKeyframe(23, { ...crop, x: 333 }, 'user'));

      // ===== INV-8: full lifecycle keeps invariants; trim cleanup works; no manufactured boundaries =====
      let lc = keyframeReducer(createInitialState(), actions.initialize(crop, 90));
      lc = keyframeReducer(lc, actions.addKeyframe(30, { ...crop, x: 150 }, 'user'));
      lc = keyframeReducer(lc, actions.addKeyframe(60, { ...crop, x: 180 }, 'user'));
      lc = keyframeReducer(lc, actions.removeKeyframe(60));
      lc = keyframeReducer(lc, actions.restoreKeyframes([
        { frame: 35, origin: 'user', ...crop, x: 130 },
        { frame: 60, origin: 'user', ...crop, x: 165 },
        { frame: 88, origin: 'user', ...crop, x: 190 },
      ]));
      lc = keyframeReducer(lc, actions.addKeyframe(20, { ...crop, x: 140 }, 'trim'));
      const lcBeforeCleanup = framesOf(lc);
      lc = keyframeReducer(lc, actions.cleanupTrimKeyframes());

      return {
        // INV-1
        inv1_frames: framesOf(inv1),
        inv1_origins: originsOf(inv1),
        inv1_xs: inv1.keyframes.map((kf) => kf.x),
        inv1_hasFrame0: inv1.keyframes.some((kf) => kf.frame === 0),
        inv1_v: validateInvariants(inv1),

        // INV-2
        inv2_frames: framesOf(inv2),
        inv2_origins: originsOf(inv2),

        // INV-3
        inv3a_frames: framesOf(inv3a),
        inv3b_frames: framesOf(inv3b),
        inv3b_x5: inv3b.keyframes.find((kf) => kf.frame === 5)?.x,

        // INV-4
        inv4_initCount: inv4_init.keyframes.length,
        inv4_initState: inv4_init.machineState,
        inv4_emptyRestoreCount: inv4_emptyRestore.keyframes.length,

        // INV-5
        del_before: delBefore,
        del_afterFirst: delAfterFirst,
        del_onlyCount: delOnlyCount,

        // INV-6
        MIN_KEYFRAME_SPACING, FRAME_TOLERANCE,
        g2_baseCount,
        g2_snappedCount: snapped.keyframes.length,
        g2_snappedX: snapped.keyframes.find((kf) => kf.frame === 30)?.x,
        g2_allowedCount: allowed.keyframes.length,

        // INV-7
        g3_closest: findKeyframeIndexNearFrame(closeKfs, 26, 7),
        g3_first: findKeyframeIndexNearFrame(closeKfs, 21, 7),
        g3_exact: findKeyframeIndexNearFrame(closeKfs, 28, 7),
        rtf_snap: resolveTargetFrame([{ frame: 20 }, { frame: 60 }], 23),
        rtf_new: resolveTargetFrame([{ frame: 20 }, { frame: 60 }], 100),
        idn_frames: framesOf(idnSnap),
        idn_x20: idnSnap.keyframes.find((kf) => kf.frame === 20)?.x,

        // INV-8
        lc_beforeCleanup: lcBeforeCleanup,
        lc_frames: framesOf(lc),
        lc_origins: originsOf(lc),
        lc_hasFrame0: lc.keyframes.some((kf) => kf.frame === 0),
        lc_v: validateInvariants(lc),
      };
    });

    // ===== INV-1: restore round-trips exactly, no manufactured entries =====
    expect(result.inv1_frames, 'Restore preserves the exact frames — no manufactured frame-0').toEqual([35, 60, 90]);
    expect(result.inv1_hasFrame0, 'Restore does NOT reconstitute a frame-0 boundary').toBe(false);
    expect(result.inv1_xs, 'Crop data round-trips unchanged').toEqual([120, 160, 200]);
    expect(result.inv1_origins, 'No keyframe is manufactured as permanent').toEqual(['user', 'user', 'user']);
    expect(result.inv1_v, 'Restored list satisfies validateInvariants').toEqual([]);
    console.log('[keyframe-integrity] INV-1 PASSED: restore round-trips exactly, no manufactured entries');

    // ===== INV-2: origin normalization =====
    // 'permanent' is legacy residue — restore normalizes it to 'user'; 'trim' is preserved.
    expect(result.inv2_frames, 'Restore preserves all frames').toEqual([0, 45, 90]);
    expect(result.inv2_origins, "'permanent' -> 'user', 'trim' preserved").toEqual(['user', 'trim', 'user']);
    console.log('[keyframe-integrity] INV-2 PASSED: origins normalized to user/trim, permanent retired');

    // ===== INV-3: dedup is spatial-identity-based, never proximity-based =====
    expect(result.inv3a_frames, 'Redundant near-boundary duplicate (identical crop) collapses').toEqual([0, 45, 90]);
    expect(result.inv3b_frames, 'DISTINCT near-boundary keyframe survives — proximity alone must not drop data').toEqual([0, 5, 45, 90]);
    expect(result.inv3b_x5, 'Surviving near-edge keyframe keeps its own data').toBe(999);
    console.log('[keyframe-integrity] INV-3 PASSED: dedup collapses redundant duplicates only, distinct data survives');

    // ===== INV-4: empty list is a legal state =====
    expect(result.inv4_initCount, 'INITIALIZE seeds ZERO keyframes (default centered crop)').toBe(0);
    expect(result.inv4_initState, 'INITIALIZE marks the controller ready').toBe('initialized');
    expect(result.inv4_emptyRestoreCount, 'Empty restore is a no-op — does not throw, keeps the empty list').toBe(0);
    console.log('[keyframe-integrity] INV-4 PASSED: empty list is legal (init seeds zero, empty restore is a no-op)');

    // ===== INV-5: any keyframe deletable, including the first and the last remaining =====
    expect(result.del_before, 'Setup has three keyframes').toEqual([0, 30, 60]);
    expect(result.del_afterFirst, 'Deleting the FIRST keyframe is legal (no protected boundary)').toEqual([30, 60]);
    expect(result.del_onlyCount, 'Deleting the last remaining keyframe is legal (empty list allowed)').toBe(0);
    console.log('[keyframe-integrity] INV-5 PASSED: every keyframe deletable, including first and last');

    // ===== INV-6: minimum spacing + snap-to-update (re-pinned from old Guard 2) =====
    expect(result.MIN_KEYFRAME_SPACING).toBe(10);
    expect(result.g2_snappedCount, 'Snap keeps count (no new keyframe within tolerance)').toBe(result.g2_baseCount);
    expect(result.g2_snappedX, 'Snap updates the existing keyframe data').toBe(155);
    expect(result.g2_allowedCount, 'A distant add creates a new keyframe').toBe(result.g2_baseCount + 1);
    console.log('[keyframe-integrity] INV-6 PASSED: minimum keyframe spacing + snap-to-update');

    // ===== INV-7: identity SSOT — resolveTargetFrame arbitrates, reducer agrees =====
    expect(result.g3_closest, 'Selection picks the closer keyframe').toBe(1);
    expect(result.g3_first, 'Selection picks the first when it is closer').toBe(0);
    expect(result.g3_exact, 'Exact match wins').toBe(1);
    expect(result.rtf_snap, 'resolveTargetFrame snaps an edit near 20 to frame 20').toBe(20);
    expect(result.rtf_new, 'resolveTargetFrame targets the raw frame when nothing is near').toBe(100);
    // The reducer resolves identity the SAME way — an edit at 23 snaps to 20 instead of
    // appending a near-duplicate frame-23 keyframe (the divergence class healed by v014).
    expect(result.idn_frames, 'Reducer snaps a near edit to the existing frame, no near-duplicate').toEqual([20, 60]);
    expect(result.idn_x20, 'The snapped edit updates the target keyframe data').toBe(333);
    console.log('[keyframe-integrity] INV-7 PASSED: resolveTargetFrame is the identity SSOT, reducer agrees');

    // ===== INV-8: lifecycle keeps invariants; trim cleanup works; no manufactured boundaries =====
    expect(result.lc_beforeCleanup, 'Trim keyframe added alongside the restored user keyframes').toEqual([20, 35, 60, 88]);
    expect(result.lc_frames, 'cleanupTrimKeyframes drops only trim-origin keyframes').toEqual([35, 60, 88]);
    expect(result.lc_origins, 'Surviving keyframes are all user — no manufactured permanent boundary').toEqual(['user', 'user', 'user']);
    expect(result.lc_hasFrame0, 'Lifecycle never manufactures a frame-0 boundary').toBe(false);
    expect(result.lc_v, 'Lifecycle end state satisfies validateInvariants (sorted, unique, well-formed)').toEqual([]);
    console.log('[keyframe-integrity] INV-8 PASSED: lifecycle invariants hold, trim cleanup works, no manufactured boundaries');

    await page.screenshot({ path: 'test-results/keyframe-integrity-flatlist.png' });
  });
});
