# T7570: session_started double-fires ~200ms apart; session counts ~2x inflated

**Status:** STAGING
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

- [x] **Root cause of the double-fire named.** `session_started` is written to BOTH
      stores by exactly ONE function — `analytics.update_session()` (callers:
      `/api/auth/me`'s fire-and-forget background task, and `/api/auth/heartbeat`).
      The SQLite `user_action_log` row is written ONLY when `is_new_session` is True,
      so the prod evidence (pairs in that log ~200ms apart) proves TWO
      `update_session` executions BOTH evaluated `is_new_session=True`. Under
      Postgres READ COMMITTED that is only possible if they OVERLAP: both `SELECT`
      the stale `last_active_at` before either commits the roll-forward `UPDATE`,
      so both see the 30-min-idle boundary and both increment — a classic
      lost-update race. (Two SEQUENTIAL calls 200ms apart would give the second
      `is_new_session=False`, hence no second log row — so the 200ms pair is
      diagnostic of CONCURRENCY, not of two genuine sessions.) The concrete
      boot-time trigger: `/me` is requested once by the frontend (`initSession`
      memoizes `_initPromise`), but its `update_session` is scheduled
      fire-and-forget (`asyncio.create_task`), decoupled from the HTTP response,
      and `sessionInit.js`'s `fetchWithRetry` re-issues `/me` on a Fly cold-start
      5xx/timeout — the first request already scheduled `update_session`, the retry
      schedules a second, and the two overlap on the offload threadpool. A boot
      `/me` overlapping the first `/heartbeat` (or a `visibilitychange` heartbeat)
      is a secondary path with the same shape. This is PROD-specific: dev machines
      are always warm, so `/me` never retries. StrictMode is NOT the cause (it is
      dev-only and `_initPromise` defeats it anyway).
- [x] **One session_started per real session start — fix + verification.** Fixed at
      the source by adding `FOR UPDATE` to `update_session`'s `user_segments`
      SELECT (`analytics.py`), making the read-decide-roll atomic: concurrent
      callers serialize on the row lock and, on lock release, READ COMMITTED
      re-reads the row so only the FIRST observes `is_new_session=True`. Exactly
      one session is recorded per genuine 30-min-idle boundary no matter how many
      times `update_session` fires — a single-owner fix, NOT a server-side dedupe
      window, and it leaves the client's cold-start retry resilience intact (the
      retried `/me` is now harmless). No frontend change needed (the client already
      emits `/me` once). Verified against the live schema with a concurrency
      harness: 10 concurrent `update_session` -> `session_started` count = 1;
      counterfactual (lock removed) -> count = 2, proving the fix is load-bearing.
      Regression guard:
      `tests/test_analytics.py::TestUpdateSession::test_concurrent_calls_count_one_session`.
      (Note: a live single-machine browser trace does not exercise the race — it
      is a warm, non-retrying, single-`/me` boot — so the concurrency harness is
      the discriminating verification, not a network trace.)
- [x] **PG-vs-SQLite divergence documented; PG is authoritative.** Postgres
      `user_actions` (SUM-aggregated, feeds the T7460 scorecard + admin) is the
      AUTHORITATIVE session store; SQLite `user_action_log` is a best-effort,
      `is_new_session`-gated per-event audit trail and is NOT expected to match PG
      exactly. The observed 9-vs-7 gap was mostly the RACE (which inflated BOTH
      stores and is now fixed). The residual, structural PG >= SQLite difference
      has two causes, neither a bug in the write path: (1) `user_actions` is keyed
      by `(user_id, action, PLATFORM)` and its first INSERT per platform records
      the debut (`first_at`) even when `is_new_session=False`, while the
      platform-agnostic SQLite log writes nothing then — so a multi-platform user
      adds one PG row per platform debut; (2) a brand-new user's FIRST session has
      `is_new_session=False` (`user_segments.last_active_at` DEFAULTs to `now()` at
      signup), so PG's first-insert records it but the `is_new_session`-gated
      SQLite log skips it. These make PG exceed SQLite by a small constant (matches
      9 vs 7), never a runaway multiple. The PG count was deliberately NOT
      re-gated strictly on `is_new_session` because that would UNDERCOUNT every
      user's genuine first session. Going forward both stores branch on the SAME
      now-atomic `is_new_session`, so the RACE dimension can no longer diverge.
- **Historical data:** do NOT heal the ~2x-inflated pre-fix session counts (no
      fabricated corrections). Analysts should date-fence queries to on/after this
      fix's rollout date, and read PG `SUM(count)` (not row existence) as the
      session metric.
