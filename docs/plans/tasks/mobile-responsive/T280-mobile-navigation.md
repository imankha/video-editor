# T280: Mobile Navigation

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

The top navigation bar overflows on mobile. Buttons like "Framing", "Annotate", "Gallery" are truncated or clipped off the right edge. This affects every screen — users can't reliably access navigation targets.

Observed on:
- Framing screen: "Framing" button cut off right edge
- Annotate screen: "Ann..." truncated
- Home screen: "Gallery" button partially hidden

## Solution

Make the top nav responsive for narrow screens. Options:
- Horizontal scroll with overflow-x-auto
- Collapse into a hamburger/dropdown menu below a breakpoint
- Reduce padding/font-size on nav items at mobile widths
- Use icon-only buttons on mobile (tooltip on long-press)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/Header.jsx` or equivalent nav component
- `src/frontend/src/App.jsx` - Top-level layout
- Tailwind config / global CSS

### Related Tasks
- Part of: Mobile Responsive epic

## Implementation

### Steps
1. [ ] Identify the nav component and current layout approach
2. [ ] Add responsive breakpoint (e.g., `md:` or `sm:`) to switch layout
3. [ ] Test on 360px and 428px widths
4. [ ] Verify all nav targets are accessible

## Acceptance Criteria

- [ ] All nav buttons visible and tappable on 360px width
- [ ] No horizontal overflow from nav bar
- [ ] Works on all screens (home, annotate, framing, overlay)
