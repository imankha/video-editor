# T247: Fix E2E Clip Extraction Timeout

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-18
**Updated:** 2026-02-18

## Problem

5 E2E tests fail because FFmpeg clip extraction never completes in the E2E test environment. After TSV import succeeds and clips appear in the UI, the tests wait for clips to be saved to the library (requiring backend FFmpeg extraction). The extraction never finishes, causing a 2-minute timeout.

This was partially masked by T246 (invalid tags caused 15 failures). With T246 fixed, 10 tests now pass but these 5 remain broken.

### Symptoms

- Test logs show: `"Still waiting for clips to save..."` looping for 2+ minutes
- Button stuck as `"Create with 0 Clips"` (disabled) — no clips reach the library
- game-loading test: `"Load"` button never appears after game creation

### Root Cause

The E2E test helper `ensureAnnotateModeWithClips` (and similar) imports TSV annotations then waits for the clips to be extracted via the backend's FFmpeg pipeline and saved to `raw_clips`. The extraction either:
1. Never starts (backend doesn't trigger extraction for E2E test clips)
2. Starts but fails silently (FFmpeg error or file path issue in test environment)
3. Takes too long (timeout too short for the extraction pipeline)

Investigation needed to determine which.

## Solution

1. Check backend logs during E2E test to see if clip extraction is triggered
2. Determine if FFmpeg is available and working in the E2E test environment
3. Check if the clip save API endpoint is being called by the frontend
4. Fix the extraction pipeline or adjust the test approach (mock extraction, skip wait, etc.)

## Failing Tests (all 5)

### `e2e/game-loading.spec.js` (1 test)
| Line | Test Name | Error |
|------|-----------|-------|
| 76 | Load saved game into annotate mode | `expect(locator('button:has-text("Load")')).toBeVisible` — timeout 15s |

### `e2e/regression-tests.spec.js` (4 tests)
| Line | Test Name | Error |
|------|-----------|-------|
| 1158 | Framing: video first frame loads @smoke | `"Create with 0 Clips"` button disabled |
| 1200 | Framing: crop window is stable @smoke | `"Create with 0 Clips"` button disabled |
| 1269 | Framing: spacebar toggles play/pause @smoke | `"Create with 0 Clips"` button disabled |
| 1367 | Create project from library clips @full | `"Create with 0 Clips"` button disabled |

## Context

### Relevant Files
- `src/frontend/e2e/regression-tests.spec.js` — `ensureAnnotateModeWithClips` helper (~line 450)
- `src/frontend/e2e/full-workflow.spec.js` — `enterAnnotateModeWithClips` helper (~line 63)
- `src/frontend/e2e/game-loading.spec.js` — inline game creation + load flow
- `src/backend/app/routers/clips.py` — clip extraction / save endpoint
- `src/backend/app/routers/annotate.py` — annotate mode clip handling

### Related Tasks
- T246: Fix E2E TSV Import Failures (DONE — fixed invalid tags, resolved 10/15 failures)
- T245: Fix Highlight Regions Test (pre-existing test failure)

## Acceptance Criteria

- [ ] All 5 failing E2E tests pass
- [ ] No regressions in the 19 currently-passing tests
- [ ] Root cause documented (FFmpeg availability, timing, or mock needed)
