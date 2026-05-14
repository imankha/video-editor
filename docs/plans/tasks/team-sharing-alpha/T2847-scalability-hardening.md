# T2847: Scalability Hardening

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-13
**Updated:** 2026-05-13

## Problem

The T2845 scalability audit identified five issues in the Team Sharing Alpha infrastructure that should be fixed before real users arrive. One is a P0 bug (single-profile materialization crashes), one is a schema design that won't scale past ~1000 clips per profile, and three are schema hygiene items that are cheap to fix now but painful to retrofit later.

## Solution

Five changes, ordered by priority:

1. **Fix `sharer_email` NameError** -- P0 bug that crashes 70% of materialization attempts
2. **Share table retention policy** -- prevent unbounded growth of shares/pending_teammate_shares
3. **Add `clip_teammates` junction table** -- replace O(all_clips) JSON scanning with indexed lookups
4. **Add UNIQUE constraint on pending_teammate_shares** -- prevent duplicate pendings on retry
5. **Add composite indexes** -- optimize the two hottest query patterns for scale

## Context

### Source: T2845 Scalability Audit

All five items come from the [T2845 audit](T2845-scalability-audit.md). See the audit's Progress Log for full analysis, row growth projections, and rationale.

### Relevant Files

- `src/backend/app/routers/clips.py` -- Fix `sharer_email` bug in `_materialize_or_pend()` (line 2212), update `GET /teammate-tags` (line 1970) to use junction table
- `src/backend/app/services/materialization.py` -- Update `_filter_clips_for_tag()` (line 152) to use junction table
- `src/backend/app/services/sharing_db.py` -- Add retention/cleanup functions
- `src/backend/app/services/pg.py` -- Add Postgres indexes, UNIQUE constraint, retention DDL
- `src/backend/app/database.py` -- Add `clip_teammates` table DDL + migration

### Related Tasks

- Depends on: T2845 (audit findings)
- Blocks: T2850 (Share Game), T2860 (My Athlete Filter)
- Related: T2870 (SQLite JSON to MsgPack) -- `clip_teammates` table reduces reliance on the JSON column that T2870 migrated to msgpack

### Technical Notes

- All Postgres schema changes use the existing `_INIT_SQL` pattern in `pg.py` (idempotent `CREATE INDEX IF NOT EXISTS`, etc.)
- SQLite changes use the existing migration pattern in `database.py` (PRAGMA table_info checks)
- The `clip_teammates` junction table lives in per-user SQLite (not Postgres) since it mirrors per-user clip data
- Retention cleanup should be a backend utility function callable from admin panel or cron, not an automatic background job

## Implementation

### Step 1: Fix `sharer_email` NameError (P0 Bug)

**Problem**: `_materialize_or_pend()` (clips.py:2212) is a module-level function that references `sharer_email` at line 2264, but `sharer_email` is a local variable in `share_with_teammates()` (line 2100). Python raises `NameError` at runtime because `_materialize_or_pend` is not nested inside `share_with_teammates` -- it has no access to that scope.

**Impact**: Crashes the single-profile immediate materialization path, which is 70% of recipients (existing users with one profile). The non-user (pending) and multi-profile (pending) paths work because they don't reference `sharer_email`.

**Fix**:
1. Add `sharer_email: str | None = None` parameter to `_materialize_or_pend()`
2. Pass `sharer_email=sharer_email` from the caller in `share_with_teammates()` at line 2184

**Files**: `src/backend/app/routers/clips.py`

### Step 2: Share Table Retention Policy

**Problem**: `shares`, `share_games`, `share_videos`, and `pending_teammate_shares` grow monotonically. At 1M users, projections show ~400M shares rows and ~36M unresolved pending rows (each carrying 1-5KB JSONB clip_data). The pending table is the biggest concern -- unresolved rows from non-users who never sign up accumulate indefinitely.

**What to build**:

A. **Resolved pending share cleanup**: Delete `pending_teammate_shares` rows where `resolved_at IS NOT NULL` and `resolved_at < now() - interval '90 days'`. These have already been materialized -- the pending record served its purpose.

B. **Stale pending share expiry**: Mark `pending_teammate_shares` as expired where `created_at < now() - interval '180 days'` and `resolved_at IS NULL`. These are non-users who never signed up. Set `resolved_at = now()` with `resolved_profile_id = 'expired'` to distinguish from real resolutions.

C. **Share record retention**: Add a `cleanup_old_shares()` function that deletes shares (and cascades to share_videos/share_games) where:
   - `share_type = 'game'` AND the share_games row has `materialized_at IS NOT NULL` AND `shared_at < now() - interval '1 year'`
   - `share_type = 'video'` AND `shared_at < now() - interval '1 year'`
   - These are fully-consumed shares with no active purpose. The materialized data in the recipient's SQLite persists independently.

D. **Admin endpoint or management command**: Expose cleanup as a callable function (not automatic). Can be triggered from admin panel or a future cron job.

**Files**: `src/backend/app/services/sharing_db.py` (new cleanup functions), optionally `src/backend/app/routers/admin.py` (admin endpoint)

### Step 3: Add `clip_teammates` Junction Table

**Problem**: Two query patterns scan ALL clips and decode msgpack JSON for each row:

