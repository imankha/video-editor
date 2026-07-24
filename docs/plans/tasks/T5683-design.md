# T5683: Poster Warming — Minimize Time-to-First-Poster

## Current State

Users see a multi-second pop-in delay (blank tile → image) when opening My Reels, games tab, or downloads gallery. The issue: poster JPEGs are only generated **on-demand** via GET requests, requiring 5+ ffmpeg seeks + R2 uploads (~1-2s per poster).

**Current poster types:**
- **Draft posters** (`posters/drafts/{project_id}.jpg`): cached thumbnail for unpublished reels
- **Reel card posters** (`final_videos/posters/{basename}.card.jpg`): resized og:image for My Reels tiles
- **Recap posters** (`recaps/posters/{game_id}.jpg`): whole-clip frame for game/teammate shares
- **Game source posters** (`recaps/posters/{game_id}.card.jpg`): live-source frame for active games

All are **generate-on-first-request** today — no warming, no dedup, no list-time batching.

## Target State

Three non-blocking warming mechanisms:

### 1. WARM-AT-GESTURE (Epic Decision #1)

Generate posters **inside** the gestures that create/change artifacts. Best-effort, never fail parent op, NOT reactive.

**Warmed at:**
- **Draft creation**: `add_clip_to_project`, `upload_clip_with_metadata`, `reorder_clips`, `remove_clip_from_project` → warm draft poster `ensure_draft_poster(project_id)` async
- **Draft materialization**: publish → warm reel poster + card poster via `generate_poster_at_publish` (already exists)
- **Recap-ready**: `share_game`, `share_playback`, `share_with_teammates` → warm recap poster via `warm_recap_poster` (already exists)
- **Upload-complete**: `POST /api/games/finalize` → warm game source poster `ensure_game_source_poster(user_id, profile_id, game_id)` async
- **Override on clip change**: `invalidate_draft_poster` already calls `delete_from_r2` → warming on next READ or next gesture (not reactive)

**Architecture:**
```python
# Each gesture handler wraps warming in try/except, NEVER fails parent:
async def add_clip_to_project(...):
    # ... existing logic: insert clip, return response ...
    asyncio.create_task(_warm_poster_background(user_id, profile_id, project_id))
    return response

async def _warm_poster_background(user_id: str, profile_id: str, project_id: int):
    """Fire-and-forget: no await, no failure propagation."""
    try:
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        await asyncio.to_thread(ensure_draft_poster, project_id, user_id)
        logger.info(f"[PosterWarm] draft project={project_id} warmed at gesture")
    except Exception as e:
        logger.info(f"[PosterWarm] draft project={project_id} gesture-warm failed (best effort): {e}")
```

### 2. LIST-TIME WARMING (Bounded Concurrency + Cache Skip)

When LIST endpoints are hit (`GET /api/projects`, `GET /api/games`, `GET /api/downloads`), warm missing posters for the VISIBLE items (batch of 6-10 per page).

**Constraints:**
- **Bounded**: max 3-4 ffmpeg processes in flight (global or per-request)
- **Single-HEAD skip**: if poster already cached (`file_exists_in_r2`), skip ffmpeg
- **Cache warming only**: no data writes, no DB changes
- **Per-endpoint list batch**: warm only the items being returned, not the whole collection

**Architecture:**
```python
async def list_projects(...):
    projects = [... fetch from DB ...]
    # Start warming visible posters in background
    asyncio.create_task(_warm_posters_for_projects(user_id, profile_id, projects))
    return {"projects": projects}

async def _warm_posters_for_projects(
    user_id: str, profile_id: str, projects: list
):
    """Warm posters for the visible LIST batch, bounded concurrency."""
    poster_warmer = get_poster_warmer()  # singleton per app
    tasks = [
        poster_warmer.warm_draft_poster_async(user_id, profile_id, p["id"])
        for p in projects
        if p.get("id")
    ]
    # Run up to 3-4 in parallel, others queue
    await asyncio.gather(*tasks, return_exceptions=True)
```

### 3. IN-FLIGHT DEDUP (Per-Key Async Lock)

Concurrent requests for the same missing poster must not both run ffmpeg. Per-key async lock prevents duplicate work.

**Current problem:**
- User opens My Reels (6 reels visible) → 6 GET tile requests arrive concurrently
- Each hits the `/poster.jpg` endpoint → `ensure_reel_card_poster` runs for the same poster 6× in parallel
- 6 ffmpeg processes extract the same frame, 6 uploads to R2

