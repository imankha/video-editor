# Auto-Export Reliability Epic Kickoff

Implement the Auto-Export Reliability epic (T2460, T2450, T2470).

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the epic: `docs/plans/tasks/auto-export-reliability/EPIC.md`

## Classification

**Stack Layers:** Backend
**Files Affected:** ~3 files
**LOC Estimate:** ~40-60 lines across all three tasks
**Test Scope:** Backend (manual staging verification)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | All code paths already identified with exact line numbers |
| Architect | No | Pattern already proven in T1220; no new architecture |
| Tester | No | Manual staging test (set expiry, restart, verify completion) |
| Reviewer | No | Small, well-scoped changes |

## Design is APPROVED -- Skip to Implementation

## Epic Context

Auto-export generates brilliant clips + recap videos when a game's storage expires. It currently fails 100% of the time on Fly.io because:

1. It downloads the entire 3GB game video to extract a few seconds of clips
2. Fly.io auto-suspends the machine mid-download (no HTTP traffic = looks idle)
3. The `pending` status prevents retry after restart (deadlock)

All three root causes were discovered on 2026-05-04 during live testing on staging.

## Implementation Order

### Task 1: T2460 — Pending Status Recovery (Impact 8, Complexity 1)

**Problem:** `auto_export_game()` at `auto_export.py:47-48` skips games with `auto_export_status` of `pending` or `complete`. If the machine dies mid-export, the game stays `pending` forever.

**Fix (choose one, the simpler option is preferred):**

Option A — Change the guard at line 47 to only skip `complete`, not `pending`:
```python
# Before:
if game['auto_export_status'] in ('complete', 'pending'):
    return game['auto_export_status']

# After:
if game['auto_export_status'] == 'complete':
    return 'complete'
```
This is safe because `do_sweep()` is single-threaded — concurrent re-entry can't happen.

Option B — Reset `pending` to `NULL` on startup in `start_sweep_loop()`. More defensive but more code.

**File:** `src/backend/app/services/auto_export.py:47-48`

Add a log line when retrying a previously-pending export so it's visible:
```python
if game['auto_export_status'] == 'pending':
    logger.info(f"[AutoExport] Retrying previously pending game {game_id}")
```

### Task 2: T2450 — Presigned URL for FFmpeg (Impact 7, Complexity 3)

**Problem:** `_export_brilliant_clip` (line 141) and `_generate_recap` (line 200) both call `download_from_r2_global()` to download the full game video before running FFmpeg.

**Fix:** Replace `download_from_r2_global` with `generate_presigned_url_global` and pass the URL directly to `ffmpeg.input()`.

**Prior art — T1220 (Modal Range Requests)** already solved this exact pattern for Modal GPU processing. Apply the same approach.

**Key function:** `generate_presigned_url_global(key, expires_in=14400)` at `storage.py:1795` generates presigned R2 URLs with a 4-hour default TTL.

**For `_export_brilliant_clip` (stream copy):**
```python
# Before (line 139-148):
with tempfile.TemporaryDirectory() as temp_dir:
    source_path = Path(temp_dir) / "source.mp4"
    if not download_from_r2_global(f"games/{video_hash}.mp4", source_path):
        raise RuntimeError(f"Failed to download game video {video_hash}")
    output_path = Path(temp_dir) / "extracted.mp4"
    ffmpeg.input(str(source_path), ss=start_time, to=end_time)
        .output(str(output_path), c="copy", movflags="+faststart")
        .run(quiet=True, overwrite_output=True)

# After:
from ..storage import generate_presigned_url_global
video_url = generate_presigned_url_global(f"games/{video_hash}.mp4")
if not video_url:
    raise RuntimeError(f"Failed to generate presigned URL for {video_hash}")
with tempfile.TemporaryDirectory() as temp_dir:
    output_path = Path(temp_dir) / "extracted.mp4"
    ffmpeg.input(video_url, ss=start_time, to=end_time)
        .output(str(output_path), c="copy", movflags="+faststart")
        .run(quiet=True, overwrite_output=True)
```

