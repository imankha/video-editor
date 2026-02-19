# T20: E2E Test Reliability

## Status: TODO

## Problem Statement

Two E2E tests fail consistently (not flaky - they fail every run):

1. **regression-tests.spec.js:2287** — "Framing: open automatically created project @full"
2. **full-workflow.spec.js:316** — "6. Create project from clips"

### Context: What T247 Fixed

T247 fixed the root cause for 6 smoke test failures: `setExtraHTTPHeaders({ 'X-User-ID': ... })` added the header to ALL requests including R2 presigned URL PUTs, triggering CORS preflight failures. After T247, the E2E test suite results are:

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| Regression @smoke | 6/6 | 0 | All fixed by T247 |
| Regression @full | 9/10 | 1 | "open automatically created project" |
| Full workflow | 15/16 | 1 | "Create project from clips" |

## Failing Test 1: "Framing: open automatically created project @full"

**File:** `src/frontend/e2e/regression-tests.spec.js:2287`

**Symptom:** Test navigates to a project but fails waiting for a mode indicator to become visible within 30s.

```
Error: Timeout 30000ms exceeded while waiting on the predicate
  at regression-tests.spec.js:2338
```

**Error context (from page snapshot):** The page IS loaded in a project view with:
- Overlay Settings panel visible
- "Highlight Region 1/2/3" visible
- "Exporting..." button visible with "Overlay Export... 0%"
- Detection data showing "13 players detected"

**Root Cause:** The preceding test ("Full Pipeline: Annotate -> Framing -> Overlay -> Final Export") leaves an export running that auto-switches the UI to Overlay mode. When this test opens the same project, it's already in Overlay mode but the test's mode detection logic (line 2338) can't find the expected mode indicator element.

The test at line 2336-2338:
```javascript
await expect(async () => {
  await expect(modeIndicator).toBeVisible();
}).toPass({ timeout: 30000, intervals: [1000, 2000, 5000] });
```

**Likely Fix:** The test needs to handle the case where the previous test's export leaves the project in Overlay mode. Options:
1. Check what `modeIndicator` locator is - it may need to match both Framing and Overlay mode indicators
2. Ensure the test navigates to a DIFFERENT project than the one used by the full pipeline test
3. Cancel/wait-for any in-progress exports before asserting mode

## Failing Test 2: "6. Create project from clips"

**File:** `src/frontend/e2e/full-workflow.spec.js:316`

**Symptom:** `POST /api/projects` returns a non-OK response when called from the Playwright `request` fixture.

```javascript
const createResponse = await request.post(`${API_BASE}/projects`, {
  headers: { 'X-User-ID': TEST_USER_ID },
  data: { name: 'E2E Test Project from API', aspect_ratio: '16:9' }
});
expect(createResponse.ok()).toBeTruthy(); // FAILS
```

**Root Cause:** Needs investigation. The `request` fixture makes direct HTTP calls (not through the browser page), so it bypasses both `setExtraHTTPHeaders` and `page.route()`. The explicit `headers: { 'X-User-ID': TEST_USER_ID }` should work. Possible causes:
1. The `/api/projects` endpoint may expect different request body format (e.g., `clip_ids` field required)
2. The endpoint may have been changed since this test was written
3. Content-Type header may not be set correctly by Playwright's `request.post` with `data`

**Investigation needed:** Check the actual HTTP status code and response body to understand what the API is rejecting.

## Files to Modify

- `src/frontend/e2e/regression-tests.spec.js` — Fix mode indicator assertion at line 2338
- `src/frontend/e2e/full-workflow.spec.js` — Fix project creation API call at line 322

## Classification

**Stack Layers:** Frontend (E2E tests only)
**Files Affected:** ~2 files
**LOC Estimate:** ~20 lines
**Test Scope:** Frontend E2E

## Success Metrics

- Both tests pass consistently across 3 consecutive runs
- No regressions in the other 24 passing tests
