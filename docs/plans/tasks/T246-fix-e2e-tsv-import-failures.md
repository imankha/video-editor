# T246: Fix E2E TSV Import Failures

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-18
**Updated:** 2026-02-18

## Problem

15 of 24 E2E tests fail because TSV import doesn't produce visible clips in the sidebar. All 15 share the same root cause — they depend on a shared helper (`enterAnnotateModeWithClips` or `ensureAnnotateModeWithClips`) that imports a TSV file and waits for clip text like `"Good Pass"` or `"Great Control Pass"` to appear. The clips never appear.

**This is pre-existing on `master`** — confirmed by running the same test on master and getting the identical failure.

### Error Context from Page Snapshot

The page snapshot at failure time reveals two critical clues:

1. **Import Errors toast visible**: `"Line 2: Invalid tags: Possession"` — The TSV has tags like `Possession,Pass` but the app rejects `"Possession"` as an invalid tag. The tag validation has changed since the TSV fixture was written, so the import partially fails.

2. **Sidebar shows**: `"Clips: 0"` and `"No clips yet"` — Zero clips were imported because the tag validation rejects the rows.

3. **Upload status**: `"Part 1 network error"` — The video upload also fails (likely because E2E tests run without R2, and the upload path has issues in local mode). This may be a contributing factor since clip extraction requires the video file.

### Root Cause Analysis

The TSV fixture (`formal annotations/test.short/test.short.tsv`) contains tags that are no longer valid:

```tsv
start_time	rating	tags	clip_name	clip_duration	notes
0:03	4	Possession,Pass	Great Control Pass	6.0	Great control and pass
0:13	4	Dribble	Full Effort Play	6.0	Good job giving it all you got
0:59	4	Pass	Good Pass	4.5	<notes>
```

The app's valid tag set was changed (likely during a tags refactor — see T62: Tag Changes) but the TSV test fixture was never updated to match. The TSV import rejects rows with unrecognized tags, resulting in 0 clips.

Two things need fixing:
1. **TSV fixture tags** — Update to use valid tag names that the current app accepts
2. **Video upload in E2E** — The `"Part 1 network error"` suggests the upload path also fails, which would prevent clip extraction even if TSV import succeeds

## Solution

1. Check what tags the app currently accepts (look at the tag constants/validation)
2. Update `test.short.tsv` to use only valid tags
3. Investigate and fix the `"Part 1 network error"` for video uploads in E2E test mode
4. Verify all 15 tests pass after the fix

## Context

### Relevant Files
- `formal annotations/test.short/test.short.tsv` — TSV fixture with invalid tags
- `src/frontend/e2e/full-workflow.spec.js` — 8 of the 15 failing tests (helper: `enterAnnotateModeWithClips`, line 63)
- `src/frontend/e2e/regression-tests.spec.js` — 6 of the 15 failing tests (helper: `ensureAnnotateModeWithClips`, line 450)
- `src/frontend/e2e/game-loading.spec.js` — 1 of the 15 failing tests (inline TSV import, line 158)
- TSV import/parsing logic (frontend) — wherever tags are validated against allowed list
- Video upload logic — wherever the "Part 1 network error" originates

### Related Tasks
- T245: Fix Highlight Regions Test (another pre-existing test failure)

### Technical Notes
- The test fixture is **not in the git repo** (lives at `formal annotations/test.short/` which is likely gitignored)
- The `"Part 1 network error"` appears in the upload status area, suggesting multipart upload to R2 fails in the E2E test environment (tests run with R2 enabled but may have network issues)
- All 15 failures cascade from the same two root causes — fixing them should resolve all tests at once

## Failing Tests (all 15)

### `e2e/full-workflow.spec.js` (8 tests)
| Line | Test Name | Suite |
|------|-----------|-------|
| 205 | 2. Annotate Mode - Upload video and import TSV | Full Workflow Tests |
| 214 | 3. Annotate Mode - Export TSV round-trip | Full Workflow Tests |
| 232 | 4. Create Annotated Video button is enabled after upload | Full Workflow Tests |
| 245 | 5. Create Annotated Video API call succeeds | Full Workflow Tests |
| 357 | Edit clip rating via UI | Clip Editing Tests |
| 377 | Edit clip name via UI | Clip Editing Tests |
| 400 | Clip sidebar shows imported clips | UI Component Tests |
| 410 | Star rating is visible for clips | UI Component Tests |

### `e2e/regression-tests.spec.js` (6 tests)
| Line | Test Name | Suite |
|------|-----------|-------|
| 1050 | Annotate: TSV import shows clips @smoke | Smoke Tests |
| 1095 | Annotate: timeline click moves playhead @smoke | Smoke Tests |
| 1158 | Framing: video first frame loads @smoke | Smoke Tests |
| 1200 | Framing: crop window is stable (no infinite loop) @smoke | Smoke Tests |
| 1269 | Framing: spacebar toggles play/pause @smoke | Smoke Tests |
| 1367 | Create project from library clips @full | Full Coverage Tests |

### `e2e/game-loading.spec.js` (1 test)
| Line | Test Name | Suite |
|------|-----------|-------|
| 76 | Load saved game into annotate mode | Game Loading Debug |

## Acceptance Criteria

- [ ] TSV fixture uses valid tags that the app accepts
- [ ] Video upload succeeds in E2E test environment (no "Part 1 network error")
- [ ] All 15 previously-failing E2E tests pass
- [ ] No regressions in the 9 currently-passing tests
