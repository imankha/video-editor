# T8160: P0 PROD OUTAGE - prepare-upload aborts its own multipart (every fresh upload fails)

**Status:** WIP
**Impact:** 10
**Complexity:** 3
**Created:** 2026-08-31

## Problem

**Every non-dedup game upload on prod fails since the ~2026-08-30 deploy of build 2a906b5a.**
Upload success rate on 2026-08-31: **29% (9 succeeded / 22 failed / 31 attempts)** - and the
"successes" are dedup EXISTS-path uploads that transfer zero bytes. Real multipart uploads
have a ~0% success rate.

Root cause, REPRODUCED LIVE against prod R2 on 2026-08-31 (this exact code path, synthetic key):

1. `prepare_upload` (T7950, `games_upload.py:262-270`) creates the multipart, then calls
   `r2_abort_orphan_multipart_uploads(r2_key, keep_upload_id=upload_id)` to reclaim orphans
   while sparing the id it just created.
2. **Cloudflare R2's ListMultipartUploads returns a DIFFERENT UploadId string on every List
   call** - different from the id CreateMultipartUpload returned, and different between two
   consecutive List calls. All of them are valid aliases of the same upload (abort/list_parts
   accept any of them). Verified:
   - `created: AIoKt7AVJWfKWan4yADLanIw...`
   - `list1:   AAHGSMa_cAosjxrrWADMuxxL...`
   - `list2:   AP80SAEG-delWIUa5D0s7ZB6...`
3. The keep-comparison `u['UploadId'] == keep_upload_id` (`storage.py:2691`) is therefore
   NEVER true -> the loop **aborts the upload it was told to keep**, every time.
4. Client PUTs its parts against the presigned URLs -> R2 answers **404 NoSuchUpload** ->
   `[UploadStore] Upload failed: Error: Part N upload failed: 404` -> T7470 cleanup deletes
   the pending game. The user retries and hits the identical wall forever.

Evidence chain (bug 47p, reporter bknoto@gmail.com - a PAYING customer, $3.99, 2 days old):
- 8 attempts across 12h on 2026-08-31, all `Part N upload failed: 404` within ~10s of game
  creation (multipart dead-on-arrival, deterministic).
- Their day-1 uploads (2026-08-28/29, pre-deploy) succeeded - the R2 object behind their one
  surviving game (12) is dated 2026-08-29 18:09, two days before game 12 was created
  (dedup EXISTS path, zero parts).
- Prod R2 has ZERO open multiparts for any of their attempts (each was self-aborted), and
  exactly one unrelated orphan from 2026-08-28 (pre-deploy).
- T7950 merged 2026-08-28 19:02 UTC; deployed in build 2a906b5a. Timeline matches exactly.

Why tests stayed green: unit tests mock R2 with stable UploadIds, and staging/e2e re-upload
known files -> dedup EXISTS path -> no parts -> "success". The regression is only visible
with a NOVEL file against REAL R2.

## Solution

Tier M urgency, but treat as the highest-priority fix in the repo. Do NOT rely on UploadId
equality against ListMultipartUploads output anywhere - on R2 it is cryptographically
meaningless.

1. **`r2_abort_orphan_multipart_uploads` (storage.py:2678)**: replace the id-equality spare
   with **age scoping**: abort only uploads whose `Initiated` is older than a threshold
   (recommend >= 1 hour). The just-created keeper (seconds old) is structurally safe; genuine
   orphans from prior sessions still get reclaimed on the next prepare of that key. Bonus:
   this also stops the pre-existing cross-user/cross-env hazard where a concurrent prepare of
   the same content hash aborts another user's ACTIVE upload (games/ keys are shared,
   env-prefix-free, and multipart aborts have no env guard - see T8170 follow-ups).
2. **Keeper post-check (fail loudly, not silently)**: after the reclaim, verify
   `r2_is_multipart_upload_valid(r2_key, upload_id)` (direct use of the create-sourced id is
   fine - only cross-response comparison is broken). If invalid -> log CRITICAL + raise 500
   so prepare can never hand out presigned URLs for a dead upload again.
3. **`_adopt_live_multipart_after_ack_loss` (storage.py:2357-2390)**: same broken premise in
   the "abort extras" loop (`u['UploadId'] != adopted_id`). Within a single List response the
   entries are distinct uploads so entry-vs-entry comparison is fine, but the adopted id must
   then be used consistently FROM THAT RESPONSE (it is a valid alias). Audit and fix the
   comparisons; keep "adopt newest by Initiated".
4. **Audit every other cross-response UploadId comparison**: `grep -rn "UploadId" src/backend`
   - notably the T7880 admin sweep's "double-UploadId anomaly" detection (stored
   pending_uploads id vs listed id) reports false anomalies for EVERY active upload and, if
   its apply mode aborts unmatched ids, would kill live uploads. At minimum neuter/flag that
   detection with a code comment + task note (fix can land in T7880's follow-up).
5. **Tests**:
   - Unit: mock R2 where List returns a different UploadId string per call (the real R2
     behavior) - the old code fails this test, the fix passes.
   - Regression marker test (staging/dev against real R2): full prepare -> part PUT with a
     NOVEL random file (fresh bytes each run so the hash is unique and dedup can't mask).
6. **Verify + deploy**: staging upload of a novel file end-to-end, then prod deploy, then a
   real prod upload of a novel file, then watch `upload_success_rate` on
   `/api/admin/analytics/pulse` recover.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/storage.py` - `r2_abort_orphan_multipart_uploads` (2678),
  `_adopt_live_multipart_after_ack_loss` (2357), `r2_create_multipart_upload` (2294),
  `r2_is_multipart_upload_valid` (2467)
- `src/backend/app/routers/games_upload.py` - `prepare_upload` fresh path (255-306)
- `src/frontend/src/services/uploadManager.js` - client failure surface (`Part N upload
  failed: 404`, isRetryable regex treats 404 as terminal - correct, keep)

### Related Tasks
- T7950 (introduced the regression, 2026-08-28) - its goal (reclaim double-UploadId leaks)
  remains valid; only the spare mechanism is wrong
- T7880 (sweep uses the same unsound stored-vs-listed comparison)
- T8170 (recovery: victims, comms, alerting), T8180 (cleanup deletes game under active
  session), T8150 (vanishing game after ready)
- Bug 47p (bknoto@gmail.com) - the report that exposed this

### Knowledge
- Update `.claude/knowledge/backend-services.md` (or persistence-sync.md) with the landmine:
  **R2 UploadIds are not stable identifiers across API responses; never compare them across
  Create/List/two Lists. Direct use of a stored id in abort/list_parts works.**

## Implementation

### Steps
1. [ ] Failing unit test: List returns per-call-random UploadId aliases; assert prepare's
       reclaim never aborts the just-created upload
2. [ ] Age-scoped reclaim + keeper post-check + adopt-path fix
3. [ ] Grep-audit remaining UploadId comparisons; flag T7880 sweep detection
4. [ ] Real-R2 novel-file regression test (staging)
5. [ ] Deploy prod + verify a real novel-file upload + pulse recovery

## Acceptance Criteria

- [ ] Unit test with unstable listed UploadIds passes (old code demonstrably fails it)
- [ ] A novel (never-before-hashed) file uploads successfully on staging AND prod
- [ ] Zero self-aborts: after a prod upload, `Aborted multipart upload` does not appear for
      the just-created id/key in the same request window
- [ ] `upload_success_rate` on the admin pulse recovers to pre-2026-08-30 levels
- [ ] Knowledge doc updated with the R2 UploadId landmine
