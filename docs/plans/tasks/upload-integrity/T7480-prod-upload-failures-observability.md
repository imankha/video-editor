# T7480: Prod game uploads failing since Aug 20: investigate + upload lifecycle observability

**Status:** TODO
**Priority:** P1 (active prod outage)
**Impact:** 9
**Complexity:** 5
**Created:** 2026-08-24
**Updated:** 2026-08-24
**Epic:** [Upload Failure Integrity](EPIC.md)

## Problem

Zero game videos have landed in prod R2 since 2026-08-20 22:49 UTC. Across the two accounts
investigated on 2026-08-24 there were 5 upload attempts and 0 successes. Sample size is
small (2 users), so "broken for everyone" is not yet established, but a path that worked on
Aug 20 producing zero successes over 4 days warrants treating this as an active outage until
a live test proves otherwise.

The transfer failure itself could NOT be root-caused read-only. Ruled out with evidence
during the investigation:

- **R2 CORS**: live OPTIONS preflight from `Origin: https://app.reelballers.com` returned
  204 with `Access-Control-Allow-Methods: GET, HEAD, PUT` and ETag exposed
- **Insufficient credits**: cost for the 17.8 MB file is 2 credits; balances were 8 and 88;
  and `can_afford` runs after the pending_uploads INSERT, which would have left rows behind
- **Backend regression**: prod last deployed 2026-08-19 15:37 UTC; the Aug 20 22:49 success
  ran on that same image
- **Frontend regression**: uploadManager.js / mp4Faststart.js / uploadStore.js unchanged
  since 2026-07-04
- **Machine restart**: single prod machine `843e15c2d26718`, uptime unbroken since deploy
- **R2 outage**: profile.sqlite syncs succeeded at the exact timestamps the uploads failed

Known concrete failure shape (rooom1h): a 17.8 MB file is a SINGLE part (`PART_SIZE = 25 MB`),
so the whole transfer is one browser -> R2 presigned PUT with `PART_UPLOAD_TIMEOUT_MS =
180_000` and 2 retries. R2 shows the multipart still open with 0 parts uploaded.

**Unresolved anomaly worth chasing**: R2's ListMultipartUploads reports a DIFFERENT UploadId
for that same key than the one stored in `pending_uploads`, both initiated the same second.
Two multiparts were created for one prepare. This may be a real clue (double prepare call?
retry at the prepare layer?) or a red herring; establish which.

**The deeper structural problem this task must also fix**: the server has NO visibility into
the browser -> R2 leg. The client logs rich diagnostics (`[DIAG upload-freeze] uploadParts`,
`[ensureVideoInR2] prepare-upload FAILED`, `[ensureVideoInR2] finalize-upload FAILED`) but
they die in the user's console. An abandoned upload session is invisible server-side until
someone happens to impersonate the account.

## Solution

Two workstreams, same task because the observability is how the investigation concludes:

### 1. Root-cause the active failures
- Live upload test against prod with a real browser + DevTools (drive-app-as-user skill /
  real account), watching the DIAG console lines and the network tab for the presigned PUT
- If reproduced: fix follows the evidence (timeout too tight for slow links? presign
  header/checksum mismatch? part-size edge? double-prepare racing itself?)
- If NOT reproduced: instrument (workstream 2) and monitor; the affected users' networks
  (mobile/WhatsApp-sourced video, possibly slow uplinks) may be the variable. A 17.8 MB
  single-part PUT with a 180s timeout implies a ~0.1 MB/s floor; consider whether the
  single-part path needs smaller parts or a longer/adaptive timeout for slow uplinks.
- Explain or dismiss the double-UploadId anomaly

### 2. Server-side upload lifecycle observability
- Log the lifecycle server-side so prepare -> finalize pairing is queryable: prepare logged
  (already exists as a row in pending_uploads), part-completion progress optional, finalize
  success/failure logged, and CRITICALLY an abandoned session (prepared, never finalized,
  older than N hours) is visible without a browser
- Client failure beacon: when the browser exhausts retries, POST the failure reason +
  part/attempt detail to a lightweight endpoint so the server log carries the same evidence
  the console does (fire-and-forget, must never block or break the failure path)
- Surface: an admin-queryable view (log-based is fine to start; an admin endpoint listing
  stuck pending_uploads with age + R2 multipart state is the natural shape)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js` - `PART_UPLOAD_TIMEOUT_MS` ~52, part upload +
  retry loop, `ensureVideoInR2` ~478-619, existing DIAG log lines
- `src/backend/app/routers/games_upload.py` - `PART_SIZE` ~50, `prepare_upload` ~100-258,
  `finalize_upload`, `list_pending_uploads` ~425-480
- `src/backend/app/storage.py` - presigned part URLs, `r2_is_multipart_upload_valid` ~2362
- `src/frontend/src/stores/uploadStore.js` - upload state (context)

### Related Tasks
- Epic siblings T7470 (stop the destructive cleanup), T7490 (pending visibility), T7500
- T7140 (faststart remux) touches finalize_upload: coordinate if concurrent
- T7360 (concurrent uploads store rework): same surface, sequence deliberately

### Technical Notes
- The failure beacon is a write triggered by a failure event inside an existing
  gesture-originated flow (the upload the user started); it writes to LOGS or analytics,
  never to the profile DB, so the gesture-persistence rules are not in play. Keep it that
  way: no new profile/user DB writes from this path.
- Log handling rules apply to the investigation itself: redirect any long-running capture
  to a file and reduce_log it.
- If the fix needs the affected users to retry, remember rooom1h's stored `r2_upload_id`
  already returns NoSuchUpload; resume is dead for that session (T7490 owns honest reaping).

## Implementation

### Steps
1. [ ] Live prod upload test (real browser, DevTools open); capture DIAG lines + network
2. [ ] Root-cause from the capture, or instrument-and-monitor if not reproduced
3. [ ] Server-side lifecycle logging + client failure beacon
4. [ ] Explain the double-UploadId anomaly
5. [ ] Fix whatever the evidence names; verify with a real prod upload

## Acceptance Criteria

- [ ] A prod game-video upload demonstrably succeeds end to end (real browser evidence)
- [ ] The transfer-failure root cause is named with evidence, or instrumentation is live and
      a monitoring window is agreed with the user
- [ ] An abandoned upload session is visible server-side (queryable, with age and state)
      without any browser console access
- [ ] Client failure beacon lands the browser-side failure reason in server logs
- [ ] Double-UploadId anomaly explained or ruled out as a factor
