# T3170: Editor Context Enrichment

**Epic:** [Bug Report Diagnostic Quality](EPIC.md)
**Status:** TODO
**Stack Layers:** Frontend
**Files Affected:** ~2 files
**LOC Estimate:** ~80 lines
**Test Scope:** None (manual verification)

## Problem

The current `getEditorContext()` in `src/frontend/src/utils/editorContext.js` captures a minimal snapshot:

```javascript
{
  mode: "annotate",
  profileId: "...",
  project: { id, clipCount, selectedClipId },
  game: { id, name },
  video: { currentTime, duration, isPlaying, isLoading },
  // Per-mode: only if mode matches
  annotate: { clipCount, selectedRegionId, clips: [...] },
  framing: { currentClipId, changedSinceExport },
  overlay: { effectType, changedSinceExport }
}
```

This is not enough to reproduce bugs. For example, Bug #1 reports "Clip 16 placed at wrong timeline position" -- but without knowing the aspect ratio, keyframe count, or which video sequence the user was on, an agent can't set up the same state.

## Goal

Capture enough state per mode that an AI agent can:
1. Load the same game/project/clip in a test environment
2. Set the app to the same mode with the same settings
3. Reproduce the exact configuration where the bug occurred

## Target Schema

### Always captured (all modes)

```javascript
{
  mode: "annotate",
  profileId: "uuid",
  route: "/annotate",                     // NEW: window.location.pathname
  viewport: { width: 1440, height: 900 }, // NEW: for layout bug correlation
  project: {
    id: 42,
    clipCount: 8,
    selectedClipId: 15,
    aspectRatio: "9:16",                  // NEW: from projectDataStore
  },
  game: { id: 7, name: "Summer Tournament" },
  video: {
    currentTime: 495.2,
    duration: 5400,
    isPlaying: false,
    isLoading: false,
  },
}
```

### Annotate mode additions

The annotate snapshot (from `setAnnotateSnapshot` in useAnnotate.js) already captures clip regions. Enrich it:

```javascript
annotate: {
  clipCount: 16,
  selectedRegionId: 15,
  videoSequenceCount: 2,                // NEW: how many video segments in this game
  currentVideoSequence: 1,             // NEW: which segment is active
  clips: [
    { i: 0, start: 120.5, end: 135.0, rating: 3, seq: 1 },
    { i: 1, start: 210.0, end: 225.0, rating: 4, seq: 1 },
    // ... all clips with start/end/rating/sequence
  ],
}
```

**Where to read:** `useAnnotate` hook already pushes this via `setAnnotateSnapshot()`. Add `videoSequenceCount` and `currentVideoSequence` to the snapshot. The hook has access to the game's video data.

### Framing mode additions

```javascript
framing: {
  currentClipId: 15,
  changedSinceExport: false,
  keyframeCount: 4,                     // NEW: number of crop keyframes for current clip
  segmentCount: 2,                      // NEW: number of segments
  aspectRatio: "9:16",                  // NEW: from projectDataStore
  hasExported: true,                    // NEW: whether clip has been exported before
}
```

**Where to read:**
- `useFramingStore.getState()` → `currentClipId`, `changedSinceExport`, `hasExported`
- `useFramingStore.getState().getClipState(clipId)` → check for keyframe count, segment count
- `useProjectDataStore.getState().aspectRatio` → aspect ratio

Note: `clipStates` is a map of `{ [clipId]: clipState }`. The clipState structure contains keyframes and segments. Read the current clip's state to count keyframes/segments. If clipState is null (not loaded), report `keyframeCount: null`.

### Overlay mode additions

```javascript
overlay: {
  effectType: "dark_overlay",
  changedSinceExport: false,
  highlightColor: "#FFFFFF",            // NEW
  highlightShape: "body",              // NEW
  strokeWidth: 2,                       // NEW
  fillEnabled: false,                   // NEW
  dimStrength: 0.15,                    // NEW
  isLoadingWorkingVideo: false,         // NEW
}
```

**Where to read:** All fields from `useOverlayStore.getState()`.

## Files to Modify

1. **`src/frontend/src/utils/editorContext.js`** — Enrich `getEditorContext()`:
   - Add `route`, `viewport` to base context
   - Add `aspectRatio` to project context (read from `useProjectDataStore`)
   - Expand framing context with keyframe/segment counts
   - Expand overlay context with all effect settings

2. **`src/frontend/src/modes/annotate/hooks/useAnnotate.js`** — Enrich the snapshot pushed to `setAnnotateSnapshot()`:
   - Add `videoSequenceCount` and `currentVideoSequence`

## Stores to Import (in editorContext.js)

Already imported: `useEditorStore`, `useProjectsStore`, `useProjectDataStore`, `useGamesDataStore`, `useVideoStore`, `useFramingStore`, `useOverlayStore`, `useProfileStore`

No new imports needed -- all required stores are already imported.

## Dependencies

- Depends on T3150 (backend NULL fix) -- without it, the enriched context could still be stored as NULL if somehow empty.
- The existing `getEditorContext()` function and `setAnnotateSnapshot()` hook are already in HEAD (commit `05c8b07d`) but not deployed. This task modifies the same code.
