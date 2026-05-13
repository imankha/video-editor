# T2840: Shared Annotation View

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2825 (shares table), T2830 (materialization)

## T2830 Implementation Learnings

### What T2830 built (files to reference)

- **`src/backend/app/services/materialization.py`** (NEW): Core service. `materialize_game_share()` copies games + game_videos + filtered raw_clips from sharer to recipient SQLite. `serialize_clip_data()` pre-serializes clips to JSON for `pending_teammate_shares.clip_data`.
- **`src/backend/app/services/sharing_db.py`**: Added `create_pending_share()`, `get_pending_shares_for_email(email)`, `resolve_pending_share(pending_id, profile_id)`.
- **`src/backend/app/routers/clips.py`**: Added `POST /api/resolve-pending-shares` endpoint (takes `{pending_ids: [...], profile_id: "..."}`). Also added `_materialize_or_pend()` helper called after email delivery.
- **`src/backend/app/services/pg.py`**: Added `pending_teammate_shares` DDL with FK CASCADE on `shares(id)`.

### How pending shares work

When `share_with_teammates` sends emails:
- **Recipient exists with 1 profile**: `materialize_game_share()` runs immediately. `share_games.materialized_at` is stamped.
- **Recipient exists with >1 profile**: `create_pending_share()` stores pre-serialized `clip_data` JSONB. Recipient must call `POST /api/resolve-pending-shares` with chosen profile_id.
- **Recipient doesn't exist**: Same as multi-profile -- `create_pending_share()`. Resolves on signup (this task).

### How to resolve pending shares

```python
POST /api/resolve-pending-shares
Body: {"pending_ids": [1, 2, 3], "profile_id": "a1b2c3d4"}
```
This endpoint calls `materialize_game_share()` with the pre-serialized `clip_data` from the pending share, then stamps `resolved_at` and `resolved_profile_id`.

### Key queries for the backend endpoint

```python
# Look up a game share by token
from app.services.sharing_db import get_share_by_token
share = get_share_by_token(token)  # returns dict with id, share_type, sharer_user_id, etc.

# Join share_games for game context
# share_games has: share_id, game_id, tag_name, recipient_profile_id, materialized_at
# Use a JOIN or separate query on share_games WHERE share_id = share['id']

# Get pending shares for a recipient email
from app.services.sharing_db import get_pending_shares_for_email
pending = get_pending_shares_for_email(email)  # returns list with clip_data JSONB

# Get sharer's game videos for presigned URLs
# Open sharer's SQLite (see _open_profile_db in materialization.py)
# Query game_videos WHERE game_id = ? ORDER BY sequence
# Use generate_presigned_url_global() from app.storage with R2 key: games/{blake3_hash}.mp4
```

### Current `/shared/:token` route problem

The existing `SharedVideoOverlay.jsx` component handles ALL `/shared/:token` URLs. It calls `GET /api/shared/{token}` which only LEFT JOINs `share_videos` (not `share_games`). For game shares, it returns 200 with null video fields, then shows "restricted" because the `is_public` field from `share_videos` is null.

