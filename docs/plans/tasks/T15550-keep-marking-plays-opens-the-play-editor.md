# T15550: Keep marking plays opens the play editor instead of returning to marking

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Mark a play, then tap 'Keep marking plays'.

**Expected:** Back to Annotate to mark the next play.

**Actual:** It created a highlight and opened Edit play ('Highlights from this play: Portrait IN PROGRESS'); the second play needed the top 'Mark Plays' button. The helper text ('Saves this play as a highlight in Plays...') contradicts the label.

## Acceptance Criteria

- [ ] 'Keep marking plays' returns to Annotate with the playhead after the marked play.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T14770, T14610

### Relevant Files (REQUIRED)
- To be found.
