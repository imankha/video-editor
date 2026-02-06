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

## Complete Rules

See individual rule files in `rules/` directory.
