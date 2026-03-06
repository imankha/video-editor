# T280: Framing Persistence Model Redesign

**Status:** DESIGN
**Priority:** Infrastructure bug (data loss)
**Complexity:** 5

## Problem

Framing state (crop keyframes, segments, trim range) has three sources of truth, two competing save paths, and multiple band-aids. Users lose edits on mode switch, refresh, or re-export.

## Design Document

### Current State

```
USER GESTURE
    |
    v
useCrop/useSegments hooks (LIVE, ephemeral)
    |
    +---> POST /actions (fire-and-forget, updates backend in-place)
    |     Backend reads FULL state, modifies one field, writes back
    |     Does NOT update Zustand store
    |
    +---> [on export only] PUT /clips/{id} (full state save)
          Reads all state from hooks
          Updates Zustand store AND backend
          Creates new version if clip was exported

RESTORE: FramingScreen mount -> read Zustand store -> parse JSON -> call restoreState() on hooks
```

**Three sources of truth:**
1. React hooks (useCrop, useSegments) - live editing, destroyed on unmount
2. Zustand store (projectDataStore.clips[]) - raw backend data in memory
3. Backend DB (working_clips table) - durable storage

**Two save paths that race:**
1. Gesture POST - fires on each interaction, updates backend only
2. Full PUT - fires on export, updates both store and backend

**Core issues:**
- Gestures update backend but NOT store -> store is stale
- Mode switch unmounts hooks -> live state destroyed, store stale
- Restore reads from stale store -> user sees old data
- PUT on exported clips creates new version; concurrent gestures still update old version

### Target State

```
USER GESTURE
    |
    v
useCrop/useSegments hooks (LIVE, ephemeral)
    |
    +---> Zustand store (SINGLE SOURCE OF TRUTH for persistence)
    |     Updated synchronously on every gesture
    |
    +---> POST /actions (fire-and-forget, backend durability only)
          Same as before, but store is always authoritative

RESTORE: FramingScreen mount -> read Zustand store -> parse JSON -> call restoreState()
         (Same as before, but store is now up-to-date because gestures update it)

EXPORT: saveCurrentClipState() reads from store (not hooks) + sends PUT
        (Store already has latest data; PUT just ensures backend matches)
```

**Single source of truth:** Zustand store is always current. Hooks are a derived view for the active clip.

**Key principle:** Every gesture updates the store AND fires the backend POST. The store is authoritative; the backend is a durable copy. On restore, the store always has the latest data.

### Architecture Changes

#### Change 1: Gestures update Zustand store synchronously

**Current:** Gesture handlers in FramingContainer update hooks and fire POST, but never update store.

**New:** After every gesture, also update the clip's `crop_data`/`segments_data` in the store.

```
// Pseudo-code for every gesture handler in FramingContainer:

function handleAddCropKeyframe(frame, cropData) {
  // 1. Update live hook (for immediate UI)
  addOrUpdateKeyframe(frame, cropData);

  // 2. Update store (for persistence across mode switches)
  const currentKeyframes = getKeyframesForExport(); // from hook, frame-based
  updateClipData(clipId, {
    crop_data: JSON.stringify(currentKeyframes)
  });

  // 3. Fire backend POST (for durability, fire-and-forget)
  framingActions.addCropKeyframe(projectId, clipId, { frame, ...cropData });
}
```

**Implementation detail:** We need a helper that serializes the current hook state to store format. This already exists partially — `getKeyframesForExport()` returns time-based keyframes, but `crop_data` stores frame-based. We need the frame-based version.

**Correction:** Looking at the code more carefully:
- `crop_data` in the DB stores frame-based keyframes: `[{frame, x, y, width, height, origin}, ...]`
- `getKeyframesForExport()` converts frame -> time for export
- The store's `crop_data` is the raw JSON string from the DB (frame-based)
- So we need to serialize the hook's internal frame-based keyframes directly

`useCrop` already exposes `keyframes` (the raw frame-based state from useKeyframeController). We'll use that.

For segments: `useSegments` already has `getState()` that returns `{boundaries, segmentSpeeds, trimRange}` — this maps directly to `segments_data`.

#### Change 2: Remove timing_data redundancy

**Current:** `timing_data` stores `{trimRange}` which duplicates `segments_data.trimRange`.

**New:** Stop writing `timing_data`. Read it only as a fallback for old clips that have it but no `segments_data.trimRange`.

**Files affected:**
- `FramingContainer.jsx` — stop including `timing_data` in saveCurrentClipState
- `projectDataStore.js` — stop sending `timing_data` in PUT
- `clips.py` PUT endpoint — stop reading `timing_data` for change detection (use `segments_data` only)
- `clipSelectors.js` — if `clipTrimRange()` reads from `timing_data`, update to read from `segments_data.trimRange`

