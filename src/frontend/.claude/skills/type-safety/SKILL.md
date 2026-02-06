---
name: type-safety
description: "Prefer typed constants over magic strings in JavaScript/React. Use `as const` objects for type-safe string literals with autocomplete support."
license: MIT
author: video-editor
version: 1.0.0
---

# Type Safety (React/JavaScript)

Avoid magic strings. Use constant objects with `as const` for type safety and autocomplete.

## When to Apply

- Defining modes (crop, pan, zoom)
- Defining status values (pending, complete, error)
- Defining types (video, image, audio)
- Any string compared with `===`

## The Pattern

```
BEST:    Constant objects with `as const`
BAD:     Magic strings
```

---

## Examples

### Bad: Magic Strings
```javascript
// BAD: Typos cause silent bugs, no autocomplete
if (editorMode === 'frmaing') {  // Typo! Silent bug
  showFramingUI();
}

if (status === 'complte') {  // Typo! Never matches
  showSuccess();
}
```

### Good: Constant Objects
```javascript
// constants/editorModes.js
export const EDITOR_MODES = {
  ANNOTATE: 'annotate',
  FRAMING: 'framing',
  OVERLAY: 'overlay',
  PROJECT_MANAGER: 'project-manager',
} as const;

// Usage - typos caught, autocomplete works
if (editorMode === EDITOR_MODES.FRAMING) {
  showFramingUI();
}
```

### Good: Status Constants
```javascript
// constants/status.js
export const SEGMENT_STATUS = {
  DONE: 'done',
  EXPORTING: 'exporting',
  IN_PROGRESS: 'in_progress',
  READY: 'ready',
  EXTRACTING: 'extracting',
  PENDING_EXTRACTION: 'pending_extraction',
} as const;

// Usage
if (segment.status === SEGMENT_STATUS.DONE) {
  showComplete();
}
```

### Good: Keyframe Origins
```javascript
// constants/keyframes.js
export const KEYFRAME_ORIGINS = {
  PERMANENT: 'permanent',
  USER: 'user',
  TRIM: 'trim',
} as const;

// Usage
if (keyframe.origin === KEYFRAME_ORIGINS.PERMANENT) {
  // Can't delete permanent keyframes
}
```

---

## File Organization

```
src/frontend/src/
└── constants/
    ├── index.js           # Re-exports all constants
    ├── editorModes.js
    ├── status.js
    ├── keyframes.js
    └── sourceTypes.js
```

---

## TypeScript Types (if using TS)

```typescript
export const EDITOR_MODES = {
  ANNOTATE: 'annotate',
  FRAMING: 'framing',
  OVERLAY: 'overlay',
} as const;

// Derive type from constant
type EditorMode = typeof EDITOR_MODES[keyof typeof EDITOR_MODES];
// Result: 'annotate' | 'framing' | 'overlay'
```

---

## Migration Checklist

When refactoring magic strings:

1. [ ] Create constant file in `src/constants/`
2. [ ] Define all values as `as const` object
3. [ ] Find all usages: `grep -rn "=== 'value'" src/`
4. [ ] Replace with constant reference
5. [ ] Import constant where needed
6. [ ] Verify no string literals remain

---

## Complete Rules

See individual rule files in `rules/` directory.
