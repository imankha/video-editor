---
name: state-management
description: "Zustand store patterns for React state management. Single ownership, no duplicate state, proper derivation. Apply when creating stores, adding state, or debugging sync issues."
license: MIT
author: video-editor
version: 1.0.0
---

# State Management

Zustand store patterns to prevent duplicate state and sync bugs.

## When to Apply
- Creating new Zustand stores
- Adding state to existing stores
- Debugging "stale data" or sync issues
- Refactoring state management

## Core Principle

**Each piece of data has ONE owning store.** Other stores that need that data must read from the owner, never duplicate it.

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Ownership | CRITICAL | `state-owner-` |
| 2 | No Duplicates | CRITICAL | `state-dup-` |
| 3 | Reactivity | CRITICAL | `state-react-` |
| 4 | Derivation | HIGH | `state-derive-` |

## Quick Reference

### Ownership (CRITICAL)
- `state-owner-single` - One store owns each piece of data
- `state-owner-write` - Only the owner writes to that data
- `state-owner-read` - Others read via selectors or direct import

### No Duplicates (CRITICAL)
- `state-dup-never` - Never store same data in multiple stores
- `state-dup-detect` - Watch for "sync" code between stores
- `state-dup-refactor` - Move duplicated state to single owner

### Reactivity (CRITICAL)
- `state-react-no-refs` - Never use refs to control UI behavior
- `state-react-state-machine` - Use state machines for async flows
- `state-react-no-timeouts` - No magic timeouts for synchronization

### Derivation (HIGH)
- `state-derive-compute` - Derive computed values, don't store them
- `state-derive-selector` - Use selectors for derived data
- `state-derive-memo` - Memoize expensive derivations

---

## Store Ownership Map

| Data | Owning Store | NOT in |
|------|--------------|--------|
| `workingVideo` | `projectDataStore` | overlayStore |
| `clipMetadata` | `projectDataStore` | overlayStore |
| `clips` (list) | `clipStore` | projectDataStore |
| `effectType` | `overlayStore` | - |
| `highlightRegions` | `overlayStore` | - |
| `selectedProject` | `editorStore` | navigationStore |
| `editorMode` | `editorStore` | - |

---

## Reactivity Principle

**UI behavior must be driven by reactive state, not hidden refs or timeouts.**

React components re-render when state changes. This is the foundation of predictable UI. When you use refs or timeouts to control behavior, you break this contract—the component's behavior becomes disconnected from its visible state.

### State Machine Pattern

For async flows (loading, saving, syncing), use a **state machine** with explicit states:

```javascript
// State machine for data sync
const [syncState, setSyncState] = useState('idle');
// States: 'idle' | 'loading' | 'ready' | 'error'

// Load effect
useEffect(() => {
  if (projectId && syncState === 'idle') {
    setSyncState('loading');

    fetchData(projectId)
      .then(data => {
        restoreData(data);
        setSyncState('ready');  // Immediately ready after restore
      })
      .catch(() => setSyncState('error'));
  }
}, [projectId, syncState]);

// Sync check is now reactive and obvious
const canSync = syncState === 'ready';
```

### Why State Machines?

1. **Visible state** - The current state is inspectable in React DevTools
2. **Predictable transitions** - Each state has defined next states
3. **No race conditions** - State transitions are atomic
4. **Self-documenting** - State names describe what's happening
5. **Testable** - Easy to test each state and transition

### Anti-Pattern: Refs with Timeouts

```javascript
// BAD: Hidden mutable state with magic timeout
const justRestoredRef = useRef(false);

useEffect(() => {
  fetchData().then(data => {
    restoreData(data);
    justRestoredRef.current = true;

    // Magic timeout - why 100ms? What if it's not enough?
    setTimeout(() => {
      justRestoredRef.current = false;
    }, 100);
  });
}, []);

// This check uses hidden state - component won't re-render when ref changes
const canSync = !justRestoredRef.current;
```

Problems:
- Ref changes don't trigger re-renders
- 100ms is arbitrary - could be too short or too long
- Behavior is invisible and hard to debug
- Effects that depend on ref state won't re-run

