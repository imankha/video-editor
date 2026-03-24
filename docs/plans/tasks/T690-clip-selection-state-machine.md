# T690: Clip Selection & Edit Mode State Machine

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-23
**Updated:** 2026-03-23

## Problem

The clip selection and edit mode system has grown through incremental patches into a fragile mess of special-case code. Symptoms:

- "Edit Clip" button shows when it shouldn't (playhead not on clip)
- Clip selection doesn't persist across fullscreen toggle
- Edit overlay doesn't load clip values (name, tags) correctly
- Auto-deselect races with async `seek()` causing selection to flicker
- `currentTime` state is stale when paused, causing incorrect deselect decisions
- Multiple competing mechanisms: auto-select effect, user select handler, overlay close handler, fullscreen toggle handler — all fighting over selection state

**Root cause:** Selection state is managed reactively through effects that trigger on `currentTime` changes, but `currentTime` updates are async (tied to video element events). This creates race conditions where effects make decisions based on stale data.

## Current Data Store

### Where State Lives

**useAnnotateState hook** (`src/frontend/src/modes/annotate/hooks/useAnnotateState.js`):
- `showAnnotateOverlay` (line 45) — Boolean: whether the Add/Edit clip overlay is visible
- `annotateFullscreen` (line 42) — Boolean: fullscreen mode
- `annotatePlaybackSpeed` (line 41) — Number: playback speed
- `annotateSelectedLayer` (line 46) — String: 'clips' or 'playhead'

**useAnnotate hook** (`src/frontend/src/modes/annotate/hooks/useAnnotate.js`):
- `selectedRegionId` (line 252) — String|null: ID of currently selected region
- `clipRegions` (line 249) — Array of clip region objects:
  ```
  { id, rawClipId, startTime, endTime, name, tags, notes, rating, color, videoSequence }
  ```
- `regionsWithLayout` (line 339) — Computed: clipRegions sorted by endTime + visual layout info (visualStartPercent, visualWidthPercent, index)
- `selectedRegion` (line 360) — Memoized lookup: `clipRegions.find(r => r.id === selectedRegionId)`

**useVideo hook** (`src/frontend/src/hooks/useVideo.js`):
- `currentTime` (line 235) — Number: playhead position (only updates on `seeked` and `timeupdate` events, NOT on `seek()` call)
- `isPlaying` — Boolean: playback state
- `isSeeking` — Boolean: seek in progress

### Data Flow

```
AnnotateScreen
  └── useVideo()                    → currentTime, isPlaying, seek()
  └── useZoom()                     → zoom, pan
  └── AnnotateContainer
        ├── useAnnotateState()      → showAnnotateOverlay, annotateFullscreen
        ├── useAnnotate()           → selectedRegionId, clipRegions, selectRegion()
        └── handlers                → handleSelectRegion, handleAddClipFromButton, etc.

  └── AnnotateModeView (props from above)
        ├── ClipsSidePanel          → reads selectedRegionId for highlight
        │   ├── ClipListItem        → isSelected={region.id === selectedRegionId}
        │   └── ClipDetailsEditor   → reads selectedRegion for edit form
        ├── AnnotateControls        → reads isEditMode for button text/variant
        ├── AnnotateFullscreenOverlay → reads frozenExistingClipRef for form data
        └── NotesOverlay            → reads getAnnotateRegionAtTime(currentTime)
```

### Current State → UI Mapping

| Data Store State | UI Element | File:Line | How It's Used |
|-----------------|------------|-----------|---------------|
| `selectedRegionId` | Sidebar clip highlight | `ClipsSidePanel.jsx:223` | `isSelected={region.id === selectedRegionId}` — border + tinted bg |
| `selectedRegionId` | Clip Details panel visibility | `ClipsSidePanel.jsx:29,115` | Shows editor when `selectedRegion` is non-null |
| `selectedRegionId` + `currentTime` | Add/Edit button text | `AnnotateModeView.jsx:261` | `isEditMode={!showAnnotateOverlay && !!selectedId && getRegionAtTime(currentTime)?.id === selectedId}` |
| `showAnnotateOverlay` | Overlay visibility | `AnnotateModeView.jsx:221-226` | Renders AnnotateFullscreenOverlay |
| `showAnnotateOverlay` | NotesOverlay visibility | `AnnotateModeView.jsx:199` | Hidden while overlay open (`!showAnnotateOverlay && ...`) |
| `annotateFullscreen` | Layout mode | `AnnotateModeView.jsx:148-157` | Fixed positioning, aspect ratio container |
| `annotateFullscreen` + `isPlaying` | Button visibility | `AnnotateControls.jsx:163` | `(!isFullscreen) \|\| (isFullscreen && !isPlaying)` |
| `currentTime` | NotesOverlay content | `AnnotateModeView.jsx:199-204` | Shows name/rating/notes for clip at playhead |
| `frozenExistingClipRef` | Overlay form data | `AnnotateFullscreenOverlay.jsx:139-146` | Loads rating, tags, name, notes, times |

