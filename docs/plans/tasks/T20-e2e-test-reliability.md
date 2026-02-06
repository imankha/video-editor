# E2E Test Reliability

## Problem Statement

Two E2E tests are flaky and fail intermittently:

1. **"Annotate Mode - Upload video and import TSV"** - Video element doesn't appear within 120s timeout
2. **"Framing: open automatically created project @full"** - Test user data gets cleaned up during test execution

These failures are not related to code changes but to test infrastructure and timing issues.

## Flaky Test Analysis

### Test 1: Annotate Mode - Upload Video

**Symptom**: Test times out waiting for video element to appear after upload.

```
Error: locator.waitFor: Timeout 120000ms exceeded.
=========================== logs ===========================
waiting for locator('video').first()
```

**Root Causes**:
1. Video processing (FFmpeg probe, thumbnail generation) can take longer than expected on cold starts
2. File system operations may be slower when disk is under load
3. The 120s timeout may not account for:
   - Large test video processing time
   - Backend startup delays
   - R2 upload/download latency

**Proposed Fixes**:

1. **Add explicit wait states**: Instead of just waiting for `video` element, wait for specific loading indicators:
   ```javascript
   // Wait for upload to complete first
   await expect(page.getByText('Processing...')).toBeHidden({ timeout: 60000 });
   // Then wait for video
   await expect(page.locator('video').first()).toBeVisible({ timeout: 60000 });
   ```

2. **Use smaller test video**: Ensure the e2e test video is as small as possible (6 seconds, low resolution) to minimize processing time.

3. **Add retry logic for video appearance**: Use Playwright's built-in retry mechanism:
   ```javascript
   await expect(async () => {
     const video = page.locator('video').first();
     await expect(video).toBeVisible();
     await expect(video).toHaveAttribute('src', /.+/);
   }).toPass({ timeout: 120000 });
   ```

4. **Pre-warm the backend**: Run a health check request before starting the test to ensure backend is ready.

### Test 2: Framing - Auto-created Project

**Symptom**: Test fails with mode detection or missing data errors.

**Error variant 1** (2026-02-06): Mode not detected after opening project:
```
Error: Should be in framing or overlay mode
expect(isFramingMode || isOverlayMode, 'Should be in framing or overlay mode').toBe(true);
```
Artifacts: `test-results/artifacts/regression-tests-Full-Cove-f2cf6-ically-created-project-full-chromium/`

**Error variant 2**: Data deleted by concurrent test cleanup:
```
Error: Expected project/clip data not found
(Data was deleted by concurrent test cleanup)
```

**Root Causes**:
1. Tests share the same test user (`e2e_{timestamp}_{random}`)
2. When tests run in parallel, one test's cleanup can delete another test's data
3. The `@full` tag runs the full pipeline which takes longer, increasing cleanup race window
4. Mode transition may not complete before assertion (timing issue with state machine transitions)
5. Project may load but UI state not yet updated to reflect framing/overlay mode

**Proposed Fixes**:

1. **Unique test users per test file**: Each test file should create its own unique user ID:
   ```javascript
   // In test setup
   const testUserId = `e2e_${Date.now()}_${testFile}_${Math.random().toString(36).slice(2, 8)}`;
   ```

2. **Isolate test data directories**: Ensure each test's data is in a completely separate directory that won't be touched by other tests.

3. **Add data existence checks before operations**:
   ```javascript
   // Before cleanup
   const response = await request.get(`/api/games`, { headers: { 'X-User-ID': userId } });
   if (response.ok()) {
     // Only cleanup if data exists
     await cleanup(userId);
   }
   ```

4. **Use Playwright's test isolation features**:
   ```javascript
   // playwright.config.js
   {
     fullyParallel: false, // Run tests serially to avoid conflicts
     // OR use workers: 1 for tests that share state
   }
   ```

5. **Add mutex/lock for cleanup operations**: Prevent concurrent cleanup of shared resources:
   ```javascript
   // Use a simple file lock or API-based lock
   await acquireCleanupLock(userId);
   try {
     await performCleanup(userId);
   } finally {
     await releaseCleanupLock(userId);
   }
   ```

6. **Wait for mode transition to complete**: Add explicit wait for UI mode indicators:
   ```javascript
   // Wait for mode-specific UI elements instead of checking state directly
   await expect(
     page.locator('[data-testid="framing-timeline"]')
       .or(page.locator('[data-testid="overlay-timeline"]'))
   ).toBeVisible({ timeout: 30000 });
   ```

## Implementation Plan

### Phase 1: Immediate Fixes

1. [ ] Reduce test video size if not already minimal
2. [ ] Add explicit wait states before video element check
3. [ ] Generate truly unique user IDs per test (include test name)
4. [ ] Add guards in cleanup to check data exists first
5. [ ] Fix mode detection: wait for UI elements instead of checking state variables

### Phase 2: Robust Test Isolation

1. [ ] Review all tests for shared state assumptions
2. [ ] Implement test-specific user namespacing
3. [ ] Add pre-test health checks for backend readiness
4. [ ] Consider running flaky tests with `test.describe.serial()`

### Phase 3: Monitoring & Prevention

1. [ ] Add test timing metrics to identify slow tests
2. [ ] Set up test result tracking to detect new flaky tests early
3. [ ] Document test isolation patterns for future tests

## Files to Modify

- `src/frontend/e2e/annotate.spec.ts` - Fix video upload wait logic
- `src/frontend/e2e/framing.spec.ts` - Fix test isolation
- `src/frontend/e2e/regression-tests.spec.js` - Fix mode detection wait (line 2293)
- `src/frontend/e2e/helpers/testUser.ts` - Improve user ID generation
- `src/frontend/playwright.config.ts` - Review parallelization settings

## Success Metrics

- Both tests pass consistently in 10 consecutive CI runs
- No test failures due to timing/cleanup race conditions
- Test suite completes in reasonable time (not overly serialized)
