"""
Quests Router - Quest progress, achievements, and reward claiming (T540).

Quest steps are derived from existing data where possible (games, clips, exports, auth).
Only 2 steps use an achievements table for non-derivable actions.
Reward claiming is idempotent — credits are only granted once per quest.
"""

import logging
import os
import sqlite3
import time

from fastapi import APIRouter, HTTPException

from ..user_context import get_current_user_id
from ..database import get_db_connection
from ..services.user_db import grant_credits, get_credit_balance, get_user_db_connection, mark_quest_completed, get_completed_quest_ids
from ..quest_config import QUEST_DEFINITIONS, QUEST_BY_ID

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

router = APIRouter(prefix="/quests", tags=["quests"])

# Known achievement keys — only these can be recorded
KNOWN_ACHIEVEMENT_KEYS = {"opened_framing_editor", "viewed_gallery_video", "viewed_custom_project_video", "played_annotations", "watched_gallery_video_1s", "watched_gallery_video_after_2_overlays"}

# Map step_id -> quest_id for skip lookups
_STEP_TO_QUEST = {}
for _q in QUEST_DEFINITIONS:
    for _s in _q["step_ids"]:
        _STEP_TO_QUEST[_s] = _q["id"]


def _check_all_steps(user_id: str, conn, skip_quest_ids: set = None) -> dict:
    """Check all quest steps by querying existing data.

    When skip_quest_ids is provided, steps for those quests are skipped
    (they're already completed and will be filled with True by the caller).
    """
    cursor = conn.cursor()
    steps = {}
    if PROFILING_ENABLED:
        step_times = {}

    # --- Quest 1: Get Started ---
    if not skip_quest_ids or "quest_1" not in skip_quest_ids:
        if PROFILING_ENABLED:
            _t = time.perf_counter()

        steps["upload_game"] = cursor.execute(
            "SELECT 1 FROM games LIMIT 1"
        ).fetchone() is not None

        if PROFILING_ENABLED:
            step_times["upload_game"] = time.perf_counter() - _t

        # Batch achievement checks — one query for all achievement-based steps
        if PROFILING_ENABLED:
            _t = time.perf_counter()

        achievement_keys = ['played_annotations', 'opened_framing_editor', 'viewed_gallery_video',
                            'watched_gallery_video_after_2_overlays', 'viewed_custom_project_video']
        cursor.execute(
            f"SELECT key FROM achievements WHERE key IN ({','.join('?' * len(achievement_keys))})",
            achievement_keys,
        )
        achieved = {row['key'] for row in cursor.fetchall()}

        if PROFILING_ENABLED:
            step_times["achievements_batch"] = time.perf_counter() - _t

        steps["playback_annotations"] = 'played_annotations' in achieved
        steps["annotate_brilliant"] = cursor.execute(
            "SELECT 1 FROM raw_clips WHERE rating = 5 LIMIT 1"
        ).fetchone() is not None
    else:
        # Still need achievements for other quests — fetch if any non-skipped quest uses them
        needs_achievements = (
            (not skip_quest_ids or "quest_2" not in skip_quest_ids) or
            (not skip_quest_ids or "quest_3" not in skip_quest_ids) or
            (not skip_quest_ids or "quest_4" not in skip_quest_ids)
        )
        if needs_achievements:
            if PROFILING_ENABLED:
                _t = time.perf_counter()
            achievement_keys = ['played_annotations', 'opened_framing_editor', 'viewed_gallery_video',
                                'watched_gallery_video_after_2_overlays', 'viewed_custom_project_video']
            cursor.execute(
                f"SELECT key FROM achievements WHERE key IN ({','.join('?' * len(achievement_keys))})",
                achievement_keys,
            )
            achieved = {row['key'] for row in cursor.fetchall()}
            if PROFILING_ENABLED:
                step_times["achievements_batch"] = time.perf_counter() - _t
        else:
            achieved = set()

    # --- Quest 2: Export Highlights ---
    if not skip_quest_ids or "quest_2" not in skip_quest_ids:
        steps["open_framing"] = 'opened_framing_editor' in achieved
        steps["view_gallery_video"] = 'viewed_gallery_video' in achieved

        # Batch export_jobs query — one query replaces 4+ individual queries
        if PROFILING_ENABLED:
            _t = time.perf_counter()

        cursor.execute("SELECT type, status, count(*) as cnt FROM export_jobs GROUP BY type, status")
        export_counts = {}
        export_type_totals = {}
        for row in cursor.fetchall():
            export_counts[(row['type'], row['status'])] = row['cnt']
            export_type_totals[row['type']] = export_type_totals.get(row['type'], 0) + row['cnt']

        if PROFILING_ENABLED:
            step_times["export_jobs_batch"] = time.perf_counter() - _t

        steps["export_framing"] = export_type_totals.get('framing', 0) > 0
        steps["wait_for_export"] = export_counts.get(('framing', 'complete'), 0) > 0
        steps["export_overlay"] = export_counts.get(('overlay', 'complete'), 0) > 0
    else:
        # Still need export data for quest 3 — fetch if quest 3 is not skipped
        if not skip_quest_ids or "quest_3" not in skip_quest_ids:
            if PROFILING_ENABLED:
                _t = time.perf_counter()
            cursor.execute("SELECT type, status, count(*) as cnt FROM export_jobs GROUP BY type, status")
            export_counts = {}
            export_type_totals = {}
            for row in cursor.fetchall():
                export_counts[(row['type'], row['status'])] = row['cnt']
                export_type_totals[row['type']] = export_type_totals.get(row['type'], 0) + row['cnt']
            if PROFILING_ENABLED:
                step_times["export_jobs_batch"] = time.perf_counter() - _t
        else:
            export_counts = {}
            export_type_totals = {}

    # --- Quest 3: Annotate More Clips ---
    if not skip_quest_ids or "quest_3" not in skip_quest_ids:
        # Batch raw_clips query — one query replaces 3 individual queries
        if PROFILING_ENABLED:
            _t = time.perf_counter()

        row = cursor.execute(
            "SELECT count(*) as total, count(CASE WHEN rating = 5 THEN 1 END) as five_star FROM raw_clips"
        ).fetchone()

        if PROFILING_ENABLED:
            step_times["raw_clips_batch"] = time.perf_counter() - _t

        steps["annotate_5_more"] = row["total"] >= 3
        steps["annotate_second_5_star"] = row["five_star"] >= 2

        # Use pre-fetched export data
        steps["export_second_highlight"] = export_type_totals.get('framing', 0) >= 2
        steps["wait_for_export_2"] = export_counts.get(('framing', 'complete'), 0) >= 2
        steps["overlay_second_highlight"] = export_counts.get(('overlay', 'complete'), 0) >= 2

        steps["watch_second_highlight"] = 'watched_gallery_video_after_2_overlays' in achieved

    # --- Quest 4: Highlight Reel (second game + custom project) ---
    if not skip_quest_ids or "quest_4" not in skip_quest_ids:
        if PROFILING_ENABLED:
            _t = time.perf_counter()

        # 2+ games
        row = cursor.execute("SELECT count(*) as cnt FROM games").fetchone()
        steps["upload_game_2"] = row["cnt"] >= 2

        # 1+ clip rated >=4 on second+ game (exclude first game)
        steps["annotate_game_2"] = cursor.execute(
            """SELECT 1 FROM raw_clips
               WHERE rating >= 4 AND game_id != (SELECT MIN(id) FROM games)
               LIMIT 1"""
        ).fetchone() is not None

        # 1+ non-auto project with working_clips from 2+ distinct game_ids
        steps["create_reel"] = cursor.execute(
            """SELECT 1 FROM projects p
               WHERE p.is_auto_created = 0
               AND (
                   SELECT COUNT(DISTINCT rc.game_id)
                   FROM working_clips wc
                   JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                   WHERE wc.project_id = p.id
               ) >= 2
               LIMIT 1"""
        ).fetchone() is not None

        # 1+ framing export started on non-auto project
        steps["export_reel"] = cursor.execute(
            """SELECT 1 FROM export_jobs ej
               JOIN projects p ON ej.project_id = p.id
               WHERE ej.type = 'framing' AND p.is_auto_created = 0
               LIMIT 1"""
        ).fetchone() is not None

        # 1+ completed framing export on non-auto project
        steps["wait_for_reel"] = cursor.execute(
            """SELECT 1 FROM export_jobs ej
               JOIN projects p ON ej.project_id = p.id
               WHERE ej.type = 'framing' AND ej.status = 'complete'
               AND p.is_auto_created = 0
               LIMIT 1"""
        ).fetchone() is not None

        # Overlay export completed on non-auto project
        steps["overlay_reel"] = cursor.execute(
            """SELECT 1 FROM export_jobs ej
               JOIN projects p ON ej.project_id = p.id
               WHERE ej.type = 'overlay' AND ej.status = 'complete'
               AND p.is_auto_created = 0
               LIMIT 1"""
        ).fetchone() is not None

        # Watched a custom project video from gallery
        steps["watch_reel"] = 'viewed_custom_project_video' in achieved

        if PROFILING_ENABLED:
            step_times["quest_4_queries"] = time.perf_counter() - _t

    if PROFILING_ENABLED:
        total = sum(step_times.values()) * 1000
        details = ", ".join(f"{k}: {v*1000:.0f}ms" for k, v in step_times.items() if v > 0.001)
        logger.info(f"[PROFILE] _check_all_steps: {total:.0f}ms total ({details})")

    return steps


