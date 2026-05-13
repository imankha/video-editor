# T2830: Game + Annotation Materialization

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model), T2820 (share UI), T2825 (shares table refactor)
**Supersedes:** T1830 (Shared Content Inbox & Claim)

## T2800 Implementation Reference

- **`tagged_teammates`** is stored as a JSON-serialized TEXT column on `raw_clips` (may become msgpack via T2870). Parse with `json.loads()`. Value is `null` when no teammates tagged.
- **`my_athlete`** is stored as INTEGER (0/1) on `raw_clips`, default 1. In API responses it's a boolean.
- **Filtering clips by tag name**: Query `SELECT * FROM raw_clips WHERE game_id = ?`, then in Python filter rows where `json.loads(row['tagged_teammates'])` contains the target tag name. No SQLite JSON functions are used.
- **`teammate_emails` table** in profile SQLite: `(id, tag_name, email, created_at)` with UNIQUE(tag_name, email).

## Problem

When a user shares clips with tagged players, the backend must create game references and filtered annotations in each recipient's account. Multiple sharers sending to the same person must merge cleanly. No inbox or claim flow -- content goes directly into the recipient's profile.

See [EPIC.md](EPIC.md) for design decisions: no inbox, per-player annotation filtering, overlap merging rules, no credit cost to recipients.

## Solution

### Share Endpoint

```
POST /api/profiles/{profile_id}/share-with-teammates
```

Request body (sent by T2820 frontend):

```json
{
  "game_id": 123,
  "recipients": [
    { "tag_name": "Jake", "emails": ["mom@email.com", "dad@email.com"] },
    { "tag_name": "Player 7", "emails": ["parent@email.com"] }
  ]
}
```

### Per-Recipient Flow

For each (tag_name, email) pair:

1. **Create share record**: INSERT into `shares` (base table from T2825) with `share_type = 'game'`, then INSERT into `share_games` with `game_id`, `tag_name`. This gives us a `share_token` for the email link and revocation tracking.

2. **Resolve recipient**: Look up email in Postgres `users` table
   - Exists with 1 profile -> materialize immediately
   - Exists with >1 profile -> create `pending_teammate_share` record; recipient picks profile on next visit
   - Doesn't exist -> create `pending_teammate_share` record; resolves on signup (T2840)

3. **Filter annotations**: Query sharer's `raw_clips` for the `game_id` where `tagged_teammates` JSON array contains the `tag_name`

4. **Create game reference** (see "Game Reference in SQLite" below)

5. **Materialize annotations** (see "Annotation Copying" below)

6. **Merge overlapping** (see "Overlap Merging" below)

7. **Update share record**: SET `share_games.materialized_at = now()` and `share_games.recipient_profile_id`

8. **Send email**: Via Resend using existing `send_share_email()` from `app/services/email.py`. Link includes the share token: `/shared/teammate/{share_token}`

### Game Reference in Profile SQLite

A "game reference" means creating rows in the **recipient's** profile SQLite that point to the **sharer's** R2 video files. No R2 duplication.

**`games` table** -- new row in recipient's profile:

| Column | Value | Source |
|--------|-------|--------|
| `name` | Copy from sharer's game | sharer's `games.name` |
| `blake3_hash` | Copy from sharer's game | sharer's `games.blake3_hash` |
| `video_duration` | Copy | sharer's `games.video_duration` |
| `video_width` | Copy | sharer's `games.video_width` |
| `video_height` | Copy | sharer's `games.video_height` |
| `video_size` | Copy | sharer's `games.video_size` |
| `opponent_name` | Copy | sharer's `games.opponent_name` |
| `game_date` | Copy | sharer's `games.game_date` |
| `game_type` | Copy | sharer's `games.game_type` |
| `video_filename` | NULL | Recipient doesn't own the file |
| `clip_count` etc | 0 | Will be computed from recipient's own annotations |

**`game_videos` table** -- copy rows from sharer's game:

| Column | Value | Source |
|--------|-------|--------|
| `game_id` | Recipient's new game ID | just created |
| `blake3_hash` | Copy from sharer | sharer's `game_videos.blake3_hash` |
| `sequence` | Copy | sharer's `game_videos.sequence` |
| `duration` | Copy | sharer's `game_videos.duration` |
| `video_width` | Copy | sharer's `game_videos.video_width` |
| `video_height` | Copy | sharer's `game_videos.video_height` |
| `video_size` | Copy | sharer's `game_videos.video_size` |
| `fps` | Copy | sharer's `game_videos.fps` |

**`game_storage_refs` table** (Postgres) -- add a reference so the recipient's profile counts as a user of this video's R2 storage. This prevents R2 cleanup from deleting the video while the recipient still has access:

