# T700: Quest Panel Smart Positioning

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-03-23
**Updated:** 2026-03-23

## Problem

The quest panel (floating NUF overlay) overlaps interactive UI elements — sidebar clip lists, clip details, form inputs — when positioned at its default bottom-left location. Previous attempts to fix this used increasingly complex JavaScript positioning (MutationObserver, elementsFromPoint sampling, sidebar detection, debounced re-checks) which caused:

- Panel jumping/thrashing on every DOM mutation
- Panel moving when it shouldn't (resize, style changes)
- Stale positioning after navigation (sidebar appears but panel doesn't move)
- Race conditions between panel measurement and sidebar rendering

**Root cause:** Using imperative JavaScript to solve a layout problem. The panel's position should be determined by the page layout, not by JavaScript measuring DOM elements after the fact.

## Requirements

1. Quest panel must not overlap interactive UI (sidebars, form controls, buttons, text inputs)
2. Panel should prefer bottom-left position when there's clear space
3. When a sidebar is present (annotate, framing), panel should sit to its right or in another clear area
4. Panel must not jump or thrash during normal interaction (typing, clicking, scrolling)
5. Position should update on route navigation (different screens have different layouts)
6. Mobile/desktop breakpoint should be respected (different padding)
7. Solution should be CSS-first where possible, with minimal JavaScript

## Solution

Consider these approaches (in order of preference):

### Option A: CSS-based positioning with layout awareness
- Render the quest panel inside the main content area's layout flow rather than as a fixed overlay
- Use CSS `position: sticky` or place it in a known layout slot
- The parent layout already knows about sidebars — let CSS handle the offset

### Option B: Simple sidebar-aware fixed positioning
- On mount, check for `[data-sidebar]` elements once
- Set `left` offset based on sidebar width
- Re-check only on route changes (detect via `useLocation` or similar React hook, NOT MutationObserver)
- No resize listener, no DOM observation, no elementsFromPoint

### Option C: Portal into a layout-aware container
- Each screen provides a "quest panel slot" in its layout
- Quest panel renders via portal into whatever slot is available
- The slot is already positioned correctly by the screen's CSS layout

## Context

### Relevant Files
- `src/frontend/src/components/QuestPanel.jsx` — Current positioning logic (updatePosition, ensurePosition, hasUIOverlap)
- `src/frontend/src/components/ClipSelectorSidebar.jsx` — Has `data-sidebar` attribute
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Has `data-sidebar` attribute
- `src/frontend/src/screens/AnnotateScreen.jsx` — Annotate layout with sidebar
- `src/frontend/src/screens/FramingScreen.jsx` — Framing layout with sidebar
- `src/frontend/src/screens/ProjectsScreen.jsx` — No sidebar

### Related Tasks
- Depends on: None
- Blocks: None

### Technical Notes
- The quest panel is rendered in `App.jsx` at the app level, not inside any specific screen. This is why it doesn't know about sidebars — it's outside their layout context.
- The panel already has compact sizing (340px width, reduced padding) from earlier work — that should be kept.
- The `data-sidebar` attribute exists on both ClipsSidePanel (annotate) and ClipSelectorSidebar (framing).

## Acceptance Criteria

- [ ] Panel doesn't overlap sidebars or interactive UI on any screen
- [ ] Panel doesn't jump or thrash during normal interaction
- [ ] Panel position updates correctly when navigating between screens
- [ ] Mobile/desktop breakpoint respected
- [ ] No MutationObserver, no elementsFromPoint, no debounce timers
- [ ] Solution uses CSS-first approach or minimal JS (route change detection only)
