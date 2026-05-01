# T1790: Watch Tracking & Share Status

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-05-01

## Problem

Sharers have no visibility into whether recipients watched their shared videos. The gallery shows no indication that a video has been shared or how many people have viewed it.

## Solution

1. Add `watched_at` column to `shared_videos` table
2. Fire a watched event from SharedVideoOverlay on first play
3. Show share status on gallery cards (shared count + watched indicator)

## Context

### What Already Exists (from T1750/T1770/T1780)

**Backend — sharing.sqlite schema (NO `watched_at` yet):**
```sql
shared_videos (
    id, share_token, video_id, sharer_user_id, sharer_profile_id,
    video_filename, video_name, video_duration,
    recipient_email, is_public, shared_at, revoked_at
)
```
`watched_at` was intentionally deferred from T1750 to this task.

**Backend — existing endpoints in `src/backend/app/routers/shares.py`:**
- `gallery_shares_router` (prefix `/api/gallery`, authenticated):
  - `POST /{video_id}/share` → `ShareCreateResponse`
  - `GET /{video_id}/shares` → `list[ShareListItem]` (has `id, share_token, recipient_email, is_public, shared_at, revoked_at`)
- `shared_router` (prefix `/api/shared`, optional auth):
  - `GET /{share_token}` → `ShareDetailResponse` (has `share_token, video_name, video_duration, video_url, is_public, shared_at`)
  - `PATCH /{share_token}` — toggle visibility
  - `DELETE /{share_token}` — revoke

**Frontend — SharedVideoOverlay (`src/frontend/src/components/SharedVideoOverlay.jsx`):**
- Props: `{ shareToken, onClose }`
- Fetches `GET /api/shared/{shareToken}`, passes `video_url` to `MediaPlayer`
- `MediaPlayer` props: `{ src, autoPlay, onClose }`
- MediaPlayer has no `onPlay` callback currently — need to add one or fire watched event on mount (autoPlay=true means mount ≈ first play)

**Frontend — DownloadsPanel (`src/frontend/src/components/DownloadsPanel.jsx`):**
- Gallery cards rendered by `renderDownloadCard(download)`
- Download object has: `id, filename, project_name, project_id, watched_at, source_type, created_at, duration`
- Share button already exists (added by T1770), opens ShareModal
- No share count or status indicator on cards yet

**Frontend — ShareModal (`src/frontend/src/components/ShareModal.jsx`):**
- Already has "People with access" section showing `activeShares` (list of non-revoked shares)
- Each share row shows: email, public/private icon, copy link, revoke button
- Does NOT show watched status

### Relevant Files

**Backend:**
- Modify: `src/backend/app/services/sharing_db.py` — Add `watched_at` column migration, add `mark_share_watched()` function
- Modify: `src/backend/app/routers/shares.py` — Add `POST /api/shared/{share_token}/watched` endpoint, add `watched_at` to `ShareListItem`
- Auth: Endpoint should be in `shared_router` (optional auth) since public link viewers may not be authenticated

**Frontend:**
- Modify: `src/frontend/src/components/SharedVideoOverlay.jsx` — Fire watched event after video starts playing
- Modify: `src/frontend/src/components/ShareModal.jsx` — Show watched badge next to each share in "People with access"
- Modify: `src/frontend/src/components/DownloadsPanel.jsx` — Show share count indicator on cards that have shares

### Related Tasks
- Depends on: T1750, T1770, T1780 (all complete/testing)

### Technical Notes

**Schema migration — add `watched_at` column:**
```sql
ALTER TABLE shared_videos ADD COLUMN watched_at TEXT;
```
Run via manual migration script (per project rules — no auto-migration).

**New endpoint — `POST /api/shared/{share_token}/watched`:**
```python
@shared_router.post("/{share_token}/watched")
async def mark_watched(share_token: str, request: Request):
    share = get_share_by_token(share_token)
    if not share or share["revoked_at"]:
        raise HTTPException(404)
    # Idempotent — only set watched_at if NULL
    mark_share_watched(share_token)
    return {"ok": True}
```
No auth required — public link viewers can mark as watched. Idempotent (first call only sets timestamp).

**Frontend watched event timing:**
- Fire on SharedVideoOverlay mount when state becomes 'ready' (since autoPlay=true, mount = play)
- Fire-and-forget: `fetch(POST /api/shared/{shareToken}/watched).catch(() => {})`
- Only fire once per overlay session

**ShareListItem update — add `watched_at`:**
```python
class ShareListItem(BaseModel):
    id: int
    share_token: str
    recipient_email: str
    is_public: bool
    shared_at: str
    revoked_at: Optional[str]
    watched_at: Optional[str]  # NEW
```

**Gallery card share indicator:**
- Small share icon + count on cards that have been shared (e.g., "2" next to a Share2 icon)
- Requires either: (a) batch-fetch share counts with downloads list, or (b) lazy-load on gallery open
- Simplest: add `share_count` to the downloads API response (query sharing.sqlite by video_id)

## Implementation

### Steps
1. [ ] Migration script: `ALTER TABLE shared_videos ADD COLUMN watched_at TEXT`
2. [ ] Backend: Add `mark_share_watched(token)` to sharing_db.py
3. [ ] Backend: Add `POST /api/shared/{share_token}/watched` endpoint
4. [ ] Backend: Add `watched_at` to `ShareListItem` response model
5. [ ] Frontend: Fire watched POST from SharedVideoOverlay on ready state
6. [ ] Frontend: Show watched badge (green eye / gray clock) in ShareModal's "People with access" list
7. [ ] Frontend: Show share count on gallery cards (optional — can be deferred)
8. [ ] Backend + frontend tests

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `watched_at` column exists in shared_videos table
- [ ] Playing a shared video fires POST watched event (fire-and-forget)
- [ ] `watched_at` set on first play only (idempotent)
- [ ] ShareModal "People with access" shows watched/unwatched status per recipient
- [ ] `ShareListItem` API response includes `watched_at`
- [ ] Public link viewers can mark as watched (no auth required)
