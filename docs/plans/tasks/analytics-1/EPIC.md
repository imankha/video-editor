# Epic: Analytics 1 (Cloudflare + Postgres)

**Status:** TODO
**Created:** 2026-05-20

## Goal

Get actionable analytics with zero new infrastructure. Fix Cloudflare Web Analytics (currently broken on the app), add a Postgres event log to the existing Fly Postgres, and migrate the admin panel off the slow R2-download-per-profile pattern.

**Supersedes:** The OpenPanel analytics epic (T1700-T1703) is deferred. That epic requires a VPS with 7 Docker services, 41 events, session replay, and a nightly intelligence engine -- premature for <1000 users. Analytics 1 delivers 80% of the value with 5% of the effort using infrastructure we already have.

## Why

1. **CF Web Analytics is broken on the app.** `VITE_CF_ANALYTICS_TOKEN` is unset in production -- zero data from the app. Landing page beacon exists but hasn't been verified.
2. **No event history.** Admin panel computes stats on the fly from profile SQLite files downloaded from R2. No time dimension, no trends, no "exports this week vs last week."
3. **Admin panel is slow.** Each page load downloads N profile SQLite files from R2 (~seconds per page). A Postgres query takes milliseconds.
4. **We can't answer basic questions.** How many exports happened this week? Who's our most active user? Is usage growing or shrinking?

## Design Decisions

1. **Cloudflare Web Analytics for traffic.** Free, no cookies, no privacy policy changes. Gives us page views, visitors, referrers, devices, countries. Already partially deployed -- just needs the token set.
2. **Milestone table, not event log.** One row per user in `user_milestones` with fixed columns: first-occurrence timestamps + lifetime counts + cohort dimensions. Grows by one row per signup, not per event. An append-only `analytics_events` table would grow unboundedly with usage and slow down queries -- milestones give the same funnel/cohort/journey answers with O(users) rows instead of O(events).
3. **Acquisition origin as first-class dimension.** Each user gets `origin_type` (organic/viral/ad_campaign) and `origin_channel` (invite_link/reel_share/game_share) set at signup, derived from the existing referrals table. Enables cohort analysis by acquisition channel without JOINs.
4. **Backend-only event recording.** All tracked events fire from backend handlers that already run on user gestures. No frontend tracking code, no new JS dependencies. Follows the app's gesture-based persistence principle.
5. **Admin panel reads from milestones.** Replace R2 profile downloads with Postgres queries against `user_milestones`. Same per-user resolution, millisecond response times, plus cohort/funnel analysis for free.
6. **Quest progress stays on profile DBs.** Quest step checking is complex (20+ SQL checks per profile) and not the admin panel bottleneck. Keep it as-is.
7. **Credit balance stays in user.sqlite.** The credit ledger is the source of truth for balances. Milestones track purchase/consumption counts for analytics, not as the ledger.

## Shared Context

### Schema

```sql
CREATE TABLE user_milestones (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),

    -- Cohort dimensions (set at signup, immutable)
    install_day DATE NOT NULL DEFAULT CURRENT_DATE,
    origin_type TEXT NOT NULL DEFAULT 'organic'
        CHECK (origin_type IN ('organic', 'viral', 'ad_campaign')),
    origin_channel TEXT,    -- viral: invite_link | reel_share | game_share
                            -- ad_campaign: campaign identifier (future)
                            -- organic: NULL
    signup_method TEXT CHECK (signup_method IN ('google', 'otp')),

    -- Journey milestones (NULL = not reached yet)
    signup_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_game_created_at TIMESTAMPTZ,
    first_clip_created_at TIMESTAMPTZ,
    first_export_completed_at TIMESTAMPTZ,
    first_share_completed_at TIMESTAMPTZ,
    first_credit_purchase_at TIMESTAMPTZ,

    -- Lifetime counts
    game_created_count INTEGER NOT NULL DEFAULT 0,
    clip_created_count INTEGER NOT NULL DEFAULT 0,
    export_completed_count INTEGER NOT NULL DEFAULT 0,
    export_failed_count INTEGER NOT NULL DEFAULT 0,
    share_completed_count INTEGER NOT NULL DEFAULT 0,
    credit_purchase_count INTEGER NOT NULL DEFAULT 0,
    credits_consumed_count INTEGER NOT NULL DEFAULT 0,

    -- Activity
    session_count INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_export_at TIMESTAMPTZ
);

CREATE INDEX idx_milestones_install_day ON user_milestones(install_day);
CREATE INDEX idx_milestones_origin ON user_milestones(origin_type);
CREATE INDEX idx_milestones_cohort ON user_milestones(install_day, origin_type);
```