- `GET /teammate-tags` (clips.py:1970): Loads every clip in the profile where `tagged_teammates IS NOT NULL`, decodes msgpack for each, counts tag frequencies in Python. O(all_clips_in_profile). At 600 clips ~5-10ms, at 2000+ clips ~50ms+.
- `_filter_clips_for_tag()` (materialization.py:152): Loads all clips for a game, decodes msgpack, filters by tag. O(clips_in_game). Typically 15-50 clips, fast, but still doing unnecessary work.

**What to build**:

A. **New SQLite table** (per-user, in `database.py`):
```sql
CREATE TABLE IF NOT EXISTS clip_teammates (
    clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
    tag_name TEXT NOT NULL,
    UNIQUE(clip_id, tag_name)
);
CREATE INDEX IF NOT EXISTS idx_clip_teammates_tag ON clip_teammates(tag_name);
```

B. **Migration** (in `database.py` migrations section): Backfill from existing `raw_clips.tagged_teammates`:
```python
# Check if clip_teammates table exists and is populated
cursor.execute("SELECT COUNT(*) as cnt FROM clip_teammates")
if cursor.fetchone()["cnt"] == 0:
    cursor.execute("SELECT id, tagged_teammates FROM raw_clips WHERE tagged_teammates IS NOT NULL")
    for row in cursor.fetchall():
        teammates = decode_data(row["tagged_teammates"])
        if teammates:
            for tag in teammates:
                cursor.execute("INSERT OR IGNORE INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)", (row["id"], tag))
```

C. **Update write paths**: Wherever `tagged_teammates` is written on `raw_clips`, also INSERT/DELETE from `clip_teammates`. Audit these callers:
- Annotation save endpoint (clip creation/update with tags)
- Any bulk import or materialization that sets `tagged_teammates`
- The `tagged_teammates` column stays as the source of truth for the full list per clip; `clip_teammates` is a denormalized index

D. **Update read paths**:
- `GET /teammate-tags`: Replace full-scan + decode with `SELECT tag_name, COUNT(*) FROM clip_teammates GROUP BY tag_name ORDER BY COUNT(*) DESC`
- `_filter_clips_for_tag()`: Replace full-scan + decode with `SELECT rc.* FROM raw_clips rc JOIN clip_teammates ct ON ct.clip_id = rc.id WHERE rc.game_id = ? AND ct.tag_name = ?`

**Files**: `src/backend/app/database.py` (table + migration), `src/backend/app/routers/clips.py` (read + write paths), `src/backend/app/services/materialization.py` (`_filter_clips_for_tag`)

### Step 4: Add UNIQUE Constraint on pending_teammate_shares

**Problem**: If `_materialize_or_pend()` is called twice for the same share (e.g., retry after partial failure), it creates duplicate pending records. No constraint prevents this.

**Fix**: Add to `pg.py` `_INIT_SQL`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_shares_unique
ON pending_teammate_shares(share_id, game_id, tag_name)
WHERE resolved_at IS NULL;
```

Using a partial unique index (`WHERE resolved_at IS NULL`) so resolved records don't block new shares for the same game/tag combination.

**Files**: `src/backend/app/services/pg.py`

### Step 5: Add Composite Indexes

**Problem**: Two query patterns will benefit from composite indexes as the tables grow:

A. `get_pending_shares_for_email()` filters `WHERE recipient_email = ? AND resolved_at IS NULL`. Current index is on `recipient_email` alone -- adding `resolved_at` makes it a covering filter.

B. `list_contacts_for_user()` filters `WHERE sharer_user_id = ? AND revoked_at IS NULL` then `GROUP BY recipient_email`. Current index is on `sharer_user_id` alone.

**Fix**: Add to `pg.py` `_INIT_SQL`:
```sql
CREATE INDEX IF NOT EXISTS idx_pending_shares_email_unresolved
ON pending_teammate_shares(recipient_email) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shares_sharer_active
ON shares(sharer_user_id) WHERE revoked_at IS NULL;
```

These are partial indexes (smaller than full indexes, faster to scan) that exactly match the query patterns.

**Note**: The existing `idx_pending_shares_email` and `idx_shares_sharer` can be kept for other queries or dropped if no other code uses the unfiltered index. Recommend keeping both since the partial indexes only help filtered queries.

**Files**: `src/backend/app/services/pg.py`

### Steps Summary

1. [ ] Fix `sharer_email` NameError in `_materialize_or_pend()`
2. [ ] Add share table retention/cleanup functions
3. [ ] Add `clip_teammates` junction table + migration + update read/write paths
4. [ ] Add UNIQUE partial index on pending_teammate_shares
5. [ ] Add composite partial indexes on pending_teammate_shares and shares

### Progress Log

## Acceptance Criteria

- [ ] `_materialize_or_pend()` accepts and passes `sharer_email` parameter -- single-profile materialization works
- [ ] Retention cleanup functions exist and can be called to clean resolved pendings (>90d) and expired pendings (>180d)
- [ ] `clip_teammates` table created with migration backfill from existing `tagged_teammates` data
- [ ] `GET /teammate-tags` uses `clip_teammates` table instead of scanning all clips
- [ ] `_filter_clips_for_tag()` uses `clip_teammates` JOIN instead of loading + decoding all clips
- [ ] Write paths (annotation save) keep `clip_teammates` in sync with `tagged_teammates`
- [ ] Partial UNIQUE index prevents duplicate unresolved pending shares
- [ ] Composite partial indexes added for pending email lookup and active contacts query
- [ ] Backend import check passes: `python -c "from app.main import app"`
- [ ] Existing backend tests pass
