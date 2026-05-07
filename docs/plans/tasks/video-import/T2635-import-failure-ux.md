# T2635: Import Failure UX

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-07
**Updated:** 2026-05-07

## Problem

When a game import fails (e.g., download stalls, Modal timeout, CDN error), the current behavior is broken:

1. **Broken game record persists** — The game may have been created in the DB before the failure (if ingest returned success but a later step failed), leaving a card in the games list that shows "Video failed to load" when opened.
2. **No failure notification** — The user sees the import progress UI get stuck or show a generic error, but after navigating away there's no indication of what happened.
3. **Credits silently lost** — Credits were deducted at step 2 but never refunded on failure (fixed in T2630 bugfix — `_run_import` now refunds on error). However, the refund amount is not communicated to the user.

## Solution

### Backend
- **No game record on failure** — Ensure `_create_game_record` is only called after ALL steps succeed (already the case in the current flow, but verify no partial-success paths exist).
- **Include refund amount in error status** — Add `credits_refunded` field to the import progress error payload so the frontend can display it.

### Frontend
- **Error toast on import failure** — When `importState.status === 'error'`, show a toast notification with:
  - Error message (e.g., "Import failed: download timed out")
  - Refund info (e.g., "3 credits have been refunded")
- **Don't navigate to a broken game** — The auto-navigate (`onCreateGame`) should only fire when `status === 'complete'` AND `game_id` is set (already guarded, but verify).
- **Clean error state** — Reset `importState` after showing the error toast so the form is ready for retry.
- **No ghost game cards** — If a game record somehow exists without a valid video, it should not appear in the games list (or show a clear "failed import" state).

## Context

### Relevant Files
- `src/backend/app/services/game_import.py` — Error handling in `_run_import`, progress dict fields
- `src/frontend/src/components/GameDetailsModal.jsx` — Import progress view, error state handling
- `src/frontend/src/components/ProjectManager.jsx` — `handleCreateGame`, toast notifications

### Related Tasks
- Depends on: T2630 credit refund bugfix (already applied)
- Part of: Video Link Import epic

## Acceptance Criteria

- [ ] Failed import shows a toast: "Import failed: {reason}. {N} credits refunded."
- [ ] No game card appears in the games list for a failed import
- [ ] Import form resets to ready state after dismissing error
- [ ] Auto-navigate only fires on genuine success (status=complete + valid game_id)
- [ ] Backend error payload includes `credits_refunded` field
