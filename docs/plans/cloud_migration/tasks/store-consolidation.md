# Store Consolidation - Eliminate Duplicate State

## Problem

Multiple Zustand stores contain duplicate state for the same data, causing sync bugs when one store is written to but another is read from.

### Current Duplicate State

| Data | Written By | Written To | Read By | Read From |
|------|------------|------------|---------|-----------|
| `workingVideo` | useProjectLoader | projectDataStore | OverlayScreen | overlayStore |
| `clipMetadata` | useProjectLoader | projectDataStore | OverlayScreen | overlayStore |
| `workingVideo` | FramingScreen export | overlayStore | OverlayScreen | overlayStore |

### Stores With Overlap

**projectDataStore.js:**
- `workingVideo: null`
- `clipMetadata: null`
- `clips: []`
- `aspectRatio: '9:16'`

**overlayStore.js:**
- `workingVideo: null`
- `clipMetadata: null`
- `effectType: 'yellow'`
- `isLoadingWorkingVideo: false`

### Recent Bugs Caused By This

1. **Highlight regions not auto-generating** (Feb 2026)
   - `useProjectLoader` set `clipMetadata` in `projectDataStore`
   - `OverlayScreen` read from `overlayStore`
   - Fix: Added duplicate write to `overlayStore`

2. **Working video not loading on project open** (Feb 2026)
   - `useProjectLoader` set `workingVideo` in `projectDataStore`
   - `OverlayScreen` read from `overlayStore`
   - Fix: Added duplicate write to `overlayStore`

These "fixes" are bandaids. The proper fix is single source of truth.

## Solution: Single Source of Truth

### Option A: Consolidate into projectDataStore (Recommended)

**Rationale:** Project-level data (working video, clips, metadata) belongs in `projectDataStore`. Mode-specific interaction state (drag, selection, effect type) belongs in mode stores.

**Changes:**

1. **Remove from overlayStore:**
   - `workingVideo` → use `projectDataStore.workingVideo`
   - `clipMetadata` → use `projectDataStore.clipMetadata`
   - Keep: `effectType`, `isLoadingWorkingVideo`, etc.

2. **Update OverlayScreen to read from projectDataStore:**
   ```javascript
   // Before
   const { workingVideo, clipMetadata } = useOverlayStore();

   // After
   const workingVideo = useProjectDataStore(state => state.workingVideo);
   const clipMetadata = useProjectDataStore(state => state.clipMetadata);
   const { effectType } = useOverlayStore();
   ```

3. **Update useProjectLoader:**
   - Remove duplicate writes to overlayStore
   - Only write to projectDataStore

4. **Update FramingScreen export completion:**
   - Write working video to `projectDataStore`
   - OverlayScreen reads from `projectDataStore`

### Option B: Use Derived Selectors

Create selectors that expose a unified interface regardless of underlying store:

```javascript
// stores/selectors.js
export const useWorkingVideo = () => {
  const fromProject = useProjectDataStore(state => state.workingVideo);
  const fromOverlay = useOverlayStore(state => state.workingVideo);
  return fromOverlay || fromProject; // Overlay takes precedence
};
```

**Downside:** Still maintains duplicate state, just hides the complexity.

## Implementation Plan

### Phase 1: Audit All Store Usage

Map every read/write of duplicate state:

```
grep -r "workingVideo" src/frontend/src/
grep -r "clipMetadata" src/frontend/src/
```

Document all files and their read/write patterns.

### Phase 2: Define Clear Ownership

| Data | Owner Store | Reason |
|------|-------------|--------|
| `workingVideo` | projectDataStore | Project-level data |
| `clipMetadata` | projectDataStore | Project-level data |
| `clips` | projectDataStore | Project-level data |
| `effectType` | overlayStore | Mode-specific UI state |
| `highlightRegions` | overlayStore (via hook) | Mode-specific editing state |

### Phase 3: Remove Duplicates from overlayStore

1. Delete `workingVideo` and `clipMetadata` from `overlayStore.js`
2. Update all consumers to read from `projectDataStore`
3. Update all writers to only write to `projectDataStore`
4. Run tests, fix any breakage

### Phase 4: Add Store Documentation

Add comments to each store defining ownership:

```javascript
/**
 * projectDataStore - Project-level data
 *
 * OWNS:
 * - clips: Array of clip objects with metadata
 * - workingVideo: Processed video from framing export
 * - clipMetadata: Clip boundaries for overlay mode
 * - aspectRatio: Project aspect ratio
 *
 * DO NOT duplicate this data in other stores.
 */
```

### Phase 5: Add ESLint Rule (Optional)

Consider adding a custom ESLint rule or code review checklist item:
- "Before adding state to a store, check if it already exists elsewhere"

## Files to Modify

| File | Changes |
|------|---------|
| `stores/overlayStore.js` | Remove `workingVideo`, `clipMetadata` |
| `stores/projectDataStore.js` | Add ownership comments |
| `screens/OverlayScreen.jsx` | Read from projectDataStore |
| `hooks/useProjectLoader.js` | Remove duplicate writes to overlayStore |
| `components/ExportButton.jsx` | Write working video to projectDataStore |
| Any other consumers | Update to use correct store |

## Testing

- [ ] Load project with working video → navigates to overlay, video plays
- [ ] Complete framing export → navigates to overlay, video plays
- [ ] Load project with clips → highlight regions auto-generate
- [ ] Switch between projects → correct data loads each time
- [ ] All existing tests pass

## Priority

**High** - These bugs keep recurring and waste debugging time. Each mismatch is a potential production bug.

## Complexity

**Medium** - Straightforward refactor, but requires touching many files and careful testing.
