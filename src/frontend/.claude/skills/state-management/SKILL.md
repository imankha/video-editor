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
| 3 | Derivation | HIGH | `state-derive-` |

## Quick Reference

### Ownership (CRITICAL)
- `state-owner-single` - One store owns each piece of data
- `state-owner-write` - Only the owner writes to that data
- `state-owner-read` - Others read via selectors or direct import

### No Duplicates (CRITICAL)
- `state-dup-never` - Never store same data in multiple stores
- `state-dup-detect` - Watch for "sync" code between stores
- `state-dup-refactor` - Move duplicated state to single owner

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
