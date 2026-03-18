"""
Quests Router - Quest progress, achievements, and reward claiming (T540).

Quest steps are derived from existing data where possible (games, clips, exports, auth).
Only 2 steps use an achievements table for non-derivable actions.
Reward claiming is idempotent — credits are only granted once per quest.
"""

import logging

from fastapi import APIRouter, HTTPException

from ..user_context import get_current_user_id
from ..database import get_db_connection
from ..services.auth_db import grant_credits, get_credit_transactions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quests", tags=["quests"])

# Known achievement keys — only these can be recorded
KNOWN_ACHIEVEMENT_KEYS = {"opened_framing_editor", "viewed_gallery_video", "viewed_custom_project_video"}

# Quest definitions — single source of truth for quest structure and rewards
QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Get Started",
        "reward": 25,
        "step_ids": [
            "upload_game",
            "annotate_brilliant",
            "annotate_unfortunate",
            "create_annotated_video",
        ],
    },
    {
        "id": "quest_2",
        "title": "Export Highlights",
        "reward": 50,
        "step_ids": [
            "open_framing",
            "extract_clip",
            "export_framing",
            "export_overlay",
            "view_gallery_video",
        ],
    },
    {
        "id": "quest_3",
        "title": "Multiple Games",
        "reward": 100,
        "step_ids": [
            "upload_game_2",
            "annotate_brilliant_2",
            "annotate_4_star",
            "create_mixed_project",
            "extract_custom_clips",
            "frame_custom_project",
            "overlay_custom_project",
            "watch_custom_video",
        ],
    },
]


def _check_all_steps(user_id: str, conn) -> dict:
    """Check all quest steps by querying existing data."""
    cursor = conn.cursor()
    steps = {}

    # --- Quest 1: Get Started ---

    steps["upload_game"] = cursor.execute(
        "SELECT 1 FROM games LIMIT 1"
    ).fetchone() is not None

    steps["annotate_brilliant"] = cursor.execute(
        "SELECT 1 FROM raw_clips WHERE rating = 5 LIMIT 1"
    ).fetchone() is not None

    steps["annotate_unfortunate"] = cursor.execute(
        "SELECT 1 FROM raw_clips WHERE rating IN (1, 2) LIMIT 1"
    ).fetchone() is not None

    steps["create_annotated_video"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'annotate' AND status = 'complete' LIMIT 1"
    ).fetchone() is not None

    # --- Quest 2: Export Highlights ---

    # Achievement checks (per-user SQLite)
    steps["open_framing"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'opened_framing_editor'"
    ).fetchone() is not None

    # A clip is "extracted" when its raw_clip has a non-empty filename (video file exists)
    # and it's assigned to a project via working_clips
    steps["extract_clip"] = cursor.execute(
        """SELECT 1 FROM working_clips wc
           JOIN raw_clips rc ON wc.raw_clip_id = rc.id
           WHERE rc.filename IS NOT NULL AND rc.filename != ''
           LIMIT 1"""
    ).fetchone() is not None

    steps["export_framing"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' AND status = 'complete' LIMIT 1"
    ).fetchone() is not None

    steps["export_overlay"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'overlay' AND status = 'complete' LIMIT 1"
    ).fetchone() is not None

    steps["view_gallery_video"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'viewed_gallery_video'"
    ).fetchone() is not None

    # --- Quest 3: Multiple Games ---
    # Quest 3 annotation steps check the SECOND+ game only (not the first game).
    # This ensures users are working with the new game, not reusing Quest 1 progress.

    # Count-based: need ≥2 games
    row = cursor.execute("SELECT count(*) as cnt FROM games").fetchone()
    steps["upload_game_2"] = row["cnt"] >= 2

    # Need ≥2 clips rated 5 on the second+ game (exclude first game)
    row = cursor.execute(
        """SELECT count(*) as cnt FROM raw_clips
           WHERE rating = 5 AND game_id != (SELECT MIN(id) FROM games)"""
    ).fetchone()
    steps["annotate_brilliant_2"] = row["cnt"] >= 2

    # Need ≥1 clip rated 4 on the second+ game
    steps["annotate_4_star"] = cursor.execute(
        """SELECT 1 FROM raw_clips
           WHERE rating = 4 AND game_id != (SELECT MIN(id) FROM games)
           LIMIT 1"""
    ).fetchone() is not None

    # All clips in a custom project have been extracted (raw_clip.filename != '')
    steps["extract_custom_clips"] = cursor.execute(
        """SELECT 1 FROM projects p
           WHERE p.is_auto_created = 0
           AND EXISTS (SELECT 1 FROM working_clips WHERE project_id = p.id)
           AND NOT EXISTS (
               SELECT 1 FROM working_clips wc
               JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id
               AND (rc.filename IS NULL OR rc.filename = '')
           )
           LIMIT 1"""
    ).fetchone() is not None

    # All clips in a custom project have crop_data (framed individually)
    steps["frame_custom_project"] = cursor.execute(
        """SELECT 1 FROM projects p
           WHERE p.is_auto_created = 0
           AND EXISTS (SELECT 1 FROM working_clips WHERE project_id = p.id)
           AND NOT EXISTS (
               SELECT 1 FROM working_clips wc
               WHERE wc.project_id = p.id
               AND (wc.crop_data IS NULL OR wc.crop_data = '')
           )
           LIMIT 1"""
    ).fetchone() is not None

    # Overlay export completed for a custom project
    steps["overlay_custom_project"] = cursor.execute(
        """SELECT 1 FROM export_jobs ej
           JOIN projects p ON ej.project_id = p.id
           WHERE ej.status = 'complete' AND ej.type = 'overlay'
           AND p.is_auto_created = 0
           LIMIT 1"""
    ).fetchone() is not None

    # Watched a custom project video from gallery (separate from Quest 2's general gallery view)
    steps["watch_custom_video"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'viewed_custom_project_video'"
    ).fetchone() is not None

    # Project containing both 4-star and 5-star clips
    steps["create_mixed_project"] = cursor.execute(
        """SELECT 1 FROM projects p
           WHERE EXISTS (
               SELECT 1 FROM working_clips wc
               JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id AND rc.rating = 5
           )
           AND EXISTS (
               SELECT 1 FROM working_clips wc
               JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id AND rc.rating = 4
           )
           LIMIT 1"""
    ).fetchone() is not None

    return steps