### Current Event Handlers That Modify Selection

| Event | Handler | Location | What It Does |
|-------|---------|----------|--------------|
| Click clip in sidebar | `handleSelectRegion` | `AnnotateContainer.jsx:799` | `selectRegion(id)` + `seek(startTime)` |
| Playhead enters clip | Auto-select effect | `AnnotateContainer.jsx:812` | `selectRegion(id)` if playhead in range |
| Create new clip | `addClipRegion` | `useAnnotate.js:414` | Auto-selects the new region |
| Delete clip | `deleteClipRegion` | `useAnnotate.js:515` | Selects prev/first or null |
| Import annotations | `importAnnotations` | `useAnnotate.js:674` | Selects first imported |
| Arrow key nav | Keyboard handler | `AnnotateScreen.jsx:307` | `selectRegion(id)` + `seek(startTime)` |
| Click "Add Clip" button | `handleAddClipFromButton` | `AnnotateContainer.jsx:614` | `setShowAnnotateOverlay(true)` (doesn't change selection) |
| Close overlay | `handleOverlayClose` | `AnnotateContainer.jsx:782` | `setShowAnnotateOverlay(false)` (doesn't change selection) |
| Toggle fullscreen | `handleToggleFullscreen` | `AnnotateContainer.jsx:604` | `setAnnotateFullscreen(!prev)` (doesn't change selection) |

### The Auto-Select Effect (Current Code)

```javascript
// AnnotateContainer.jsx:811-823
useEffect(() => {
  if (!annotateVideoUrl) return;
  const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
  if (regionAtPlayhead && regionAtPlayhead.id !== annotateSelectedRegionId) {
    const currentSelection = clipRegions.find(r => r.id === annotateSelectedRegionId);
    if (currentSelection && currentTime >= currentSelection.startTime && currentTime <= currentSelection.endTime) {
      return; // Stay selected if playhead still in current selection
    }
    selectAnnotateRegion(regionAtPlayhead.id);
  }
}, [annotateVideoUrl, currentTime, getAnnotateRegionAtTime, annotateSelectedRegionId, selectAnnotateRegion, clipRegions]);
```

**Problems with this effect:**
1. Only auto-SELECTS, never deselects (playhead leaving clip doesn't clear selection)
2. Depends on `currentTime` state which is stale when paused (only updates on video events)
3. No awareness of `showAnnotateOverlay` or `annotateFullscreen` — selection changes can conflict with overlay state

## Requirements

### Selection Rules
1. A clip is **selected** when:
   - User clicks a clip in the sidebar → select + seek to clip start
   - Playhead enters a clip's `[startTime, endTime]` range during playback
2. A clip is **deselected** when:
   - Playhead moves outside the selected clip's `[startTime, endTime]` range (scrub, playback, or seek)
   - User clicks a different clip
   - There is no clip at the current playhead position and no user-initiated selection is pending
3. Selection must survive fullscreen toggle without flickering

### Edit Mode Rules (Button)
4. **Non-fullscreen:** The Add/Edit Clip button is hidden when a clip is selected (Clip Details sidebar is the editing interface)
5. **Fullscreen:** Button shows "Edit Clip" (amber) when a clip is selected, "Add Clip" (green) when no clip is selected
6. **Fullscreen + playing:** "Edit Clip" stays visible during playback; "Add Clip" only shows when paused
7. Button is always hidden while the overlay dialog is open

### Edit Overlay Rules
8. Entering fullscreen with a selected clip → open Edit Clip overlay automatically
9. Leaving fullscreen → close the overlay (sidebar takes over)
10. Overlay loads ALL fields from the selected clip: name, rating, tags, notes, startTime, endTime
11. Selecting a different clip while overlay is open → overlay reloads with new clip's data
12. Closing the overlay does NOT deselect the clip

### Seek Responsiveness
13. `setCurrentTime` should update optimistically in `seek()` so UI responds instantly (playhead, timestamp, selection effects). The `seeked` event refines the value after the browser loads the frame.

## Solution

### State Machine

Replace the scattered state (`selectedRegionId` + `showAnnotateOverlay` + `isEditMode` computed prop) with a single state machine:

```
States: NONE | SELECTED(clipId) | EDITING(clipId)

Transitions:
  NONE + user_click_clip(id)      → SELECTED(id)   [seek to startTime]
  NONE + playhead_enters_clip(id) → SELECTED(id)
  SELECTED(id) + playhead_leaves  → NONE
  SELECTED(id) + user_click_edit  → EDITING(id)    [open overlay]
  SELECTED(id) + enter_fullscreen → EDITING(id)    [open overlay]
  SELECTED(id) + user_click_clip(other) → SELECTED(other) [seek]
  EDITING(id) + close_overlay     → SELECTED(id)   [stay selected]
  EDITING(id) + exit_fullscreen   → SELECTED(id)   [close overlay]
  EDITING(id) + select_clip(other)→ EDITING(other)  [reload overlay]
  ANY + playhead_leaves_clip      → NONE            [close overlay if open]
```

### Target State → UI Mapping

| State Machine | selectedRegionId | showAnnotateOverlay | isEditMode (controls) | Sidebar highlight | ClipDetails visible | Overlay visible | Button |
|--------------|-----------------|--------------------|-----------------------|-------------------|--------------------|-----------------|----|
| `NONE` | `null` | `false` | `false` | none | no | no | "Add Clip" (fullscreen paused) or hidden |
| `SELECTED(id)` | `id` | `false` | `true` | highlighted | yes (non-fullscreen) | no | hidden (non-FS) / "Edit Clip" (FS) |
| `EDITING(id)` | `id` | `true` | N/A | highlighted | yes (non-fullscreen) | yes | hidden |

### Key Design Decisions

- **No cooldown timers.** The seek-is-async problem is solved by updating `currentTime` optimistically in `seek()`, not by suppressing effects with timeouts.
- **Single source of truth.** The state machine value drives all UI. `showAnnotateOverlay` and `isEditMode` are derived, not independently managed.
- **Views reflect state.** The button text, overlay visibility, sidebar highlight — all derived from the state machine. No imperative show/hide calls scattered across handlers.
- **`frozenExistingClipRef` may not be needed.** If the state machine keeps `EDITING(id)` stable during scrub, the overlay can just look up the clip by ID instead of freezing a snapshot.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` — `showAnnotateOverlay`, `annotateFullscreen` state
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — `selectedRegionId`, `clipRegions`, `selectRegion()`, `getRegionAtTime()`
- `src/frontend/src/containers/AnnotateContainer.jsx` — Selection handlers, auto-select effect, overlay open/close
- `src/frontend/src/modes/AnnotateModeView.jsx` — `isEditMode` prop, `frozenExistingClipRef`, `onAddClip` conditional
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` — Add/Edit button visibility logic
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Overlay form population from `existingClip`
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Sidebar clip list, detail editor, `isSelected` prop
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Edit form for selected clip
- `src/frontend/src/hooks/useVideo.js` — `seek()` function, `currentTime` state updates

### Related Tasks
- Depends on: None
- Blocks: None

### Technical Notes
- The `frozenExistingClipRef` pattern exists because scrub handles seek the playhead in/out of clip regions, which toggles `existingClip` and resets the form. The state machine approach should handle this by keeping `EDITING` state stable during scrub.
- `currentTime` from React state only updates on video `seeked`/`timeupdate` events. The optimistic seek fix (setting `currentTime` in `seek()` before `seeked` event) is essential for correct selection behavior and instant UI response.
- `getRegionAtTime(time)` in `useAnnotate.js:566` does `clipRegions.find(r => time >= r.startTime && time <= r.endTime)`.

## Acceptance Criteria

- [ ] Selecting a clip in sidebar highlights it and seeks to start
- [ ] Playhead leaving clip range deselects (during playback or scrub)
- [ ] Selection survives fullscreen toggle without flicker
- [ ] Edit Clip button: hidden in non-fullscreen when selected, visible in fullscreen during playback
- [ ] Overlay loads all clip fields (name, rating, tags, notes, times)
- [ ] Overlay reloads when selecting a different clip
- [ ] Closing overlay keeps clip selected
- [ ] No timer-based workarounds
- [ ] Seek updates UI instantly (optimistic currentTime)
- [ ] All UI elements derive from single state machine — no independent isEditMode/showOverlay management
