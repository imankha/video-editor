# T14230: "Highlight Generating" card covers editor action buttons on phones

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-10-31
**Updated:** 2026-10-31

## Problem

QA sweep 2026-10-31, 390x844. While a highlight generates, the floating
"1 Highlight Generating" card (`GlobalExportIndicator`, `fixed bottom-4 right-4 z-50`) sits on
top of the editor's bottom action area in Frame and Spotlight. In Spotlight it hides most of
"Add text" and part of the generation button. Users cannot tell which controls are still
available. QA did not prove the buttons are unclickable, but they are visually obscured.

## Solution

Progress stays readable and editor controls stay unobstructed at phone width. Options for the
UX pass (pick one with the user, per the UX-expert-before-user-tests rule):
1. While an editor screen with a bottom action bar is mounted, dock the indicator ABOVE that bar
   (bar exposes its height, e.g. a CSS variable), or
2. On phone width inside editors, collapse the card to a compact pill (icon + %) that does not
   overlap the action buttons, expanding on tap, or
3. Render the progress inline in the editor's own generation button area and hide the floating
   card on that screen.

Desktop layout must not regress.

## Context

### Relevant Files
- `src/frontend/src/components/GlobalExportIndicator.jsx` - floating card (line ~363)
- `src/frontend/src/containers/ExportButtonContainer.jsx` - generation button in editors
- Frame and Spotlight (overlay) mode views' bottom action bars

### Knowledge Docs
- `.claude/knowledge/export-pipeline.md`
- `.claude/references/ui-style-guide.md`

## Acceptance Criteria

- [ ] At 390x844 in Frame and Spotlight during generation, no action button is overlapped
      (assert bounding boxes do not intersect in a real-browser test)
- [ ] Progress (title + %) stays readable
- [ ] Desktop layout unchanged
