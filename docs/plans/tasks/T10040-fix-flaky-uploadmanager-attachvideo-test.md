# T10040: Fix the chronic uploadManager.attachVideo Branch CI false-positive

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

`src/services/uploadManager.attachVideo.test.js`'s test `attachVideoToExistingGame (T8700, new
helper) > runs hash -> upload -> addVideosToGame in order, then reloads the game` has failed on
**10 separate Branch CI runs** since it was first observed (T8910, T8960), most recently on
T9480, T9575, T9285, T9820, and T9810 (2026-09-13/14) — see
`docs/testing/known-failures.md` row 30 for the full hit list. Every single hit has been
independently confirmed as unrelated to the branch that triggered it (grep-confirmed: none of the
10 branches touch `uploadManager.js`'s upload-status handling), so this is pure debt: a
pre-existing bug in the TEST, not the product.

This has real cost even though no user is affected: every task that lands on Branch CI has to
spend a triage cycle re-confirming "yes, it's the known flake again" before it can merge — a
`gh run view --log-failed` pull, a log-reduce pass, and a `known-failures.md` edit, repeated per
task. Ten times and counting. That triage cost is why this is worth fixing directly rather than
attributing an 11th time.

## Symptom

```
FAIL src/services/uploadManager.attachVideo.test.js > attachVideoToExistingGame (T8700, new helper)
  > runs hash -> upload -> addVideosToGame in order, then reloads the game
Error: Unexpected status: undefined
    at ensureVideoInR2 (uploadManager.js:754-756)
    at attachVideoToExistingGame
```

`ensureVideoInR2` throws this when `prepareData.status` is neither `UPLOAD_STATUS.EXISTS`
(`'exists'`) nor `UPLOAD_STATUS.UPLOAD_REQUIRED`. The test only queues two `mockFetch`
responses via `mockResolvedValueOnce` (positional, not URL-matched):
1. First queued response: `{ status: 'exists', blake3_hash, file_size }` — intended for the
   `POST /api/games/prepare-upload` call.
2. Second queued response: the `addVideosToGame` shape (`{ game_id, videos_added, videos, ... }`,
   **no `status` field**) — intended for `POST /api/games/{id}/videos`.

`prepareData.status === undefined` (the exact symptom) is exactly what you get if `prepareData`
is actually the SECOND mock (the addVideosToGame shape) — i.e. **something in the real call
sequence now issues an extra `fetch` before `prepare-upload`, consuming the first positional mock
and shifting everything by one.** The test's `beforeEach` does `vi.resetAllMocks()` and mocks
`Worker` for hashing (no fetch there), so the extra call is somewhere in the `fetch`-based
pipeline between test setup and the `prepare-upload` POST — most likely inside
`apiFetchWithNetworkRetry` (a preflight/retry-probe request added or changed since T8700) or a
new step `ensureVideoInR2`/`attachVideoToExistingGame` picked up from a later task (credits
check, R2 warm-check, etc.) that this test's mock queue was never updated for.

**This is a hypothesis, not a confirmed root cause — the first implementation step below is to
confirm it** (or find the actual mismatch) by instrumenting/logging `mockFetch.mock.calls` in an
isolated run, not by guessing further.

## Solution

1. Reproduce in isolation: `cd src/frontend && npx vitest run src/services/uploadManager.attachVideo.test.js`
   on a clean master checkout (confirmed reproducible per `known-failures.md` — commit `cccaadde`
   and every hit since).
2. Log `mockFetch.mock.calls.map(([url]) => url)` right before the assertions to see the ACTUAL
   call sequence and compare against the test's assumed 2-call sequence. Identify the real extra
   call (or confirm a different mismatch entirely — the URL-drift hypothesis above may be wrong).
3. Fix at the right layer:
   - If it's a genuine new fetch call in the production path (e.g. a network-retry preflight,
     a credits check) that the test's mock queue never accounted for — add the missing mock
     response in the right position, OR (preferred, more durable) switch the mock from
     positional `mockResolvedValueOnce` chaining to a URL-routed mock implementation
     (`mockFetch.mockImplementation((url, init) => { if (String(url).includes('/prepare-upload')) return ...; if (String(url).includes('/videos')) return ...; })`)
     so a future added call can't silently shift the queue and reintroduce this exact class of
     flake for an 11th time.
   - If it's a real product bug (the code doesn't handle a status/response shape it should), fix
     the code instead — the test would then be correctly failing, not flaky.
4. Confirm the fix by running the file in isolation AND as part of the full frontend suite
   (parallel-run flakiness has burned this project before per other `known-failures.md` rows —
   rule that out too, not just the isolated case).
5. Apply the same URL-routed-mock treatment to the file's OTHER tests if they share the same
   positional-mock fragility (`does NOT trigger a reload when the attach POST fails`, etc.) —
   don't leave a second copy of the same landmine two lines down.
6. Delete the row from `docs/testing/known-failures.md` once fixed and confirmed green on 2-3
   consecutive Branch CI runs (rule 2 in that file's header: "delete the row when fixed").

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.attachVideo.test.js` — the flaky test; almost
  certainly where the actual fix lands (mock routing).
- `src/frontend/src/services/uploadManager.js` — `ensureVideoInR2` (~line 684-769),
  `attachVideoToExistingGame`, `apiFetchWithNetworkRetry` (check this for any preflight/retry
  fetch call added after T8700) — read here to CONFIRM the extra call, not to change behavior
  unless step 3 above finds a real product bug.
- `docs/testing/known-failures.md` — row 30 documents all 10 prior hits with commit/run IDs;
  delete the row once this is fixed.

### Related Tasks
- No blockers. Independent of the in-flight 2026-09-13 evaluation batch
  (`docs/plans/tasks/evaluation-2026-09-13/`) — this is general CI-infrastructure debt, not
  product-facing.

### Technical Notes
- This is a **Frontend Unit test only** fix — no backend, no schema, no UI change expected
  unless step 3 finds a genuine product bug (unlikely given 10/10 confirmed non-regressions).
- Tier: **S or M** depending on step 3's finding. If it's purely a test-mock fix (expected), it's
  S-tier (1 file, <20 LOC). Only escalate to M if a real product-code change is needed.
- Don't touch anything else in the file while here — this is a surgical fix, not a test-file
  cleanup pass.

## Implementation

### Steps
1. [ ] Reproduce in isolation and log the actual `mockFetch` call sequence to confirm the extra
       call.
2. [ ] Identify the exact source of the extra call (or the real mismatch, if the hypothesis above
       is wrong).
3. [ ] Fix: URL-routed mock (preferred) or missing mock response, or a genuine product-code fix
       if warranted.
4. [ ] Apply the same durability fix to sibling tests in the same file if they share the
       positional-mock pattern.
5. [ ] Confirm green in isolation AND in the full suite (rule out parallel-run flakiness too).
6. [ ] Delete the `known-failures.md` row once confirmed green on 2-3 consecutive Branch CI runs.

## Acceptance Criteria

- [ ] `uploadManager.attachVideo.test.js` passes in isolation and in the full suite.
- [ ] Root cause is documented (not just "it passes now") — what the extra/mismatched call
      actually was.
- [ ] The fix is durable against a similar future drift (URL-routed mocks, not another positional
      guess) unless a genuine product bug made that unnecessary.
- [ ] `docs/testing/known-failures.md` row 30 removed after 2-3 consecutive green Branch CI runs
      confirm the fix holds.
