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
KNOWN_ACHIEVEMENT_KEYS = {"opened_framing_editor", "viewed_gallery_video", "viewed_custom_project_video", "played_annotations", "watched_gallery_video_1s"}

# Quest definitions — single source of truth for quest structure and rewards
QUEST_DEFINITIONS = [
    {
        "id": "quest_1",
        "title": "Get Started",
        "reward": 15,
        "step_ids": [
            "upload_game",
            "annotate_brilliant",
            "playback_annotations",
        ],
    },
    {
        "id": "quest_2",
        "title": "Export Highlights",
        "reward": 25,
        "step_ids": [
            "open_framing",
            "export_framing",
            "wait_for_export",
            "export_overlay",
            "view_gallery_video",
        ],
    },
    {
        "id": "quest_3",
        "title": "Annotate More Clips",
        "reward": 40,
        "step_ids": [
            "annotate_second_5_star",
            "annotate_5_more",
            "export_second_highlight",
            "wait_for_export_2",
            "overlay_second_highlight",
            "watch_second_highlight",
        ],
    },
    {
        "id": "quest_4",
        "title": "Highlight Reel",
        "reward": 45,
        "step_ids": [
            "upload_game_2",
            "annotate_game_2",
            "create_reel",
            "export_reel",
            "wait_for_reel",
            "watch_reel",
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

    steps["playback_annotations"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'played_annotations'"
    ).fetchone() is not None

    # --- Quest 2: Export Highlights ---

    # Achievement checks (per-user SQLite)
    steps["open_framing"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'opened_framing_editor'"
    ).fetchone() is not None

    # export_framing: user clicked "Frame Video" (export job exists, any status)
    steps["export_framing"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' LIMIT 1"
    ).fetchone() is not None

    # wait_for_export: framing export completed successfully
    steps["wait_for_export"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' AND status = 'complete' LIMIT 1"
    ).fetchone() is not None

    steps["export_overlay"] = cursor.execute(
        "SELECT 1 FROM export_jobs WHERE type = 'overlay' AND status = 'complete' LIMIT 1"
    ).fetchone() is not None

    steps["view_gallery_video"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'viewed_gallery_video'"
    ).fetchone() is not None

    # --- Quest 3: Annotate More Clips (first game only) ---

    # 3+ total raw_clips on first game (at least 1 more beyond the 2 five-star clips)
    row = cursor.execute(
        "SELECT count(*) as cnt FROM raw_clips WHERE game_id = (SELECT MIN(id) FROM games)"
    ).fetchone()
    steps["annotate_5_more"] = row["cnt"] >= 3

    # 2+ clips rated 5 on first game
    row = cursor.execute(
        """SELECT count(*) as cnt FROM raw_clips
           WHERE rating = 5 AND game_id = (SELECT MIN(id) FROM games)"""
    ).fetchone()
    steps["annotate_second_5_star"] = row["cnt"] >= 2

    # 2+ framing export jobs exist (any status)
    row = cursor.execute(
        "SELECT count(*) as cnt FROM export_jobs WHERE type = 'framing'"
    ).fetchone()
    steps["export_second_highlight"] = row["cnt"] >= 2

    # 2+ completed framing export jobs
    row = cursor.execute(
        "SELECT count(*) as cnt FROM export_jobs WHERE type = 'framing' AND status = 'complete'"
    ).fetchone()
    steps["wait_for_export_2"] = row["cnt"] >= 2

    # Overlay on second highlight — 2+ completed overlay exports
    row = cursor.execute(
        "SELECT count(*) as cnt FROM export_jobs WHERE type = 'overlay' AND status = 'complete'"
    ).fetchone()
    steps["overlay_second_highlight"] = row["cnt"] >= 2

    # Watch second highlight — 2+ overlay exports completed AND gallery video watched
    steps["watch_second_highlight"] = row["cnt"] >= 2 and cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'watched_gallery_video_1s'"
    ).fetchone() is not None

    # --- Quest 4: Highlight Reel (second game + custom project) ---

    # 2+ games
    row = cursor.execute("SELECT count(*) as cnt FROM games").fetchone()
    steps["upload_game_2"] = row["cnt"] >= 2

    # 1+ clip rated ≥4 on second+ game (exclude first game)
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

    # Watched a custom project video from gallery
    steps["watch_reel"] = cursor.execute(
        "SELECT 1 FROM achievements WHERE key = 'viewed_custom_project_video'"
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
