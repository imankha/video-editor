# T3030: Analytics Dashboards

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-05-20
**Epic:** [Analytics 1](EPIC.md)
**Depends on:** T3010 (User Milestones), T3020 (Admin Panel Migration)

## Problem

T3010 creates the `user_milestones` table and T3020 migrates the admin panel to read from it, but neither adds aggregate visualizations. The admin panel shows a user list with activity counts -- it can't answer "where do users drop off?", "are viral users more valuable than organic?", or "is signup volume growing?"

## Solution

Add 5 dashboard views to the admin panel, backed by Postgres queries against `user_milestones`. Add a `daily_counters` table for volume trends that milestones can't provide (milestones track lifetime totals, not daily breakdowns).

## Schema: daily_counters

```sql
CREATE TABLE daily_counters (
    counter_date DATE NOT NULL DEFAULT CURRENT_DATE,
    origin_type TEXT NOT NULL DEFAULT 'all',
    signups INTEGER NOT NULL DEFAULT 0,
    games_created INTEGER NOT NULL DEFAULT 0,
    clips_created INTEGER NOT NULL DEFAULT 0,
    exports_completed INTEGER NOT NULL DEFAULT 0,
    exports_failed INTEGER NOT NULL DEFAULT 0,
    shares_completed INTEGER NOT NULL DEFAULT 0,
    credit_purchases INTEGER NOT NULL DEFAULT 0,
    credits_consumed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_date, origin_type)
);
```

**Size**: ~3 rows/day (one per origin_type). 1 year = ~1,100 rows. Effectively zero overhead.

**Updated by `record_milestone()`** (from T3010) -- each milestone update also does an atomic UPSERT on the daily counter:

```sql
INSERT INTO daily_counters (counter_date, origin_type, exports_completed)
VALUES (CURRENT_DATE, %s, 1)
ON CONFLICT (counter_date, origin_type)
DO UPDATE SET exports_completed = daily_counters.exports_completed + 1;
```

The `origin_type` for each counter row comes from the user's `user_milestones.origin_type`. An additional row with `origin_type = 'all'` is updated on every event for unfiltered totals.

## Dashboards

### 1. Activation Funnel

The most important view. Shows where users drop off in the activation sequence.

**Query:**
```sql
SELECT
    origin_type,
    COUNT(*) as signed_up,
    COUNT(first_game_created_at) as uploaded,
    COUNT(first_clip_created_at) as clipped,
    COUNT(first_export_completed_at) as exported,
    COUNT(first_share_completed_at) as shared,
    COUNT(first_credit_purchase_at) as purchased
FROM user_milestones
WHERE install_day BETWEEN %s AND %s  -- date range filter
GROUP BY origin_type;
```

**UI**: Horizontal bar chart. Each bar = a funnel stage, width proportional to count. Conversion % shown between bars. Dropdown to filter by origin_type or show all. Date range picker for install cohort.

**What it answers**: "50% of users who upload never clip. 80% of viral users export vs 40% organic."

### 2. Acquisition Channels

Shows where users come from and which channels produce valuable users.

**Query (signups by channel):**
```sql
SELECT
    origin_type,
    origin_channel,
    COUNT(*) as signups,
    COUNT(first_export_completed_at) as exported,
    ROUND(100.0 * COUNT(first_export_completed_at) / NULLIF(COUNT(*), 0), 1) as export_pct,
    COUNT(first_credit_purchase_at) as purchased,
    AVG(export_completed_count) as avg_exports
FROM user_milestones
GROUP BY origin_type, origin_channel
ORDER BY signups DESC;
```

**UI**: Table with columns: Channel, Signups, Exported (%), Purchased (%), Avg Exports. Organic row, then viral rows broken by channel (invite_link, reel_share, game_share). Color-coded by export conversion rate.

**What it answers**: "Game shares convert at 3x the rate of invite links. Organic users purchase more but viral users export more."

### 3. Cohort Grid

Classic retention/activation grid. Rows are install cohorts, columns are milestones.

**Query:**
```sql
SELECT
    date_trunc('week', install_day)::date as cohort_week,
    origin_type,
    COUNT(*) as signups,
    COUNT(first_game_created_at) as uploaded,
    ROUND(100.0 * COUNT(first_game_created_at) / NULLIF(COUNT(*), 0)) as upload_pct,
    COUNT(first_export_completed_at) as exported,
    ROUND(100.0 * COUNT(first_export_completed_at) / NULLIF(COUNT(*), 0)) as export_pct,
    COUNT(first_credit_purchase_at) as purchased,
    ROUND(100.0 * COUNT(first_credit_purchase_at) / NULLIF(COUNT(*), 0)) as purchase_pct
FROM user_milestones
GROUP BY cohort_week, origin_type
ORDER BY cohort_week DESC;
```

**UI**: Table with rows = install weeks, columns = milestone completion rates (%). Cells color-coded green (high) to red (low). Toggle between "all", "organic", "viral". Shows whether activation is improving over time.

**What it answers**: "Week of May 12 had 60% export rate vs 40% the week before -- the onboarding change worked."

### 4. User Journey Inspector

Select a user and see their complete activation timeline.

**Query:**
```sql
SELECT * FROM user_milestones WHERE user_id = %s;
```

