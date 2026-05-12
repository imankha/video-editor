# T2830: Game + Annotation Materialization

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2800 (data model), T2820 (share flow)
**Supersedes:** T1830 (Shared Content Inbox & Claim)

## Problem

When a user shares clips with tagged players, the backend must create game references and filtered annotations in each recipient's account. Multiple sharers sending to the same person must merge cleanly. No inbox or claim flow -- content goes directly into the recipient's profile.

## Solution

### Share Endpoint

```
POST /api/profiles/{profile_id}/share-with-teammates
```

For each recipient email + tag_name pair:

1. **Resolve recipient**: Look up email in Postgres `users` table
   - Exists with 1 profile -> use that profile
   - Exists with >1 profile -> create `pending_teammate_share` record; recipient picks profile on next visit (lightweight picker, not inbox)
   - Doesn't exist -> create `pending_teammate_share` record; resolves on signup

2. **Filter annotations**: Query sharer's raw_clips for `game_id` where `tagged_teammates` JSON array contains the tag_name

3. **Create game reference**: In recipient's profile SQLite, create a game entry pointing to the same R2 video objects. No R2 duplication -- just a DB reference.

4. **Materialize annotations**: Copy filtered raw_clips into recipient's profile SQLite, associated with the new game entry.

5. **Merge overlapping**: If the recipient already has annotations on this game (from a prior share or their own annotation), merge overlapping clips:
   - **Overlap detection**: Two clips overlap if their frame ranges intersect on the same video
   - **Merge rule**: Combined clip gets the earliest start frame, latest end frame, first clip's title, both sets of notes (separated by newline)
   - **Non-overlapping**: Stay as separate annotations

6. **Send email**: Via Resend with link to the game. Reuses email infrastructure from T1760.

### Pending Share Resolution

For multi-profile users and non-users, store pending shares in Postgres:

```sql
CREATE TABLE pending_teammate_shares (
    id SERIAL PRIMARY KEY,
    sharer_user_id TEXT NOT NULL,
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    game_id INTEGER NOT NULL,           -- sharer's game_id
    tag_name TEXT NOT NULL,
    clip_data JSONB NOT NULL,           -- serialized annotation data
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_profile_id TEXT
);
```

Resolution flow:
- Multi-profile user: profile picker shown on next app visit (banner/toast)
- New user: on signup completion, check for pending shares -> profile picker -> materialize

### Profile Picker (Multi-Profile)

Lightweight UI -- NOT an inbox:
- Banner: "Jake's dad shared 3 clips with you. Which profile?"
- Profile selector (existing profiles + "Create new")
- One-click resolution, content materializes immediately

### Annotation Data Copying

When materializing annotations in recipient's profile:
- Copy relevant fields: start_time, end_time, name, rating, tags, notes, video_sequence
- Do NOT copy: tagged_teammates, my_athlete (these are sharer's metadata)
- Set `my_athlete = 1` for recipient (it's their kid's clip)
- Associate with recipient's game entry

### No Cost to Recipient

Game references point to same R2 objects. No storage credits consumed. Expiry follows the original uploader's credits.

## Test Scope

- Backend unit tests for annotation filtering by tag_name
- Backend unit tests for overlap detection and merge logic
- Backend unit tests for game reference creation
- Backend unit tests for pending share CRUD
- Integration test: end-to-end share -> materialize -> verify recipient data
- Edge cases: same game shared by 2 different people, self-share, non-existent email

## Files Affected

- `src/backend/app/routers/profiles.py` (or new sharing router) -- share-with-teammates endpoint
- `src/backend/app/services/sharing_db.py` -- pending_teammate_shares table, resolution
- `src/backend/app/services/pg.py` -- pending_teammate_shares schema
- `src/backend/app/database.py` -- game reference creation helpers
- `src/backend/app/services/email.py` -- teammate share email template
- Frontend: profile picker component, pending share banner

## Estimate

~400 LOC backend, ~150 LOC frontend, ~200 LOC tests
