"""Poster warming service with in-flight dedup and bounded concurrency (T5683).

Minimizes time-to-first-poster by:
1. Warming posters at-gesture (draft creation/changes, publish, game upload)
2. Warming posters in LIST endpoint batches (max 3-4 in flight)
3. Deduplicating concurrent requests for the same poster (per-key lock + task cache)

All warming is best-effort: failures never propagate to parent operations.
"""

import asyncio
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

MAX_POSTER_CONCURRENT = 3  # Max ffmpeg processes in flight per LIST batch


class PosterWarmer:
    """In-flight dedup + bounded concurrency for poster generation.

    Concurrent requests for the same poster key wait on the same ffmpeg task,
    not duplicate. LIST endpoints warm up to 3-4 posters in parallel.
    """

    def __init__(self):
        self._locks = {}  # key -> asyncio.Lock per poster
        self._warming_tasks = {}  # key -> Task[str | None] (currently in-flight)
        self._last_access = {}  # key -> datetime (for cleanup)
        self._semaphore = asyncio.Semaphore(MAX_POSTER_CONCURRENT)

    def _cleanup_old_locks(self) -> None:
        """Evict locks untouched for >5 minutes (prevent memory leak)."""
        now = datetime.now()
        timeout = timedelta(minutes=5)
        stale_keys = [
            k for k, t in self._last_access.items()
            if (now - t) > timeout
        ]
        for k in stale_keys:
            self._locks.pop(k, None)
            self._last_access.pop(k, None)
            # In-flight tasks are NOT evicted; let them finish
            logger.debug(f"[PosterWarm] evicted stale lock for {k}")

    async def warm_draft_poster_async(
        self, user_id: str, profile_id: str, project_id: int
    ) -> str | None:
        """Warm a draft poster with in-flight dedup.

        Returns the poster rel_path on success, None on failure (best-effort).
        Concurrent calls for the same project_id await the same task.
        """
        from .poster import draft_poster_rel_path, ensure_draft_poster
        from ..profile_context import set_current_profile_id
        from ..user_context import set_current_user_id
        from ..storage import file_exists_in_r2

        key = f"draft:{profile_id}:{project_id}"
        self._last_access[key] = datetime.now()

        # If another task is already warming this poster, await its result.
        if key in self._warming_tasks:
            try:
                result = await self._warming_tasks[key]
                if result:
                    logger.info(f"[PosterWarm] draft {key} cache hit (dedup)")
                    return result
            except asyncio.CancelledError:
                pass  # Fall through to retry
            except Exception:
                pass  # Fall through to retry

        # Acquire per-key lock (one at a time per poster, but many in parallel).
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()

        async with self._locks[key]:
            # Double-check: maybe another task finished while we waited.
            rel_path = draft_poster_rel_path(project_id)
            if file_exists_in_r2(user_id, rel_path):
                logger.info(f"[PosterWarm] draft {key} already exists (dedup double-check)")
                return rel_path

            # Run blocking work on a thread pool.
            async def do_warm():
                try:
                    set_current_user_id(user_id)
                    set_current_profile_id(profile_id)
                    result = await asyncio.to_thread(
                        ensure_draft_poster, project_id, user_id
                    )
                    if result:
                        logger.info(f"[PosterWarm] draft {key} warmed -> {result}")
                    else:
                        logger.info(f"[PosterWarm] draft {key} generation returned None")
                    return result
                except Exception as e:
                    logger.info(f"[PosterWarm] draft {key} warming failed: {e}")
                    return None

            # Cache the task so concurrent requests await it.
            task = asyncio.create_task(do_warm())
            self._warming_tasks[key] = task
            try:
                result = await task
                return result
            finally:
                self._warming_tasks.pop(key, None)

    async def warm_game_source_poster_async(
        self, user_id: str, profile_id: str, game_id: int
    ) -> bool:
        """Warm a game source poster (live video, no recap) with in-flight dedup.

        Returns True when poster exists (cached or freshly generated), False on failure.
        """
        from .poster import ensure_game_source_poster
        from ..profile_context import set_current_profile_id
        from ..user_context import set_current_user_id
        from ..storage import r2_head_object_global
        from .poster import recap_card_poster_r2_key

        key = f"game_source:{profile_id}:{game_id}"
        self._last_access[key] = datetime.now()

        # In-flight dedup.
        if key in self._warming_tasks:
            try:
                result = await self._warming_tasks[key]
                if result:
                    logger.info(f"[PosterWarm] game_source {key} cache hit (dedup)")
                    return True
            except:
                pass

        if key not in self._locks:
            self._locks[key] = asyncio.Lock()

        async with self._locks[key]:
            # Double-check.
            poster_key = recap_card_poster_r2_key(user_id, profile_id, game_id)
            if r2_head_object_global(poster_key) is not None:
                logger.info(f"[PosterWarm] game_source {key} already exists (dedup double-check)")
                return True

            async def do_warm():
                try:
                    set_current_user_id(user_id)
                    set_current_profile_id(profile_id)
                    result = await asyncio.to_thread(
                        ensure_game_source_poster, user_id, profile_id, game_id
                    )
                    if result:
                        logger.info(f"[PosterWarm] game_source {key} warmed")
                    else:
                        logger.info(f"[PosterWarm] game_source {key} generation returned False")
                    return result
                except Exception as e:
                    logger.info(f"[PosterWarm] game_source {key} warming failed: {e}")
                    return False

            task = asyncio.create_task(do_warm())
            self._warming_tasks[key] = task
            try:
                result = await task
                return result
            finally:
                self._warming_tasks.pop(key, None)

    async def warm_with_semaphore(self, coro):
        """Enforce bounded concurrency (max 3-4 in flight).

        Use this wrapper for LIST endpoint batches to limit ffmpeg load.
        """
        async with self._semaphore:
            return await coro

    def cleanup(self) -> None:
        """Evict stale locks periodically (call from a background task)."""
        self._cleanup_old_locks()


# Module-level singleton initialized at app startup.
_poster_warmer: PosterWarmer | None = None


def init_poster_warmer() -> None:
    """Initialize the poster warmer singleton (call at app startup)."""
    global _poster_warmer
    _poster_warmer = PosterWarmer()
    logger.info("[PosterWarm] service initialized")


def get_poster_warmer() -> PosterWarmer:
    """Get the poster warmer singleton."""
    global _poster_warmer
    if _poster_warmer is None:
        init_poster_warmer()
    return _poster_warmer


async def warm_draft_poster_background(
    user_id: str, profile_id: str, project_id: int
) -> None:
    """Fire-and-forget warming for draft posters (gesture handlers).

    Never raises; all exceptions logged at info.
    """
    try:
        warmer = get_poster_warmer()
        await warmer.warm_draft_poster_async(user_id, profile_id, project_id)
    except Exception as e:
        logger.info(f"[PosterWarm] draft background warming failed: {e}")


async def warm_game_source_poster_background(
    user_id: str, profile_id: str, game_id: int
) -> None:
    """Fire-and-forget warming for game source posters (gesture handlers).

    Never raises; all exceptions logged at info.
    """
    try:
        warmer = get_poster_warmer()
        await warmer.warm_game_source_poster_async(user_id, profile_id, game_id)
    except Exception as e:
        logger.info(f"[PosterWarm] game_source background warming failed: {e}")
