# T7950: Root-cause the double-UploadId multipart leak (2/2 recurrence)

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-28 (filed by T7880 per its own "if this reproduces, file a task" instruction)

## Problem

T7880's prod sweep (2026-08-28) found the "double-UploadId anomaly" in BOTH accounts it
scanned (2/2, not a one-off): the R2 multipart actually open for a game's blake3-hash
key has a **different UploadId** than the one stored in that user's `pending_uploads`
row. Two multiparts were created for what should have been ONE `prepare-upload` call.

| User | Stored (dead) UploadId | Open (leaked) UploadId |
|---|---|---|
| roooooooooom1h | `AAi3jIZ...` | `AMW7ZUH...` |
| finneganscudder | `AK7DkCv...` | `AOb-Ejz...` |

This was first flagged in the 2026-08-24 drop-off report as a recurring pattern, not
root-caused there either — T7880 was scoped to clean up the symptom (abort both,
reconcile the game/pending_uploads rows), explicitly deferring the "why does R2 end up
with two multiparts for one prepare" question to this task.

## Investigation Starting Points

- `src/backend/app/routers/games_upload.py` — the `prepare-upload` handler that calls
  `r2_create_multipart_upload`; check for retry logic (a client-side or `retry_r2_call`
  retry on `CreateMultipartUpload` would legitimately create two live sessions if the
  first response was lost but the request landed) — T7480's commit message already notes
  "UploadId hygiene: orphan multiparts on a key are aborted before a fresh create" as a
  partial mitigation (`r2_abort_orphan_multipart_uploads`), so check whether that path is
  actually reached before every create, or only some.
- `src/frontend/src/services/uploadManager.js` — does the client ever call prepare-upload
  twice for the same file (e.g. a retry after a slow/timed-out response, StrictMode
  double-invoke in dev not relevant to prod, or a user double-click not debounced)?
- Both known cases are LARGE files (finneganscudder: 663MB; check rooom1h's size) on
  what were likely slow/unreliable connections — correlate with T7480's slow-uplink
  history; a request that the client gives up on and retries, while the server's original
  request is still processing, is the leading hypothesis.
- Check `retry_r2_call`'s retry policy (`src/backend/app/utils/retry.py`) for whether
  `CreateMultipartUpload` is retried at the R2-call level in a way that could itself
  produce two server-side sessions if the first actually succeeded but the ack was lost.

## Solution

Not yet designed — root-cause first (this is exactly the "async timing" class CLAUDE.md
flags for the expert agent, not a grind-it-out bug fix). Once the mechanism is confirmed,
the fix is likely one of: idempotency key on prepare-upload keyed by (user, blake3_hash)
so a retry reuses the same multipart instead of creating a second one, or a stronger
"abort orphans before create" guarantee if the existing T7480 mitigation isn't actually
firing on this path.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games_upload.py` — prepare-upload handler
- `src/frontend/src/services/uploadManager.js` — client retry/prepare-upload call sites
- `src/backend/app/utils/retry.py` — `retry_r2_call` policy
- `src/backend/app/storage.py` — `r2_create_multipart_upload`, `r2_abort_orphan_multipart_uploads`

### Related Tasks
- Surfaced by: T7880 (stranded-upload sweep), 2/2 recurrence confirmed 2026-08-28
- Originally flagged: 2026-08-24 drop-off report

## Implementation

### Steps
1. [ ] Escalate to the expert agent with both accounts' evidence for root-cause analysis
2. [ ] Confirm the mechanism (client retry vs. server-side retry vs. something else)
3. [ ] Design + implement the fix (idempotency key or stronger orphan-abort guarantee)
4. [ ] Regression test reproducing the double-create scenario

## Acceptance Criteria

- [ ] Mechanism confirmed with evidence, not guessed
- [ ] Fix implemented with a regression test that would have caught both prod occurrences
- [ ] No double-UploadId recurrence in the next sweep (re-run T7880's scan script as verification)
