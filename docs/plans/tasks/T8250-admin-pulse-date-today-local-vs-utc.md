# T8250: Admin pulse/funnel `date.today()` uses local time, daily_counters uses UTC — daily blind window

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-01

## Problem

Found by accident while testing T8170's upload-success alarm: `GET /api/admin/analytics/pulse`
(and at least one sibling endpoint) computed its date window with Python's **naive local-time**
`date.today()` (`app/routers/admin.py:1637`, `start = today - timedelta(days=days-1)`), while
`daily_counters` rows are written keyed on Postgres's `CURRENT_DATE` (UTC, `analytics.py:101`,
`_DailyCounterBuffer.flush`).

For anyone running the app server (or a local dev/test client) in a negative-UTC-offset
timezone (e.g. US Pacific, UTC-7/-8), there is a **daily ~7-8 hour window, right after local
midnight-UTC-minus-offset** where Python's `today` is still "yesterday" by local calendar while
Postgres has already rolled `CURRENT_DATE` to the new UTC day. Any milestone recorded during
that window lands under a `daily_counters.counter_date` the pulse query's `BETWEEN start AND
today` range does not include — it silently reads as zero for the metric that day, then
reappears once Python's local calendar catches up. Reproduced live 2026-09-01 ~00:30 UTC:
`game_upload_failed`/`game_upload_succeeded` milestones recorded and correctly landed in
`daily_counters` (verified via direct query) with `origin_type='all'`, but the pulse endpoint's
`upload_success_rate` card showed `today: null` (zero attempts) because its Python-computed
date window excluded the row.

This is the same class of bug T7990 already fixed once for the STAT TILES ("stay UTC ... not
shifted", per that task's resolution) — this endpoint just wasn't part of that sweep, or
regressed since.

Likely affects every window/sparkline computation in this endpoint (signups, exports,
active_users, revenue, viral_conversion, upload_success_rate) since they all share the same
`today`/`start`/`date_range` variables — not just the upload metric that happened to surface it.

## Solution

Bug-reproduction skill: a test asserting a `daily_counters` row written with
`counter_date = CURRENT_DATE` (Postgres/UTC) is visible in the pulse response when the LOCAL
system clock is mocked to a time zone/offset where local-today != UTC-today (freeze the clock
near a local-evening/UTC-morning boundary, matching this bug's exact reproduction window).

Fix: compute `today`/`start` in `app/routers/admin.py`'s pulse (and any sibling analytics
endpoint sharing the pattern — grep `date.today()` across `admin.py`/`analytics.py`) using UTC
explicitly (`datetime.now(UTC).date()`), matching `daily_counters`' own UTC convention and
T7990's precedent. Audit `_build_segment_filter`'s `date.fromisoformat` date-range params too
(admin.py:1596-1599) for the same class of issue if they're ever compared against UTC-anchored
columns.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — pulse endpoint `today`/`start` (line ~1637); grep
  `date.today()` for sibling occurrences (line 1235-1236 is a DIFFERENT, user-suppliable
  date-range default, lower priority but same class)
- `src/backend/app/analytics.py` — `_DailyCounterBuffer.flush` (UTC `CURRENT_DATE` writes, the
  source of truth this should match)
- Related: T7990 (fixed the same local-vs-UTC class for the stat-tile subtitle wording, not
  this query — see if its fix left this endpoint out of scope deliberately or was incomplete)

## Acceptance Criteria

- [ ] Pulse endpoint's date window matches `daily_counters`' UTC convention (test with a mocked
      clock at a local/UTC day-boundary mismatch)
- [ ] Every sparkline/card fed by the same `today`/`start`/`date_range` variables verified
      correct at the boundary, not just upload_success_rate
- [ ] Audit other admin analytics endpoints for the same `date.today()` pattern
