# T3010: User Milestones + Acquisition Tracking

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-20
**Updated:** 2026-05-20
**Epic:** [Analytics 1](EPIC.md)

## Problem

We have no event history. The app knows what happened (exports, signups, purchases) but doesn't record it anywhere queryable. The admin panel computes stats on the fly from profile SQLite files downloaded from R2 -- no time dimension, no trends, no ability to ask "how many exports happened this week?"

An append-only event log (`INSERT INTO analytics_events` on every gesture) would grow unboundedly -- every export, clip, share appends a row. With even modest usage, the table balloons and queries slow down. We need analytics that scales with user count, not event count.

## Solution

One row per user in a `user_milestones` table. Fixed-width columns: a timestamp for when they first did each action (NULL = not yet), a count for how many times they've done it, and cohort dimensions (install day, origin type) for grouping. The table grows by one row per signup, never by event volume.

This answers the core questions:
- **Journey**: sort non-null timestamps for one user to see their activation order
- **Funnel**: `COUNT(first_X_at IS NOT NULL)` grouped by cohort to see drop-off
- **Cohort**: filter by `install_day` + `origin_type` to compare viral vs organic
- **Trends**: counts give lifetime totals; `last_export_at` + `last_active_at` give recency

### What This Doesn't Cover

- **Per-profile breakdowns**: milestones are per-user, not per-profile. Profile-level activity is still queryable from profile SQLite for the rare admin drilldown.
- **Time-series of repeated events**: "exports per week" requires a separate time-bucketed table or nightly snapshot. Not in scope for T3010 -- add in T3020 if needed.
- **Detailed error data**: error count is tracked as a health signal. Error details (message, stack, component) stay in server logs where they belong.

## Schema

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

**Size**: one row per user, ~20 columns, ~200 bytes/row. 100K users = ~20 MB. No growth per event.

## Origin Type Tracking

The app already tracks referrals via the `referrals` table (see `v004_referral_graph.py`), but origin type isn't a first-class queryable field. This task makes it one.

### Current Referral Flow (Already Built)

```
User clicks invite link → ?ref=abc12345
  → Frontend sends ref in signup request body
  → _find_or_create_user(email, ref=body.ref)
    → resolve_invite_code(ref) → referrer_user_id
    → record_referral(referrer, new_user, "invite_link", ref)
  Fallback: attribute_from_existing_shares(user_id, email)
    → Finds earliest share for this email → records referral
```

Three viral channels already tracked: `invite_link`, `reel_share`, `game_share`, `annotation_share`.

### What T3010 Adds

Derive `origin_type` at signup and store it on the milestones row:

```python
# In _find_or_create_user, after referral attribution:
referral = get_referral_for_user(user_id)  # SELECT FROM referrals WHERE referred_id = %s
if referral:
    origin_type = 'viral'
    origin_channel = referral['channel']
else:
    origin_type = 'organic'
    origin_channel = None
```

**Ad campaign tracking** (future, not in this task): when UTM params indicate a paid campaign, set `origin_type = 'ad_campaign'` and `origin_channel` to the campaign identifier. The CHECK constraint already allows this value. Frontend would need to capture UTM params from the URL and send them in the signup request.

## Implementation

### record_milestone() Helper

**File:** `src/backend/app/analytics.py` (NEW)

```python
MILESTONE_EVENTS = {
    "game_created":     ("first_game_created_at",     "game_created_count"),
    "clip_created":     ("first_clip_created_at",     "clip_created_count"),
    "export_completed": ("first_export_completed_at", "export_completed_count"),
    "export_failed":    (None,                        "export_failed_count"),
    "share_completed":  ("first_share_completed_at",  "share_completed_count"),
    "credit_purchased": ("first_credit_purchase_at",  "credit_purchase_count"),
    "credits_consumed": (None,                        "credits_consumed_count"),
}

def record_milestone(user_id: str, event: str):
    """Atomic: set first_X_at if NULL, increment X_count. Fire-and-forget."""
```

- Column names come from the hardcoded dict (no injection risk from f-string SQL)
- Catches all exceptions, logs them, never raises -- analytics must not break user flows
- Single UPDATE statement per call (atomic, no read-then-write race)
- For `export_completed`: also sets `last_export_at = now()`
- All events set `last_active_at = now()`
- Uses existing `get_pg()` connection pool

