# T2840: Shared Annotation View

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2825 (shares table), T2830 (materialization)

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