| Column | Value |
|--------|-------|
| `user_id` | Recipient's user_id |
| `profile_id` | Recipient's profile_id |
| `blake3_hash` | Same hash as sharer |
| `game_size_bytes` | Same as sharer's entry |
| `storage_expires_at` | Same as sharer's entry (expiry follows uploader) |

**Video access**: R2 presigned URLs are generated from `blake3_hash`. Since the recipient's `game_videos` rows have the same hash, the existing video loading code will generate working URLs. The `game_storage_refs` entry ensures R2 cleanup respects the reference.

### Annotation Copying

Copy filtered `raw_clips` into recipient's profile SQLite:

| Column | Value | Notes |
|--------|-------|-------|
| `filename` | '' (empty) | No extracted video file yet |
| `rating` | Copy from sharer | |
| `tags` | Copy from sharer | |
| `name` | Copy from sharer | |
| `notes` | Copy from sharer | |
| `start_time` | Copy from sharer | |
| `end_time` | Copy from sharer | |
| `game_id` | Recipient's new game ID | Not sharer's game_id |
| `video_sequence` | Copy from sharer | |
| `tagged_teammates` | NULL | Sharer's metadata, not recipient's |
| `my_athlete` | 1 | Default true -- it's their kid's clip |

### Overlap Merging

When the recipient already has annotations on the same game (from a prior share or their own annotation work), merge overlapping clips:

**Same game detection**: Two games are "the same" if they share the same `blake3_hash` in `game_videos`. If the recipient already has a game with matching video hashes, reuse that game entry instead of creating a new one.

**Overlap detection**: Two clips overlap if their `video_sequence` matches AND their frame ranges (`start_time`, `end_time`) intersect.

**Merge rule** (per EPIC.md): Combined clip gets the earliest `start_time`, latest `end_time`, first clip's `name`, both sets of `notes` (separated by newline). Non-overlapping clips stay separate.

### Pending Share Resolution

For multi-profile users and non-users, store in Postgres:

```sql
CREATE TABLE pending_teammate_shares (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id),
    sharer_user_id TEXT NOT NULL,
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    clip_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_profile_id TEXT
);

CREATE INDEX idx_pending_shares_email ON pending_teammate_shares(recipient_email);
CREATE INDEX idx_pending_shares_share ON pending_teammate_shares(share_id);
```

`clip_data` contains the serialized annotation data (pre-filtered for this tag) so materialization doesn't need to re-query the sharer's SQLite later.

**Resolution flow:**
- Multi-profile user: profile picker shown on next app visit (banner/toast: "Jake's dad shared 3 clips with you. Which profile?")
- New user: on signup, check `pending_teammate_shares` for their email -> profile picker -> materialize (T2840)
- On resolution: materialize, SET `resolved_at` and `resolved_profile_id`, update `share_games.materialized_at`

### No Cost to Recipient

Game references point to the same R2 objects via `blake3_hash`. No storage credits consumed. The `game_storage_refs` entry uses the sharer's `storage_expires_at`. When the uploader's credits expire and R2 objects are deleted, the recipient also loses access to raw footage -- but any exported clips/reels survive in the recipient's own R2 space.

## Test Scope

- Backend unit tests for annotation filtering by tag_name (JSON array containment)
- Backend unit tests for overlap detection and merge logic
- Backend unit tests for game reference creation (games + game_videos + game_storage_refs)
- Backend unit tests for `shares` + `share_games` record creation
- Backend unit tests for pending share CRUD and resolution
- Integration test: end-to-end share -> materialize -> verify recipient's SQLite has game + clips
- Edge cases: same game shared by 2 different people, self-share, non-existent email, recipient already annotated the same game

## Files Affected

- `src/backend/app/routers/profiles.py` (or new `routers/teammate_shares.py`) -- share-with-teammates endpoint
- `src/backend/app/services/sharing_db.py` -- `create_game_share()`, pending share CRUD, resolution
- `src/backend/app/services/pg.py` -- `pending_teammate_shares` table DDL
- `src/backend/app/database.py` -- game reference creation helpers (insert into recipient's games + game_videos)
- `src/backend/app/services/email.py` -- teammate share email template (may reuse existing `send_share_email` with different link format)
- Frontend: profile picker component (lightweight, not full inbox), pending share banner/toast
- `scripts/reset_all_accounts.py`, `scripts/reset-test-user.py`, `scripts/delete_user.py` -- add `pending_teammate_shares` to truncation

## Estimate

~400 LOC backend, ~150 LOC frontend, ~200 LOC tests
