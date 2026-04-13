# T1152: Persist Sync-Failed State Across Restarts

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Problem

`_sync_failed: dict[str, bool]` in [src/backend/app/middleware/db_sync.py:64](src/backend/app/middleware/db_sync.py#L64) is in-memory. On backend restart every user's degraded flag resets to False — even if their `.sync_pending` marker still exists on disk.

Consequence: the `X-Sync-Status` header reports "ok" after a restart until the next sync attempt, so the frontend's degraded-state warning disappears and the user thinks their data is safe when it isn't.

## Solution

Treat `.sync_pending` presence as the source of truth. Remove the separate `_sync_failed` dict (or make it a pure cache derived from the marker file).

```python
def is_sync_failed(user_id: str) -> bool:
    return has_sync_pending(user_id)
```

Drop the `set_sync_failed(user_id, True)` calls (redundant with `mark_sync_pending`). Keep `set_sync_failed(user_id, False)` only as a thin wrapper around `clear_sync_pending` — or just inline the clear.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py:64-82` — `_sync_failed` dict, `is_sync_failed`, `set_sync_failed`
- `src/backend/app/middleware/db_sync.py:282-295` — places that call `set_sync_failed`
- `src/backend/tests/test_sync_status.py` — existing tests on the flag's behavior

### Related Tasks
- Related: T1150 (retry mechanism), T1151 (background worker — should also use marker as truth)

### Technical Notes
- `mark_sync_pending` already writes the marker before the sync attempt. `_sync_failed=True` is always set immediately after a failed sync, by which time the marker exists. So the dict never holds information the marker doesn't.
- Conflict case: T950 distinguishes "conflict" from "failed" in the header. If we collapse to marker-based, we lose that distinction across restarts. Acceptable — conflict is transient and re-detected on next sync. Alternative: marker file content (currently a timestamp) could encode status.
- Fly.io volumes: markers live on local disk (same volume that holds SQLite). A volume loss takes both together, so marker truth is consistent with what's actually at risk.

## Acceptance Criteria

- [ ] `is_sync_failed(user_id)` returns True iff `.sync_pending` marker exists
- [ ] No separate in-memory dict tracking sync failure
- [ ] `X-Sync-Status: failed` header still sent when marker exists
- [ ] Restart test: create marker, restart backend, next request still reports degraded
- [ ] Existing `test_sync_status.py` tests still pass (adapt if needed)