def _get_claimed_quest_ids(user_id: str) -> set:
    """Check which quests have had rewards claimed. Single query instead of N+1."""
    with get_user_db_connection(user_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT reference_id FROM credit_transactions WHERE source = 'quest_reward'"
        )
        return {row['reference_id'] for row in cursor.fetchall()}


@router.get("/definitions")
async def get_definitions():
    """Return quest structure for the frontend. No auth required."""
    return [
        {
            "id": q["id"],
            "title": q["title"],
            "reward": q["reward"],
            "step_ids": q["step_ids"],
        }
        for q in QUEST_DEFINITIONS
    ]


@router.get("/progress")
async def get_progress():
    """Get quest progress for the current user.

    Completed quests are read from user.sqlite (user-scoped, T970).
    Step progress for uncompleted quests is derived from the active profile.

    Allowlisted pre-login: if no user context is set, return an all-incomplete
    shape so the onboarding quest panel can render without a 401.
    """
    try:
        user_id = get_current_user_id()
    except RuntimeError:
        return {
            "quests": [
                {
                    "id": qdef["id"],
                    "steps": {sid: False for sid in qdef["step_ids"]},
                    "completed": False,
                    "reward_claimed": False,
                }
                for qdef in QUEST_DEFINITIONS
            ]
        }

    if PROFILING_ENABLED:
        _t_total = time.perf_counter()
        _t = time.perf_counter()

    completed_quest_ids = get_completed_quest_ids(user_id)

    if PROFILING_ENABLED:
        _t_completed = time.perf_counter() - _t

    with get_db_connection() as conn:
        if PROFILING_ENABLED:
            _t = time.perf_counter()
        all_steps = _check_all_steps(user_id, conn, skip_quest_ids=completed_quest_ids)
        if PROFILING_ENABLED:
            _t_check_steps = time.perf_counter() - _t

    # Batch reward claim check — single query instead of N+1
    if PROFILING_ENABLED:
        _t = time.perf_counter()
    claimed_quest_ids = _get_claimed_quest_ids(user_id)
    if PROFILING_ENABLED:
        _t_claimed = time.perf_counter() - _t

    quests = []
    for qdef in QUEST_DEFINITIONS:
        quest_id = qdef["id"]

        if quest_id in completed_quest_ids:
            # Quest already completed (user-scoped) — all steps true, reward claimed
            quest_steps = {sid: True for sid in qdef["step_ids"]}
            quests.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": True,
                "reward_claimed": True,
            })
        else:
            quest_steps = {sid: all_steps.get(sid, False) for sid in qdef["step_ids"]}
            completed = all(quest_steps.values())
            reward_claimed = quest_id in claimed_quest_ids

            quests.append({
                "id": quest_id,
                "steps": quest_steps,
                "completed": completed,
                "reward_claimed": reward_claimed,
            })

    if PROFILING_ENABLED:
        total_ms = (time.perf_counter() - _t_total) * 1000
        logger.info(
            f"[PROFILE] GET /quests/progress: {total_ms:.0f}ms "
            f"(completed_ids: {_t_completed*1000:.0f}ms, "
            f"check_steps: {_t_check_steps*1000:.0f}ms, "
            f"claimed_rewards: {_t_claimed*1000:.0f}ms [1 batch query])"
        )

    return {"quests": quests}


