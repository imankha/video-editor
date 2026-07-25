# T5770: Admin per-user usage: avg/week + last-7-days columns

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Created:** 2026-07-23
**Updated:** 2026-07-23

## Problem

User direction 2026-07-23: "displaying total time on site is good (in the admin tool) but I also want average per week and total last 7 days displayed per user."

The admin user table shows per-user `Sessions` and total `Usage` ([UserTable.jsx:53-54](../../src/frontend/src/components/admin/UserTable.jsx#L53), fed by `total_usage_seconds` from [admin.py:134/219](../../src/backend/app/routers/admin.py#L134)). Total time can't distinguish a long-gone power user from a currently-active one — the two requested metrics answer "how engaged is this user NOW / typically per week".

**Data reality (audited 2026-07-23):** `user_segments.total_usage_seconds` is a single running total in Postgres, incremented at exactly two sites in [analytics.py](../../src/backend/app/analytics.py) (~369-378 session-rollover path, ~484-490 session-end path). There is NO per-user time-bucketed usage anywhere: `daily_counters` is keyed `(counter_date, origin_type)` — per-origin site counters, not per-user ([analytics.py:86-100](../../src/backend/app/analytics.py#L86)) — so it cannot be extended for this without changing its identity. A new table is justified.

## Solution

Two metrics, two different data strategies (no-redundant-state rule):

1. **Average per week — DERIVED, no storage.** `total_usage_seconds / max(1, weeks_since_signup)` computed in the admin endpoint from existing columns (`user_segments.signup_completed_at`, fallback `users.created_at` if null). Never stored.
2. **Total last 7 days — NEW BUCKETED DATA.** New Postgres table:
   ```sql
   CREATE TABLE user_usage_daily (
       user_id TEXT NOT NULL,
       day DATE NOT NULL,
       seconds INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (user_id, day)
   );
   ```
   Incremented via `INSERT ... ON CONFLICT (user_id, day) DO UPDATE SET seconds = user_usage_daily.seconds + %s` at the SAME two sites that bump `total_usage_seconds` — extract a single shared helper (`add_usage_seconds(user_id, seconds)`) that updates both total and daily bucket, so there is one write path for usage data. Day = `CURRENT_DATE` at write time (sessions spanning midnight attribute to the day the increment lands — acceptable for admin metrics; note it, don't engineer around it).
   Admin endpoint adds `SUM(seconds)` over the trailing 7 days per user (single grouped query joined into the existing user list query — no N+1).
3. **UI:** two new right-aligned columns in UserTable.jsx (`Avg/wk`, `Last 7d`) using the existing `fmtDuration` formatter.
4. **Honesty about history:** per-day buckets cannot be backfilled (history was never recorded). `Last 7d` is accurate ~7 days after deploy; until then it under-reports. Display the real number (no fabrication, no fallback to derived estimates). Avg/week from total is accurate immediately.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — the two `total_usage_seconds` write sites (~369-378, ~484-490); new shared `add_usage_seconds` helper
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` gets `user_usage_daily` (fresh deployments)
- `src/backend/app/migrations/postgres/v019_user_usage_daily.py` — NEW versioned migration (check the current head is v018 before numbering; never collide, per running-migrations rules)
- `src/backend/app/routers/admin.py` — user list query (~134, ~187-219): weeks-since-signup derivation + last-7d SUM join
- `src/frontend/src/components/admin/UserTable.jsx` — two new columns + header entries (~53-54, ~390-391)
- `src/backend/tests/` — helper unit test (both totals move together), endpoint field test

### Related Tasks
- Related: postgres v012 (added `total_usage_seconds`) — this is its time-bucketed complement
- Unrelated to T5760 (revenue) beyond both living in the admin table

### Technical Notes
- **Migration agent: YES** (schema change, postgres track). Migrations do NOT auto-run — after deploy, trigger via `POST /api/admin/migrate` or the fly ssh fallback, per env.
- Postgres current version is 18 (verified during T4940 migration run 2026-07-23: `'current_version': 18`), so the new migration is v019 — re-verify at implementation time in case parallel branches land migrations first (version-gap gotcha).
- Retention: rows are ~40 bytes/user/day; no pruning needed at current scale. If ever desired, prune > 90 days — do NOT build it now.
- The session heartbeat path already holds a pg connection at both write sites — the bucket upsert joins the existing transaction; no extra round-trip.
- Impersonation guard: `record_milestone` skips impersonated actions; check whether the usage-increment paths run under impersonation and keep behavior consistent (admin browsing as a user must not inflate that user's usage).

## Implementation

### Steps
1. [ ] Migration v019 + `_SCHEMA_DDL` update (`user_usage_daily`)
2. [ ] Shared `add_usage_seconds` helper; both write sites use it (single write path)
3. [ ] Admin endpoint: `avg_weekly_seconds` (derived) + `last_7d_seconds` (grouped SUM join)
4. [ ] UserTable columns
5. [ ] Tests: helper updates both stores atomically; endpoint returns both fields; weeks clamp (new signup = min 1 week)
6. [ ] Deploy + run migration per env (staging then prod); verify columns populate as sessions accrue

### Progress Log

**2026-07-23**: Task created. Data audit done: no existing per-user time buckets; `daily_counters` is per-origin and not extensible for this; two usage write sites identified in analytics.py.

## Acceptance Criteria

- [ ] Admin user table shows `Avg/wk` and `Last 7d` per user alongside existing total
- [ ] Avg/week is derived at read time (nothing new stored for it)
- [ ] `user_usage_daily` written only via the shared helper, in the same transaction as the total
- [ ] Last-7d shows real recorded data only (no backfill fabrication)
- [ ] Migration applied on staging + prod via the manual trigger; fresh-deploy DDL updated
- [ ] Admin list query remains a bounded number of queries (no per-user N+1)
- [ ] Tests pass
