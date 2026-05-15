# T2855: Shared Game Storage Extension

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2850 (Share Game), T2830 (materialization creates recipient storage refs)
**Impact:** 6
**Complexity:** 2

## Problem

When a game is shared, the recipient's `game_storage_refs` row copies the **sharer's `storage_expires_at`**. If the sharer shared late in their 30-day window, the recipient gets very little time. Recipients currently have no way to pay for additional storage on shared games.

Actually -- the existing `POST /api/games/{game_id}/extend-storage` endpoint already operates on the **current user's** refs and SQLite. Since materialization (`_copy_game`) copies `video_size`, `blake3_hash`, and `game_videos` into the recipient's SQLite, and `_create_storage_refs` creates `game_storage_refs` for the recipient in Postgres, the extend endpoint should already work when a recipient calls it.

This task is primarily **verification** that the end-to-end flow works for shared game recipients, with fixes for any gaps discovered.

## What Should Already Work

The extend-storage flow for recipients reuses existing infrastructure:

| Step | Mechanism | Status |
|------|-----------|--------|
| Recipient has game in SQLite | `_copy_game()` copies game + game_videos with `video_size`, `blake3_hash` | Built (T2830) |
| Recipient has storage ref in Postgres | `_create_storage_refs()` copies sharer's ref with same expiry | Built (T2830) |
| Games list shows expiry countdown | `GET /api/games` derives `storage_expires_at` from recipient's own refs | Built |
| Expired card shows "Extend Storage" | `can_extend = blake3 in all_ref_hashes or blake3 in grace_hashes` | Built |
| Extend endpoint works for recipient | Reads recipient's SQLite + refs, deducts recipient's credits, updates recipient's ref | Built |
| Grace deletion cancelled on extend | `insert_game_storage_ref` calls `delete_grace_deletion` | Built |

## What Needs Verification

### 1. End-to-end extend flow for shared games

Share a game, let recipient's ref expire, verify:
- Recipient sees "Expired" status on game card
- "Extend Storage" button appears
- Clicking extend deducts recipient's credits (not sharer's)
- Recipient's `game_storage_refs.storage_expires_at` is updated
- Game returns to "active" status
- Video plays correctly after extension

### 2. Independent expiry lifecycle

Verify that sharer and recipient expiry are truly independent:
- Sharer extends -> recipient's ref is NOT updated (expected)
- Recipient extends -> sharer's ref is NOT updated (expected)
- One expires while other is active -> expired user loses access, active user keeps it

### 3. Grace period interaction

When ALL refs for a hash expire:
- Hash enters `r2_grace_deletions` (14-day grace)
- If recipient extends during grace period -> grace deletion cancelled, video preserved
- If grace period elapses -> R2 object permanently deleted, no one can extend

### 4. Auto-export on expiry for shared games

When recipient's ref expires, sweep calls `auto_export_game()`. Verify:
- If recipient annotated the shared game -> their clips are auto-exported
- If recipient never annotated -> no-op (nothing to export), game just expires gracefully

## Potential Fixes

Based on verification, these may need attention:

1. **Extend cost calculation**: `calculate_extension_cost` uses `video_size` from `game_videos`. Verify this is populated correctly in recipient's SQLite (it should be -- `_copy_game` copies it).

2. **Near-expiry UX for shared games**: The frontend shows "Expires in X days" when `daysLeft < 14`. Shared games with short remaining windows (e.g., shared on Day 25 of 30) might expire before the user notices. Consider whether shared games need a different near-expiry threshold or a "shared" badge.

3. **Extend modal game size**: The StorageExtensionModal shows the cost based on `game.video_size`. Verify this field is returned correctly for shared games in the games list endpoint.

## Design Decisions

- **Recipients pay their own credits to extend** -- no free ride after the sharer's window
- **No cascading updates** -- sharer extending does NOT extend recipients (each user controls their own costs)
- **Same pricing** -- recipients pay the same `calculate_extension_cost` rate as uploaders
- **No upload cost** -- recipients still don't pay the initial upload credit cost, only extension if they want to keep access longer

## Test Scope

- Backend: verify `extend_game_storage` works when called by a user whose game came from sharing (not upload)
- Frontend: verify expired shared game shows "Extend Storage" and the modal works
- Integration: share game -> expire -> extend -> verify video plays

## Files Affected

- Likely no code changes needed if verification passes
- If fixes needed, likely in:
  - `src/backend/app/routers/games.py` (extend endpoint edge cases)
  - `src/frontend/src/components/ProjectManager.jsx` (shared game UX)
  - `src/frontend/src/components/StorageExtensionModal.jsx` (cost display)