@router.post("/{quest_id}/claim-reward")
async def claim_reward(quest_id: str):
    """
    Claim credits for completing a quest. Idempotent — returns current balance
    if already claimed.
    """
    user_id = get_current_user_id()

    # Find quest definition
    qdef = next((q for q in QUEST_DEFINITIONS if q["id"] == quest_id), None)
    if not qdef:
        raise HTTPException(status_code=404, detail="Quest not found")

    # Verify all steps complete
    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn)

    for sid in qdef["step_ids"]:
        if not all_steps.get(sid, False):
            raise HTTPException(status_code=400, detail=f"Quest not complete: step '{sid}' is incomplete")

    # Grant reward — UNIQUE index on (user_id, source, reference_id) prevents double-grant
    try:
        new_balance = grant_credits(user_id, qdef["reward"], "quest_reward", quest_id)
    except sqlite3.IntegrityError:
        # UNIQUE constraint violation — already claimed (race condition or retry)
        # Still mark completed in user.sqlite in case backfill missed it
        mark_quest_completed(user_id, quest_id)
        balance = get_credit_balance(user_id)
        return {"credits_granted": 0, "new_balance": balance["balance"], "already_claimed": True}

    # T970: Mark quest as completed in user.sqlite (user-scoped, survives profile switch)
    mark_quest_completed(user_id, quest_id)

    logger.info(f"[Quests] Granted {qdef['reward']} credits for {quest_id} to {user_id}, balance={new_balance}")

    return {"credits_granted": qdef["reward"], "new_balance": new_balance, "already_claimed": False}


@router.post("/achievements/{key}")
async def record_achievement(key: str):
    """
    Record a non-derivable achievement. Idempotent — INSERT OR IGNORE.
    """
    if key not in KNOWN_ACHIEVEMENT_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown achievement key: {key}")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO achievements (key) VALUES (?)",
            (key,),
        )
        conn.commit()

        row = cursor.execute(
            "SELECT key, achieved_at FROM achievements WHERE key = ?",
            (key,),
        ).fetchone()

    logger.info(f"[Quests] Achievement recorded: {key}")
    return {"key": row["key"], "achieved_at": row["achieved_at"]}
