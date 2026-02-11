# Coding Standards

Single source of truth for implementation rules. Referenced by:
- [Architect Agent](../agents/architect.md) - designs to these standards
- [Implementor Agent](../agents/implementor.md) - builds to these standards
- [Refactor Agent](../agents/refactor.md) - enforces these standards
- [Reviewer Agent](../agents/reviewer.md) - verifies these standards

---

## MVC + Data Always Ready

### Component Hierarchy

```
Screen (data fetching, guards data readiness)
  └── Container (state logic, event handlers)
        └── View (presentational only, assumes data exists)
```

| Layer | Responsibility | Data Handling |
|-------|---------------|---------------|
| **Screen** | Fetch data, loading states, error boundaries | Guards: `if (!data) return <Loading />` |
| **Container** | Business logic, event handlers, state management | Receives guarded data, passes to View |
| **View** | Render UI, purely presentational | Assumes data exists, NO null checks |

### Data Always Ready Pattern

Parents guard, children assume:

```jsx
// Screen - guards data
function FeatureScreen() {
  const { data, isLoading } = useFeatureData();
  if (isLoading) return <Loading />;
  if (!data) return <Empty />;
  return <FeatureContainer data={data} />;
}

// Container - receives guarded data
function FeatureContainer({ data }) {
  const handleAction = useCallback(() => { ... }, []);
  return <FeatureView data={data} onAction={handleAction} />;
}

// View - assumes data exists, NO null checks
function FeatureView({ data, onAction }) {
  return <div onClick={onAction}>{data.name}</div>;
}
```

### Reactive Updates

- State lives in Zustand stores or Screen-level hooks
- Views subscribe and re-render on changes
- No imperative "refresh" calls
- Props flow down, events flow up

---

## State Management

### Single Source of Truth

Every piece of data has ONE authoritative location:

```javascript
// BAD: Same data in two places
overlayStore: { workingVideo: video }
framingStore: { workingVideo: video }  // Can disagree!

// GOOD: One source, others reference
videoStore: { workingVideo: video }
// overlayStore and framingStore use videoStore.workingVideo
```

### Derive, Don't Duplicate

Compute values from source of truth instead of storing separately:

```javascript
// BAD: Multiple variables for same state
const [isLoading, setIsLoading] = useState(false);
const [status, setStatus] = useState('idle');
// Can disagree! isLoading=true but status='idle'

// GOOD: One source, derive the rest
const [status, setStatus] = useState('idle');
const isLoading = status === 'loading';  // Derived
const isError = status === 'error';      // Derived
```

### State Location Guide

| State Type | Location | Example |
|------------|----------|---------|
| Shared across app | Zustand store | Current project, user settings |
| Shared in feature | Feature store | Overlay regions, framing keyframes |
| Local to component | useState/useReducer | Form input, dropdown open |
| Derived | Computed in render | `isLoading = status === 'loading'` |

---

## Loose Coupling, Tight Cohesion

### Tight Cohesion

Each module does ONE thing. All methods relate to that purpose:

```javascript
// GOOD: All methods relate to video playback
class VideoPlayer {
  play() {}
  pause() {}
  seek(time) {}
  getCurrentTime() {}
}

// BAD: Unrelated responsibilities
class VideoManager {
  play() {}
  uploadToCloud() {}  // Different concern
  sendAnalytics() {}  // Different concern
}
```

### Loose Coupling

Depend on abstractions, not concrete implementations:

```javascript
// BAD: Tightly coupled to Modal
function ExportButton() {
  const result = await ModalClient.process(file);
}

// GOOD: Loosely coupled via abstraction
function ExportButton({ processor }) {
  const result = await processor.process(file);
}
```

---

## Type Safety

### Preference Hierarchy

**Magic Strings < Enums < Typed Objects**

```javascript
// BAD: Magic strings - no autocomplete, typos cause bugs
if (editorMode === 'framing') ...

// BETTER: Enum/constants - autocomplete, typo = error
const EDITOR_MODES = { FRAMING: 'framing', OVERLAY: 'overlay' };
if (editorMode === EDITOR_MODES.FRAMING) ...

// BEST: Typed object - carries data, methods, validation
class EditorMode {
  static FRAMING = new EditorMode('framing', { canExport: true });
  static OVERLAY = new EditorMode('overlay', { canExport: true });

  constructor(value, config) {
    this.value = value;
    this.canExport = config.canExport;
  }
}
if (editorMode === EditorMode.FRAMING) ...
if (editorMode.canExport) ...  // Behavior attached to type
```

