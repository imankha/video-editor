# T8170: P0 - Upload-outage recovery: victims, comms, alerting that would have caught it

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-08-31

## Problem

The T8160 outage (all fresh uploads failing since ~2026-08-30) ran for ~2 days undetected:

1. **Nobody was alerted.** The T7970 `upload_success_rate` card sat at 29% on the admin pulse
   with no threshold, no notification. A bug report from a paying customer (47p) surfaced it.
2. **The beacon mislabeled the failure.** The client's `Part N upload failed: 404` is
   recorded as `game_upload_failed:network` - an HTTP 404 from R2 is not a network error, and
   the mislabel pointed diagnosis at users' connections instead of our own abort. bknoto's
   action log alone shows 14+ `game_upload_failed:network` rows across 2 days.
3. **Victims are unidentified and uncontacted.** 22 failed attempts on 2026-08-31 alone; the
   outage window is 2026-08-30 deploy -> T8160 fix. bknoto@gmail.com is a PAYING customer
   ($3.99, 80 credits, signed up 2026-08-29) who burned ~12 hours creating 9 throwaway games
   ("Test: Vs df", "Vs fdgd"...) trying to make upload work, then filed bug 47p.
4. **`/api/admin/users/{id}/stuck-uploads` 500s** for bknoto (reproduced twice 2026-08-31) -
   the one admin tool for exactly this situation is broken, likely tripping over this
   account's failure debris. Root-cause and fix.

## Solution

Blocked by T8160 shipping to prod (comms must say "fixed", and the retry must actually work).

1. **Victim identification** (read-only, before comms): pull `game_upload_failed` milestones
   per user for 2026-08-30 -> fix date from prod analytics; cross-reference `game_created`
   with games that no longer exist (cleanup-deleted) and accounts whose games list is empty.
   Produce a list: email, attempts, days lost, paying y/n. (Recipe: admin
   `/api/admin/analytics/user/{id}/actions`, or analytics.sqlite via fly ssh; per-user R2
   probe pattern from this investigation is in bug 47p's admin notes.)
2. **Outreach**: fold the victim list into the T7610 send (its upload-failed segment copy
   "bug fixed, please retry" applies verbatim), or a standalone short apology+retry email if
   T7610 stays held. bknoto gets a personal reply on bug 47p + goodwill credits
   (user decision on amount - they PAID and got two days of failure).
3. **Beacon truthfulness**: map part-upload HTTP status into the reason taxonomy -
   `http_404` (or `r2_rejected`) distinct from `network`/`timeout`/`stalled`. Client sends
   status in the beacon payload (uploadManager already knows it); server maps it instead of
   bucketing everything as `network`. Backfill is not needed - just stop lying forward.
4. **Alerting**: `upload_success_rate` below threshold (e.g. <70% with >=5 attempts/day) ->
   visible alarm. Cheapest honest version: a red banner on the admin dashboard + a
   `logger.critical` line (greppable, and Fly log alerts can hook it later). No new infra,
   aggregates only (analytics policy).
5. **stuck-uploads endpoint**: reproduce the 500 against bknoto's account, fix, and add a
   regression test with an account in the post-outage state (games deleted, empty
   pending_uploads, orphaned working_videos).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games_upload.py` - `upload_failure_beacon` (512),
  `_record_upload_failure` (72) + reason mapping
- `src/backend/app/analytics.py` - MILESTONE_REASONS taxonomy (line ~197, 229)
- `src/backend/app/routers/admin.py` - pulse card (1779), `stuck-uploads` (703)
- `src/frontend/src/services/uploadManager.js` - beacon payload (sendUploadFailureBeacon, 88)

### Related Tasks
- T8160 (the fix; hard dependency for comms)
- T7610 (outreach vehicle; its upload-failed segment copy applies; cohort grows by this
  outage's victims)
- T7970 (built the success-rate card this task adds teeth to)
- Bug 47p (bknoto) - reply + goodwill credits decision

### User decisions needed
- Goodwill credit amount for bknoto (and any other paying victims)
- Standalone apology email vs folding into T7610

## Implementation

### Steps
1. [ ] Victim list (read-only probe) + post in task file
2. [ ] Beacon reason mapping (client status -> taxonomy) + test
3. [ ] Success-rate threshold banner + CRITICAL log + test
4. [ ] Fix stuck-uploads 500 + regression test
5. [ ] After T8160 on prod: comms per user decision; bknoto bug 47p reply

## Acceptance Criteria

- [ ] Victim list produced with attempts/dates/paying status; posted for user review
- [ ] A part PUT failing with HTTP 404 records a reason distinct from `network`
- [ ] Admin dashboard shows an unmissable alarm when upload success collapses; a CRITICAL
      log line fires
- [ ] `/api/admin/users/{id}/stuck-uploads` returns 200 for bknoto's account
- [ ] Outreach sent (or explicitly deferred by user) once fix is verified on prod