### Modify _find_or_create_user

**File:** `src/backend/app/routers/auth.py`

Change return to `(user_id, is_new)`. After referral attribution, query the referrals table to determine origin. Return origin info to caller.

The caller (`google_auth()` / `verify_otp()`) creates the milestones row when `is_new=True`:

```python
user_id, is_new = _find_or_create_user(email, ref=body.ref)
if is_new:
    origin_type, origin_channel = _get_origin_for_user(user_id)
    create_user_milestones(user_id, origin_type, origin_channel, method="google")
```

### Instrumentation Points (8 events)

| Event | File | Where to Add |
|-------|------|-------------|
| `signup_completed` | `auth.py` | `google_auth()` and `verify_otp()` -- INSERT milestones row when `is_new=True` |
| `game_created` | `games_upload.py` | After game row inserted |
| `clip_created` | `clips.py` | After clip saved |
| `export_completed` | `exports.py` | Export completion callback |
| `export_failed` | `exports.py` | Export failure callback |
| `credit_purchased` | `payments.py` | Stripe webhook, after `grant_credits()` |
| `credits_consumed` | `credits.py` | After successful credit deduction |
| `clip_shared` | `sharing.py` | After share created |

Each call is one line: `record_milestone(user_id, "event_name")`. Same handlers as the original design, same gesture-based principle.

### Session Counting

Increment `session_count` when the gap between `last_active_at` and current time exceeds 30 minutes. This can be checked in the auth middleware or `/api/me` endpoint (called on app startup). Update `last_active_at` on authenticated requests (already happens for `users.last_seen_at` -- piggyback on that).

### Backfill Migration for Existing Users

**File:** `src/backend/app/migrations/postgres/v005_user_milestones.py`

1. CREATE TABLE `user_milestones`
2. Backfill from existing Postgres data:

```sql
INSERT INTO user_milestones (user_id, install_day, origin_type, origin_channel, signup_method, signup_completed_at, last_active_at)
SELECT
    u.user_id,
    u.created_at::date,
    CASE WHEN r.id IS NOT NULL THEN 'viral' ELSE 'organic' END,
    r.channel,
    CASE WHEN u.google_id IS NOT NULL THEN 'google' ELSE 'otp' END,
    u.created_at,
    COALESCE(u.last_seen_at, u.created_at)
FROM users u
LEFT JOIN referrals r ON u.user_id = r.referred_id;
```

This correctly sets install_day, origin_type, origin_channel, and signup_method for all existing users. Journey milestones and counts start at NULL/0 -- we don't have historical event timestamps in Postgres. Going forward, all new events update milestones in real time.

Also update `_SCHEMA_DDL` in `pg.py` with `CREATE TABLE IF NOT EXISTS` for fresh deployments.

### Share-derived milestones for existing users

The backfill can also set `first_share_completed_at` and `share_completed_count` from the Postgres `shares` table:

```sql
UPDATE user_milestones m SET
    first_share_completed_at = s.first_share,
    share_completed_count = s.share_count
FROM (
    SELECT sharer_user_id, MIN(shared_at) as first_share, COUNT(*) as share_count
    FROM shares WHERE revoked_at IS NULL
    GROUP BY sharer_user_id
) s
WHERE m.user_id = s.sharer_user_id;
```

Other milestones (games, clips, exports) live in per-user SQLite and can't be backfilled from Postgres. If historical counts are needed for the admin panel, T3020 can run a one-time R2 download backfill.

## Query Examples

These demonstrate that the fixed-width model supports all the analysis patterns:

**Activation funnel (this week, by origin):**
```sql
SELECT origin_type,
    COUNT(*) as signups,
    COUNT(first_game_created_at) as uploaded,
    COUNT(first_clip_created_at) as clipped,
    COUNT(first_export_completed_at) as exported,
    COUNT(first_share_completed_at) as shared
FROM user_milestones
WHERE install_day >= CURRENT_DATE - 7
GROUP BY origin_type;
```

**Cohort retention (week-1 export rate by install week):**
```sql
SELECT
    date_trunc('week', install_day) as cohort_week,
    origin_type,
    COUNT(*) as signups,
    COUNT(first_export_completed_at) FILTER (
        WHERE first_export_completed_at < install_day + 7
    ) as exported_week_1
FROM user_milestones
GROUP BY cohort_week, origin_type
ORDER BY cohort_week DESC;
```

