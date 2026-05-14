# T1702: Monetization + Intelligence -- Credits, Revenue, Computed Engine, Alerts

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-05-13
**Epic:** [Analytics System](EPIC.md)
**Depends on:** [T1701](T1701-core-analytics.md) (all 41 events flowing, L2 dashboard live)

## Problem

After T1701, we have comprehensive event tracking and dashboards but no:
- Credit economy visibility (purchase funnel, utilization, repurchase rate)
- Revenue tracking in OpenPanel (Stripe purchases not flowing)
- Computed intelligence (churn risk, engagement tiers, LTV, credit health)
- Automated alerts (zero exports, error spikes, purchase failures)
- Weekly health digest
- Viral attribution (who referred whom, reel shares vs. team shares)

## Solution

Instrument 5 credit events, wire Stripe revenue to OpenPanel, build L2-D Monetization dashboard, create the nightly analytics engine (churn risk, engagement tiers, credit health, LTV, early value score), set up hourly/weekly alert crons, and track viral attribution chains.

See [analytics-system-plan.md](../../analytics-system-plan.md) Sections 3.3 (L2-D), 4.1 (Credit/Revenue events), 6 (Virality), 7 (Computed Intelligence), 8 (Alerts) for full spec.

## Scope

### 1. Credit Events (5 events)

| Event | Source | Handler Location | Key Properties |
|-------|--------|-----------------|---------------|
| `credits_modal_viewed` | Frontend | Insufficient credits modal mount | `trigger` (upload_insufficient/expiry_warning/manual), `credits_remaining`, `credits_needed`, `current_pack_expiry_days` |
| `credit_purchase_started` | Frontend | Pack selection click in credits modal | `pack_size` (1/5/20), `trigger`, `modal_impression_count` |
| `credits_purchased` | Backend | Stripe webhook (`checkout.session.completed`) | `pack_size`, `amount_cents`, `currency`, `credits_remaining_before`, `is_first_purchase`, `time_since_signup_days` |
| `credits_consumed` | Backend | Game upload handler (credit deduction) | `credits_used`, `trigger` (game_upload/upload_surcharge), `credits_remaining_after`, `game_id` |
| `credits_expired` | Backend | Credit expiry batch job | `credits_expired_count`, `credits_remaining`, `days_since_last_purchase` |

### 2. Revenue Tracking (REST API)

Python SDK lacks `revenue()`. Use REST API from Stripe webhook:

```python
# In stripe webhook handler, after credits_purchased event
async def track_revenue(user_id: str, amount_cents: int, pack_size: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{OPENPANEL_API_URL}/track",
            headers={
                "openpanel-client-id": CLIENT_ID,
                "openpanel-client-secret": CLIENT_SECRET,
            },
            json={
                "type": "track",
                "payload": {
                    "name": "revenue",
                    "profileId": user_id,
                    "properties": {
                        "__revenue": amount_cents,
                        "pack_size": pack_size,
                    },
                },
            },
        )
```

### 3. L2-D Monetization Dashboard

| Widget | Chart Type | Time Range |
|--------|-----------|------------|
| Weekly credit revenue | Linear (line) | 8 weeks |
| ARPU ticker | Linear (line) | 8 weeks |
| Credit purchase funnel: `credits_modal_viewed` -> `credit_purchase_started` -> `credits_purchased` -> `video_uploaded` | Funnel | 4 weeks |
| Free-to-paid conversion rate | Conversion | 8 weeks |
| Credit pack distribution (1 vs. 5 vs. 20) | Pie | Current month |
| Repurchase rate (30d) | Linear (line) | 8 weeks |
| Credit utilization rate (consumed / purchased) | Linear (line) | 8 weeks |

### 4. Nightly Analytics Engine

Create `src/backend/app/analytics/engine.py` with `compute_analytics_properties()`, scheduled at 2am UTC.

For each active user (active in last 90 days), compute and push via `op.identify()`:

**Engagement tier:**
- `power`: exports_30d >= 8 or games_30d >= 4
- `active`: exports_30d >= 2 or games_30d >= 1
- `casual`: everything else

**Churn risk (0-100):**
- Recency: days_since_last_session / 14 (weight: 20%)
- Game recency: days_since_last_game / 21 (weight: 15%)
- Frequency decline: session count drop last 14d vs. prior 14d (weight: 15%)
- Depth decline: distinct event types last 14d vs. first 30d (weight: 10%)
- Action decline: export count drop last 14d vs. prior 14d (weight: 10%)
- **Credit health: 30% weight** (strongest signal in credit economy)
  - Credits remaining = 0: risk = 1.0
  - Credits <= 2 and expiry <= 7 days: risk = 0.7
  - Expiry <= 3 days: risk = 0.5
  - Else: risk = 0.0

**Credit health:**
- `healthy`: credits > 3 and expiry > 14 days
- `expiring_soon`: credits > 0 and expiry <= 7 days
- `depleted`: credits = 0 and had credits recently
- `expired`: credits = 0 and last expiry > 30 days ago

