# T15050: Upload observability: flow id and kind on every event, no empty beacons, log retention, alarm counts affected users

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

What slowed down the 2026-11-04 investigation (T15020). Each item below cost real time or
hid the answer.

## Problem

1. **No flow identity.** `[UPLOAD_LIFECYCLE]` lines carry user, session and hash but nothing that
   distinguishes two client flows sharing one session. The collision was only provable by
   counting `prepare | resume | finalize success | finalize FAILED` per session by hand.
2. **Server-side failures without kind or hash.** `save_upload_parts` and (before T15020)
   `finalize_upload` record `session_not_found` with no hash and the GAME default kind. The
   admin pulse card therefore showed 27 "game" failures for clip uploads.
3. **Empty beacons.** Eight `[UPLOAD_BEACON] ... phase=None session=None hash=None attempts=None
   reason=None` rows (build 7102) landed as `kind=game stage=unknown reason=unknown` terminal
   failures. Some caller of `sendUploadFailureBeacon` sends an empty payload; find it (the
   `apiFetchWithNetworkRetry` spread path or a bare call) and give every beacon a phase, a reason
   and the kind. The writer should refuse to mark a reason-less beacon terminal.
4. **Log retention.** `fly logs` returns the last ~100 lines; `/tmp/logs/app.log` keeps today plus
   ONE rotated day (`backupCount=1`, main.py). A report that arrives two days late has no log.
   Raise `backupCount` (disk is cheap, the log is ~10 MB/day) or add a Fly log drain, and write the
   access recipe (`fly ssh console -C "sh -c 'grep ... /tmp/logs/app.log'"`) into the knowledge doc.
5. **The alarm counts requests, not people.** `UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT = 70` over
   `succeeded + failed` let one user's 36 duplicated failures read as a fleet-wide collapse. The
   pulse card and the alert text should also report distinct users with a failure and distinct
   users with a success in the window ("36 failures from 1 user; 28 successes from 2 users"), and
   the alarm should require failures from more than one user before calling it a collapse.

## Solution

- Client: a per-`ensureVideoInR2` `flow_id` (uuid) sent on prepare, `/parts`, finalize and every
  beacon; server logs it on every `[UPLOAD_LIFECYCLE]` and `[UPLOAD_FAILURE]` line and stores it
  in `upload_failures` (new column, postgres migration).
- `/parts` requests carry `blake3_hash` + `kind` like finalize does now, so a 404 there is filed
  correctly.
- Beacon writer: `reason` missing -> `terminal=False` and a WARNING naming the client build.
- Logging: `backupCount=7` or a drain; recipe in `backend-services.md`.
- Admin: distinct-user counts beside the pair; alarm text names the user count.

## Acceptance Criteria

- [ ] One `grep flow_id=<x>` in app.log shows a flow's prepare, parts, finalize and beacons
- [ ] A `/parts` 404 is recorded with the client kind and hash
- [ ] A beacon with no reason never counts as a terminal failure (test)
- [ ] The upload pulse card shows "N failures from M users" and the alarm needs M >= 2
- [ ] app.log retention covers at least 7 days on prod

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py`, `src/backend/app/services/upload_failures.py`
- `src/backend/app/routers/admin.py` (`UPLOAD_SUCCESS_ALARM_*`, upload pair)
- `src/backend/app/main.py` (log rotation), `src/frontend/src/services/uploadManager.js`

### Related Tasks
- T15020, T10270 (upload_failures), T8170 (pulse-card alarm), T7510 (attempted vs succeeded)