#### Change 3: Remove unmount save band-aid

**Current:** FramingScreen has (or had) unmount cleanup that saves hook state to store via refs.

**New:** Not needed. Store is already up-to-date because Change 1 keeps it current on every gesture. The unmount cleanup can be removed entirely.

#### Change 4: Simplify clipsWithCurrentState merge

**Current:** Complex conditional merge — if selected clip AND hook has keyframes, use hook; otherwise use store.

**New:** Store is always current for all clips. For the *selected* clip, we still use hooks for real-time UI (interpolation, playback). But for export/persistence purposes, the store is authoritative.

The `clipsWithCurrentState` memo can be simplified:
- For selected clip: still merge live hook state (needed for sub-frame interpolation during playback)
- For non-selected clips: use store directly
- The `getKeyframesForExport().length > 0` guard is no longer needed because the store always has the latest

#### Change 5: Fix gesture/version race condition

**Current:** POST gestures update v1 in-place even after PUT creates v2.

**New:** When PUT returns `refresh_required` with a `new_clip_id`:
1. Frontend updates `selectedClipId` to the new ID
2. Subsequent gesture POSTs target the new clip ID
3. No race because all operations target the same version

This already partially works — FramingContainer checks `result.newClipId` and updates. But we need to ensure the gesture action calls use a ref to the current clip ID so they don't fire against the old ID.

### Implementation Plan

**Phase 1: Store sync on gestures** (core fix)

Files:
- `src/frontend/src/containers/FramingContainer.jsx`
  - Every gesture handler (addCropKeyframe, deleteCropKeyframe, splitSegment, setSegmentSpeed, setTrimRange, clearTrimRange) gets a store update call after the hook update
  - Add helper: `syncCropToStore()` — reads hook keyframes, writes to store
  - Add helper: `syncSegmentsToStore()` — reads hook segment state, writes to store

- `src/frontend/src/modes/framing/hooks/useCrop.js`
  - Expose `getRawKeyframes()` that returns the frame-based keyframe array (not time-converted)
  - Or: use existing `keyframes` from useKeyframeController return value

- `src/frontend/src/modes/framing/hooks/useSegments.js`
  - Expose `getState()` already exists (returns `{boundaries, segmentSpeeds, trimRange}`)

**Phase 2: Remove band-aids**

Files:
- `src/frontend/src/screens/FramingScreen.jsx`
  - Remove unmount save refs (currentSegmentStateRef, currentKeyframesRef, previousClipIdRef)
  - Remove unmount cleanup effect
  - Remove DIAG logs

- `src/frontend/src/containers/FramingContainer.jsx`
  - Simplify `clipsWithCurrentState` memo
  - Remove `getKeyframesForExport().length > 0` guard
  - Remove DIAG logs

- `src/frontend/src/modes/framing/hooks/useCrop.js`
  - Remove DIAG logs

- `src/frontend/src/hooks/useProjectLoader.js`
  - Remove DIAG logs

**Phase 3: Remove timing_data redundancy**

Files:
- `src/frontend/src/containers/FramingContainer.jsx` — stop writing timing_data
- `src/frontend/src/stores/projectDataStore.js` — stop sending timing_data in PUT
- `src/backend/app/routers/clips.py` — stop using timing_data for change detection
- Migration: keep reading timing_data in clipSelectors for backward compat with old clips

**Phase 4: Clean up backend**

Files:
- `src/backend/app/routers/clips.py`
  - Remove DIAG logs from PUT endpoint
  - Ensure gesture POST checks clip version to avoid updating stale versions

### Risks & Open Questions

1. **Store update timing:** After `addOrUpdateKeyframe()`, the hook state update is async (React batching). Reading `getRawKeyframes()` immediately after may return stale data. **Mitigation:** Compute the new state inline rather than reading from hook.

2. **Performance:** Serializing keyframes to JSON on every gesture could be expensive for clips with many keyframes. **Mitigation:** Use `JSON.stringify()` only — it's fast for typical keyframe counts (<100).

3. **Backward compatibility:** Old clips with `timing_data` but no `segments_data.trimRange`. **Mitigation:** Keep reading `timing_data` as fallback in selectors; just stop writing it.

4. **Version race (Phase 4):** More complex to fix fully. The core fix (Phase 1-2) makes the frontend store authoritative, so even if backend has a stale version, the frontend will re-send on next PUT. Acceptable risk for now.

### Not In Scope

- Retry logic for failed gesture POSTs (nice-to-have but separate concern)
- Offline support / optimistic updates
- Real-time collaboration (single user per project)
