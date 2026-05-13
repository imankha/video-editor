# T2850: Share Game

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2825 (shares table), T2830 (materialization logic)
**Based on:** T1850 (Share Game with Team)

## Problem

Users want to share raw game footage with friends so those friends can annotate their own clips. This is independent of the annotation tagging flow -- it's a simple "share this game" action from the game card.

## Solution

### Share Button on Game Cards

Add a share icon/button to game cards in the home screen game list. Clicking opens a share modal.

### Share Modal

Reuses the existing `UserPicker` component (`src/frontend/src/components/shared/UserPicker.jsx`) for email entry:
- Email input with autocomplete from prior shares (existing `GET /api/gallery/contacts` endpoint)
- "Share" button sends the game

### Backend Endpoint

```
POST /api/games/{game_id}/share
{
  "emails": ["friend@email.com", "other@email.com"]
}
```

For each recipient email:

1. **Create share record**: INSERT into `shares` (base table from T2825) with `share_type = 'game'`, then INSERT into `share_games` with `game_id` and `tag_name = NULL` (game shares aren't tag-filtered). This gives a `share_token` for the email link.

2. **Resolve recipient**: Look up email in Postgres `users` table
   - Exists with 1 profile -> materialize immediately
   - Exists with >1 profile -> `pending_teammate_share` with `tag_name = NULL` (profile picker on next visit)
   - Doesn't exist -> `pending_teammate_share`, resolves on signup

3. **Materialize game reference**: Reuse T2830's game reference creation logic:
   - Create `games` row in recipient's profile SQLite (copy metadata from sharer's game)
   - Create `game_videos` rows (copy `blake3_hash`, sequence, dimensions, fps)
   - Create `game_storage_refs` row in Postgres (so R2 cleanup respects the reference)
   - See T2830 "Game Reference in Profile SQLite" section for full column mapping

4. **No annotation copying**: Unlike teammate shares, game-only shares do NOT copy annotations. The recipient gets raw footage to annotate themselves.

5. **Send email**: Via Resend. Link format: `/shared/teammate/{share_token}`. The shared view (T2840) handles both game-only and annotation shares -- for game-only shares, it shows the video without annotation overlays.

### Difference from Teammate Share (T2830)

| | Teammate Share (T2830) | Game Share (T2850) |
|---|---|---|
| Trigger | "Share with Tagged Players" in annotation mode | Share button on game card |
| `share_games.tag_name` | The tag name (e.g., "Jake") | NULL |
| Annotations copied? | Yes, filtered by tag | No |
| Overlap merging? | Yes | No (no annotations to merge) |
| Materialization logic | Game ref + filtered clips | Game ref only |

The game reference creation code (games + game_videos + game_storage_refs) is shared with T2830. Extract it as a reusable helper in T2830; this task calls it.

### No Cost to Recipient

Same as T2830: game reference points to sharer's R2 objects via `blake3_hash`. No storage credits consumed. Expiry follows the original uploader's credits.

## UI Layout

Game card with share button:

```
+------------------------------------------+
|  vs Eagles - Nov 15          [Share] [>] |
|  6 clips | 40:00                         |
+------------------------------------------+
```

Share modal (reuses UserPicker pattern):

```
+------------------------------------------+
|  Share Game: vs Eagles - Nov 15          |
|                                          |
|  Add people:                             |
|  [friend@email.com x] [____________]    |
|                                          |
|  [Cancel]                       [Share]  |
+------------------------------------------+
```

## Test Scope

- Backend unit tests for `POST /api/games/{game_id}/share` endpoint
- Backend unit tests for game reference creation in recipient's profile (verify games + game_videos + game_storage_refs rows)
- Frontend unit tests for share button on game cards + share modal
- E2E: share game, recipient sees game in their account, can annotate it

## Files Affected

- `src/frontend/src/modes/home/` -- share button on game cards
- New component: `src/frontend/src/components/ShareGameModal.jsx` (thin wrapper around UserPicker + API call)
- `src/backend/app/routers/games.py` -- new `POST /api/games/{game_id}/share` endpoint
- `src/backend/app/services/sharing_db.py` -- `create_game_share()` (reuses T2825 base table insert)
- Reuse game reference helper from T2830's `app/database.py` additions
- Reuse email infrastructure from `app/services/email.py`

## Estimate

~150 LOC frontend, ~100 LOC backend (mostly reusing T2830), ~100 LOC tests
