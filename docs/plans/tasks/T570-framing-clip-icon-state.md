# T570: Framing Clip "!" Icon Doesn't Clear After Framing + No Tooltip

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-03-18

## Problem

In the framing screen, clips show a "!" icon (presumably indicating the clip needs to be framed). Two issues:

1. The icon doesn't go away after the clip has been framed (crop_data set)
2. There's no rollover/tooltip text explaining what the icon means

## Solution

1. Hide the "!" icon when the clip has crop_data (framed)
2. Add a tooltip like "This clip needs to be framed"

## Context

### Relevant Files
- Framing screen clip list component (likely in `src/frontend/src/screens/FramingScreen.jsx` or a sub-component)
- Look for the "!" icon rendering and check what condition controls its visibility

### Related Tasks
- Discovered during T540 (Quest System) testing

## Acceptance Criteria

- [ ] "!" icon disappears after clip is framed (has crop_data)
- [ ] Hovering over "!" shows tooltip explaining the icon
