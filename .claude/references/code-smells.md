# Code Smells Reference

Based on Martin Fowler's "Refactoring: Improving the Design of Existing Code"

## Quick Reference

| Smell | Symptom | Refactoring |
|-------|---------|-------------|
| Duplicated Code | Same code in multiple places | Extract Method/Hook |
| Long Method | Method doing too much | Extract Method |
| Large Class | Class with too many responsibilities | Extract Class/Hook |
| Long Parameter List | Function takes many args | Parameter Object |
| Feature Envy | Method uses another class's data more | Move Method |
| Data Clumps | Same data groups appear together | Extract Class |
| Primitive Obsession | Using primitives instead of objects | Value Object |
| Switch Statements | Complex conditionals | Strategy Pattern |
| Shotgun Surgery | One change requires many edits | Move Method, Consolidate |
| Divergent Change | Class changes for different reasons | Extract Class |

---

## Bloaters

### Long Method
**Symptom**: Method has too many lines, does multiple things.
```javascript
// BAD: One method doing everything
function handleExport() {
  // 50 lines of validation
  // 30 lines of preparation
  // 40 lines of API call
  // 20 lines of cleanup
}
```
**Refactoring**: Extract Method
```javascript
// GOOD: Each step is its own method
function handleExport() {
  const validated = validateExport();
  const prepared = prepareExport(validated);
  const result = await executeExport(prepared);
  return cleanupExport(result);
}
```

### Large Class
**Symptom**: Class/component has too many methods, state, or responsibilities.
```jsx
// BAD: Component does too much
function OverlayScreen() {
  // 20 useState calls
  // 15 useEffect calls
  // 30 handler functions
  // 500 lines of JSX
}
```
**Refactoring**: Extract Class → Custom Hooks + Subcomponents
```jsx
// GOOD: Responsibilities split
function OverlayScreen() {
  const video = useVideoState();
  const highlights = useHighlightRegions();
  const detection = usePlayerDetection();

  return <OverlayContainer {...{video, highlights, detection}} />;
}
```

### Long Parameter List
**Symptom**: Function takes 4+ parameters.
```javascript
// BAD: Too many parameters
function exportVideo(file, format, quality, width, height, fps, codec, audio) {}
```
**Refactoring**: Introduce Parameter Object
```javascript
// GOOD: Single config object
function exportVideo(config: ExportConfig) {}

interface ExportConfig {
  file: File;
  format: 'mp4' | 'webm';
  quality: number;
  dimensions: { width: number; height: number };
  fps: number;
  codec: string;
  includeAudio: boolean;
}
```

### Data Clumps
**Symptom**: Same group of data appears together repeatedly.
```javascript
// BAD: Same params repeated everywhere
function drawBox(x, y, width, height) {}
function moveBox(x, y, width, height, newX, newY) {}
function resizeBox(x, y, width, height, newWidth, newHeight) {}
```
**Refactoring**: Extract Class
```javascript
// GOOD: Data grouped into object
class Box {
  constructor(public x, public y, public width, public height) {}
  move(newX, newY) { this.x = newX; this.y = newY; }
  resize(newWidth, newHeight) { ... }
}
```

---

## Object-Orientation Abusers

### Switch Statements
**Symptom**: Complex switch/if-else based on type.
```javascript
// BAD: Switch on type
function processExport(type) {
  switch (type) {
    case 'framing': return processFraming();
    case 'overlay': return processOverlay();
    case 'annotate': return processAnnotate();
  }
}
```
**Refactoring**: Replace with Strategy/Polymorphism
```javascript
// GOOD: Strategy pattern
const exportStrategies = {
  framing: new FramingExportStrategy(),
  overlay: new OverlayExportStrategy(),
  annotate: new AnnotateExportStrategy(),
};

function processExport(type) {
  return exportStrategies[type].process();
}
```

### Primitive Obsession
**Symptom**: Using strings/numbers where objects would be clearer.
```javascript
// BAD: Magic strings everywhere
const status = 'processing';
if (status === 'processing') { ... }
if (status === 'complete') { ... }
```
**Refactoring**: Replace with Value Object / Enum
```javascript
// GOOD: Type-safe enum
const ExportStatus = {
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

type ExportStatus = typeof ExportStatus[keyof typeof ExportStatus];
```

### Refused Bequest
**Symptom**: Subclass doesn't use parent's methods/data.
**Refactoring**: Replace Inheritance with Composition
```javascript
// BAD: Inheritance for code reuse
class VideoExporter extends BaseExporter { /* ignores most parent methods */ }

// GOOD: Composition
class VideoExporter {
  constructor(private helper: ExportHelper) {}
}
```