**UI**: Timeline view. Each milestone shown as a node on a horizontal timeline with timestamps and time gaps between steps. Shows:
- Origin badge (organic/viral + channel)
- Install date
- Each milestone in chronological order (sorted by non-null timestamps)
- Time gap between each step (e.g., "2 hours later", "3 days later")
- Lifetime counts for each event type
- Missing milestones shown as gray/dimmed nodes

Accessed from the existing user table -- click a user to see their journey.

**What it answers**: "This user uploaded immediately but took 3 days to clip. They've exported 12 times but never shared."

### 5. Daily Pulse

At-a-glance health metrics. Requires `daily_counters` table.

**Query:**
```sql
SELECT
    counter_date,
    origin_type,
    signups,
    exports_completed,
    shares_completed,
    credit_purchases
FROM daily_counters
WHERE counter_date >= CURRENT_DATE - 30
  AND origin_type = 'all'
ORDER BY counter_date;
```

**UI**: 4 metric cards at the top of the admin dashboard, each with:
- **Today's value** (big number)
- **vs same day last week** (% change, green/red)
- **30-day sparkline** below

Cards:
1. **Signups Today** -- `signups` from daily_counters
2. **Exports Today** -- `exports_completed` from daily_counters
3. **Active Users** -- `COUNT(*) FROM users WHERE last_seen_at >= CURRENT_DATE` (not from daily_counters)
4. **Purchases Today** -- `credit_purchases` from daily_counters

**What it answers**: "Signups are up 30% week-over-week. Exports dropped today -- investigate."

## API Endpoints

All under `/api/admin/analytics/` (admin session required):

| Endpoint | Dashboard | Params |
|----------|-----------|--------|
| `GET /api/admin/analytics/funnel` | Activation Funnel | `?from=DATE&to=DATE&origin=TYPE` |
| `GET /api/admin/analytics/channels` | Acquisition Channels | `?from=DATE&to=DATE` |
| `GET /api/admin/analytics/cohorts` | Cohort Grid | `?granularity=week\|month&origin=TYPE` |
| `GET /api/admin/analytics/journey/:user_id` | User Journey | -- |
| `GET /api/admin/analytics/pulse` | Daily Pulse | `?days=30` |

## Files Affected

| File | Change |
|------|--------|
| `src/backend/app/migrations/postgres/v006_daily_counters.py` | NEW: daily_counters table |
| `src/backend/app/services/pg.py` | Add daily_counters to _SCHEMA_DDL |
| `src/backend/app/analytics.py` | Extend record_milestone() to also UPSERT daily_counters |
| `src/backend/app/routers/admin.py` | Add 5 analytics endpoints |
| `src/frontend/src/components/admin/AnalyticsDashboard.jsx` | NEW: dashboard container with 5 views |
| `src/frontend/src/components/admin/FunnelChart.jsx` | NEW: horizontal bar funnel |
| `src/frontend/src/components/admin/CohortGrid.jsx` | NEW: color-coded cohort table |
| `src/frontend/src/components/admin/JourneyTimeline.jsx` | NEW: milestone timeline for single user |
| `src/frontend/src/components/admin/PulseCards.jsx` | NEW: metric cards with sparklines |

## Implementation Notes

- **No chart library needed** for the funnel, cohort grid, or pulse cards -- these are CSS-styled divs/tables. The funnel is horizontal bars with width percentages. The cohort grid is a table with background-color. Sparklines can be inline SVG paths (one polyline from 30 data points).
- **Journey timeline**: CSS flexbox with dots and lines. No external dependency.
- **Date filtering**: all queries use `install_day` or `counter_date` ranges. Parameterized SQL, no injection risk.
- **Admin-only**: all endpoints require admin session. No public access.

## Steps

1. [ ] Create migration `v006_daily_counters.py` + update `_SCHEMA_DDL` in pg.py
2. [ ] Extend `record_milestone()` to UPSERT daily_counters on each event
3. [ ] Backfill daily_counters from user_milestones install_day data (signups only -- other counts not available historically)
4. [ ] Add 5 admin analytics endpoints to `admin.py`
5. [ ] Create `AnalyticsDashboard.jsx` container with tab navigation (Funnel / Channels / Cohorts / Pulse)
6. [ ] Implement FunnelChart component
7. [ ] Implement Acquisition Channels table
8. [ ] Implement CohortGrid component
9. [ ] Add Journey view to existing user detail (click user -> see timeline)
10. [ ] Implement PulseCards with sparklines
11. [ ] Backend tests: verify each endpoint returns correct data shape
12. [ ] Manual test on staging: trigger events, verify dashboards update in real-time

## Acceptance Criteria

- [ ] daily_counters table exists with real-time increments from record_milestone()
- [ ] Activation funnel shows drop-off between stages, filterable by origin and date range
- [ ] Acquisition channels table shows signup/export/purchase rates by origin_type and channel
- [ ] Cohort grid shows weekly milestone completion rates, color-coded
- [ ] User journey timeline accessible from user table click
- [ ] Daily pulse cards show today's metrics with WoW comparison and 30-day sparklines
- [ ] All endpoints admin-only, parameterized SQL (no injection)
- [ ] Dashboard loads in < 500ms on staging
