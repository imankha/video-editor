# T13932: Alert when an R2 source or the billing cycle crosses its Class A threshold

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

The T13920 sweep hot loop ran for 12 days before a Cloudflare billing email surfaced it. T13930
now attributes R2 ops per source; an alert turns that into a same-day signal.

## Solution

Unit 4 of [T13930-design.md](T13930-design.md) sec 4.5, as approved (depends on T13931's
`load_merged_usage`):
- `app/services/r2_usage_alert.py`, started only when `APP_ENV == "production"`, evaluating all three
  env prefixes (shared bucket and free tier). Hourly after a 120s startup delay, under
  `R2Source.R2_USAGE_ALERT` (add the literal).
- Rules (env-overridable constants): any (env, source) >= 20,000 Class A on a UTC day; cycle-to-date
  Class A >= 50% of 1,000,000, or (elapsed >= 2 days and linear projection > 1,000,000).
- Dedup: `pg_try_advisory_lock(13930)` (writes no data) + an R2 marker
  `production/analytics/r2_usage_alerts.json` of sent keys, written with HEAD-etag check + PUT; marker
  write failure logs CRITICAL "may re-alert" (T8670 tradeoff). Channel: CRITICAL log +
  `send_admin_update_email` to `get_admin_emails()`, as reconciliation_alert does.

## Context

- Parent: [T13930-r2-usage-attribution.md](T13930-r2-usage-attribution.md), design [T13930-design.md](T13930-design.md)
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md`

## Acceptance Criteria

- [ ] Alert fires once (not per machine) when a source crosses the threshold; test covers dedup across two passes.
- [ ] Concurrent pass with the lock held -> `skipped_locked`, no alert.
- [ ] Next day re-alerts a sustained source; below threshold is silent; cycle projection alerts once per cycle.