**Solution:**
```python
# services/poster_warmer.py (new module)
class PosterWarmer:
    def __init__(self):
        self._locks = {}  # key -> asyncio.Lock
        self._warming = {}  # key -> asyncio.Task

    async def warm_draft_poster_async(
        self, user_id: str, profile_id: str, project_id: int
    ) -> str | None:
        """Async wrapper with in-flight dedup."""
        key = f"draft:{profile_id}:{project_id}"
        
        # If another coroutine is already warming this key, await its result
        if key in self._warming:
            task = self._warming[key]
            try:
                return await task
            except:
                # If the task failed, fall through to retry
                pass
        
        # Acquire per-key lock for this warming run
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        
        async with self._locks[key]:
            # Double-check: maybe another coroutine finished while we waited
            if file_exists_in_r2(user_id, draft_poster_rel_path(project_id)):
                logger.info(f"[PosterWarm] draft {key} already exists (dedup)")
                return draft_poster_rel_path(project_id)
            
            # Run the blocking extraction/upload on a thread
            def do_warm():
                set_current_user_id(user_id)
                set_current_profile_id(profile_id)
                return ensure_draft_poster(project_id, user_id)
            
            result = await asyncio.to_thread(do_warm)
            logger.info(f"[PosterWarm] draft {key} -> {result}")
            return result
    
    async def warm_with_semaphore(self, coro, max_concurrent=3):
        """Wrapper for bounded concurrency across LIST requests."""
        if not hasattr(self, '_semaphore'):
            self._semaphore = asyncio.Semaphore(max_concurrent)
        async with self._semaphore:
            return await coro

# Module-level singleton
_poster_warmer = PosterWarmer()

def get_poster_warmer() -> PosterWarmer:
    return _poster_warmer
```

## Implementation Plan

### Phase 1: In-Flight Dedup Service (Lowest Risk)
1. Create `services/poster_warmer.py` with `PosterWarmer` class
2. Add per-key async locks + in-flight task caching
3. Wrap `ensure_draft_poster`, `ensure_game_source_poster`, `ensure_reel_card_poster` in async methods
4. Tests: `test_t5683_dedup_concurrent_gets.py` (same poster key, concurrent requests)

### Phase 2: WARM-AT-GESTURE (Gesture Handlers)
1. Modify clips.py gesture handlers (`add_clip_to_project`, `upload_clip_with_metadata`, `reorder_clips`, `remove_clip_from_project`) to call `asyncio.create_task(_warm_poster_background(...))`
2. Modify games.py upload finalize to warm game source poster
3. Error handling: all failures logged at info, never propagate
4. Tests: `test_t5683_warm_at_gesture.py` (gesture fires warming, parent succeeds even if warming fails)

### Phase 3: LIST-TIME WARMING (Bounded Concurrency)
1. Add `_warm_posters_for_projects`, `_warm_posters_for_games`, `_warm_posters_for_downloads` helpers
2. Call from `list_projects`, `list_games_metadata`, `list_downloads`
3. Use `poster_warmer.warm_with_semaphore()` for max 3-4 in flight
4. Tests: `test_t5683_list_time_warming.py` (LIST endpoint warms visible items with semaphore)

## Invariants & Rules

1. **Gesture warming NEVER fails parent**: all exceptions caught, logged at info, never re-raised
2. **Reactive warming is banned**: no `useEffect`-style watchers, only explicit gestures
3. **Cache-first LIST warming**: skip ffmpeg if `file_exists_in_r2` (single HEAD, not multiple)
4. **Per-key dedup**: concurrent requests for the same poster key wait on the same task, not duplicate
5. **Bounded concurrency**: max 3-4 ffmpeg processes per request/globally (configurable `MAX_POSTER_CONCURRENT`)
6. **Best-effort all the way**: warmer service never raises, failures logged at info
7. **Idempotent**: warming the same poster multiple times is safe (R2 overwrite-safe keys, no DB writes)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Semaphore starvation: LIST batches starve gesture warming | Gesture tasks use a separate high-priority semaphore, or semaphore per endpoint |
| Memory leak: per-key locks accumulate forever | Cleanup task: evict locks older than 5 minutes of no activity |
| FFmpeg process leak if extraction hangs | subprocess timeout already 30-60s in `extract_first_frame_jpeg` / `extract_clearest_frame_jpeg` |
| R2 rate limiting under heavy concurrent uploads | Backed off by bounded semaphore; monitor 429s / `upload_bytes_to_r2` failures |

## Test Plan

| Test | Mechanism | Coverage |
|------|-----------|----------|
| `test_t5683_dedup_concurrent_gets` | In-flight dedup | 10 concurrent GETs same key → 1 ffmpeg run |
| `test_t5683_warm_at_gesture_swallows_failure` | WARM-AT-GESTURE | Gesture succeeds when warming fails |
| `test_t5683_list_warm_bounded_concurrency` | LIST-TIME WARMING | LIST warms 6 items with max 3 in flight |
| `test_t5683_list_warm_cache_skips_ffmpeg` | LIST-TIME WARMING | Cached poster → no ffmpeg on LIST |

## Measurement Plan (Live Stack)

Baseline on staging + prod with fresh profile:
1. **Before**: Time `GET /api/projects` → all 6 draft tile posters cached → measure TTFB of each GET `/api/projects/{id}/poster.jpg`
2. **After gesture warming**: Create 6 clips via `add_clip_to_project` → background warming should populate cache → repeat measurement
3. **After LIST warming**: `GET /api/projects` should warm visible batch → next LIST call should have cache hits

**Success criteria**: fresh-profile LIST call completes first tile-image load 50%+ faster (poster JPEG present before user scrolls).

## Staging/Prod Checklist

- [ ] Code review + approval (must scrutinize concurrency patterns)
- [ ] Performance tests on real hardware (container vs. live Fly)
- [ ] Monitor poster-warmer logs for errors/timeouts (first week)
- [ ] Check R2 429 errors in the week post-deploy
- [ ] Verify gesture warnings don't slow down clip actions (<50ms overhead)
