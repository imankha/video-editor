# T2635 Kickoff Prompt: Import Failure UX

## Task

Implement T2635. Read the task file: `docs/plans/tasks/video-import/T2635-import-failure-ux.md`

This is part of the Video Link Import epic (`docs/plans/tasks/video-import/EPIC.md`). The prior task T2630 added the import UI and a credit refund bugfix. This task improves the failure UX so users see clear feedback when imports fail.

## What Needs to Change

### Backend: Add `credits_refunded` to error payload

**File:** `src/backend/app/services/game_import.py`

In `_run_import` (the except block around line 163-177), credits are already refunded on failure. But the refund amount is not included in the progress dict that gets broadcast to the frontend. The fix:

1. After the `refund_credits()` call succeeds, store the amount in the progress dict:
   ```python
   progress["credits_refunded"] = credits_charged
   ```

2. In `_broadcast_status` (around line 68-81), add `credits_refunded` to the dict that gets sent via WebSocket:
   ```python
   "credits_refunded": progress.get("credits_refunded", 0),
   ```

That's it for backend — the refund logic already works, we just need to pipe the amount to the frontend.

### Frontend: Error toast + form reset

**File:** `src/frontend/src/components/GameDetailsModal.jsx`

**Current error UI** (around line 467-508): When `importState.status === 'error'`, the modal shows an inline error with "Try Again" / "Upload File Instead" buttons. There's a special case for `error_code === 'INGEST_EXHAUSTED'` that shows a yellow warning.

Changes needed:

1. **Show a toast on error** — When `importState` transitions to `status === 'error'`, fire a toast:
   - If `credits_refunded > 0`: `"Import failed: {error}. {N} credits refunded."`
   - Otherwise: `"Import failed: {error}"`
   - Use the existing `toast` import from `'./shared'`

2. **Reset form for retry** — The "Try Again" button (around line 499) currently calls `setImportState(null)` and `setImportError('')`. Verify this fully resets the form to a pasteable state. The user should be able to paste a new URL and submit immediately.

