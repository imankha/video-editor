# T4460: Overlay onto the Keyframe Controller (Region-Scoped Tracks)

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Created:** 2026-07-03
**Epic:** [keyframe-unification](EPIC.md) · Audit item C1 · Depends on T4440, T4450 · Absorbs **T3820** · **Architecture-gated (Stage 2 required)**

## Problem

`useHighlightRegions.js` re-implements the entire keyframe lifecycle inline (:517-671: add/update/move/remove/copy/paste/snap) instead of using `controllers/keyframeController.js` + `useKeyframeController` like framing's `useCrop` (:72-76) does. Documented divergences, each a bug or bug-in-waiting:

- Snap: overlay `MIN_KEYFRAME_DISTANCE_FRAMES = 5` (:26) vs shared `MIN_KEYFRAME_SPACING = 10` (`keyframeUtils.js:67-68`) — same gesture, different result per mode. Direction also differs (T3820: crop KEEPS the old frame, overlay MOVES to the clicked frame).
- The `resolveTargetFrame` identity fix (the near-duplicate-keyframe prod bug) was applied to the controller; overlay grew a PARALLEL solution (`movedFromFrame`, :527-539) to the same bug.
- Overlay hardcodes `framerate = 30` (:40); framing reads `videoMetadata`.
- `restoreRegions` (:250) has a stale-closure smell (deps `[framerate]` but uses `calculateDefaultHighlight`/`videoMetadata`).

## Solution (design doc first — this is the epic's high-risk task)

1. **Controller grows region-scoped tracks:** `createKeyframeTrack(bounds)` — N independent keyframe lists, one per region, each with the controller's full lifecycle. `useHighlightRegions` keeps region CRUD (create/delete/move region boundaries) and delegates ALL keyframe ops to per-region controller instances.
2. **T3820 decided here:** one snap window + direction across modes. UX decision required — present both current behaviors + a recommendation in the design doc; the user picks; both modes get the winner.
3. Keyframe identity flows through `resolveTargetFrame` ONLY; `movedFromFrame` and the inline snap logic are deleted.
4. Framerate from the canonical source (T4540 if landed; else `videoMetadata`, warn-not-default on missing — no `= 30`).

## Context

- **Persistence semantics are the risk** (T350/near-duplicate history). T3800's persist wrapper is the boundary: hook state changes must produce EXACTLY the same surgical action calls as today, except where the snap decision intentionally changes them. Pin with tests before migrating: for each gesture (add/move/delete/copy/paste at various frames), record the action payloads the CURRENT code sends; assert the migrated code sends the same (modulo the documented snap change).
- Extend `keyframeController` tests to multi-track cases BEFORE the migration (epic completion criterion).
- Files: `modes/overlay/hooks/useHighlightRegions.js`, `controllers/keyframeController.js`, `hooks/useKeyframeController.js`, `utils/keyframeUtils.js`, `screens/OverlayScreen.jsx` gesture wrappers (:575-745)

## Steps

1. [ ] Stage 2 design doc (`T4460-design.md`): track API, snap decision options, migration order, payload-parity test plan. **User approval before implementation.**
2. [ ] Controller multi-track support + tests.
3. [ ] Payload-parity characterization tests for every overlay gesture.
4. [ ] Migrate gesture-by-gesture (add → move → delete → copy/paste), parity tests green at each step.
5. [ ] Delete inline lifecycle + `movedFromFrame`; fix `restoreRegions` deps.
6. [ ] E2E overlay flows + manual multi-region editing session on dev.

## Acceptance Criteria

- [ ] `useHighlightRegions` contains zero keyframe-lifecycle logic (grep: no add/move/remove keyframe math)
- [ ] One snap window + direction, user-approved, in both modes (T3820 closed)
- [ ] Identity through resolveTargetFrame only; payload parity proven per gesture
- [ ] No hardcoded framerate in overlay keyframe code
