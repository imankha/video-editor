# T7570: session_started double-fires ~200ms apart; session counts ~2x inflated

**Status:** WIP
**Priority:** P3 (metrics integrity)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Prod evidence (2026-08-24, cschwartz78's user_action_log): `session_started` pairs at
16:14:47.266/.500, 20:47:08.618/.800, 17:48:38.339/.535 - duplicates ~200ms apart on
three separate real sessions. Session counts are inflated roughly 2x, which corrupts
"days active"/sessions-per-user analysis and will feed the T7460 scorecard wrongly.

Additionally the two stores DISAGREE: Postgres `user_actions` reports count 9 for the
same user where the SQLite `user_action_log` holds 7 rows - so the two recording paths
are not writing in lockstep (different dedupe? different failure handling?).

Likely mechanism: the session-init emission point fires twice (double mount / StrictMode
in prod would be surprising, so more likely two callers or a retry) - find the emitter in
sessionInit.js / session_init.py and trace both writes.

## Solution

1. Locate the emitter(s); establish why two fire ~200ms apart in PROD builds (StrictMode
   is dev-only, so do not hand-wave it; find the two real call sites or the retry).
2. Single-owner fix at the source (one emission per genuine session start), not a
   server-side dedupe window that papers over it. If a legitimate second caller exists,
   collapse to one owner (state-management single-ownership rule).
3. Explain the PG-vs-SQLite count divergence and fix the write path so both stores agree
   (or document which is authoritative and derive the other).
4. Note for analysts: historical session counts before the fix are ~2x; do not "heal"
   old data, just date-fence it in queries (no fabricated corrections).

## Context

### Relevant Files
- `src/frontend/src/utils/sessionInit.js` - client emission
- `src/backend/app/session_init.py`, `src/backend/app/analytics.py`,
  `src/backend/app/services/user_db.py` - the two recording paths (PG user_actions
  aggregate + user.sqlite user_action_log)

### Related Tasks
- **Same defect class, different code corner:** T6250 (post-har-latency epic) found
  `overlay-data`/`outdated-clips` firing 2-3x on the Framing->Overlay transition — "two
  owners fetching the same thing" — and its investigation discipline applies directly here
  (name the real call sites, don't hand-wave StrictMode, an ODD/production-confirmed count
  proves genuine duplication). Not the same code (T6250 is a screen-transition GET fetch;
  this is a session-boot POST) and not a candidate to fold into that epic (scoped to one HAR
  capture on different screens) — reference only, reuse the method not the fix.

## Acceptance Criteria

- [ ] Root cause of the double-fire named (both call sites / retry identified)
- [ ] One session_started per real session start, verified in a real browser session
      against staging (network trace shows one call)
- [ ] PG and SQLite stores agree for new events; divergence mechanism documented
