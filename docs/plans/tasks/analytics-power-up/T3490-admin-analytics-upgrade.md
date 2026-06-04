# T3490: Admin Analytics Upgrade

**Status:** TODO
**Priority:** P2
**Impact:** 7 | **Complexity:** 3

## Summary

Upgrade the Analytics tab (Funnel, Channels, Cohorts views) to use the new normalized schema, include the new tracked events, and show revenue attribution per campaign including viral descendants.

## Why

Current analytics views work but are limited:
- Funnel doesn't include session_started, export_started, share_viewed (new events from T3470)
- Channels view uses the old 3-way origin_type enum instead of the new origin model (organic or campaign ID)
- No revenue data visible -- can't see which campaigns generate money
- Cohorts view only shows pipeline step percentages, no time-to-milestone or retention
- Pulse cards show % change vs last week but no absolute trend context

## Changes

### Funnel View

Update to include new events in the pipeline:

```
Signed Up       142  ████████████████████████████████ 100%
Sessioned       138  ██████████████████████████████   97%   <- NEW
Uploaded         98  ██████████████████████           69%
Clipped          87  ████████████████████             61%
Annotation Done  71  ████████████████                 50%
Framing Opened   62  ██████████████                   44%
Framing Export   43  ████████████                     30%
Export Started   39  ███████████                      27%   <- NEW
Export Done      35  ██████████                       25%
Overlay Export   31  █████████                        22%
Downloaded       24  ███████                          17%
Shared           18  █████                            13%
Share Viewed     12  ████                              8%   <- NEW (viral conversion)
Purchased         9  ███                               6%
```

Backend: update FUNNEL_STEPS, query `user_actions` instead of `user_flow_events`.

### Channels View (now "Campaigns")

Show revenue per origin, including viral descendants:

```
ORIGIN            USERS  DIRECT  VIRAL  EXPORTED%  PURCHASED%  REVENUE    AVG EXPORTS
organic              48     48      0      58%       12.5%      $142.50       3.2
ig_summer_camp       22     10     12      55%       18.2%      $210.00       4.1
facebook_may         15      8      7      40%       13.3%       $85.00       2.5
```

- **USERS**: total users with this origin (direct + viral descendants)
- **DIRECT**: users who arrived directly via ?ref=campaign_id
- **VIRAL**: users who inherited this origin through invite chain
- **REVENUE**: SUM(total_spent_cents) for all users with this origin

Expandable rows: click a campaign to see the referral tree (who brought whom).

Backend: query `user_segments` grouped by origin, with referrer_id to count direct vs viral.

```sql
SELECT
    origin,
    COUNT(*) AS users,
    COUNT(*) FILTER (WHERE referrer_id IS NULL) AS direct,
    COUNT(*) FILTER (WHERE referrer_id IS NOT NULL) AS viral,
    SUM(total_spent_cents) AS revenue_cents,
    -- join user_actions for conversion metrics
FROM user_segments s
GROUP BY origin
ORDER BY revenue_cents DESC;
```

### Cohorts View

Add time-to-first-export column, 7-day return rate, and revenue:

```
COHORT       SIGNUPS  UPLOADED  CLIPPED  EXPORTED  SHARED  PURCHASED  REVENUE   TIME-TO-EXPORT  7d RETURN%
Week May 19      24     75%      63%      50%      21%       8%       $52.00      3.2 days         42%
Week May 26      31     81%      68%      58%      29%      13%       $95.00      2.1 days         52%
Week Jun 02      22     77%      64%      55%      32%      14%       $63.50      1.8 days         55%
```

- Revenue: SUM(total_spent_cents) per cohort
- Time-to-export: median days between signup and first `export_completed` action
- 7d return: % of cohort with a `session_started` action >= 7 days after signup

Backend: derive from `user_actions.first_at` timestamps + `user_segments.total_spent_cents`.

### Pulse Cards

Add sparkline time range selector and make metrics more actionable:

```
SIGNUPS          EXPORTS           REVENUE (30d)     VIRAL CONV.
    3                12              $210.00              67%
 +50% vs last wk  -20% vs last wk  +15% vs last mo   +5% vs last wk
 [7d] [30d] [90d]  [7d] [30d] [90d]  [7d] [30d] [90d]  [7d] [30d] [90d]
 [sparkline~~~~]   [sparkline~~~~]   [sparkline~~~~]    [sparkline~~~~]
```

Replace "Purchases" card with "Revenue" and add "Viral Conv." (share_viewed / share_completed %).

## Dependencies

- T3450 (schema): queries use `user_segments` + `user_actions`, revenue from total_spent_cents
- T3470 (tracking gaps): new events must be recording for the funnel to include them

## Implementation

### Backend
- Update `/api/admin/analytics/funnel`: query `user_actions` with new FUNNEL_STEPS
- Update `/api/admin/analytics/channels`: rewrite as campaign view -- GROUP BY origin with revenue rollup
- Update `/api/admin/analytics/cohorts`: add revenue, time-to-export, return rate columns
- Update `/api/admin/analytics/pulse`: add revenue metric, viral conversion, time range param

### Frontend
- `FunnelChart.jsx`: add new funnel steps
- `ChannelsTable.jsx`: rename to campaigns, show origin + direct/viral split + revenue
- `CohortGrid.jsx`: add revenue, time-to-export, 7d return columns
- `PulseCards.jsx`: replace Purchases with Revenue, add Viral Conv., add time range selector

## Testing

- Funnel: verify new events appear with correct counts
- Channels/campaigns: verify revenue rollup includes viral descendants (campaign user + all invited users = total)
- Cohorts: verify time-to-export calculation against manual spot check
- Pulse: verify revenue total and viral conversion % match manual calculation
