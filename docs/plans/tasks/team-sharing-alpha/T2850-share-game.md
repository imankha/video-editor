# T2850: Share Game

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2830 (materialization backend)
**Based on:** T1850 (Share Game with Team)

## Problem

Users want to share raw game footage with friends so those friends can annotate their own clips. This is independent of the annotation tagging flow -- it's a simple "share this game" action from the game card.

## Solution

### Share Button on Game Cards

Add a share icon/button to game cards in the home screen game list. Clicking opens a share modal.

### Share Modal

Reuses the existing `UserPicker` component for email entry:
- Email input with autocomplete from prior shares (existing contacts endpoint)
- "Share" button sends the game

### Backend Flow

```
POST /api/games/{game_id}/share
{
  "emails": ["friend@email.com", "other@email.com"]
}
```

For each recipient:
1. Look up user by email
2. If exists with 1 profile -> create game reference in their profile SQLite
3. If exists with >1 profile -> pending share with profile picker
4. If doesn't exist -> pending share, resolves on signup
5. Send email via Resend with link to the game

### Game Reference

A game reference in the recipient's profile SQLite points to the sharer's R2 video objects:
- Same `blake3_hash` / `game_videos` entries
- Same R2 path for video files
- No R2 duplication
- Recipient can annotate, frame, export from this game independently

### No Cost to Recipient

Game reference is free. Expiry follows the original uploader's storage credits. When the R2 video is deleted (uploader's credits expire), recipient also loses access to raw footage -- but any exported clips/reels survive.

## Test Scope

- Backend unit tests for game share endpoint
- Backend unit tests for game reference creation
- Frontend unit tests for share button + modal on game cards
- E2E: share game, recipient sees game in their account

## Files Affected

- `src/frontend/src/modes/home/` -- share button on game cards
- Reuse `UserPicker` from `src/frontend/src/components/shared/UserPicker.jsx`
- `src/backend/app/routers/games.py` -- new share endpoint
- `src/backend/app/database.py` -- game reference creation helper
- Reuse email infrastructure from T1760

## Estimate

~150 LOC frontend, ~200 LOC backend, ~100 LOC tests
