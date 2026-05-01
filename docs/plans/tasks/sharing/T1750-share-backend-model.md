# T1750: Share Backend Model & API

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

No backend infrastructure exists for sharing videos. Need the data model and API endpoints before any frontend work can begin.

## Solution

Create `shared_videos` table, storage operations, and REST endpoints for creating, listing, and revoking shares.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/storage.py` - Add shared_videos table operations
- `src/backend/app/routers/gallery.py` - Add share endpoints
- `src/backend/app/main.py` - Register router if separate
- `scripts/` - Migration script for shared_videos table

### Related Tasks
- Blocks: T1760, T1770, T1780, T1790 (all depend on the share model)

### Technical Notes

**Table schema:**
```sql
CREATE TABLE shared_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_token TEXT UNIQUE NOT NULL,       -- UUID, used in share URL
    video_id INTEGER NOT NULL,              -- FK to working_clips or exports
    sharer_user_id TEXT NOT NULL,           -- who shared it
    recipient_email TEXT NOT NULL,           -- who it's shared with
    is_public INTEGER DEFAULT 0,            -- 1 = anyone with link can view; 0 = recipient must auth with matching email
    shared_at TEXT NOT NULL,                -- ISO timestamp
    watched_at TEXT,                        -- NULL until first play
    revoked_at TEXT                         -- NULL unless revoked
);
CREATE INDEX idx_shared_videos_token ON shared_videos(share_token);
CREATE INDEX idx_shared_videos_video ON shared_videos(video_id);
```

**Visibility model (Google Docs style):**
- `is_public=0` (private, default): `GET /shared/{token}` returns 403 unless authenticated user's email matches `recipient_email`
- `is_public=1` (public): `GET /shared/{token}` returns video metadata to anyone — no auth required. Named recipients still tracked for watch status via email match.
- Visibility is set per-share at creation time and can be toggled later by the sharer via PATCH

**Endpoints:**
- `POST /gallery/{video_id}/share` — body: `{recipient_emails: [str], is_public: bool}`, creates one share record per email, returns list of share_tokens. Each recipient gets their own token. `is_public` defaults to false.
- `GET /gallery/{video_id}/shares` — list all shares for a video (sharer only)
- `PATCH /shared/{share_token}` — update share settings (e.g., toggle `is_public`). Sharer only.
- `DELETE /shared/{share_token}` — revoke a share (sets revoked_at)
- `GET /shared/{share_token}` — get share details + video metadata. If `is_public=1`, no auth required. If `is_public=0`, gated by email match (403 on mismatch).
- `POST /shared/{share_token}/watched` — mark as watched (recipient only, or anonymous for public links)

## Implementation

### Steps
1. [ ] Create migration script for `shared_videos` table
2. [ ] Add storage functions: `create_share`, `get_share_by_token`, `list_shares_for_video`, `mark_share_watched`, `revoke_share`
3. [ ] Add share endpoints to gallery router (or new shares router)
4. [ ] Access control: sharer-only for list/revoke, recipient-email-match for GET/watched
5. [ ] Backend tests for all endpoints + access control

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `shared_videos` table created via migration
- [ ] POST share accepts list of emails + `is_public` flag, creates one record per email each with unique UUID token
- [ ] GET shares returns list for sharer only (includes `is_public` status)
- [ ] GET share by token: if `is_public=0`, returns 403 when auth email doesn't match recipient_email; if `is_public=1`, returns video metadata without auth
- [ ] GET share by token returns 410 if revoked
- [ ] PATCH share toggles `is_public` (sharer only)
- [ ] DELETE revokes share (sets revoked_at)
- [ ] POST watched sets watched_at (first call only, idempotent) — works for anonymous viewers on public links
- [ ] Backend tests pass (including public/private access scenarios)
