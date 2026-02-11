---
name: mvc-pattern
description: "Screen → Container → View architecture pattern. Screens own data, Containers handle logic, Views are presentational. Apply when creating features, refactoring components, or reviewing architecture."
license: MIT
author: video-editor
version: 1.0.0
---

# MVC Pattern

Component architecture pattern that separates data ownership, business logic, and presentation into distinct layers.

## When to Apply
- Creating new features or screens
- Refactoring existing components
- Reviewing component architecture
- Deciding where to put new logic
- Debugging data flow issues

## Architecture Overview

```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Screen Layer | CRITICAL | `mvc-screen-` |
| 2 | Container Layer | CRITICAL | `mvc-container-` |
| 3 | View Layer | CRITICAL | `mvc-view-` |
| 4 | Boundaries | HIGH | `mvc-boundary-` |

## Quick Reference

### Screen Layer (CRITICAL)
- `mvc-screen-owns-data` - Screens own all hooks and data fetching
- `mvc-screen-guards` - Screens guard data before rendering containers
- `mvc-screen-self-contained` - Screens don't receive props from App

### Container Layer (CRITICAL)
- `mvc-container-receives-props` - Containers receive all data as props
- `mvc-container-handlers` - Containers define event handlers
- `mvc-container-derived-state` - Containers manage derived/local state

### View Layer (CRITICAL)
- `mvc-view-no-hooks` - Views never use hooks
- `mvc-view-no-fetch` - Views never fetch data
- `mvc-view-pure-props` - Views are pure functions of their props

### Boundaries (HIGH)
- `mvc-boundary-no-drilling` - No prop drilling through App
- `mvc-boundary-stores` - Use Zustand stores for cross-screen state
- `mvc-boundary-composition` - Prefer composition over inheritance

---

## Component Composition Pattern

When a View needs business logic, compose Container + View explicitly in the parent View:

```jsx
// 1. Create a section component that composes Container + View
const ExportButtonSection = forwardRef(function ExportButtonSection({
  videoFile,
  cropKeyframes,
  // ... other props
}, ref) {
  // Container: all business logic
  const container = ExportButtonContainer({
    videoFile,
    cropKeyframes,
    // ... pass through props
  });

  // View: pure presentation
  return (
    <div className="mt-6">
      <ExportButtonView
        ref={ref}
        isExporting={container.isExporting}
        onExport={container.handleExport}
        // ... pass container state/handlers to view
      />
    </div>
  );
});

// 2. Use the section in the parent View
function FramingModeView({ ...props }) {
  return (
    <>
      {/* ... other UI ... */}
      <ExportButtonSection
        videoFile={props.videoFile}
        cropKeyframes={props.cropKeyframes}
        // ... pass only what the section needs
      />
    </>
  );
}
```

### Why This Pattern?

1. **No wrapper components** - Don't create "smart" wrappers that hide Container+View composition
2. **Explicit composition** - The parent View explicitly shows Container and View being combined
3. **Clear data flow** - Props flow: Parent View → Section → Container → View
4. **Testable** - Container and View can be tested independently

### File Structure

```
components/
  ExportButtonView.jsx      # Pure view (props only)
containers/
  ExportButtonContainer.jsx # Business logic (hooks, state, handlers)
modes/
  FramingModeView.jsx       # Composes ExportButtonSection inline
```

---

## Complete Rules

See individual rule files in `rules/` directory.
