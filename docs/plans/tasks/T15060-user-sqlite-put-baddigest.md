# T15060: user.sqlite PUT to R2 failed with BadDigest (MD5 mismatch) during a clip batch

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (backend; expert root-cause first)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Prod `/tmp/logs/app.log`, 2026-11-04 17:55:04 UTC, user cometlawal, mid clip batch (T15020):

```
app.storage - ERROR - Failed to upload user.sqlite to R2: Failed to upload
/user_data/605645f3-.../user.sqlite to reel-ballers-users/production/users/605645f3-.../user.sqlite:
An error occurred (BadDigest) when calling the PutObject operation (reached max retries: 0):
The MD5 checksum you specified did not match what we received.
```

Surrounded by minutes of `[ExportWorker] Failed to sync user.sqlite to R2` and `[SYNC] Upload lock
busy >0.5s, deferring user=... db=user`.

## Problem

R2 computed a different MD5 for the body than the one boto3 sent. For a local file that means
the bytes changed between the checksum pass and the body read, i.e. user.sqlite was written
while the upload was reading it. The upload lock is supposed to make that impossible. Either a
writer bypasses the lock (the ExportWorker sync path and the request-path sync both touch
user.sqlite), or the WAL checkpoint lands between the checksum and the stream. Not a data-loss
event by itself (R2 rejected the PUT, the next sync retried), but a sync that can fail this way
can also upload a torn file if a checksum is ever skipped, and `reached max retries: 0` means
one attempt with no retry.

## Solution

Expert root-cause first: trace which writer can touch user.sqlite while
`r2_upload_user_db` is streaming it (ExportWorker sync vs request-path sync vs eviction sync
T14390), and whether the body is read as a file handle (racy) or a bytes snapshot. Then:
- upload from an in-memory snapshot taken under the lock (or a `VACUUM INTO` copy), never a live
  file handle;
- classify BadDigest as retryable once (not `max retries: 0`), after a fresh snapshot;
- a test that writes to the DB concurrently with the upload and asserts the uploaded bytes are
  a consistent snapshot.

## Acceptance Criteria

- [ ] Root cause written up in `persistence-sync.md` (which writer, which window)
- [ ] Upload body is a snapshot taken under the lock; concurrent-write test passes
- [ ] BadDigest retries once with a fresh snapshot and logs CRITICAL if it repeats

## Context

### Relevant Files
- `src/backend/app/storage.py` (user.sqlite upload), `src/backend/app/database.py` (ExportWorker sync),
  `src/backend/app/middleware/db_sync.py`, `src/backend/app/services/user_db.py`

### Related Tasks
- T15030 (the lock contention that surrounded it), T14390 (eviction sync), T4310 (upload CAS)
