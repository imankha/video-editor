# T2650: Move Sweep Auto-Export to Modal

**Status:** TODO
**Impact:** 7 | **Complexity:** 4 | **Priority:** 1.8
**Stack Layers:** Backend, Modal
**Migration:** [ ]

## Problem

The background sweep (`sweep_scheduler.py`) runs FFmpeg encoding, recap video generation, and R2 uploads directly on the Fly.io server via `asyncio.to_thread`. This violates the architecture principle that the server handles only fast operations and delegates long-running compute to Modal.

Concrete issues:
- **CPU/memory contention**: FFmpeg encoding competes with API request serving on a single Fly.io machine
- **Keepalive hack**: Needs a localhost health pinger to prevent Fly.io from auto-suspending during long sweeps — a clear signal the work doesn't belong here
- **Unbounded duration**: If multiple games expire at once, the sweep can run for minutes/hours with no timeout on the overall operation
- **No parallelism**: Games are exported sequentially; Modal could process them in parallel

## Current Architecture

```
Fly.io server (sweep_scheduler.py)
  └─ do_sweep() [blocking, via asyncio.to_thread]
       ├─ Phase 1: For each expired ref
       │    ├─ _find_games_for_hash() — DB queries (fast, fine here)
       │    ├─ auto_export_game() — FFmpeg + R2 upload (SLOW, move this)
       │    ├─ delete_ref() — DB write (fast)
       │    └─ insert_grace_deletion() — DB write (fast)
       └─ Phase 2: For each grace-expired hash
            ├─ r2_delete_object_global() — single R2 DELETE (fast)
            └─ delete_grace_deletion() — DB write (fast)
```

## Target Architecture

```
Fly.io server (sweep_scheduler.py)
  └─ do_sweep() [lightweight orchestrator]
       ├─ Phase 1: For each expired ref
       │    ├─ _find_games_for_hash() — DB queries (stays on server)
       │    ├─ call_modal_auto_export(user_id, profile_id, game_id) — Modal call
       │    │    └─ Modal: FFmpeg + recap + R2 upload (MOVED)
       │    ├─ delete_ref() — DB write (stays on server)
       │    └─ insert_grace_deletion() — DB write (stays on server)
       └─ Phase 2: unchanged (R2 DELETEs are fast)
```

## Implementation Plan

### 1. Create Modal auto-export function

New Modal function (in `app/modal_functions/video_processing.py` or new file) that:
- Accepts: `user_id`, `profile_id`, `game_id`
- Does everything `auto_export_game()` currently does: find brilliant clips, FFmpeg extract, generate recap, upload results to R2
- Returns: export status (success/skipped/failed)
- Needs access to: user's profile DB (download from R2), R2 credentials, presigned URLs for source video

### 2. Create `call_modal_auto_export()` wrapper

In `modal_client.py`, add a wrapper following the existing pattern (`call_modal_framing_ai`, `call_modal_ingest`):
- Async function that calls the Modal function
- Handles Modal errors, timeouts
- Falls back gracefully if Modal is unavailable (log error, mark game as failed, sweep continues)

### 3. Refactor `do_sweep()` Phase 1

- Replace `auto_export_game(user_id, profile_id, game_id)` with `await call_modal_auto_export(...)`
- Since `do_sweep` currently runs in `asyncio.to_thread`, need to restructure: make the sweep loop async so it can await Modal calls
- Remove the keepalive pinger (no longer needed — sweep is fast)
- Consider parallelizing Modal calls for multiple games (gather with concurrency limit)

### 4. Handle DB sync

The tricky part: `auto_export_game` currently writes to the user's profile DB directly (creates export records, updates `auto_export_status`). On Modal, it won't have direct DB access.

Options:
- **A) Modal writes results to R2, server applies to DB**: Modal does FFmpeg + upload, returns metadata. Server updates DB. Simpler, keeps DB writes on server.
- **B) Modal downloads profile DB, modifies, re-uploads**: Follows existing Modal pattern but risks conflicts if user is active.

Option A is strongly preferred — keeps all DB writes on the server where they belong.

### 5. Remove keepalive pinger

Delete `_ping_health()` and the keepalive task creation in `_run_sweep_loop()`. The sweep will complete in seconds (just DB queries + Modal RPC calls), not minutes.

## Risks

- **Modal cold start**: First auto-export after idle period may take 30-60s to start. Acceptable since sweep is not user-facing.
- **Modal downtime**: Need fallback behavior — mark games as `export_failed` and retry next sweep cycle.
- **DB state**: Must ensure `auto_export_status` is set to `pending` before Modal call and updated after, to prevent duplicate exports on crash.

## Files Affected

- `src/backend/app/services/sweep_scheduler.py` — refactor to async, call Modal
- `src/backend/app/services/auto_export.py` — extract FFmpeg logic into Modal-callable form
- `src/backend/app/services/modal_client.py` — add `call_modal_auto_export()`
- `src/backend/app/modal_functions/video_processing.py` — new Modal function
- `src/backend/tests/test_sweep_scheduler.py` — update tests

## Related

- T1583 (Auto-Export Pipeline) — original implementation
- T2450 (Presigned URL for FFmpeg) — same pattern of avoiding full video download
- T2625 (Modal Video Ingest) — recent Modal integration, good pattern to follow
- Auto-Export Reliability epic (T2450-T2470) — prior fixes to this system