**Options for T2840:**
1. Add a new route `/shared/teammate/:token` (as spec'd) with a separate component
2. OR modify the existing `/shared/:token` flow to check `share_type` and branch

Option 1 is cleaner -- the share email link format (`_get_share_url()` in `email.py`) would need updating to use `/shared/teammate/{token}` for game shares.

### R2 presigned URL generation for game videos

```python
from app.storage import generate_presigned_url_global
# R2 key for game videos: "games/{blake3_hash}.mp4"
# generate_presigned_url_global takes an r2_key and returns a presigned URL
# The blake3_hash comes from game_videos.blake3_hash (multi-video) or games.blake3_hash (single-video)
```

### Auth bypass for testing (dev only)

- Backend accepts `X-User-ID` header in dev/staging (not production)
- Backend accepts `X-Profile-ID` header (must be 8-char hex, e.g. `a1b2c3d4`)
- Vite proxy strips custom headers -- hit `localhost:8000` directly for API testing with auth bypass
- Frontend auth bypass: `useAuthStore.setState({ isAuthenticated: true, email: '...', showAuthModal: false })`

### Share URL format (needs updating)

`_get_share_url()` in `email.py:205` currently generates `/shared/{token}` for ALL share types. T2840 should either:
- Update this to generate `/shared/teammate/{token}` for game shares (requires passing share_type to the email function), OR
- Keep `/shared/{token}` and have the frontend detect share_type from the API response and render accordingly.

The `send_teammate_share_email()` function (email.py:279) calls `_get_share_url(share_token)` directly.

### Dev email bypass

`send_teammate_share_email()` in `email.py` currently logs the share URL and returns `True` when `RESEND_API_KEY` is not set (dev mode). The key is commented out in `.env` for local testing. Staging and production have it set as a Fly.io secret.

## Problem

Non-users who receive a teammate share email need to see the shared annotations before signing up. They should see a playback experience showing the clips with annotation metadata (name, stars, notes), plus a clear CTA to sign up and claim the content.

See [EPIC.md](EPIC.md) for design decisions: non-users see playback + signup CTA, content materializes on signup via `pending_teammate_shares` (T2830).

## Solution

### Share Token Resolution

The share email (sent by T2830) contains a link: `/shared/teammate/{share_token}`

The `share_token` lives in the `shares` base table (T2825) with `share_type = 'game'`. The backend resolves it by joining `shares` + `share_games` to get the game and tag context.

### Route: `/shared/teammate/:shareToken`

New frontend route, distinct from `/shared/:shareToken` (reel video shares). Both resolve through the same `shares` base table but render different experiences.

### Backend Endpoint

```
GET /api/shared/teammate/{share_token}
```

1. Look up `share_token` in `shares` table (T2825). Verify `share_type = 'game'`, not revoked.
2. Access check: if `is_public = false`, verify requester email matches `recipient_email` (same pattern as existing `get_shared_video` in `shares.py`).
3. Join `share_games` for `game_id`, `tag_name`, `materialized_at`.
4. If `materialized_at` is set -> the content is already in the recipient's account. Return a redirect hint.
5. If not materialized:
   - Check `pending_teammate_shares` for `clip_data` (pre-serialized annotations from T2830)
   - Generate presigned R2 URLs for the game videos (using `blake3_hash` from sharer's `game_videos`)
   - Return: game metadata, video URLs, annotation data, sharer attribution

Response shape:

```json
{
  "share_token": "...",
  "sharer_name": "Jake's Dad",
  "game_name": "vs Eagles - Nov 15",
  "videos": [
    { "sequence": 0, "url": "https://r2.../presigned", "duration": 2400.0, "fps": 30 }
  ],
  "annotations": [
    { "name": "Quick Goal", "rating": 5, "notes": "Beautiful finish", "start_time": 120.5, "end_time": 128.3, "video_sequence": 0 }
  ],
  "materialized": false,
  "recipient_has_account": false
}
```

### Non-User View (Frontend)

When a non-user clicks the link:

1. Video player loads the presigned game video URL
2. Annotation regions shown on a mini-timeline (clickable)
3. Current annotation overlay: clip name, star rating, notes displayed during playback of each region
4. Previous/next navigation between clips
5. Attribution: "Shared by [sharer name]"
6. CTA: "Sign up / Sign In to annotate and make your own Reel"

### Authenticated User View

When a logged-in user clicks the link:

1. If `pending_teammate_shares` exists for their email and is unresolved:
   - Show profile picker (if >1 profile): "Which profile should these clips go to?"
   - On selection: POST to materialize endpoint (T2830's resolution flow), redirect to game in their account
2. If already materialized (`share_games.materialized_at` is set):
   - Redirect to the game in their account

### On Signup Flow

1. New user signs up from the shared view (signup modal opens with email pre-filled from share link)
2. After signup completes, frontend checks for pending shares via the share token
3. Profile picker if needed (new users typically have 1 profile)
4. Materialize: POST triggers T2830's pending share resolution
5. Redirect to the game in their account

### Video Access for Non-Users

The `GET /api/shared/teammate/{share_token}` endpoint generates time-limited presigned R2 URLs for the game videos. This works because:
- The sharer's `game_videos` rows contain `blake3_hash`
- R2 presigned URLs are generated from hash (existing `generate_presigned_url_global`)
- No auth required to use presigned URLs (they're self-authenticating)

## UI Layout

```
+------------------------------------------+
|  [Reel Ballers logo]                     |
|                                          |
|  Shared by Jake's Dad                    |
|                                          |
|  +------------------------------------+ |
|  |                                    | |
|  |         Video Player               | |
|  |                                    | |
|  |  [Clip: Quick Goal  !!!!!]         | |
|  |  [Notes: Beautiful finish]         | |
|  +------------------------------------+ |
|  |  [|< ] [ < ] [ > ] [ >|]          | |
|  |  Clip 1 of 3                       | |
|  +------------------------------------+ |
|                                          |
|  +------------------------------------+ |
|  | Sign up to annotate and make your  | |
|  | own Reel                           | |
|  |         [Sign Up]  [Sign In]       | |
|  +------------------------------------+ |
+------------------------------------------+
```

## Test Scope

- Backend unit tests for `GET /api/shared/teammate/{share_token}` (public, private, revoked, materialized vs pending)
- Frontend unit tests for shared annotation playback component (video player, clip navigation, annotation overlay)
- Frontend unit tests for profile picker on authenticated visit
- E2E: non-user views shared link, sees annotations with correct data
- E2E: non-user signs up from shared view, content materializes, redirected to game

## Files Affected

- New frontend component: `src/frontend/src/components/SharedAnnotationView.jsx` (or `src/frontend/src/pages/SharedAnnotationPage.jsx`)
- `src/frontend/src/App.jsx` -- new route `/shared/teammate/:shareToken`
- `src/backend/app/routers/shares.py` -- new `GET /api/shared/teammate/{share_token}` endpoint in `shared_router`
- Reuse video player patterns from existing playback components
- Reuse auth modal with email pre-fill from existing auth flow

## Estimate

~250 LOC frontend, ~100 LOC backend, ~80 LOC tests
