# T10560: Rating popup becomes a bottom sheet on mobile, not a centered dialog

**Status:** STAGING
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Follow-up to T10550 (which made the mobile rating popup a screen-centered dialog).
User asked what the "perfect" mobile UI would look like; recommendation given and
accepted: a bottom sheet, since the rating badge already lives inside the mobile
"Edit play" bottom sheet — a centered modal floats a dialog over a dialog, whereas a
second sheet sliding up over the first reads as one consistent gesture language.

## Solution

`RatingBadge` (`PlayProgressBadges.jsx`), mobile (`max-sm:`) branch only:
- `items-center` -> `items-end` (anchors the box to the bottom edge instead of the
  vertical center); dropped the `p-4` backdrop padding so the sheet runs edge-to-edge.
- The box itself: `w-full` (uncapped, was `max-w-xs`), `rounded-t-2xl` (top corners
  only, was `rounded-xl` all around), bottom padding respects
  `env(safe-area-inset-bottom)` for notched devices.
- Added a small decorative grabber bar (`sm:hidden`, a standard bottom-sheet
  affordance) above the heading.
- Desktop (`sm:`) branch is untouched — still the anchored dropdown.

No test changes needed — the existing backdrop-click and inside-click tests
(T10550) assert on `role="presentation"`/behavior, not on the specific
centering/sheet classNames, so they remain valid unchanged.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx`

### Related Tasks
- Follow-up to T10550 (mobile dialog), which itself followed T10520/T10530.

## Implementation

### Steps
1. [x] Mobile backdrop: `items-end`, no padding, edge-to-edge
2. [x] Box: full width, top-rounded only, safe-area bottom padding, grabber
3. [x] Live-drive verified at a real 390×844 viewport (screenshot)

### Progress Log

**2026-09-19**: No test changes required (23/23 still green — the T10550 tests
target behavior/roles, not sheet-vs-dialog styling). Lint clean. Live-drive at a
real 390×844 viewport: screenshot confirms a bottom sheet anchored to the screen
edge, full width, rounded top corners, grabber bar, dim backdrop over the "Edit
play" sheet behind it.

## Acceptance Criteria

- [x] On mobile, the rating popup is a bottom sheet (anchored to the bottom edge,
      full width, rounded top corners), not a screen-centered box
- [x] Desktop anchored-dropdown behavior is unchanged
- [x] Tests pass