def _has_claimed_reward(user_id: str, quest_id: str) -> bool:
    """Check if quest reward was already claimed via credit_transactions."""
    txns = get_credit_transactions(user_id, limit=100)
    return any(
        t["source"] == "quest_reward" and t["reference_id"] == quest_id
        for t in txns
    )


@router.get("/progress")
async def get_progress():
    """Get quest progress for the current user."""
    user_id = get_current_user_id()

    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn)

    quests = []
    for qdef in QUEST_DEFINITIONS:
        quest_steps = {sid: all_steps.get(sid, False) for sid in qdef["step_ids"]}
        completed = all(quest_steps.values())
        reward_claimed = _has_claimed_reward(user_id, qdef["id"])

        quests.append({
            "id": qdef["id"],
            "steps": quest_steps,
            "completed": completed,
            "reward_claimed": reward_claimed,
        })

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

    # Idempotent: already claimed → return current balance
    if _has_claimed_reward(user_id, quest_id):
        from ..services.auth_db import get_credit_balance
        balance = get_credit_balance(user_id)
        return {"credits_granted": 0, "new_balance": balance["balance"], "already_claimed": True}

    # Verify all steps complete
    with get_db_connection() as conn:
        all_steps = _check_all_steps(user_id, conn)

    for sid in qdef["step_ids"]:
        if not all_steps.get(sid, False):
            raise HTTPException(status_code=400, detail=f"Quest not complete: step '{sid}' is incomplete")

    # Grant reward
    new_balance = grant_credits(user_id, qdef["reward"], "quest_reward", quest_id)
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
