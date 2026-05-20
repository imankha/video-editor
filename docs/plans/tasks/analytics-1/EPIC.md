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
2. **Postgres event log for business events.** Single table in existing Fly Postgres. Logged from backend handlers that already exist (signup, export, upload, purchase, share). No new SDKs, no frontend instrumentation.
3. **Backend-only event logging.** All tracked events fire from backend handlers that already run on user gestures. No frontend tracking code, no new JS dependencies. Follows the app's gesture-based persistence principle.
4. **Admin panel reads from event log.** Replace R2 profile downloads with Postgres aggregation queries. Same per-user/per-profile resolution, dramatically faster.
5. **Quest progress stays on profile DBs.** Quest step checking is complex (20+ SQL checks per profile) and not the admin panel bottleneck. Keep it as-is.
6. **Credit balance stays in user.sqlite.** The credit ledger is the source of truth for balances. Event log tracks purchases and consumption for analytics, not as the ledger.

## Shared Context

### Schema

```sql
CREATE TABLE analytics_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    profile_id TEXT,
    event TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_analytics_events_event_created ON analytics_events(event, created_at);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id, created_at);
CREATE INDEX idx_analytics_events_profile ON analytics_events(profile_id, created_at);
```

### Events Tracked (Backend Only)

| Event | Handler | Metadata |
|-------|---------|----------|
| `signup_completed` | Auth route | `{method: "google"\|"otp"}` |
| `game_created` | Games upload handler | `{game_id, video_count}` |
| `clip_created` | Clips handler | `{clip_id, rating}` |
| `export_completed` | Export completion handler | `{type: "framing"\|"overlay", gpu_seconds, project_id}` |
| `export_failed` | Export failure handler | `{type, error}` |
| `credit_purchased` | Stripe webhook | `{amount_credits, amount_cents, pack}` |
| `credits_consumed` | Credit deduction handler | `{amount, reason}` |
| `clip_shared` | Share handler | `{share_type: "reel"\|"game"\|"annotation"}` |

### Files Affected Across Tasks

- `src/backend/app/services/pg.py` -- Add analytics_events to _SCHEMA_DDL
- `src/backend/app/migrations/postgres/` -- Versioned migration for analytics_events
- `src/backend/app/analytics.py` -- NEW: log_event() helper
- `src/backend/app/routers/auth.py` -- Log signup_completed
- `src/backend/app/routers/games_upload.py` -- Log game_created
- `src/backend/app/routers/clips.py` -- Log clip_created
- `src/backend/app/routers/exports.py` -- Log export_completed/export_failed
- `src/backend/app/routers/credits.py` -- Log credit_purchased, credits_consumed
- `src/backend/app/routers/sharing.py` -- Log clip_shared
- `src/backend/app/routers/admin.py` -- Replace R2 download pattern with Postgres queries
- `src/frontend/src/components/admin/UserTable.jsx` -- Minor: consume new response shape

## Tasks

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T3000 | [Fix Cloudflare Web Analytics](T3000-fix-cloudflare-web-analytics.md) | TODO | Set token in CF Pages env, verify beacon on app + landing page |
| T3010 | [Postgres Event Log + Instrumentation](T3010-postgres-event-log.md) | TODO | Create analytics_events table, log_event() helper, instrument 8 backend handlers |
| T3020 | [Admin Panel Event Migration](T3020-admin-panel-event-migration.md) | TODO | Replace R2 profile downloads with Postgres event queries, backfill historical data |

## Task Order Rationale

1. **T3000** first: pure config change, zero code risk, immediate value (traffic visibility within 24h)
2. **T3010** second: creates the event log and starts populating it. Must exist before admin panel can read from it.
3. **T3020** third: depends on T3010's event log being populated. Includes backfill to cover historical data.

## Completion Criteria

- [ ] CF Web Analytics dashboard shows page views for both landing page and app
- [ ] analytics_events table exists in Fly Postgres with proper indexes
- [ ] 8 business events logged from backend handlers
- [ ] Admin panel activity counts (games, clips, framed, completed, GPU) come from Postgres
- [ ] Admin panel page load < 500ms (down from multi-second R2 downloads)
- [ ] Historical data backfilled so admin panel shows pre-migration activity
- [ ] Old OpenPanel epic (T1700-T1703) marked as deferred in PLAN.md
