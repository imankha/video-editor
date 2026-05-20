# T3010: Postgres Event Log + Backend Instrumentation

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-20

## Problem

We have no event history. The app knows what happened (exports, signups, purchases) but doesn't record it anywhere queryable. The admin panel computes stats on the fly from profile SQLite files downloaded from R2 -- no time dimension, no trends, no ability to ask "how many exports happened this week?"

## Solution

Add an `analytics_events` table to existing Fly Postgres and log business events from the backend handlers that already fire on user gestures. No new SDKs, no frontend code, no new infrastructure.

## Context

### Relevant Files
- `src/backend/app/services/pg.py` -- Postgres schema DDL (_SCHEMA_DDL), connection pool
- `src/backend/app/migrations/postgres/` -- Versioned migration directory
- `src/backend/app/analytics.py` -- NEW: log_event() helper
- `src/backend/app/routers/auth.py` -- signup_completed event
- `src/backend/app/routers/games_upload.py` -- game_created event
- `src/backend/app/routers/clips.py` -- clip_created event
- `src/backend/app/routers/exports.py` -- export_completed, export_failed events
- `src/backend/app/routers/credits.py` -- credit_purchased, credits_consumed events
- `src/backend/app/routers/sharing.py` -- clip_shared event

### Related Tasks
- Blocks: T3020 (Admin Panel Event Migration)
- See [EPIC.md](EPIC.md) for schema and event catalog

### Technical Notes

**Schema:**
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

**log_event() helper:**
- Async function: `async def log_event(user_id, event, metadata=None, profile_id=None)`
- Fire-and-forget: caller does not await or check result. Use `asyncio.create_task()` in handlers so event logging never blocks the response.
- Failure-tolerant: catch and log exceptions, never raise. Analytics must not break user flows.
- Uses existing `get_pg()` connection pool.

**Events to instrument (8 total):**

| Event | Where to Add | Metadata |
|-------|-------------|----------|
| `signup_completed` | Auth route, after user creation | `{method: "google"\|"otp"}` |
| `game_created` | Games upload handler, after game row created | `{game_id, video_count}` |
| `clip_created` | Clips create endpoint, after clip saved | `{clip_id, rating}` |
| `export_completed` | Export completion callback | `{type: "framing"\|"overlay", gpu_seconds, project_id}` |
| `export_failed` | Export failure callback | `{type, error}` |
| `credit_purchased` | Stripe webhook, after credits granted | `{amount_credits, amount_cents, pack}` |
| `credits_consumed` | Credit deduction, after successful deduction | `{amount, reason}` |
| `clip_shared` | Share creation handler | `{share_type: "reel"\|"game"\|"annotation"}` |

**Gesture-based only:** Every event traces back to a specific user action (upload, export, purchase, share). No reactive logging from state changes or background jobs.

## Implementation

### Steps
1. [ ] Create versioned Postgres migration: `src/backend/app/migrations/postgres/v004_analytics_events.py`
2. [ ] Update `_SCHEMA_DDL` in `pg.py` with CREATE TABLE IF NOT EXISTS for fresh deployments
3. [ ] Create `src/backend/app/analytics.py` with `log_event()` helper
4. [ ] Instrument auth route: log `signup_completed` after user creation
5. [ ] Instrument games upload: log `game_created` after game row inserted
6. [ ] Instrument clips endpoint: log `clip_created` after clip saved
7. [ ] Instrument export handlers: log `export_completed` and `export_failed`
8. [ ] Instrument Stripe webhook: log `credit_purchased` after credits granted
9. [ ] Instrument credit deduction: log `credits_consumed`
10. [ ] Instrument share handler: log `clip_shared`
11. [ ] Write backend tests: verify each event is logged with correct metadata
12. [ ] Deploy to staging, trigger test user flow, verify events in Postgres via `fly pg connect`

## Acceptance Criteria

- [ ] `analytics_events` table exists in Fly Postgres with 3 indexes
- [ ] `log_event()` is fire-and-forget (never blocks response, never raises)
- [ ] All 8 events logged with correct user_id, profile_id, and metadata
- [ ] Backend tests cover each event type
- [ ] Event logging verified on staging via SQL query after a test user flow
- [ ] No regressions: existing handler behavior unchanged (event logging is additive)
