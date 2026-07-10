"""
Bootstrap endpoint -- single GET that replaces 9+ individual data fetch calls
on page load. The two independent read groups (user.sqlite + profile.sqlite) run
concurrently: the user-scoped group on a worker thread, the profile-scoped group
on the event loop (T4771). Single logical read path, single response shape, no
writes.
"""

import asyncio
import contextvars
import logging
import time
from fastapi import APIRouter

from ..user_context import get_current_user_id
from ..database import get_db_connection
from ..queries import exclude_teammate_reels_clause, latest_final_videos_subquery
from ..services.user_db import (
    get_profiles, get_selected_profile_id, get_credit_balance,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["bootstrap"])


def _read_user_scoped(user_id: str) -> dict:
    """Read everything sourced from user.sqlite (profiles, credits, settings,
    quests). Pure synchronous reads — run on a worker thread so they overlap the
    profile.sqlite reads (see bootstrap()). No writes: safe to run concurrently
    with the profile-scoped reads (different DB file; quests' read of
    profile.sqlite is a concurrent WAL reader, which SQLite allows)."""
    t0 = time.perf_counter()

    profiles_raw = get_profiles(user_id)
    selected_profile = get_selected_profile_id(user_id)
    profiles = [
        {
            "id": p["id"],
            "name": p["name"],
            "color": p["color"],
            "sport": p["sport"],
            "isDefault": bool(p["is_default"]),
            "isCurrent": p["id"] == selected_profile,
        }
        for p in profiles_raw
    ]

    credits = get_credit_balance(user_id)

    from ..routers.settings import get_all_preferences, DEFAULTS, _to_nested
    stored = get_all_preferences()
    settings = _to_nested({**DEFAULTS, **stored})

    # Quest progress
    from ..quest_config import QUEST_DEFINITIONS
    from ..services.user_db import get_completed_and_claimed_quest_ids
    from ..routers.quests import _check_all_steps

    # T1536: single user.sqlite open for completed + claimed (was two).
    completed_quest_ids, claimed_quest_ids = get_completed_and_claimed_quest_ids(user_id)
    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn, skip_quest_ids=completed_quest_ids)

    quests_progress = []
    for qdef in QUEST_DEFINITIONS:
        quest_id = qdef["id"]
        if quest_id in completed_quest_ids:
            quests_progress.append({
                "id": quest_id,
                "steps": {sid: True for sid in qdef["step_ids"]},
                "completed": True,
                "reward_claimed": True,
            })
        else:
            quest_steps = {sid: all_steps.get(sid, False) for sid in qdef["step_ids"]}
            quests_progress.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": all(quest_steps.values()),
                "reward_claimed": quest_id in claimed_quest_ids,
            })

    return {
        "profiles": profiles,
        "credits": credits,
        "settings": settings,
        "quests_progress": quests_progress,
        "_ms": int((time.perf_counter() - t0) * 1000),
    }


