# state-owner-single

**Priority:** CRITICAL
**Category:** Ownership

## Rule
Each piece of data has exactly ONE owning store. The owner is the single source of truth for that data.

## Rationale
When multiple stores own the same data:
1. Writes to one store don't update the other
2. Components reading from different stores see different values
3. "Sync" code between stores is fragile and error-prone
4. Debugging requires checking multiple stores

## Incorrect Example

```javascript
// Two stores both "own" workingVideo
// projectDataStore.js
const useProjectDataStore = create((set) => ({
  workingVideo: null,
  loadProject: async (id) => {
    const data = await fetchProject(id);
    set({ workingVideo: data.workingVideo });
  }
}));

// overlayStore.js
const useOverlayStore = create((set) => ({
  workingVideo: null,  // DUPLICATE!
  setWorkingVideo: (video) => set({ workingVideo: video })
}));

// Now we need "sync" code
useEffect(() => {
  // BAD: Manual sync between stores
  useOverlayStore.getState().setWorkingVideo(
    useProjectDataStore.getState().workingVideo
  );
}, [projectWorkingVideo]);
```

## Correct Example

```javascript
// projectDataStore.js - SINGLE OWNER
const useProjectDataStore = create((set) => ({
  workingVideo: null,
  setWorkingVideo: (video) => set({ workingVideo: video }),
  loadProject: async (id) => {
    const data = await fetchProject(id);
    set({ workingVideo: data.workingVideo });
  }
}));

// overlayStore.js - NO workingVideo
const useOverlayStore = create((set) => ({
  // Only overlay-specific state
  effectType: 'brightness_boost',
  highlightRegions: [],
}));

// Components read from the owner
function OverlayContainer() {
  // Read from the owner
  const workingVideo = useProjectDataStore(state => state.workingVideo);
  const effectType = useOverlayStore(state => state.effectType);

  // Write to the owner
  const updateVideo = useProjectDataStore(state => state.setWorkingVideo);
}
```

## Additional Context

Ownership should be based on:
- **Who creates the data** - loadProject creates workingVideo → projectDataStore owns it
- **Who primarily uses the data** - If only overlay needs highlightRegions → overlayStore owns it
- **Lifecycle** - Project-scoped data → projectDataStore, mode-specific → mode store
