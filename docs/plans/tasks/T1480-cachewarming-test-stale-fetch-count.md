# T1480: cacheWarming test asserts stale fetch count (pre-existing failure)

**Status:** TODO
**Type:** Bug — stale test expectation
**Found during:** T1460 implementation (2026-04-14)
**Scope:** Single-file, ~1 LOC fix + assertion update

## Problem

`src/frontend/src/utils/cacheWarming.test.js:106` asserts that after
`clearForegroundActive()` resumes the warmer, exactly 1 fetch is issued for
the single clip in the tier-1 queue:

```javascript
expect(fetchMock).toHaveBeenCalledTimes(1);
```

Actual count is **2**. Reproduces on clean `master` (verified via
`git stash` during T1460):

```
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
  src/utils/cacheWarming.test.js:106:23
```

## Root Cause

[warmClipRange in cacheWarming.js:322-374](../../../src/frontend/src/utils/cacheWarming.js#L322-L374)
fires **two parallel fetches** per clip range since T1430 Step 1:

1. Moov/header region prewarm: `Range: bytes=0-1048575` (line 342-348)
2. The clip body range itself (line 353-359)

Both hit `fetchMock` during the test. The test was written before T1430 and
never updated when the head-prewarm was added. The warmer behavior is
correct — the test expectation is stale.

## Fix

Update the assertion in `cacheWarming.test.js:106` to reflect the current
two-fetch-per-clip contract:

```javascript
// warmClipRange fires head-prewarm (0-1MB) + clip body range in parallel
expect(fetchMock).toHaveBeenCalledTimes(2);
```

Optionally also assert the two fetch calls have different `Range` headers
so a future regression (e.g., dropping the head-prewarm) gets caught.

## Acceptance

- [ ] `npx vitest run src/utils/cacheWarming.test.js` passes
- [ ] `npx vitest run` full suite: 0 failures

## Out of scope

The other stderr noise observed during the full run
(`profileStore.test.js` 500-response log, `AppStateContext.test.jsx`
"must be used within AppStateProvider" error) are **expected** — those are
error-path tests exercising their own failure modes. They pass; only the
cacheWarming assertion fails.