### Events Tracked (Backend Only)

| Event | Handler | Milestone Column | Count Column |
|-------|---------|-----------------|-------------|
| `signup_completed` | Auth route | `signup_completed_at` (row creation) | -- |
| `game_created` | Games upload handler | `first_game_created_at` | `game_created_count` |
| `clip_created` | Clips handler | `first_clip_created_at` | `clip_created_count` |
| `export_completed` | Export completion handler | `first_export_completed_at` | `export_completed_count` |
| `export_failed` | Export failure handler | -- | `export_failed_count` |
| `credit_purchased` | Stripe webhook | `first_credit_purchase_at` | `credit_purchase_count` |
| `credits_consumed` | Credit deduction handler | -- | `credits_consumed_count` |
| `clip_shared` | Share handler | `first_share_completed_at` | `share_completed_count` |

### Files Affected Across Tasks

- `src/backend/app/services/pg.py` -- Add user_milestones to _SCHEMA_DDL
- `src/backend/app/migrations/postgres/` -- v005: user_milestones table + backfill
- `src/backend/app/analytics.py` -- NEW: record_milestone() + create_user_milestones()
- `src/backend/app/routers/auth.py` -- Create milestones row on signup with origin_type
- `src/backend/app/routers/games_upload.py` -- record_milestone game_created
- `src/backend/app/routers/clips.py` -- record_milestone clip_created
- `src/backend/app/routers/exports.py` -- record_milestone export_completed/export_failed
- `src/backend/app/routers/payments.py` -- record_milestone credit_purchased
- `src/backend/app/routers/credits.py` -- record_milestone credits_consumed
- `src/backend/app/routers/sharing.py` -- record_milestone share_completed
- `src/backend/app/routers/admin.py` -- Replace R2 download pattern with milestones queries
- `src/frontend/src/components/admin/UserTable.jsx` -- Minor: consume new response shape

## Tasks

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T3000 | [Fix Cloudflare Web Analytics](T3000-fix-cloudflare-web-analytics.md) | TODO | Set token in CF Pages env, verify beacon on app + landing page |
| T3010 | [User Milestones + Acquisition Tracking](T3010-postgres-event-log.md) | TODO | Create user_milestones table, record_milestone() helper, origin tracking, instrument 8 backend handlers |
| T3020 | [Admin Panel Migration to Milestones](T3020-admin-panel-event-migration.md) | TODO | Replace ALL R2 SQLite access with milestones JOIN. Delete R2 download code, quest badges, GPU drilldown, summary cards (~300 lines removed) |
| T3030 | [Analytics Dashboards](T3030-analytics-dashboards.md) | TODO | Activation funnel, cohort grid, acquisition channels, user journey, daily pulse -- all from milestones + daily_counters |

## Task Order Rationale

1. **T3000** first: pure config change, zero code risk, immediate value (traffic visibility within 24h)
2. **T3010** second: creates the milestones table, backfills existing users with origin tracking, and starts recording milestones from handlers. Must exist before admin panel can read from it.
3. **T3020** third: depends on T3010's milestones table being populated. Migrates admin panel to read from milestones instead of R2.
4. **T3030** fourth: depends on T3020 (admin panel already reading from milestones). Adds aggregate dashboard views: funnel, cohorts, channels, journey, daily pulse.

## Completion Criteria

- [ ] CF Web Analytics dashboard shows page views for both landing page and app
- [ ] user_milestones table exists in Fly Postgres with cohort indexes
- [ ] All existing users backfilled with correct origin_type (organic/viral) and install_day
- [ ] 8 business events update milestones (first_X timestamps + counts)
- [ ] Viral vs organic acquisition tracked and queryable by cohort
- [ ] Admin panel activity counts come from milestones table
- [ ] Admin panel page load < 500ms (down from multi-second R2 downloads)
- [ ] Activation funnel, cohort grid, acquisition channels, user journey, and daily pulse dashboards live
- [ ] daily_counters table provides real-time volume trends
- [ ] Old OpenPanel epic (T1700-T1703) marked as deferred in PLAN.md
