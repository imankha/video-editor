# T2640: Local Processing Subprocess Isolation

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-05-07
**Updated:** 2026-05-07

## Problem

When `MODAL_ENABLED=false`, all local processing (`local_ingest`, `local_framing`, etc. in `local_processors.py`) runs on the FastAPI event loop. Even though these functions use `asyncio.to_thread()` for CPU-bound work, the httpx async download streams and progress callbacks still occupy the event loop. During a 1.4GB Veo import, the progress polling endpoint (`GET /api/games/imports/{id}/progress` — a simple dict lookup) took **7 seconds** to respond because the event loop was saturated processing download chunks.

This makes local dev testing of import/export flows unusable — the UI appears frozen because API responses are blocked behind the processing work.

**Workaround:** Set `MODAL_ENABLED=true` to offload processing to Modal (production path). This is acceptable for now but means local-only development requires a Modal account.

## Solution

Run local processor functions in a **separate process** so the FastAPI event loop stays responsive. Options:

1. **Subprocess with IPC** — Spawn a child process for each local job, communicate progress via pipes/queue
2. **Multiprocessing pool** — Pre-fork worker processes, submit jobs via `ProcessPoolExecutor`
3. **Separate worker process** — Long-running sidecar process (like Celery without the broker) that accepts jobs via localhost HTTP or Unix socket

Option 2 (ProcessPoolExecutor) is likely simplest — `asyncio.get_running_loop().run_in_executor(process_pool, fn)` is a drop-in replacement for thread-based execution. The challenge is forwarding async progress callbacks across process boundaries.

## Context

### Relevant Files
- `src/backend/app/services/local_processors.py` — All local fallback functions (local_ingest, local_framing, local_overlay)
- `src/backend/app/services/modal_client.py` — Dispatches to local_processors when MODAL_ENABLED=false
- `src/backend/app/services/game_import.py` — Import pipeline that calls call_modal_ingest

### Related Tasks
- Discovered during: T2630 (Add Game Import UI)
- Related: T2625 (Modal Video Ingest)

### Technical Notes
- `local_ingest` for direct downloads uses `httpx.AsyncClient` with `aiter_bytes` — this is async but still runs on the event loop
- Progress callbacks are `async def` — need to bridge across process boundary
- `asyncio.to_thread` only moves to a thread, not a separate process — the GIL and event loop are still shared
- The default `ThreadPoolExecutor` has limited workers; if all are occupied by blocking Modal generator calls, other async tasks queue behind them

## Acceptance Criteria

- [ ] `GET /api/games/imports/{id}/progress` responds in <100ms while local_ingest is downloading
- [ ] Progress updates still flow to the frontend during local processing
- [ ] All existing local processor tests pass
- [ ] No change to the Modal-enabled code path
