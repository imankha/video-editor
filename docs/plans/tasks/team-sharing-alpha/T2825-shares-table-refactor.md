# T2825: Shares Table Refactor (Base + Extensions)

**Status:** TESTING
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** None (infrastructure refactor, no dependency on T2800-T2820)
**Blocks:** T2830 (Game + Annotation Materialization), T2850 (Share Game)

## Problem

The current `shared_videos` table in Fly Postgres was designed for sharing exported reels (My Reels). The Team Sharing Alpha epic introduces a second share type — sharing games + filtered annotations with tagged teammates. These two share types have different column needs:

- **Reel shares**: `video_filename`, `video_name`, `video_duration` (R2 file reference)
- **Game shares**: `game_id`, `tag_name`, `recipient_profile_id`, `materialized_at` (data materialization)

Rather than adding nullable columns or duplicating shared infrastructure (tokens, revocation, visibility), we normalize into a base table with type-specific extensions.

## Solution

### 1. New Schema (replaces `shared_videos`)

**Base table — `shares`:**

```sql
CREATE TABLE shares (
    id SERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game')),
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    watched_at TIMESTAMPTZ
);

CREATE INDEX idx_shares_token ON shares(share_token);
CREATE INDEX idx_shares_sharer ON shares(sharer_user_id);
CREATE INDEX idx_shares_recipient ON shares(recipient_email);
```

**Video extension — `share_videos`:**

```sql
CREATE TABLE share_videos (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL,
    video_filename TEXT NOT NULL,
    video_name TEXT,
    video_duration REAL
);

CREATE INDEX idx_share_videos_video_sharer
    ON share_videos(video_id);
```

**Game extension — `share_games`:**

```sql
CREATE TABLE share_games (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    recipient_profile_id TEXT,
    materialized_at TIMESTAMPTZ
);

CREATE INDEX idx_share_games_game ON share_games(game_id);
CREATE INDEX idx_share_games_recipient_profile ON share_games(recipient_profile_id);
```

### 2. Migration Script

Migrates existing `shared_videos` rows into the new structure. Must run on production Postgres.

```sql
-- 1. Create new tables
-- (DDL from above)

-- 2. Migrate existing data
INSERT INTO shares (id, share_token, share_type, sharer_user_id, sharer_profile_id,
                    recipient_email, is_public, shared_at, revoked_at, watched_at)
SELECT id, share_token, 'video', sharer_user_id, sharer_profile_id,
       recipient_email, is_public, shared_at, revoked_at, watched_at
FROM shared_videos;

INSERT INTO share_videos (share_id, video_id, video_filename, video_name, video_duration)
SELECT id, video_id, video_filename, video_name, video_duration
FROM shared_videos;

-- 3. Sync sequence
SELECT setval('shares_id_seq', (SELECT COALESCE(MAX(id), 0) FROM shares));

-- 4. Drop old table
DROP TABLE shared_videos;
```

### 3. Code Changes

**`src/backend/app/services/pg.py`**
- Replace `shared_videos` DDL with `shares` + `share_videos` + `share_games` DDL

**`src/backend/app/services/sharing_db.py`**
- `create_shares()` → INSERT into `shares` + `share_videos` (two-step, same transaction)
- `get_share_by_token()` → query `shares` for access checks; JOIN extension table based on `share_type`
- `list_shares_for_video()` → `shares JOIN share_videos WHERE share_videos.video_id = %s`
- `update_share_visibility()` → operates on `shares` only (no change needed beyond table name)
- `revoke_share()` → operates on `shares` only (no change needed beyond table name)
- `list_contacts_for_user()` → operates on `shares` only (works for both types automatically)

**New functions for game shares (used by T2830):**
- `create_game_share()` → INSERT into `shares` + `share_games`
- `list_shares_for_game()` → `shares JOIN share_games WHERE game_id = %s`
- `mark_game_share_materialized()` → UPDATE `share_games SET materialized_at = now(), recipient_profile_id = %s`

**`src/backend/app/routers/shares.py`**
- `create_share()` → pass through to updated `create_shares()`
- `get_shared_video()` → JOIN `share_videos` for video URL; will need a parallel handler for game shares (T2830/T2840)
- `_build_video_r2_key()` → unchanged (operates on share_videos columns)
- Response models stay the same for video share endpoints

**Cleanup scripts** (4 files):
- `scripts/reset_all_accounts.py` — `shared_videos` → truncate `share_games`, `share_videos`, `shares` (FK order)
- `scripts/reset-test-user.py` — same
- `scripts/delete_user.py` — same
- `tests/conftest.py` — same

### 4. What This Task Does NOT Do

- Does not add game share endpoints (that's T2830)
- Does not add the `share_games` INSERT logic (that's T2830)
- Does not change the frontend ShareModal (response shape stays identical for video shares)
- The `share_games` table is created but empty — it's the foundation for T2830

## Test Scope

- Backend unit tests: verify video share CRUD still works through new schema
- Backend unit tests: verify `create_shares` + `get_share_by_token` round-trip
- Backend unit tests: verify `list_contacts_for_user` returns contacts from both share types
- Backend unit tests: verify revocation works on base table
- Migration script tested on dev/staging before production

## Files Affected

- `src/backend/app/services/pg.py` — DDL
- `src/backend/app/services/sharing_db.py` — all CRUD functions
- `src/backend/app/routers/shares.py` — minor (response building)
- `src/backend/tests/test_shares.py` — update for new schema
- `src/backend/tests/conftest.py` — truncation order
- `scripts/reset_all_accounts.py` — table names
- `scripts/reset-test-user.py` — table names
- `scripts/delete_user.py` — table names
- New: `scripts/migrate_shares_refactor.py` — production migration

## Estimate

~200 LOC backend (refactor + migration script), ~50 LOC test updates