### When to Use Each

| Level | Use When |
|-------|----------|
| **Enum/Const** | Simple flags, modes, statuses with no associated data |
| **Typed Object** | Types need associated data, methods, or validation |

### Constants Locations

| Type | Location |
|------|----------|
| Editor modes | `src/frontend/src/constants/editorModes.js` |
| Export status | `src/frontend/src/constants/exportStatus.js` |
| Segment status | `src/frontend/src/constants/segmentStatus.js` |
| Keyframe origins | `src/frontend/src/constants/keyframes.js` |
| Backend enums | `src/backend/app/constants/` |

---

## Data Guards

### External Boundaries Only

Validate data at system boundaries (user input, API responses):

```javascript
// At API boundary - guard
const clips = await api.getClips();
if (!Array.isArray(clips)) {
  console.error('[getClips] Invalid response:', clips);
  return [];
}

// Internal code - trust the data
clips.forEach(c => process(c));  // No null check needed
```

### No Silent Fallbacks

Don't hide bugs with fallbacks for internal data:

```javascript
// BAD: Silently uses default, hides the bug
const fps = region.fps || 30;

// GOOD: Make the bug visible
if (!region.fps) {
  console.warn(`[Component] Region ${region.id} missing fps`);
}
const fps = region.fps;
```

---

## Code Organization

### DRY (Don't Repeat Yourself)

Extract shared logic:

```javascript
// BAD: Same logic in two places
// ComponentA.jsx
const toggle = () => setEnabled(!enabled);

// ComponentB.jsx
const toggle = () => setEnabled(!enabled);

// GOOD: Shared hook
function useToggle(initial = false) {
  const [enabled, setEnabled] = useState(initial);
  const toggle = useCallback(() => setEnabled(e => !e), []);
  return [enabled, toggle];
}
```

### Single Code Path

One way to do each thing:

```javascript
// BAD: Two ways to save
function saveViaButton() { api.save(data); }
function saveViaKeyboard() { api.save(data); }  // Duplicate!

// GOOD: One save function, multiple triggers
function save() { api.save(data); }
// Button and keyboard both call save()
```

### Minimal Branching

Prefer strategy/routing over if/else sprawl:

```javascript
// BAD: Sprawling conditionals
if (type === 'framing') { handleFraming(); }
else if (type === 'overlay') { handleOverlay(); }
else if (type === 'annotate') { handleAnnotate(); }

// GOOD: Strategy pattern
const handlers = {
  framing: handleFraming,
  overlay: handleOverlay,
  annotate: handleAnnotate,
};
handlers[type]();
```

---

## Backend Patterns

### Router → Service → Repository

```python
# Router - HTTP concerns only
@router.post("/feature/{id}")
async def update_feature(id: str, data: FeatureUpdate):
    feature = get_feature(id)
    if not feature:
        raise HTTPException(404, "Feature not found")
    result = process_feature(feature, data)  # Delegate to service
    return {"success": True, "data": result}

# Service - business logic, no HTTP
def process_feature(feature: Feature, update: FeatureUpdate) -> Feature:
    return feature.apply(update)
```

### Python Enums

```python
from enum import Enum

class ExportMode(str, Enum):
    FAST = "fast"
    QUALITY = "quality"

# Usage
if export_mode == ExportMode.FAST:
    ...
```

---

## Quick Reference

| Rule | Check |
|------|-------|
| MVC | Screen → Container → View hierarchy? |
| Data Always Ready | Parents guard, Views assume? |
| Single Source | One authoritative location for each data? |
| Derive Don't Duplicate | Computed values, not stored duplicates? |
| No Magic Strings | Constants for repeated values? |
| External Guards Only | Validation at boundaries, trust internal? |
| DRY | No duplicate logic? |
| Single Code Path | One way to do each thing? |
| Loose Coupling | Depends on abstractions? |
| Tight Cohesion | Each module does one thing? |
