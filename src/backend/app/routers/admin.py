"""
Admin Router — Admin panel endpoints (T550).

All /api/admin/* endpoints require the requesting user to be in the admin_users table.
GET /api/admin/me is the only exception — it returns {is_admin: bool} safely for any user.

Per-user stats (quest progress + GPU totals) are fetched in parallel using asyncio.gather
to avoid sequential per-user DB scans.
"""

import asyncio
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import USER_DATA_BASE
from ..user_context import get_current_user_id
from ..services.auth_db import (
    is_admin,
    get_all_users_for_admin,
    grant_credits,
    get_user_by_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Quest definitions — mirrors quests.py (step IDs per quest)
_QUEST_STEP_IDS = {
    "quest_1": ["upload_game", "annotate_brilliant", "annotate_unfortunate", "create_annotated_video"],
    "quest_2": ["open_framing", "extract_clip", "export_framing", "export_overlay", "view_gallery_video"],
    "quest_3": [
        "upload_game_2", "annotate_brilliant_2", "annotate_4_star", "create_mixed_project",
        "extract_custom_clips", "frame_custom_project", "start_custom_framing",
        "complete_custom_framing", "overlay_custom_project", "watch_custom_video",
    ],
}


# ---------------------------------------------------------------------------
# Admin gate dependency
# ---------------------------------------------------------------------------

def _require_admin():
    """Raise 403 if the current user is not an admin."""
    user_id = get_current_user_id()
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")


# ---------------------------------------------------------------------------
# Per-user stat helpers (run in parallel via asyncio.gather)
# ---------------------------------------------------------------------------

def _get_profile_db_paths(user_id: str) -> list[Path]:
    """Return paths to all profile databases for a user."""
    profiles_dir = USER_DATA_BASE / user_id / "profiles"
    if not profiles_dir.exists():
        return []
    return list(profiles_dir.glob("*/database.sqlite"))


def _check_steps_on_conn(conn) -> dict[str, bool]:
    """
    Run all quest step checks on an open SQLite connection.
    Mirrors _check_all_steps() in quests.py.
    """
    cursor = conn.cursor()
    steps = {}

    def one(sql, params=()):
        return cursor.execute(sql, params).fetchone() is not None

    def val(sql, params=()):
        row = cursor.execute(sql, params).fetchone()
        return row[0] if row else 0

    # Quest 1
    steps["upload_game"] = one("SELECT 1 FROM games LIMIT 1")
    steps["annotate_brilliant"] = one("SELECT 1 FROM raw_clips WHERE rating = 5 LIMIT 1")
    steps["annotate_unfortunate"] = one("SELECT 1 FROM raw_clips WHERE rating IN (1, 2) LIMIT 1")
    steps["create_annotated_video"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'annotate' AND status = 'complete' LIMIT 1"
    )

    # Quest 2
    steps["open_framing"] = one("SELECT 1 FROM achievements WHERE key = 'opened_framing_editor'")
    steps["extract_clip"] = one(
        """SELECT 1 FROM working_clips wc
           JOIN raw_clips rc ON wc.raw_clip_id = rc.id
           WHERE rc.filename IS NOT NULL AND rc.filename != '' LIMIT 1"""
    )
    steps["export_framing"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' AND status = 'complete' LIMIT 1"
    )
    steps["export_overlay"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'overlay' AND status = 'complete' LIMIT 1"
    )
    steps["view_gallery_video"] = one("SELECT 1 FROM achievements WHERE key = 'viewed_gallery_video'")

    # Quest 3
    steps["upload_game_2"] = val("SELECT count(*) FROM games") >= 2
    steps["annotate_brilliant_2"] = val(
        "SELECT count(*) FROM raw_clips WHERE rating = 5 AND game_id != (SELECT MIN(id) FROM games)"
    ) >= 2
    steps["annotate_4_star"] = one(
        "SELECT 1 FROM raw_clips WHERE rating = 4 AND game_id != (SELECT MIN(id) FROM games) LIMIT 1"
    )
    steps["extract_custom_clips"] = one(
        """SELECT 1 FROM projects p WHERE p.is_auto_created = 0
           AND EXISTS (SELECT 1 FROM working_clips WHERE project_id = p.id)
           AND NOT EXISTS (
               SELECT 1 FROM working_clips wc JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id AND (rc.filename IS NULL OR rc.filename = '')
           ) LIMIT 1"""
    )
    steps["frame_custom_project"] = one(
        """SELECT 1 FROM projects p WHERE p.is_auto_created = 0
           AND EXISTS (SELECT 1 FROM working_clips WHERE project_id = p.id)
           AND NOT EXISTS (
               SELECT 1 FROM working_clips wc WHERE wc.project_id = p.id
               AND (wc.crop_data IS NULL OR wc.crop_data = '')
           ) LIMIT 1"""
    )
    steps["start_custom_framing"] = one(
        """SELECT 1 FROM export_jobs ej JOIN projects p ON ej.project_id = p.id
           WHERE ej.type = 'framing' AND p.is_auto_created = 0 LIMIT 1"""
    )
    steps["complete_custom_framing"] = one(
        """SELECT 1 FROM export_jobs ej JOIN projects p ON ej.project_id = p.id
           WHERE ej.status = 'complete' AND ej.type = 'framing' AND p.is_auto_created = 0 LIMIT 1"""
    )
    steps["overlay_custom_project"] = one(
        """SELECT 1 FROM export_jobs ej JOIN projects p ON ej.project_id = p.id
           WHERE ej.status = 'complete' AND ej.type = 'overlay' AND p.is_auto_created = 0 LIMIT 1"""
    )
    steps["watch_custom_video"] = one("SELECT 1 FROM achievements WHERE key = 'viewed_custom_project_video'")
    steps["create_mixed_project"] = one(
        """SELECT 1 FROM projects p
           WHERE EXISTS (
               SELECT 1 FROM working_clips wc JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id AND rc.rating = 5
           )
           AND EXISTS (
               SELECT 1 FROM working_clips wc JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id AND rc.rating = 4
           ) LIMIT 1"""
    )

    return steps


async def _compute_quest_progress(user_id: str) -> dict:
    """Compute per-quest progress by OR-ing steps across all profiles."""
    db_paths = _get_profile_db_paths(user_id)
    if not db_paths:
        return {
            qid: {"completed": 0, "total": len(sids), "reward_claimed": False}
            for qid, sids in _QUEST_STEP_IDS.items()
        }

    # Merge steps across profiles: a step is done if ANY profile has it
    merged: dict[str, bool] = {}
    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            conn.row_factory = sqlite3.Row
            profile_steps = _check_steps_on_conn(conn)
            conn.close()
            for k, v in profile_steps.items():
                merged[k] = merged.get(k, False) or v
        except Exception as e:
            logger.warning(f"[Admin] Could not read quest steps from {db_path}: {e}")

    # Check reward_claimed per quest (also OR across profiles)
    reward_claimed: dict[str, bool] = {qid: False for qid in _QUEST_STEP_IDS}
    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            cursor = conn.cursor()
            for qid in _QUEST_STEP_IDS:
                if not reward_claimed[qid]:
                    row = cursor.execute(
                        "SELECT 1 FROM credit_transactions WHERE source = ? LIMIT 1", (f"quest_{qid}",)
                    ).fetchone()
                    reward_claimed[qid] = row is not None
            conn.close()
        except Exception as e:
            logger.warning(f"[Admin] Could not read reward_claimed from {db_path}: {e}")

    result = {}
    for qid, step_ids in _QUEST_STEP_IDS.items():
        completed = sum(1 for sid in step_ids if merged.get(sid, False))
        result[qid] = {
            "completed": completed,
            "total": len(step_ids),
            "reward_claimed": reward_claimed[qid],
            "steps": {sid: merged.get(sid, False) for sid in step_ids},
        }
    return result


async def _compute_gpu_total(user_id: str) -> Optional[float]:
    """Sum gpu_seconds across all profiles for a user. Returns None if no data."""
    db_paths = _get_profile_db_paths(user_id)
    if not db_paths:
        return None

    total = 0.0
    found_any = False
    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            row = conn.execute(
                "SELECT SUM(gpu_seconds) FROM export_jobs WHERE status = 'complete' AND gpu_seconds IS NOT NULL"
            ).fetchone()
            conn.close()
            if row and row[0] is not None:
                total += row[0]
                found_any = True
        except Exception as e:
            logger.warning(f"[Admin] Could not read gpu_seconds from {db_path}: {e}")

    return round(total, 2) if found_any else None


async def _get_user_stats(user: dict) -> dict:
    """Fetch per-user stats in parallel (quest progress + GPU total)."""
    user_id = user["user_id"]
    quest_progress, gpu_total = await asyncio.gather(
        _compute_quest_progress(user_id),
        _compute_gpu_total(user_id),
    )
    return {
        **user,
        "quest_progress": quest_progress,
        "gpu_seconds_total": gpu_total,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me")
async def admin_me():
    """Check if the current user is an admin. Safe for all users — never 403."""
    user_id = get_current_user_id()
    return {"is_admin": is_admin(user_id)}


@router.get("/users")
async def list_users():
    """List all users with credits, quest progress, and GPU usage. Admin only."""
    _require_admin()

    users = get_all_users_for_admin()
    results = await asyncio.gather(*[_get_user_stats(u) for u in users])
    return list(results)


@router.get("/users/{user_id}/gpu-usage")
async def get_gpu_usage(user_id: str):
    """GPU usage drilldown for a specific user. Admin only."""
    _require_admin()

    db_paths = _get_profile_db_paths(user_id)
    if not db_paths:
        return {"total_gpu_seconds": None, "by_function": {}, "recent_jobs": []}

    total = 0.0
    by_function: dict[str, dict] = {}
    recent_jobs = []

    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            conn.row_factory = sqlite3.Row

            # Aggregate by modal_function
            rows = conn.execute(
                """SELECT modal_function, COUNT(*) as cnt, SUM(gpu_seconds) as total_sec
                   FROM export_jobs
                   WHERE status = 'complete' AND gpu_seconds IS NOT NULL
                   GROUP BY modal_function"""
            ).fetchall()
            for row in rows:
                fn = row["modal_function"] or "unknown"
                if fn not in by_function:
                    by_function[fn] = {"count": 0, "total_seconds": 0.0}
                by_function[fn]["count"] += row["cnt"]
                by_function[fn]["total_seconds"] = round(
                    by_function[fn]["total_seconds"] + (row["total_sec"] or 0), 2
                )
                total += row["total_sec"] or 0

            # Recent jobs
            job_rows = conn.execute(
                """SELECT id, type, gpu_seconds, status, created_at
                   FROM export_jobs
                   WHERE gpu_seconds IS NOT NULL
                   ORDER BY created_at DESC LIMIT 20"""
            ).fetchall()
            recent_jobs.extend([dict(r) for r in job_rows])
            conn.close()
        except Exception as e:
            logger.warning(f"[Admin] Could not read GPU usage from {db_path}: {e}")

    # Sort recent_jobs by created_at desc and take top 20
    recent_jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    recent_jobs = recent_jobs[:20]

    return {
        "total_gpu_seconds": round(total, 2) if total else None,
        "by_function": by_function,
        "recent_jobs": recent_jobs,
    }


class GrantCreditsRequest(BaseModel):
    amount: int


@router.post("/users/{user_id}/grant-credits")
async def admin_grant_credits(user_id: str, request: GrantCreditsRequest):
    """Grant credits to any user. Admin only."""
    _require_admin()

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_balance = grant_credits(user_id, request.amount, source="admin_grant")
    return {"balance": new_balance}


class SetCreditsRequest(BaseModel):
    amount: int


@router.post("/users/{user_id}/set-credits")
async def admin_set_credits(user_id: str, request: SetCreditsRequest):
    """Set a user's credit balance to an exact value. Admin only."""
    _require_admin()

    if request.amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from ..services.auth_db import set_credits
    new_balance = set_credits(user_id, request.amount)
    return {"balance": new_balance}
