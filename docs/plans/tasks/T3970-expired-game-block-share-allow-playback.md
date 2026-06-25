# T3970: Expired Game - Block Sharing, Allow Annotation Playback

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

For a game whose storage has **expired** (`storage_status === 'expired'`):
1. **You can still share it** — you shouldn't be able to share an expired game.
2. **You can't easily play back its annotations** — clicking an expired (still-extendable) game opens
   the Storage Extension modal instead of offering playback, even though the annotations (and recap, if
   present) still exist and are served by the backend.

## Solution

A. **Block sharing of expired games** — remove/disable the Share affordance on the expired game card,
   and add a backend guard so the share endpoints reject an expired game with a clear error.
B. **Allow annotation playback for expired games** — give the expired card a clear "Playback
   annotations" action that opens the existing annotation/recap playback, regardless of extend state.
   (Backend already serves annotations + recap for expired games; no gate to add there.)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — GameCard: `isExpired = game.storage_status === 'expired'` (~L1244); the **expired view** (~L1322-1421) renders the Share button (~L1401-1409); the expired-card **click handler** (~L1283-1292) opens StorageExtensionModal when `canExtend`, else RecapPlayerModal when `hasRecap`; active-card hover Share (~L1490-1498).
- `src/backend/app/routers/games.py` — `share_game` (~L1656) and `share_playback` (~L1798): **add an expired guard**. The expiry source is `game_storage.storage_expires_at` (profile.sqlite); mirror the is_expired computation at ~L877-884. `get_game` annotations (~L1150) and `get_recap_data` (~L1008) already have **no** expiry gate (leave them open).
- `src/backend/app/services/sharing_db.py` — `create_game_share` (~L226): no expiry check today (guard at the router is fine).
- `src/frontend/src/components/RecapPlayerModal.jsx` — annotation/recap playback; ensure graceful handling if a hard-deleted (post-grace) video 404s while annotations still exist.
- Storage status plumbing: `/api/games` returns `storage_status`, `storage_expires_at`, `can_extend` (games.py ~L917-922); `gamesDataStore.js` stores them raw; components key off `game.storage_status`. (ExpirationBadge.jsx uses `storage_expires_at`.)

### Related Tasks
- Builds on the Storage Credits epic (T1580-T1583), Grace Period (T2400), and the Expired Game Experience epic (T2410 Playback-Mode Recap Viewer, T2420 Annotations+Highlights tabs, T2430). Share-game = T2850.

### Technical Notes
- `storage_status` is computed server-side in `/api/games` from `game_storage.storage_expires_at` (per-profile SQLite). Reuse that flag on the frontend; reuse the same is_expired math for the backend guard.
- **Grace period (14 days):** a recently-expired game still has its video in R2, so playback works normally. After grace, the video is hard-deleted but annotations persist — playback should degrade gracefully (annotations/recap available; clear message if the video is gone), not error opaquely.
- Backend guard error shape: `HTTPException(status_code=410, detail="...")` (or 422); the frontend share flow should surface the detail. Block both `share_game` and `share_playback` for expired.
- No reactive persistence; these are gating + navigation/UI changes only.

## Implementation

### Steps
1. [ ] Frontend (ProjectManager GameCard): on the expired view, remove/disable the Share button (with a reason tooltip, e.g. "Storage expired - extend to share"); also gate the active-card hover Share if a game can be expired there.
2. [ ] Frontend: ensure the expired card offers a "Playback annotations" action that opens the annotation/recap playback even when `canExtend` (don't force the Extend modal); RecapPlayerModal handles a missing (post-grace) video gracefully.
3. [ ] Backend: add an expired guard to `share_game` and `share_playback` (compute is_expired from `game_storage.storage_expires_at`), returning a clear 410/422. Leave `get_game`/`get_recap_data` open.
4. [ ] Tests: backend - sharing an expired game is rejected (both endpoints); active game still shareable. Frontend - expired card hides/disables Share and exposes playback.

## Acceptance Criteria
- [ ] Sharing an expired game is blocked in the UI (Share hidden/disabled + reason) AND the backend (both share endpoints reject with a clear error).
- [ ] An expired game can still play back its annotations (and recap if present) from the UI.
- [ ] Active (non-expired) games are unchanged - shareable and playable as before.
- [ ] Recently-expired (in-grace) games play normally; post-grace (video deleted) degrades gracefully.
- [ ] Backend + frontend tests cover the share-blocked-when-expired behavior.
