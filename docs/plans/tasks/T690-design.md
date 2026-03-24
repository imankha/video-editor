# T690 Design: Clip Selection & Edit Mode State Machine

## Current State

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ useAnnotateState│     │    useAnnotate    │     │  AnnotateModeView   │
│                 │     │                   │     │                     │
│ showAnnotate    │     │ selectedRegionId  │     │ isEditMode =        │
│ Overlay (bool)  │     │ (string|null)     │     │  !overlay && !!id   │
│                 │     │                   │     │  && atTime(ct)===id │
│ setShow...()    │     │ selectRegion()    │     │                     │
└─────────────────┘     └──────────────────┘     │ frozenExistingClip  │
        ↑                       ↑                 │ Ref (stale snapshot)│
        │                       │                 └─────────────────────┘
   5 places write          7 places write              computed in render
```

**Problems:** Three independent pieces of state (overlay bool, selected ID, computed isEditMode) can disagree. Auto-select effect races with async seek. frozenExistingClipRef is a workaround for scrub instability.

## Target State

```
┌───────────────────────────────────────────┐
│           useClipSelection hook           │
│                                           │
│  selectionState: NONE | SELECTED(clipId)  │
│                | EDITING(clipId)          │
│                | CREATING                 │
│                                           │
│  Derived:                                 │
│    selectedRegionId = state.clipId ?? null │
│    isOverlayOpen = EDITING | CREATING     │
│    isEditMode = SELECTED                  │
│                                           │
│  Transitions:                             │
│    selectClip(id)    → SELECTED(id)       │
│    editClip(id)      → EDITING(id)        │
│    startCreating()   → CREATING           │
│    closeOverlay()    → SELECTED | NONE    │
│    deselectClip()    → NONE               │
└───────────────────────────────────────────┘
```

## State Machine Transitions

```
            ┌─────────────────────────────────────────┐
            │                                         │
            ▼                                         │
┌────────────────┐  click clip / playhead enters  ┌───┴────────────┐
│      NONE      │ ─────────────────────────────► │  SELECTED(id)  │
│                │ ◄───────────────────────────── │                │
└───────┬────────┘    playhead leaves clip         └──┬──────────┬─┘
        │                                             │          │
        │ click "Add Clip"              click "Edit"  │          │ enter fullscreen
        │ (no clip selected)         or enter FS      │          │ (with selected clip)
        ▼                                             ▼          │
┌────────────────┐                            ┌────────────────┐ │
│    CREATING    │                            │  EDITING(id)   │◄┘
│                │                            │                │
└───────┬────────┘                            └──┬─────────┬───┘
        │                                        │         │
        │ close/cancel          close overlay     │         │ exit fullscreen
        │                       or exit FS        │         │
        ▼                                         ▼         │
┌────────────────┐                            ┌────────────┐│
│      NONE      │                            │ SELECTED   ││
└────────────────┘                            └────────────┘│
                                                            │
                                                            ▼
                                              ┌────────────────┐
                                              │   SELECTED     │
                                              └────────────────┘
```

**Key rule:** `playhead_leaves` is a NO-OP in EDITING and CREATING states. Only SELECTED reacts to playhead position. This eliminates the need for `frozenExistingClipRef`.

## State → UI Mapping

| State | selectedRegionId | isOverlayOpen | isEditMode | Sidebar highlight | Button (non-FS) | Button (FS) |
|-------|-----------------|--------------|------------|-------------------|-----------------|-------------|
| NONE | null | false | false | none | "Add Clip" | "Add Clip" (paused only) |
| SELECTED(id) | id | false | true | highlighted | hidden | "Edit Clip" (always) |
| EDITING(id) | id | true | N/A | highlighted | hidden | hidden |
| CREATING | null | true | N/A | none | hidden | hidden |

## Implementation Plan

### 1. New file: `useClipSelection.js`

Location: `src/frontend/src/modes/annotate/hooks/useClipSelection.js`

```javascript
// State representation
const SELECTION_STATES = { NONE: 'NONE', SELECTED: 'SELECTED', EDITING: 'EDITING', CREATING: 'CREATING' };

// State shape: { type: 'NONE' } | { type: 'SELECTED', clipId } | { type: 'EDITING', clipId } | { type: 'CREATING' }

