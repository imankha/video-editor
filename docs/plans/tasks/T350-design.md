# T350 Design: Sync Strategy Overhaul

## Current State

### Three persistence paths exist

```
Path 1 - GESTURE ACTIONS (surgical):
  User gesture → FramingContainer handler → framingActions.* (POST /actions)
    Backend: reads current DB state → applies ONLY the gesture's change → writes back
    Example: addCropKeyframe sends {frame, x, y, w, h, origin} → backend appends to existing array

Path 2 - REACTIVE SYNC EFFECT (full state, store-only):
  Any hook state change → FramingScreen useEffect (lines 649-672) → updateClipData()
    Only updates Zustand store (NO backend call)
    Sends ALL keyframes + ALL segments — including ensurePermanentKeyframes fixups

Path 3 - SAVE CURRENT CLIP STATE (full state, hits backend):
  Export or clip switch → saveCurrentClipState() → saveFramingEdits() (PUT /clips/{id})
    Sends ALL current hook state to backend
    Called on: export (ExportButtonContainer:540)
```

### The corruption loop

```
1. Load clip from DB → RESTORE_KEYFRAMES action in keyframeController
   → ensurePermanentKeyframes runs (adds/corrects frame 0 + endFrame origins)
   → Hook state now has fixup data that differs from what was in DB

2. Sync effect (Path 2) detects hook state changed
   → Writes fixup-modified keyframes to Zustand store
   → Store now has corrupted origins (e.g., 'user' → 'permanent' corrections)

3. Next clip load reads from store (if cached) or backend
   → If Path 3 ran, backend has the fixup data too
   → ensurePermanentKeyframes runs again on already-fixed data
   → Origin corrections applied to data that was already corrected = double fixup
```

## Deep Audit: What Each Path Actually Persists

### Gesture Actions (POST /actions) — ALL SURGICAL

Each action sends only the gesture's specific data. The backend reads current DB state, applies the change, writes back.

| Handler | Sends to Backend | Backend Operation |
|---------|-----------------|-------------------|
| addCropKeyframe | `{frame, x, y, w, h, origin: 'user'}` | Append/update single entry in crop_keyframes[] |
| deleteCropKeyframe | `{frame}` | Remove single entry from crop_keyframes[] |
| setTrimRange | `{start, end}` | Set segments_data.trimRange only |
| clearTrimRange | (no params) | Set segments_data.trimRange = null |
| splitSegment | `{time}` | Add to segments_data.boundaries[] |
| removeSegmentSplit | `{time}` | Remove from segments_data.boundaries[] |
| setSegmentSpeed | `{segment_index, speed}` | Set segments_data.segmentSpeeds[i] |

These are safe. They never read from React hooks to build the full payload.

### Reactive Sync Effect (lines 649-672) — STORE-ONLY, FULL STATE

```javascript
updateClipData(selectedClipId, {
  crop_data: JSON.stringify(keyframes),           // ALL keyframes from hook
  segments_data: JSON.stringify({
    boundaries: segmentBoundaries,
    segmentSpeeds: segmentSpeeds,
    trimRange: trimRange,
  }),
});
```

`updateClipData` → `updateClipInStore` → Zustand `set()`. **Does NOT hit the backend.**

But it writes fixup-corrupted data to the Zustand store, which is then the source for `saveCurrentClipState`.

### saveCurrentClipState — FULL STATE, HITS BACKEND

```javascript
saveFramingEdits(currentClip.id, {
  cropKeyframes: keyframes,    // ALL keyframes from hook (may include fixups)
  segments: segmentState,      // ALL segments from hook
  trimRange: trimRange
});
```

This is a PUT that overwrites the entire crop_data and segments_data in the DB.

**Called from:** ExportButtonContainer (on export). This is an explicit user gesture, and the hook state at that point IS the user's intended state — permanent keyframes should be there.

**Not called from:** clip switching (verified — clip switching uses gesture actions + store cache).

## Analysis: Is saveCurrentClipState a problem?

**No, for a different reason than expected.** When the user exports, the hook state including permanent keyframes IS correct — that's what should be persisted. The problem is the sync effect writing fixups to the store on every render, which:
1. Makes the store "source of truth" contain fixup artifacts
2. Creates a feedback loop where fixups compound on reload

## Target State

```
User Gesture → FramingContainer handler → framingActions.* (POST /actions, surgical)
                                        ↘ useCrop/useSegments (hook state, ephemeral)

Export → saveCurrentClipState() → saveFramingEdits() (PUT /clips/{id}, full state)

Internal Fixups → useCrop/useSegments (memory only, NO persistence to store or backend)
```

Remove the reactive sync effect entirely. The Zustand store no longer gets continuous hook state updates. Backend stays in sync via surgical gesture actions.

## Implementation Plan

### 1. Remove reactive sync effect (FramingScreen.jsx)
- Delete lines 635-672 (syncClipIdRef declaration + the useEffect)
- Remove `updateClipData` from destructured imports if no longer used elsewhere in the file

### 2. Documentation updates

**CLAUDE.md** — Add sync strategy section under "Coding Principles":
```
### Sync Strategy: Gesture-Based Persistence
1. Gesture → API: User actions fire backend API calls directly from handlers (surgical POST)
2. No reactive persistence: Never useEffect to watch state and write to DB/store
3. Runtime-only fixups: Internal corrections (ensurePermanentKeyframes) stay in memory
4. Restore is read-only: Loading from DB must not trigger write-back
5. Single write path: Each data has exactly ONE code path that writes to backend
6. Full-state saves only on explicit user action: saveCurrentClipState only on export
```

**coding-standards.md** — Replace "Hook → Store Sync" section with "Gesture-Based Persistence" anti-pattern documentation.

**state-management SKILL.md** — Replace "Hook → Store Sync Pattern" section with gesture-based persistence rules.

**src/frontend/CLAUDE.md** — Update the "Don't" rule from "use ONE reactive sync effect" to "use gesture-based API calls, not reactive sync effects".

### 3. No other code changes
- `saveCurrentClipState` stays (only called on export — explicit user gesture)
- All gesture handlers stay (already surgical)
- No backend changes

## Risks

| Risk | Mitigation |
|------|------------|
| Missing gesture path | All 9 handlers verified with direct surgical API calls |
| Store gets stale after removing sync effect | Backend is source of truth; store refreshes on clip load. Gesture actions update backend directly |
| saveCurrentClipState persists fixup data | Only called on export — fixup data (permanent keyframes) is correct at that point |
| Clip switching loses unsaved state | Gesture actions fire immediately (fire-and-forget) — no unsaved state accumulates |