**Critical:** `-ss` must be BEFORE `-i` (pre-input seek). The `ffmpeg.input(url, ss=...)` syntax places it correctly — FFmpeg seeks via byte offset on HTTP sources instead of decoding from the start.

**For `_generate_recap` (480p re-encode):**
Same pattern per video hash — generate presigned URL, pass to each `ffmpeg.input()` call. The `clips_by_hash` grouping still works; just replace the download + local path with a URL.

```python
# Before (line 198-206):
for video_hash, hash_clips in clips_by_hash.items():
    source_path = Path(temp_dir) / f"source_{video_hash[:12]}.mp4"
    if not download_from_r2_global(f"games/{video_hash}.mp4", source_path):
        ...

# After:
for video_hash, hash_clips in clips_by_hash.items():
    video_url = generate_presigned_url_global(f"games/{video_hash}.mp4")
    if not video_url:
        logger.error(f"[AutoExport] Failed to get URL for {video_hash}")
        continue
    for clip in hash_clips:
        ffmpeg.input(video_url, ss=clip['start_time'], to=clip['end_time'])
            ...
```

**Update imports:** Remove `download_from_r2_global` from the import at line 20, add `generate_presigned_url_global`.

### Task 3: T2470 — Sweep Keepalive (Impact 5, Complexity 2)

**Problem:** Fly.io auto-suspends the machine during background sweep work because there's no incoming HTTP traffic.

**Fix:** In `_run_sweep_loop()` at `sweep_scheduler.py:58`, wrap the `do_sweep()` call with a concurrent keepalive that pings `localhost:8000/api/health` every 30 seconds.

```python
async def _run_sweep_loop():
    await asyncio.sleep(STARTUP_DELAY)
    while True:
        try:
            # Keepalive prevents Fly.io auto-suspend during active sweep
            keepalive = asyncio.create_task(_ping_health())
            try:
                await asyncio.to_thread(do_sweep)
            finally:
                keepalive.cancel()
            ...

async def _ping_health():
    """Ping localhost health to prevent Fly.io auto-suspend."""
    import urllib.request
    while True:
        try:
            urllib.request.urlopen("http://localhost:8000/api/health", timeout=5)
        except Exception:
            pass
        await asyncio.sleep(30)
```

Use `urllib.request` (already imported in the project) instead of `aiohttp` to avoid a new dependency. The async sleep between pings yields to the event loop.

**File:** `src/backend/app/services/sweep_scheduler.py`

## Verification

After all three tasks:
1. Set a game's `storage_expires_at` to the past (use the staging R2 update script pattern from this conversation)
2. Restart the staging machine
3. Verify the sweep completes in under 60 seconds (check `auto_export_status` via API)
4. Verify brilliant clips appear in My Reels
5. Verify recap video plays from the expired game card

## Critical Gotchas

1. **`-ss` before `-i`** — FFmpeg's `ss` parameter must be a pre-input option for HTTP sources. `ffmpeg.input(url, ss=...)` handles this correctly. Do NOT use `.filter('trim', ...)` which would download-then-seek.

2. **Presigned URL TTL** — The default is 4 hours, which is generous enough for even the longest recap generation. No change needed.

3. **`do_sweep()` is single-threaded** — It runs via `asyncio.to_thread(do_sweep)`, so only one sweep runs at a time. This makes the `pending` guard simplification (Option A) safe.

4. **The sweep deletes the `game_storage_ref` after auto-export** — Line 121 in `sweep_scheduler.py`. This means the game won't appear in future sweeps regardless of export outcome. The `auto_export_status` on the game itself is what prevents duplicate work.

5. **Run backend import check after changes:**
   ```bash
   cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
   ```

6. **Commit each task separately** with descriptive messages. Branch: `feature/T2450-auto-export-reliability`