**Stickiness:** active_days_7d / 7

**Early value score** (first 7 days only, 0-8):
- Upload a game: +1
- Create 3+ clips: +1
- Export first highlight: +2
- Share to teammate or social: +2
- Return within 48h: +1
- Use Framing or Overlay mode: +1

**Estimated LTV** (after D30): coefficient method -- D90_LTV / D7_LTV ratio from historical cohorts, applied to current D7 LTV.

**Repurchase probability** (when credits <= 2): based on prior purchase history, engagement tier, credit utilization.

**Data sources:** Query OpenPanel Export API (`analytics-read` client) for event counts. Query Fly Postgres for credit balance/expiry. Query per-user SQLite for game/clip/export counts.

### 5. Hourly Cron (`check_guardrails`)

Create scheduled task running hourly:

1. **Zero exports in 24h** -> Slack P1 alert (only during business hours)
2. **Error rate >1% of sessions** (last hour, minimum 10 sessions) -> Slack P0 alert
3. **Export failure rate >10%** (last 4 hours, minimum 5 starts) -> Slack P1 alert
4. **Credit purchase completion <50%** (last 4 hours, minimum 3 starts) -> Slack P1 alert

Query OpenPanel Export API for event counts. Send alerts via Slack webhook.

### 6. Weekly Cron (`weekly_health_digest`, Monday 9am)

Send Slack message comparing this week vs. last week:
- North Star: exports count
- WAU, signups, activation rate, D7 retention
- Credit revenue, credits purchased, repurchase rate
- Shares, error rate, quest completion rate
- All with WoW delta (absolute + percentage)

### 7. Viral Attribution

Create `share_attribution` table in Fly Postgres:

```sql
CREATE TABLE share_attribution (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    referred_by TEXT NOT NULL REFERENCES users(id),
    share_type TEXT NOT NULL,  -- 'reel' or 'team'
    share_link_id TEXT,
    share_depth INT NOT NULL DEFAULT 1,
    ultimate_source TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

On signup via share link:
- Insert `share_attribution` row with depth = referrer's depth + 1
- `ultimate_source` = walk chain to root
- `op.identify()` with `referred_by`, `share_depth`, `share_type`, `ultimate_source`, `acquisition_type: "viral"`

Update L2-F dashboard:
- Viral tree depth (Bar, 4 weeks)
- K-factor ticker (Linear, 8 weeks) -- computed in nightly job
- Share-to-signup conversion (Conversion, 8 weeks)
- Breakdown retention/revenue by `acquisition_type` (viral vs. organic)

### 8. OpenPanel Event-Match Alerts

Configure in OpenPanel dashboard:
- Alert on every `export_failed` -> Slack channel
- Alert on every `error_tracked` with `severity: "critical"` -> Slack channel

## Files Affected

| File | Change |
|------|--------|
| `src/frontend/src/analytics/events.ts` | Add 5 credit event constants |
| `src/frontend/src/analytics/track.ts` | Add credit event wrapper functions |
| `src/backend/app/analytics/events.py` | Add credit event constants |
| `src/backend/app/analytics/tracker.py` | Add credit tracking + revenue REST call |
| `src/backend/app/analytics/engine.py` (new) | Nightly compute + hourly cron + weekly digest |
| Insufficient credits modal | Track `credits_modal_viewed` |
| Credit purchase UI | Track `credit_purchase_started` |
| Stripe webhook handler | Track `credits_purchased` + `revenue` |
| Game upload handler | Track `credits_consumed` |
| Credit expiry job | Track `credits_expired` |
| Signup handler | Insert `share_attribution` on viral signups |
| `src/backend/app/models/` or migration | Add `share_attribution` table |
| `.env` | Add `SLACK_WEBHOOK_URL`, `OPENPANEL_READ_CLIENT_ID/SECRET` |

## Acceptance Criteria

- [ ] All 5 credit events flowing to OpenPanel
- [ ] Revenue tracked via REST API from Stripe webhook (visible in OpenPanel revenue view)
- [ ] L2-D Monetization dashboard live (purchase funnel, repurchase rate, utilization, pack distribution)
- [ ] Nightly analytics engine runs at 2am UTC without errors
- [ ] Computed properties visible on OpenPanel user profiles (engagement_tier, churn_risk, credit_health, stickiness_7d, early_value_score, ltv_estimated)
- [ ] Hourly cron fires and catches test conditions (verify with simulated zero-export period)
- [ ] Weekly digest sends to Slack on Monday morning with WoW comparisons
- [ ] `share_attribution` table created and populated on viral signups
- [ ] Viral signup users have `referred_by`, `share_depth`, `acquisition_type` properties in OpenPanel
- [ ] OpenPanel event-match alerts configured for `export_failed` and critical errors
- [ ] Alert false positive rate verified (no spam from known deploy patterns)
