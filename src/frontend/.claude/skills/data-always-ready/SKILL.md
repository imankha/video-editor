---
name: data-always-ready
description: "React data loading pattern where parent components ensure data exists before rendering children. Apply when writing components, implementing data fetching, or reviewing loading states."
license: MIT
author: video-editor
version: 1.0.0
---

# Data Always Ready

Comprehensive data loading pattern for React applications. The frontend assumes data is loaded before rendering—components never render loading states internally.

## When to Apply
- Writing new React components
- Implementing data fetching logic
- Reviewing component architecture
- Handling loading states
- Debugging "undefined" prop errors

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Parent Guarding | CRITICAL | `data-guard-` |
| 2 | Prop Flow | HIGH | `data-prop-` |
| 3 | Path Coverage | MEDIUM | `data-path-` |

## Quick Reference

### Parent Guarding (CRITICAL)
- `data-guard-parent` - Parent verifies data before rendering child
- `data-guard-conditional` - Use conditional rendering, not internal checks
- `data-guard-screen` - Screens are the ultimate data guards

### Prop Flow (HIGH)
- `data-prop-flow` - Pass saved state as props, restore in hooks
- `data-prop-no-timing` - Avoid timing-dependent restoration
- `data-prop-derived` - Derive computed values from props

### Path Coverage (MEDIUM)
- `data-path-all-conditions` - All paths must satisfy all conditions
- `data-path-streaming` - Handle streaming URL edge cases
- `data-path-fallback` - Provide metadata fallbacks for edge cases

---

## Complete Rules

See individual rule files in `rules/` directory.
