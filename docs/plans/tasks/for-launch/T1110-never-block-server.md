# T1110: Never Block Server on Export Processing

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

When Modal is enabled on staging, multi-clip framing exports run **synchronously** inside the request handler. A 3GB video download from R2 (6+ minutes) blocks the single Fly.io instance, making the entire backend unresponsive to all requests — health checks, auth, quest progress, everything.

This happened in production-like conditions: user clicked "Frame Video" on a multi-clip reel, the export started downloading source videos from R2 synchronously, and the server became unreachable for 6+ minutes. A hard refresh couldn't reconnect because the server couldn't accept new requests.

## Solution

All export processing must be non-blocking. The render endpoint should:

1. Insert the export job into the DB
2. Return 202 immediately (like the local/non-Modal path already does)
3. Process the export in a background task (asyncio.create_task or similar)
4. Report progress via WebSocket

The local (non-Modal) path at `framing.py:873` already does this correctly with `asyncio.create_task`. The Modal path at `framing.py:897` runs synchronously and must be converted.

Also applies to:
- `multi_clip.py` — the multi-clip export path that triggered this incident
- `overlay.py` — check if it has the same issue

## Context

### Relevant Files
- `src/backend/app/routers/export/framing.py` — Lines 871-895 (local 202 path) vs 897+ (blocking Modal path)
- `src/backend/app/routers/export/multi_clip.py` — Multi-clip export (blocked server for 6+ min)
- `src/backend/app/routers/export/overlay.py` — Check for same pattern

### Technical Notes
- Staging has `MODAL_ENABLED=true` and a single Fly.io instance
- The local path already uses `asyncio.create_task` correctly
- Modal calls are async (`await call_modal_framing_ai`) but they block the request handler
- WebSocket disconnect happened after 6s of the blocked request — the client had no way to reconnect
- Quest progress can't refresh during a blocked export, causing quest steps to appear stuck

## Acceptance Criteria

- [ ] All export endpoints return 202 immediately after creating the export job
- [ ] Export processing runs in background tasks, never blocking the request handler
- [ ] Server remains responsive to health checks and other requests during exports
- [ ] WebSocket progress updates continue working from background tasks
- [ ] Quest progress refreshes immediately when export job is created (not when export finishes)
