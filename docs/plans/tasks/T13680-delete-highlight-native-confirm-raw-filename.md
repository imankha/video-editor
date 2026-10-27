# T13680: Deleting a finished highlight asks with a browser popup that shows the raw file name

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 3, 2026-10-26, 1440x900, highlight "Play 1" in game2-offline-test (download id 8).

## Problem

Finished tile ⋮ > Delete opens a native `window.confirm`: `Delete "final_9_b251cb00.mp4"?`. A parent sees an internal file name, not "Play 1", and nothing says the highlight and its share links are gone for good. The rest of the app uses styled dialogs (and the CLAUDE.md "no backdrop close" modal pattern). Delete itself works (Finished 6 -> 5, persists after reload).

## Repro steps

1. Home > Finished > hover a highlight tile > ⋮ > Delete.
2. Read the prompt.

**Expected:** an in-app dialog naming the highlight ("Delete 'Play 1'?"), saying it can't be undone and that share links stop working, with Cancel / Delete.
**Actual (before fix):** native confirm with the file name.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the prompt text; a component test asserting the dialog shows the highlight name (and no `window.confirm`) fails.
2. **After the fix:** same steps: named in-app dialog; Cancel keeps it, Delete removes it (count drops, persists on reload).

## Acceptance Criteria

- [ ] In-app confirm with the highlight name and consequences
- [ ] Test fails before, passes after

## Progress Log
- 2026-10-27 QA pass 2 (staging): VERIFIED at 1440: Delete on a Finished card opens an in-app dialog 'Delete "Play 2"?' with Cancel/Delete, no native confirm. Cancelled, nothing deleted.