---

## Cross-Cutting Implementation Patterns

### Backend Sync State Machine

When syncing data between frontend and backend, use this pattern:

```javascript
// Sync states for data that loads from and saves to backend
const [syncState, setSyncState] = useState('idle');
// 'idle' - No data loaded, waiting for projectId
// 'loading' - Fetching from backend
// 'ready' - Data loaded, actions will sync to backend
// 'error' - Load failed, show error UI

// Track which project we loaded for
const [loadedProjectId, setLoadedProjectId] = useState(null);

// Load effect - only runs when needed
useEffect(() => {
  if (projectId && projectId !== loadedProjectId && syncState !== 'loading') {
    setSyncState('loading');

    fetchData(projectId)
      .then(data => {
        restoreLocalState(data);
        setLoadedProjectId(projectId);
        setSyncState('ready');
      })
      .catch(err => {
        console.error('Load failed:', err);
        setSyncState('error');
      });
  }
}, [projectId, loadedProjectId, syncState]);

// Action handlers check sync state
const handleUserAction = useCallback((actionData) => {
  // Update local state immediately (optimistic)
  updateLocalState(actionData);

  // Only sync to backend when ready
  if (syncState === 'ready') {
    api.sendAction(projectId, actionData)
      .catch(err => console.error('Sync failed:', err));
  }
}, [syncState, projectId]);
```

### Project Switching

When switching projects, reset to idle:

```javascript
useEffect(() => {
  // Reset sync state when project changes
  if (projectId !== loadedProjectId) {
    setSyncState('idle');
  }
}, [projectId, loadedProjectId]);
```

### Component Unmount Cleanup

State machines naturally handle unmount - no cleanup needed for timeouts:

```javascript
// With refs + timeouts: must clean up
useEffect(() => {
  const timer = setTimeout(...);
  return () => clearTimeout(timer);  // Required!
}, []);

// With state machine: state resets on remount
// No cleanup needed - fresh state on each mount
```

### When to Use Refs (Legitimate Cases)

Refs are appropriate for:
- DOM element references (`ref={videoRef}`)
- Values that don't affect rendering (scroll position cache)
- Mutable values in event handlers that shouldn't trigger re-renders
- Previous value comparison (`usePrevious` pattern)

Refs are NOT appropriate for:
- Controlling whether actions are allowed
- Tracking loading/ready states
- Synchronization flags
- Any value that affects component behavior

---

## Anti-Patterns

### Duplicate State Bug

```javascript
// overlayStore.js
const useOverlayStore = create((set) => ({
  workingVideo: null,  // BAD: Duplicated from projectDataStore
  setWorkingVideo: (video) => set({ workingVideo: video }),
}));

// projectDataStore.js
const useProjectDataStore = create((set) => ({
  workingVideo: null,  // This is the owner
  setWorkingVideo: (video) => set({ workingVideo: video }),
}));

// Bug: Component writes to projectDataStore but reads from overlayStore
// Result: Stale data, sync issues
```

### Correct Pattern

```javascript
// projectDataStore.js - OWNS workingVideo
const useProjectDataStore = create((set) => ({
  workingVideo: null,
  setWorkingVideo: (video) => set({ workingVideo: video }),
}));

// overlayStore.js - Does NOT have workingVideo
const useOverlayStore = create((set) => ({
  effectType: 'brightness_boost',
  highlightRegions: [],
  // No workingVideo here!
}));

// Component reads from owner
function OverlayScreen() {
  const workingVideo = useProjectDataStore(state => state.workingVideo);
  const effectType = useOverlayStore(state => state.effectType);
  // ...
}
```

---

## Migration Checklist

When fixing duplicate state:

1. **Identify the owner** - Which store should own this data?
2. **Remove from non-owners** - Delete the duplicate state and setters
3. **Update readers** - Change imports to read from owner
4. **Update writers** - Change all writes to go to owner
5. **Test all paths** - Verify data flows correctly

---

## Complete Rules

See individual rule files in `rules/` directory.