**User journey (single user):**
```sql
SELECT * FROM user_milestones WHERE user_id = %s;
-- Client-side: sort non-null milestone timestamps to show journey order
```

**Drop-off (uploaded but never clipped):**
```sql
SELECT COUNT(*) FROM user_milestones
WHERE first_game_created_at IS NOT NULL
  AND first_clip_created_at IS NULL;
```

**Daily signups by origin (dashboard):**
```sql
SELECT install_day, origin_type, COUNT(*) as signups
FROM user_milestones
GROUP BY install_day, origin_type
ORDER BY install_day DESC;
```

**Viral vs organic lifetime value comparison:**
```sql
SELECT origin_type,
    COUNT(*) as users,
    AVG(export_completed_count) as avg_exports,
    AVG(credit_purchase_count) as avg_purchases,
    ROUND(100.0 * COUNT(first_credit_purchase_at) / COUNT(*), 1) as purchase_pct
FROM user_milestones
GROUP BY origin_type;
```

## Context

### Relevant Files
- `src/backend/app/services/pg.py` -- Postgres schema DDL (_SCHEMA_DDL), connection pool
- `src/backend/app/migrations/postgres/` -- Versioned migration directory (latest: v004)
- `src/backend/app/analytics.py` -- NEW: record_milestone() helper
- `src/backend/app/routers/auth.py` -- Signup: create milestones row, origin tracking
- `src/backend/app/routers/games_upload.py` -- game_created milestone
- `src/backend/app/routers/clips.py` -- clip_created milestone
- `src/backend/app/routers/exports.py` -- export_completed, export_failed milestones
- `src/backend/app/routers/payments.py` -- credit_purchased milestone (Stripe webhook)
- `src/backend/app/routers/credits.py` -- credits_consumed milestone
- `src/backend/app/routers/sharing.py` -- share_completed milestone
- `src/backend/app/services/sharing_db.py` -- Referral attribution (record_referral, resolve_invite_code)

### Related Tasks
- Blocks: T3020 (Admin Panel Migration -- reads from user_milestones instead of R2)
- See [EPIC.md](EPIC.md) for schema and design decisions

## Steps

1. [ ] Create `src/backend/app/analytics.py` with `record_milestone()` and `create_user_milestones()`
2. [ ] Create migration `src/backend/app/migrations/postgres/v005_user_milestones.py` (CREATE TABLE + backfill from users/referrals/shares)
3. [ ] Update `_SCHEMA_DDL` in `pg.py` with CREATE TABLE IF NOT EXISTS for fresh deployments
4. [ ] Modify `_find_or_create_user()` to return `(user_id, is_new)` and add `_get_origin_for_user()` helper
5. [ ] Instrument `google_auth()` and `verify_otp()`: create milestones row on new signup with origin_type
6. [ ] Instrument games upload: `record_milestone(user_id, "game_created")`
7. [ ] Instrument clips endpoint: `record_milestone(user_id, "clip_created")`
8. [ ] Instrument export handlers: `record_milestone(user_id, "export_completed")` / `"export_failed"`
9. [ ] Instrument Stripe webhook: `record_milestone(user_id, "credit_purchased")`
10. [ ] Instrument credit deduction: `record_milestone(user_id, "credits_consumed")`
11. [ ] Instrument share handler: `record_milestone(user_id, "share_completed")`
12. [ ] Add session counting logic (increment when gap > 30 min)
13. [ ] Write backend tests: verify milestones row created on signup with correct origin, verify record_milestone updates first_X and count
14. [ ] Deploy to staging, run test user flow, verify milestones via `fly pg connect`

## Acceptance Criteria

- [ ] `user_milestones` table exists in Fly Postgres with 3 indexes
- [ ] Existing users backfilled with correct install_day, origin_type, origin_channel, signup_method
- [ ] New signups create milestones row with correct origin_type (viral if referral exists, organic otherwise)
- [ ] `record_milestone()` is fire-and-forget (never blocks response, never raises)
- [ ] All 8 events update milestones with correct first_X_at timestamp and count increment
- [ ] Backend tests cover signup (both origins), each event type, and backfill idempotency
- [ ] Milestone updates verified on staging via SQL query after a test user flow
- [ ] No regressions: existing handler behavior unchanged (milestone recording is additive)
