# T10100: Delete the two unimported dead components (CompareModelsButton, GalleryButton)

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Found as a byproduct of the T9860 design investigation: two components are unimported anywhere in
`src/frontend/src` and carry stale copy that the T9860 copy sweep would otherwise have to edit for
no reason (dead code doesn't need correct vocabulary).

- `src/frontend/src/components/CompareModelsButton.jsx` — unimported; contains a stale AI-quality
  claim ("AI Model Comparison (Experimental)", "find the best quality") that would violate T9860's
  "no quality outcome promised" rule if it were ever wired up.
- `src/frontend/src/components/GalleryButton.jsx` — unimported since T8555 moved the destination
  into the Published tab; still renders `SECTION_NAMES.LIBRARY`, which T9860 deletes (D1: retired
  in favor of `SECTION_NAMES.PUBLISHED`). If `GalleryButton.jsx` is deleted, it removes the last
  consumer of `SECTION_NAMES.LIBRARY`; if it survives, T9860's implementer must update it to avoid
  a stale reference to a deleted constant.

## Solution

Confirm each has zero importers (grep before deleting — component trees change), delete both files
and their test files if any exist, run the frontend build/lint to confirm nothing referenced them.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/CompareModelsButton.jsx`
- `src/frontend/src/components/GalleryButton.jsx`

### Related Tasks
- Found during: T9860 design investigation (`docs/plans/tasks/T9860-design.md` §5, §8)
- **Sequencing note:** if T9860 has not yet merged, confirm `GalleryButton.jsx` still has zero
  importers post-T9860 (it references `SECTION_NAMES.LIBRARY`, which T9860 deletes) before deleting
  — T9860's implementer may touch this file first as part of its own D1 cleanup.

### Technical Notes
No behavior change for any live surface — both files are confirmed dead code as of the 2026-09-14
investigation. S-tier: <10 LOC net (deletions), 2 files, no test scope beyond a build/lint check.

## Implementation

### Steps
1. [ ] Grep-confirm zero importers for both files (re-check, don't trust this task file's dated claim)
2. [ ] Delete both files (and any dedicated test files)
3. [ ] Run frontend build/lint to confirm no dangling references

### Progress Log

**2026-09-14**: Filed as a T9860 investigation byproduct, not folded into T9860's scope per the
project's standing rule (new bugs found as investigation byproducts get filed separately).

## Acceptance Criteria

- [ ] Both files deleted
- [ ] Frontend build passes with no missing-import errors
- [ ] No test regressions
