# T247: Fix E2E Clip Extraction Timeout

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-18
**Updated:** 2026-02-18

## Problem

6 E2E tests fail because FFmpeg clip extraction never completes (or takes excessively long) in the E2E test environment. After TSV import succeeds and clips appear in the UI, the tests wait for clips to be saved to the library (requiring backend FFmpeg extraction). The extraction either never finishes or takes far longer than the 2-minute timeout.

This was partially masked by T246 (invalid tags caused 15 failures). With T246 fixed, 10 tests now pass but these 5 remain broken.

### Symptoms

- Test logs show: `"Still waiting for clips to save..."` looping for 2+ minutes
- Button stuck as `"Create with 0 Clips"` (disabled) — no clips reach the library
- game-loading test: `"Load"` button never appears after game creation
- Tests that require full pipeline setup (clips → framing export → working video) compound the problem — even if extraction eventually succeeds on retry, subsequent pipeline steps add more time

### Root Cause

The E2E test helper `ensureAnnotateModeWithClips` (and similar) imports TSV annotations then waits for the clips to be extracted via the backend's FFmpeg pipeline and saved to `raw_clips`. The extraction either:
1. Never starts (backend doesn't trigger extraction for E2E test clips)
2. Starts but fails silently (FFmpeg error or file path issue in test environment)
3. Takes too long (timeout too short for the extraction pipeline)

Investigation needed to determine which.

### Observed Behavior (T245 testing, 2026-02-18)

Ran `Overlay: highlight region initializes @full` in isolation. Observed:

1. First clip extraction attempt: polled for 121s, hit 2-minute WARNING, **no clips saved**
2. Helper logged `"Loaded video and TSV in annotate mode"` and retried the full flow
3. Second attempt succeeded: `"Clips created and auto-saved to library"` appeared
4. Test was still running (had not reached overlay mode) when manually killed after 10+ minutes

This suggests extraction **does eventually work** but is extremely slow on the first attempt (cold start?). The helper's 2-minute timeout expires, it retries, and the second attempt benefits from whatever the first attempt set up. Even after clips are saved, the test still needs to create a working video via framing export before reaching overlay mode — the cumulative time exceeds Playwright's test timeout.

## Solution

1. Check backend logs during E2E test to see if clip extraction is triggered
2. Determine if FFmpeg is available and working in the E2E test environment
3. Check if the clip save API endpoint is being called by the frontend
4. Fix the extraction pipeline or adjust the test approach (mock extraction, skip wait, etc.)

## Failing Tests (6 total)

### `e2e/game-loading.spec.js` (1 test)
| Line | Test Name | Error |
|------|-----------|-------|
| 76 | Load saved game into annotate mode | `expect(locator('button:has-text("Load")')).toBeVisible` — timeout 15s |

### `e2e/regression-tests.spec.js` (5 tests)
| Line | Test Name | Error |
|------|-----------|-------|
| 1158 | Framing: video first frame loads @smoke | `"Create with 0 Clips"` button disabled |
| 1200 | Framing: crop window is stable @smoke | `"Create with 0 Clips"` button disabled |
| 1269 | Framing: spacebar toggles play/pause @smoke | `"Create with 0 Clips"` button disabled |
| 1367 | Create project from library clips @full | `"Create with 0 Clips"` button disabled |
| 1558 | Overlay: highlight region initializes @full | Clip extraction timeout during setup (needs clips → framing export → working video before reaching overlay) |

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

- [ ] All 6 failing E2E tests pass
- [ ] No regressions in the currently-passing tests
- [ ] Root cause documented (FFmpeg availability, timing, or mock needed)