3. **Verify auto-navigate guard** — The auto-navigate effect (around line 218-226) watches for `importState.status === 'complete' && importState.game_id`. Confirm this does NOT fire when status is `'error'` — even if `game_id` is somehow set (it shouldn't be, but belt-and-suspenders).

**File:** `src/frontend/src/components/ProjectManager.jsx`

The `handleCreateGame` callback (around line 394-403) receives `{ importComplete: true, gameId }` from the modal. No changes needed here unless the error toast should be shown at this level instead. Recommendation: keep the toast in `GameDetailsModal.jsx` since that's where `importState` lives.

### Verify: No ghost game cards

**File:** `src/backend/app/services/game_import.py`

Verify that `_create_game_record` is ONLY called after all steps succeed. Current flow:

- `_import_veo`: Lines 259-275 — `_create_game_record` is called after `video_refs` is fully populated. If `call_modal_ingest` fails, the function raises before reaching game creation.
- `_import_trace`: Lines 355-370 — Same pattern: `_create_game_record` only after all halves succeed.
- Single-video Veo path (lines 246-253): Early return with `ImportStatus.ERROR` if ingest fails, so game creation is never reached.

The flow looks correct — no game record is created on failure. But verify by reading the code to confirm no partial-success edge cases exist.

**File:** `src/backend/app/routers/games.py`

The `list_games` endpoint (around line 690) queries games with `status = 'ready'`. Imported games are inserted with `status = 'ready'` directly. There's no `status = 'failed'` path. Since game creation only happens on full success, ghost cards shouldn't appear. But consider: what if the ffprobe in `_create_game_record` fails? The game is still created with `status = 'ready'` but missing metadata. This isn't a ghost (the video IS in R2), it just has missing fps/duration — a degraded but valid state.

## Current State of Key Code

### Error broadcast fields (game_import.py `_broadcast_status`, ~line 68-81)

```python
async def _broadcast_status(import_id: str, progress: dict):
    await manager.send_progress(import_id, {
        "import_id": progress["import_id"],
        "status": progress["status"],
        "platform": progress["platform"],
        "progress_pct": progress["progress_pct"],
        "downloaded_bytes": progress["downloaded_bytes"],
        "total_bytes": progress["total_bytes"],
        "error": progress.get("error"),
        "error_code": progress.get("error_code"),
        "game_id": progress.get("game_id"),
        "message": progress.get("message", ""),
    })
```

Note: `credits_refunded` is NOT currently included — must be added.

### Error except block (game_import.py `_run_import`, ~line 163-177)

```python
except (VeoImportError, TraceImportError, Exception) as e:
    logger.error(f"[game_import] Import {import_id} failed: {e}")
    progress["status"] = ImportStatus.ERROR
    progress["error"] = str(e)

    credits_charged = progress.get("_credits_charged", 0)
    if credits_charged > 0:
        try:
            from app.services.user_db import refund_credits
            refund_credits(user_id, credits_charged, reference_id=import_id, source="import_refund")
            logger.info(f"[game_import] Refunded {credits_charged} credits for failed import {import_id}")
        except Exception as refund_err:
            logger.error(f"[game_import] Failed to refund {credits_charged} credits: {refund_err}")

    await _broadcast_status(import_id, progress)
```

Note: After `refund_credits` succeeds, `progress["credits_refunded"]` should be set before `_broadcast_status`.

### Frontend error display (GameDetailsModal.jsx, ~line 467-508)

The error section shows inline within the modal. Two cases:
- `INGEST_EXHAUSTED`: Yellow warning, suggests trying later
- Generic error: Red alert, shows error message, offers retry or upload fallback

The "Try Again" button does:
```jsx
onClick={() => { setImportState(null); setImportError(''); }}
```

This clears the import state but doesn't call `resetForm()`. The URL fields retain their values, which is actually good — the user can just hit submit again.

### Auto-navigate effect (GameDetailsModal.jsx, ~line 218-226)

```jsx
useEffect(() => {
    if (importState?.status === 'complete' && importState?.game_id && !navigatedRef.current) {
        navigatedRef.current = true;
        const gameId = importState.game_id;
        const timer = setTimeout(() => {
            onCreateGame({ importComplete: true, gameId });
        }, 1500);
        return () => clearTimeout(timer);
    }
}, [importState, onCreateGame]);
```

This is already correctly guarded — only fires on `complete` + valid `game_id`.

## Implementation Checklist

1. **Backend** (~5 lines):
   - Add `progress["credits_refunded"] = credits_charged` after successful refund in `_run_import`
   - Add `"credits_refunded": progress.get("credits_refunded", 0)` to `_broadcast_status`

2. **Frontend** (~10 lines):
   - Add a `useEffect` that watches for `importState.status === 'error'` and fires a toast with error + refund info
   - Verify "Try Again" button resets to a usable state
   - Verify auto-navigate doesn't fire on error

3. **Verification** (~0 lines, just reading):
   - Confirm no ghost game cards can be created
   - Confirm `_create_game_record` is unreachable on failure

## Classification

```
**Stack Layers:** Frontend, Backend
**Files Affected:** ~2 files
**LOC Estimate:** ~15 lines
**Test Scope:** None (UX behavior, manual testing)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Small scope, files already documented |
| Architect | No | No design decisions, straightforward plumbing |
| Tester | No | UX behavior, manual testing only |
| Reviewer | No | <20 LOC change |
```

## Acceptance Criteria

- [ ] Failed import shows a toast: "Import failed: {reason}. {N} credits refunded."
- [ ] No game card appears in the games list for a failed import
- [ ] Import form resets to ready state after dismissing error
- [ ] Auto-navigate only fires on genuine success (status=complete + valid game_id)
- [ ] Backend error payload includes `credits_refunded` field
