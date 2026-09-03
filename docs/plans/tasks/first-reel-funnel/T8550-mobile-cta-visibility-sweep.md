# T8550: Mobile CTA visibility sweep (primary buttons above the fold)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

User report 2026-09-03: export buttons sometimes sit below the scroll line. The
walkthrough was desktop-first with only home/annotate mobile spot checks; the export
surfaces (Focus settings panel, Add Play sheet, Overlay controls) were not audited at
phone sizes. Prod context: 6 of 28 real users are mobile-only, and T8140 already found
Save below the fold in the clip form once before.

## Solution

Audit every primary CTA in the first-reel journey at 320/375/390/428 widths (keyboard
open and closed where inputs exist) and fix each finding, preferring sticky/pinned
primary actions over layout squeezing:

- Add Game submit (with the T8500 reorder)
- Add Play sheet Save (T8140 shipped a sticky Save; verify it held)
- Focus "Export Focused Video" + its inline reason (T8510)
- Overlay "Add Overlay" / skip choice (T8520)
- Reel player Share (T8540)

Add viewport e2e assertions so regressions are caught: for each surface, an assertion
that the primary CTA's bounding box intersects the viewport without scrolling.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/framing/components/ExportButtonView.jsx` and its panel container
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- Overlay mode action bar; Add Game modal; reel player toolbar
- e2e: extend the responsive spec set (responsiveness skill: real browser, not jsdom)

### Related Tasks
- Runs LAST in the epic (audits the other tasks' surfaces post-change)
- responsiveness skill is the testing workflow reference

## Implementation

### Steps
1. [ ] Matrix audit (320/375/390/428, keyboard states) with screenshots
2. [ ] Fix findings (sticky action bars preferred)
3. [ ] Viewport e2e assertions per surface
4. [ ] Record the matrix in the task file for the tutorial team (T7640 reuses it)

## Acceptance Criteria

- [ ] Every journey-primary CTA visible without scrolling at all four widths
- [ ] e2e viewport assertions in place and green
- [ ] Matrix screenshots attached to the task
