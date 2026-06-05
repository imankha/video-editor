# T3510: Real Pulse Sparklines for Revenue + Viral Conversion

## Context

T3490 added Revenue and Viral Conversion cards to the admin pulse view, replacing the old Purchases card. However, both new cards return stub data: `{"sparkline": [], "change_pct": 0}`. The existing cards (Signups, Exports, Active Users) compute real daily sparklines and week-over-week change.

## Problem

In `admin.py` `analytics_pulse`:
- `revenue` returns `{"today": revenue_total, "sparkline": [], "change_pct": 0}` -- total is correct but sparkline and trend are empty
- `viral_conversion` returns `{"today": viral_pct, "sparkline": [], "change_pct": 0}` -- percentage is correct but sparkline/trend are empty
- The `viral_spark` loop always appends 0 (`viral_spark.append(0)`) and never uses `s_val`

## Requirements

### Revenue Sparkline
- Daily revenue per day across the date range
- **Unfiltered path**: derive from `daily_counters.credit_purchases` x average pack price, or better: query `user_segments` for users whose payment occurred on each date
- **Filtered path**: SUM(total_spent_cents) per acquired_at date for filtered segment (approximation -- true daily revenue requires payment timestamps)
- `change_pct`: compare last 7 days vs prior 7 days

### Viral Conversion Sparkline
- Daily `share_viewed / share_completed` ratio
- **Unfiltered path**: use `daily_counters.shares_viewed` / `daily_counters.shares_completed` per day
- **Filtered path**: query `user_actions` joined with segment filter for daily counts
- `change_pct`: compare last 7 days vs prior 7 days

### Implementation Notes
- The `make_card()` helper already computes `change_pct` from sparkline data -- use it for the new cards too
- For revenue, consider tracking daily_revenue in `daily_counters` (new column) so sparklines are cheap
- Viral conversion per-day can be 0/0 (no shares that day) -- use 0 not NaN

## Files to Change
- `src/backend/app/routers/admin.py` -- fix pulse endpoint
- Possibly `src/backend/app/services/pg.py` -- if adding daily_revenue column
- Possibly `src/backend/app/migrations/postgres/` -- if adding column
- `src/backend/tests/test_analytics_dashboards.py` -- verify sparklines are non-empty arrays of correct length

## Done When
- Revenue card shows real daily sparkline with correct length matching `days` param
- Viral conversion card shows real daily sparkline
- Both cards show real `change_pct` (not hardcoded 0)
- Existing tests updated and passing