// Transition functions: selectClip, editClip, startCreating, closeOverlay, deselectClip
// Derived values: selectedRegionId, isOverlayOpen, isEditMode
```

### 2. Modify: `useAnnotate.js`

**Remove:** `selectedRegionId` state (`useState(null)` at line 252), `selectRegion` callback (line 539)

**Add:** Accept `{ selectedRegionId, onSelect }` options parameter:
- `selectedRegionId` — for `selectedRegion` derivation (useMemo at line 360)
- `onSelect(clipId|null)` — callback for internal selection changes (add/delete/import/reset)

**Modify internal callers:**
- `addClipRegion` (line 414): `onSelect?.(newRegion.id)` instead of `setSelectedRegionId`
- `deleteClipRegion` (line 520-528): call `onSelect?.(nextId)` instead of `setSelectedRegionId`
- `initialize` (line 322): `onSelect?.(null)` instead of `setSelectedRegionId`
- `reset` (line 331): `onSelect?.(null)` instead of `setSelectedRegionId`
- `pendingAnnotations` effect (line 307): `onSelect?.(newRegions[0].id)` instead of `setSelectedRegionId`

**Remove from return:** `selectedRegionId`, `selectRegion`
**Keep in return:** `selectedRegion` (derived from param)

### 3. Modify: `useAnnotateState.js`

**Remove:** `showAnnotateOverlay` state (line 45), `setShowAnnotateOverlay` (line 197), reset call (line 121)

### 4. Modify: `useVideo.js`

**In `seek()` (line 235-249):** Add `setCurrentTime(validTime)` before `videoRef.current.currentTime = validTime` for optimistic UI update.

### 5. Modify: `AnnotateContainer.jsx`

**Add:** `useClipSelection()` hook call. Wire `onSelect` callback to `selectClip`.

**Replace auto-select effect (lines 811-823)** with new effect:
```javascript
useEffect(() => {
  if (!annotateVideoUrl) return;
  const { type, clipId } = selectionState;

  // EDITING/CREATING: immune to playhead changes
  if (type === 'EDITING' || type === 'CREATING') return;

  const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);

  if (type === 'SELECTED') {
    const selectedClip = clipRegions.find(r => r.id === clipId);
    if (selectedClip && (currentTime < selectedClip.startTime || currentTime > selectedClip.endTime)) {
      regionAtPlayhead ? selectClip(regionAtPlayhead.id) : deselectClip();
    }
  } else { // NONE
    if (regionAtPlayhead) selectClip(regionAtPlayhead.id);
  }
}, [annotateVideoUrl, currentTime, selectionState, getAnnotateRegionAtTime, clipRegions]);
```

**Modify handlers:**
- `handleToggleFullscreen`: On enter FS + SELECTED → `editClip(id)`. On exit FS + EDITING/CREATING → `closeOverlay()`.
- `handleAddClipFromButton`: If SELECTED → `editClip(id)`. If NONE → `startCreating()`.
- `handleOverlayClose`: `closeOverlay()` (replaces `setShowAnnotateOverlay(false)`)
- `handleOverlayResume`: `closeOverlay()` + `togglePlay()`
- `handleFullscreenCreateClip`: After `addClipRegion()` (which calls `onSelect` → `selectClip`), overlay auto-closes
- `handleFullscreenUpdateClip`: After update, `closeOverlay()`
- `handleSelectRegion`: `selectClip(regionId)` + `seek(startTime)` (handles EDITING+click_other → EDITING(other) via selectClip logic)
- Escape handler: `setAnnotateFullscreen(false)` + `closeOverlay()`

**Modify return:** Replace `showAnnotateOverlay` with `isOverlayOpen`, replace `annotateSelectedRegionId` with derived from state machine.

### 6. Modify: `AnnotateScreen.jsx`

**Update prop names:** `showAnnotateOverlay` → `isOverlayOpen` (or keep name for minimal diff). Pass new `isEditMode` prop (from state machine derived value).

### 7. Modify: `AnnotateModeView.jsx`

**Remove:** `frozenExistingClipRef` and `wasOverlayOpenRef` (lines 96-102)

**Change existingClip:** Compute from `annotateSelectedRegionId` and regions:
```javascript
const existingClip = annotateSelectedRegionId
  ? annotateRegionsWithLayout.find(r => r.id === annotateSelectedRegionId)
  : null;
```
This is stable during scrub because EDITING(clipId) keeps the ID constant.

**Change isEditMode:** Receive as prop from container (derived from state machine) instead of computing inline at line 261.

### 8. Modify: `AnnotateControls.jsx`

**Minimal change.** `isEditMode` prop now correctly derived from state machine. Button visibility logic:
```javascript
// Non-fullscreen: show only in NONE state (isEditMode=false, isOverlayOpen=false)
// Fullscreen: show "Edit Clip" when SELECTED (always), "Add Clip" when NONE (paused only)
// Hidden when EDITING or CREATING (isOverlayOpen=true)
```

Pass `isOverlayOpen` as a prop to control hiding during overlay.

### 9. Modify: `AnnotateFullscreenOverlay.jsx`

**No structural changes.** `existingClip` prop is now stable (ID-based lookup vs frozen ref). The `[existingClip]` dependency in the form reset effect (line 156) works correctly because the reference only changes when the actual clip changes (different ID), not during scrub.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Optimistic seek breaks Framing mode tracking squares | `seeked` event still fires and corrects value; tracking squares at target position is acceptable during seek |
| `existingClip` reference changes trigger form reset | ID-based lookup from `clipRegions` is stable during scrub (clipRegions doesn't change during handle drag) |
| `addClipRegion`'s `onSelect` callback creates auto-transition from CREATING→SELECTED | This is the desired behavior — overlay closes after clip creation |
| `deleteClipRegion` needs access to `selectedRegionId` for smart next-selection | Passed as parameter; `onSelect` callback fires the transition |

## Files Changed

| File | Change Type | LOC |
|------|------------|-----|
| `hooks/useClipSelection.js` | **New** | ~50 |
| `hooks/useAnnotate.js` | Modify (remove selectedRegionId state) | ~30 |
| `hooks/useAnnotateState.js` | Modify (remove showAnnotateOverlay) | ~10 |
| `hooks/useVideo.js` | Modify (optimistic seek) | ~3 |
| `containers/AnnotateContainer.jsx` | Modify (wire state machine) | ~40 |
| `modes/AnnotateModeView.jsx` | Modify (remove frozenRef, derive existingClip) | ~15 |
| `modes/annotate/components/AnnotateControls.jsx` | Modify (button visibility) | ~10 |
| `screens/AnnotateScreen.jsx` | Modify (prop names) | ~5 |
| `modes/annotate/index.js` | Modify (export new hook) | ~2 |
| **Total** | | **~165** |