def _read_profile_misc() -> dict:
    """Read downloads count + active/unacknowledged exports + pending uploads
    from profile.sqlite in a single connection. Synchronous reads."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Downloads count -- counts actual gallery reels, so it matches the
        # gallery list (list_downloads / get_download_count). A single-clip reel
        # built from a teammate clip (my_athlete=0) is not the user's own reel
        # and is excluded everywhere the gallery is surfaced (bug 22).
        cursor.execute(f"""
            SELECT
                COUNT(*) as count,
                SUM(CASE WHEN watched_at IS NULL THEN 1 ELSE 0 END) as unwatched_count
            FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
            AND published_at IS NOT NULL
            {exclude_teammate_reels_clause("final_videos")}
        """)
        dl_row = cursor.fetchone()
        downloads = {
            "count": dl_row['count'] if dl_row else 0,
            "unwatched_count": dl_row['unwatched_count'] if dl_row else 0,
        }

        # Active exports
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status,
                   e.error, e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.status IN ('pending', 'processing', 'uploading')
            ORDER BY e.created_at DESC
        """)
        active_exports = [dict(row) for row in cursor.fetchall()]

        # Unacknowledged exports
        cursor.execute("""
            SELECT e.id, e.project_id, p.name as project_name, e.type, e.status,
                   e.error, e.output_video_id, e.output_filename,
                   e.created_at, e.started_at, e.completed_at,
                   e.game_id, e.game_name
            FROM export_jobs e
            LEFT JOIN projects p ON e.project_id = p.id
            WHERE e.status IN ('complete', 'error')
              AND e.acknowledged_at IS NULL
              AND e.completed_at >= datetime('now', '-24 hours')
            ORDER BY e.completed_at DESC
        """)
        unacknowledged_exports = [dict(row) for row in cursor.fetchall()]

        # Pending uploads (raw list, no R2 validation for speed)
        cursor.execute("""
            SELECT id as session_id, blake3_hash, file_size, original_filename,
                   created_at, label
            FROM pending_uploads
            ORDER BY created_at DESC
        """)
        pending_uploads = [dict(row) for row in cursor.fetchall()]

    return {
        "downloads": downloads,
        "exports": {
            "active": active_exports,
            "unacknowledged": unacknowledged_exports,
        },
        "pending_uploads": pending_uploads,
    }


async def _read_profile_scoped():
    """Profile-scoped group (profile.sqlite): projects + games (async, sync-bodied)
    + downloads/exports/pending. Runs on the event loop concurrently with the
    user-scoped worker thread. Returns (projects_response, games_response, misc)
    where misc carries the group's own wall time under `_ms` (internal only)."""
    t0 = time.perf_counter()
    from ..routers.projects import list_projects
    from ..routers.games import list_games_metadata
    projects_response = await list_projects()
    games_response = await list_games_metadata()
    misc = _read_profile_misc()
    misc["_ms"] = int((time.perf_counter() - t0) * 1000)
    return projects_response, games_response, misc


@router.get("/bootstrap")
async def bootstrap():
    """Single GET that replaces 9+ page-load fetches.

    T4771: the two independent read groups run concurrently instead of serially.
    The user.sqlite group (profiles/credits/settings/quests) runs on a worker
    thread while the profile.sqlite group (projects/games/downloads/exports/
    pending) runs on the event loop; wall-clock becomes ~max(group) instead of
    the sum. Still a single logical read path -- one endpoint, one response,
    no writes.
    """
    t_start = time.perf_counter()
    user_id = get_current_user_id()

    # Kick the user-scoped reads onto a worker thread. run_in_executor submits to
    # the pool synchronously, so the thread starts NOW, concurrently with the
    # profile-scoped coroutine below. copy_context() propagates the request
    # contextvars (user id, profile id, req id) into the thread so
    # get_current_*() resolve there -- a bare run_in_executor would raise
    # "No user context set" inside the thread.
    loop = asyncio.get_running_loop()
    ctx = contextvars.copy_context()
    user_future = loop.run_in_executor(None, lambda: ctx.run(_read_user_scoped, user_id))

    # gather joins BOTH groups; if one raises, gather retrieves the other's
    # result/exception too (no orphaned "future exception never retrieved").
    user_scoped, (projects_response, games_response, misc) = await asyncio.gather(
        user_future, _read_profile_scoped(),
    )
    t_end = time.perf_counter()

    logger.info(
        f"[PROFILE bootstrap] user_group={user_scoped['_ms']}ms "
        f"profile_group={misc['_ms']}ms "
        f"wall={int((t_end-t_start)*1000)}ms"
    )

    return {
        "profiles": user_scoped["profiles"],
        "credits": user_scoped["credits"],
        "settings": user_scoped["settings"],
        "quests_progress": user_scoped["quests_progress"],
        "projects": projects_response,
        "games": games_response,
        "downloads": misc["downloads"],
        "exports": misc["exports"],
        "pending_uploads": misc["pending_uploads"],
    }
