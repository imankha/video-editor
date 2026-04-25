# Epic: Export Pipeline Non-Blocking & DRY

**Status:** TODO
**Created:** 2026-04-24

## Goal

Make all export endpoints non-blocking and eliminate duplication between single-clip and multi-clip framing exports. Single-clip framing is just the N=1 case of multi-clip — they should share one code path.

## Why

The Fly.io server hangs during exports. Investigation revealed the Modal RPC calls themselves are properly async (`modal_client.py` uses `run_in_executor`), but the **surrounding I/O** — `subprocess.run(ffprobe)`, `download_from_r2()`, `ffmpeg.run()` — blocks the event loop for 4-120+ seconds. During these windows, health checks, WebSocket, and all other requests are unservable.

Separately, `framing.py` `render_project` and `multi_clip.py` `export_multi_clip` duplicate ~70% of their logic (credit reservation, progress reporting, player detection, DB saves). Single-clip framing artificially rejects >1 clip at `framing.py:801` instead of delegating to multi_clip.

## Sequencing

Fix blocking first (small, surgical), then unify (larger refactor on a stable async foundation).

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T1110 | [Non-Blocking Export I/O](T1110-never-block-server.md) | Wrap sync calls in `asyncio.to_thread()`. Small diff, immediate server-responsiveness win. |
| 2 | T1115 | [Unify Single/Multi-Clip Export](T1115-unify-single-multi-clip.md) | Collapse framing.py render into multi_clip pipeline. Depends on T1110 (both paths must be async before merging). |

## Shared Context

### The three export files

| File | Endpoint | Single/Multi | Local async? | Modal async? |
|------|----------|-------------|-------------|-------------|
| `framing.py` | `POST /render` | Single only | Yes (`asyncio.create_task`) | No (blocks on surrounding I/O) |
| `multi_clip.py` | `POST /multi-clip` | Multi (1-N) | No (both paths block) | No (blocks on surrounding I/O) |
| `overlay.py` | `POST /render-overlay` | Single only | Yes (`asyncio.create_task`) | No (blocks on surrounding I/O) |

### Blocking calls identified

All are `subprocess.run()` or synchronous network I/O inside `async def` handlers:

| Call | File | Line | Duration | Fix |
|------|------|------|----------|-----|
| `get_video_info(r2_url)` | framing.py | 932 | ~4s (R2 probe) | `await asyncio.to_thread(...)` |
| `download_from_r2()` | framing.py | 1035 | 5-15s | `await asyncio.to_thread(...)` |
| `get_video_duration()` | framing.py | 1039 | 0.5-2s | `await asyncio.to_thread(...)` |
| `ffmpeg.run()` (clip extract) | multi_clip.py | 1366-1370 | 2-10s | `await asyncio.to_thread(...)` |
| `download_from_r2()` | multi_clip.py | 1394, 1416 | 5-15s each | `await asyncio.to_thread(...)` |
| `upload_bytes_to_r2()` | multi_clip.py | 1489 | varies | `await asyncio.to_thread(...)` |
| `concatenate_clips_with_transition()` | multi_clip.py | 1830 | 30-120s | `await asyncio.to_thread(...)` |
| `get_video_duration()` | multi_clip.py | 1841 | 0.5-2s | `await asyncio.to_thread(...)` |

### What's already correct

- `modal_client.py` — All three `call_modal_*` functions use `loop.run_in_executor()`. Non-blocking.
- `local_processors.py` — Already wraps ffmpeg calls in `asyncio.to_thread()` (e.g., line 429).
- `framing.py` local path — Uses `asyncio.create_task(_run_local_framing_export(...))` + 202 return.
- `overlay.py` local path — Uses `asyncio.create_task(_run_local_overlay_export(...))` + 202 return.

## Completion Criteria

- [ ] Zero `subprocess.run()` calls execute on the event loop thread in any export endpoint
- [ ] Server responds to health checks during a multi-clip Modal export
- [ ] Single-clip framing export uses the multi-clip code path
- [ ] `framing.py` render_project is a thin adapter, not a parallel implementation