---

## Change Preventers

### Divergent Change
**Symptom**: One class changes for multiple unrelated reasons.
```javascript
// BAD: Changes for UI, API, and storage reasons
class ClipManager {
  renderClip() { ... }      // UI change
  fetchClip() { ... }       // API change
  saveToStorage() { ... }   // Storage change
}
```
**Refactoring**: Extract Class
```javascript
// GOOD: Single responsibility each
class ClipRenderer { ... }
class ClipApi { ... }
class ClipStorage { ... }
```

### Shotgun Surgery
**Symptom**: One logical change requires editing many files.
```javascript
// BAD: Adding a new export type touches 10 files
// - exportTypes.js
// - ExportButton.jsx
// - exportApi.js
// - exportRouter.py
// - ... 6 more files
```
**Refactoring**: Move Method, Consolidate
```javascript
// GOOD: Export type is self-contained
// New type = one new file + one registration
registerExportType('newType', new NewTypeExporter());
```

### Parallel Inheritance Hierarchies
**Symptom**: Creating subclass in one hierarchy requires subclass in another.
**Refactoring**: Move Method to eliminate one hierarchy

---

## Dispensables

### Duplicate Code
**Symptom**: Same code in multiple places.
```javascript
// BAD: Same logic in two components
// ComponentA.jsx
const handleToggle = () => setEnabled(!enabled);

// ComponentB.jsx
const handleToggle = () => setEnabled(!enabled);
```
**Refactoring**: Extract Method/Hook
```javascript
// GOOD: Shared hook
function useToggle(initial = false) {
  const [enabled, setEnabled] = useState(initial);
  const toggle = useCallback(() => setEnabled(e => !e), []);
  return [enabled, toggle];
}
```

### Lazy Class
**Symptom**: Class that doesn't do enough to justify existence.
**Refactoring**: Inline Class - merge into caller

### Speculative Generality
**Symptom**: "We might need this someday" abstractions.
```javascript
// BAD: Abstract factory for one implementation
class ExporterFactory {
  createExporter(type) {
    if (type === 'video') return new VideoExporter();
    // No other types exist or are planned
  }
}
```
**Refactoring**: Remove - use concrete class until needed
```javascript
// GOOD: Direct usage until we actually need abstraction
const exporter = new VideoExporter();
```

### Dead Code
**Symptom**: Code that's never executed.
**Refactoring**: Remove it

### Comments (as Deodorant)
**Symptom**: Comments explaining confusing code.
```javascript
// BAD: Comment explains unclear code
// Check if the clip is valid and ready for export
if (clip && clip.status === 'ready' && clip.duration > 0 && !clip.error) { ... }
```
**Refactoring**: Extract Method with good name
```javascript
// GOOD: Method name is self-documenting
if (isClipReadyForExport(clip)) { ... }

function isClipReadyForExport(clip) {
  return clip && clip.status === 'ready' && clip.duration > 0 && !clip.error;
}
```

---

## Couplers

### Feature Envy
**Symptom**: Method uses another object's data more than its own.
```javascript
// BAD: Method is more interested in clip than in this
class Exporter {
  getExportFilename(clip) {
    return `${clip.project}_${clip.name}_${clip.timestamp}.mp4`;
  }
}
```
**Refactoring**: Move Method
```javascript
// GOOD: Method lives with the data it uses
class Clip {
  getExportFilename() {
    return `${this.project}_${this.name}_${this.timestamp}.mp4`;
  }
}
```

### Inappropriate Intimacy
**Symptom**: Classes are too involved with each other's internals.
**Refactoring**: Move Method, Extract Class, Hide Delegate

### Message Chains
**Symptom**: `a.getB().getC().getD().doSomething()`
**Refactoring**: Hide Delegate
```javascript
// BAD: Long chain
const name = project.getClip().getMetadata().getName();

// GOOD: Direct accessor
const name = project.getClipName();
```

### Middle Man
**Symptom**: Class that only delegates to another class.
```javascript
// BAD: Just passes through
class ClipManager {
  getClip(id) { return this.storage.getClip(id); }
  saveClip(clip) { return this.storage.saveClip(clip); }
  deleteClip(id) { return this.storage.deleteClip(id); }
}
```
**Refactoring**: Remove Middle Man - use storage directly

---

## Project-Specific Rules

See **[Coding Standards](coding-standards.md)** for project-specific implementation rules (MVC, state management, type safety, etc.).
