# T12500: "Add text" dead-ends on short clips; default text "1.1"; wrong sheet title

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N10, N11 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

On a 2 s clip at 390 tapping "Add text" opens a sheet titled "Spotlight settings" (wrong title for the Text tab) that says "No text region under the playhead. Open Text under the timeline and click the lane to add one." The words text region, playhead and lane are editor jargon. Add text also prefills a meaningless "1.1". The empty-lane collapse itself is T12400, not this task.

Screenshots: rr-45, rr-88, rr-115, rr-116.

## Solution

Add text always creates a text at the current moment and says "Type your text below. It shows for 2 seconds."; title the sheet "Text"; empty field with placeholder "Name or number, e.g. #7 Maya".

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/overlay/TextManagementPanel.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/utils/textRegionPlayhead.js`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12500:`

## Acceptance Criteria

- [ ] Add text works on a 2 s clip at 390 and 1440 with no dead end
- [ ] The sheet is titled "Text" on the Text tab
- [ ] No default "1.1"; the placeholder is shown
- [ ] Test written first
