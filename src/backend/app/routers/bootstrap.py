"""
Bootstrap endpoint -- single GET that replaces 9+ individual data fetch calls
on page load. Eliminates thread pool contention by running all queries
sequentially in a single request handler.
"""

import logging
import time
from fastapi import APIRouter

from ..user_context import get_current_user_id
from ..database import get_db_connection
from ..queries import latest_final_videos_subquery
from ..services.user_db import (
    get_profiles, get_selected_profile_id, get_credit_balance,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["bootstrap"])


@router.get("/bootstrap")
async def bootstrap():
    t_start = time.perf_counter()
    user_id = get_current_user_id()

    # --- User-scoped data (user.sqlite) ---
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
    t_profiles = time.perf_counter()

    credits = get_credit_balance(user_id)
    t_credits = time.perf_counter()

    from ..routers.settings import get_all_preferences, DEFAULTS, _to_nested
    stored = get_all_preferences()
    settings = _to_nested({**DEFAULTS, **stored})
    t_settings = time.perf_counter()

    # Quest progress
    from ..quest_config import QUEST_DEFINITIONS
    from ..services.user_db import get_completed_quest_ids
    from ..routers.quests import _check_all_steps, _get_claimed_quest_ids

    completed_quest_ids = get_completed_quest_ids(user_id)
    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn, skip_quest_ids=completed_quest_ids)
    claimed_quest_ids = _get_claimed_quest_ids(user_id)

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
    t_quests = time.perf_counter()

    # --- Profile-scoped data (profile.sqlite) ---
    from ..routers.projects import list_projects
    projects_response = await list_projects()
    t_projects = time.perf_counter()

    from ..routers.games import list_games_metadata
    games_response = await list_games_metadata()
    t_games = time.perf_counter()

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Downloads count
        cursor.execute(f"""
            SELECT
                COUNT(*) as count,
                SUM(CASE WHEN watched_at IS NULL THEN 1 ELSE 0 END) as unwatched_count
            FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
            AND published_at IS NOT NULL
        """)
        dl_row = cursor.fetchone()
        downloads = {
            "count": dl_row['count'] if dl_row else 0,
            "unwatched_count": dl_row['unwatched_count'] if dl_row else 0,
        }
        t_downloads = time.perf_counter()

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
        t_exports = time.perf_counter()

        # Pending uploads (raw list, no R2 validation for speed)
        cursor.execute("""
            SELECT id as session_id, blake3_hash, file_size, original_filename,
                   created_at, label
            FROM pending_uploads
            ORDER BY created_at DESC
        """)
        pending_uploads = [dict(row) for row in cursor.fetchall()]
    t_pending = time.perf_counter()

    logger.info(
        f"[PROFILE bootstrap] profiles={int((t_profiles-t_start)*1000)}ms "
        f"credits={int((t_credits-t_profiles)*1000)}ms "
        f"settings={int((t_settings-t_credits)*1000)}ms "
        f"quests={int((t_quests-t_settings)*1000)}ms "
        f"projects={int((t_projects-t_quests)*1000)}ms "
        f"games={int((t_games-t_projects)*1000)}ms "
        f"downloads={int((t_downloads-t_games)*1000)}ms "
        f"exports={int((t_exports-t_downloads)*1000)}ms "
        f"pending={int((t_pending-t_exports)*1000)}ms "
        f"total={int((t_pending-t_start)*1000)}ms"
    )

    return {
        "profiles": profiles,
        "credits": credits,
        "settings": settings,
        "quests_progress": quests_progress,
        "projects": projects_response,
        "games": games_response,
        "downloads": downloads,
        "exports": {
            "active": active_exports,
            "unacknowledged": unacknowledged_exports,
        },
        "pending_uploads": pending_uploads,
    }
