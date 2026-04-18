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

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from ..database import USER_DATA_BASE
from ..user_context import get_current_user_id
from ..services.auth_db import (
    is_admin,
    get_all_users_for_admin,
    get_user_by_id,
    create_impersonation_session,
    find_or_create_admin_restore_session,
    log_impersonation,
    invalidate_session,
    validate_session,
    IMPERSONATION_TTL_MINUTES,
)
from ..services.user_db import (
    get_credit_stats_for_admin,
    grant_credits,
)
from ..quest_config import QUEST_DEFINITIONS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


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
    return list(profiles_dir.glob("*/profile.sqlite"))


def _check_steps_on_conn(conn) -> dict[str, bool]:
    """
    Run all quest step checks on an open SQLite connection.
    Mirrors _check_all_steps() in quests.py — uses canonical step IDs from quest_config.
    """
    cursor = conn.cursor()
    steps = {}

    def one(sql, params=()):
        return cursor.execute(sql, params).fetchone() is not None

    def val(sql, params=()):
        row = cursor.execute(sql, params).fetchone()
        return row[0] if row else 0

    # --- Quest 1: Get Started ---
    steps["upload_game"] = one("SELECT 1 FROM games LIMIT 1")
    steps["annotate_brilliant"] = one("SELECT 1 FROM raw_clips WHERE rating = 5 LIMIT 1")
    steps["playback_annotations"] = one(
        "SELECT 1 FROM achievements WHERE key = 'played_annotations'"
    )

    # --- Quest 2: Export Highlights ---
    steps["open_framing"] = one("SELECT 1 FROM achievements WHERE key = 'opened_framing_editor'")
    steps["export_framing"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' LIMIT 1"
    )
    steps["wait_for_export"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'framing' AND status = 'complete' LIMIT 1"
    )
    steps["export_overlay"] = one(
        "SELECT 1 FROM export_jobs WHERE type = 'overlay' AND status = 'complete' LIMIT 1"
    )
    steps["view_gallery_video"] = one("SELECT 1 FROM achievements WHERE key = 'viewed_gallery_video'")

    # --- Quest 3: Annotate More Clips ---
    row_clips = val(
        "SELECT count(*) FROM raw_clips WHERE game_id = (SELECT MIN(id) FROM games)"
    )
    steps["annotate_5_more"] = row_clips >= 3

    row_5star = val(
        "SELECT count(*) FROM raw_clips WHERE rating = 5 AND game_id = (SELECT MIN(id) FROM games)"
    )
    steps["annotate_second_5_star"] = row_5star >= 2

    row_framing = val("SELECT count(*) FROM export_jobs WHERE type = 'framing'")
    steps["export_second_highlight"] = row_framing >= 2

    row_framing_complete = val(
        "SELECT count(*) FROM export_jobs WHERE type = 'framing' AND status = 'complete'"
    )
    steps["wait_for_export_2"] = row_framing_complete >= 2

    row_overlay_complete = val(
        "SELECT count(*) FROM export_jobs WHERE type = 'overlay' AND status = 'complete'"
    )
    steps["overlay_second_highlight"] = row_overlay_complete >= 2

    steps["watch_second_highlight"] = row_overlay_complete >= 2 and one(
        "SELECT 1 FROM achievements WHERE key = 'watched_gallery_video_1s'"
    )

    # --- Quest 4: Highlight Reel ---
    steps["upload_game_2"] = val("SELECT count(*) FROM games") >= 2

    steps["annotate_game_2"] = one(
        """SELECT 1 FROM raw_clips
           WHERE rating >= 4 AND game_id != (SELECT MIN(id) FROM games)
           LIMIT 1"""
    )

    steps["create_reel"] = one(
        """SELECT 1 FROM projects p
           WHERE p.is_auto_created = 0
           AND (
               SELECT COUNT(DISTINCT rc.game_id)
               FROM working_clips wc
               JOIN raw_clips rc ON wc.raw_clip_id = rc.id
               WHERE wc.project_id = p.id
           ) >= 2
           LIMIT 1"""
    )

    steps["export_reel"] = one(
        """SELECT 1 FROM export_jobs ej
           JOIN projects p ON ej.project_id = p.id
           WHERE ej.type = 'framing' AND p.is_auto_created = 0
           LIMIT 1"""
    )

    steps["wait_for_reel"] = one(
        """SELECT 1 FROM export_jobs ej
           JOIN projects p ON ej.project_id = p.id
           WHERE ej.type = 'framing' AND ej.status = 'complete'
           AND p.is_auto_created = 0
           LIMIT 1"""
    )

    steps["overlay_reel"] = one(
        """SELECT 1 FROM export_jobs ej
           JOIN projects p ON ej.project_id = p.id
           WHERE ej.type = 'overlay' AND ej.status = 'complete'
           AND p.is_auto_created = 0
           LIMIT 1"""
    )

    steps["watch_reel"] = one(
        "SELECT 1 FROM achievements WHERE key = 'viewed_custom_project_video'"
    )

    return steps


async def _compute_quest_progress(user_id: str) -> dict:
    """Compute per-quest progress by OR-ing steps across all profiles."""
    db_paths = _get_profile_db_paths(user_id)
    if not db_paths:
        return {
            qdef["id"]: {"completed": 0, "total": len(qdef["step_ids"]), "reward_claimed": False}
            for qdef in QUEST_DEFINITIONS
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
    quest_ids = [qdef["id"] for qdef in QUEST_DEFINITIONS]
    reward_claimed: dict[str, bool] = {qid: False for qid in quest_ids}
    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            cursor = conn.cursor()
            for qid in quest_ids:
                if not reward_claimed[qid]:
                    row = cursor.execute(
                        "SELECT 1 FROM credit_transactions WHERE source = ? LIMIT 1", (f"quest_{qid}",)
                    ).fetchone()
                    reward_claimed[qid] = row is not None
            conn.close()
        except Exception as e:
            logger.warning(f"[Admin] Could not read reward_claimed from {db_path}: {e}")

    result = {}
    for qdef in QUEST_DEFINITIONS:
        qid = qdef["id"]
        step_ids = qdef["step_ids"]
        completed = sum(1 for sid in step_ids if merged.get(sid, False))
        result[qid] = {
            "completed": completed,
            "total": len(step_ids),
            "reward_claimed": reward_claimed[qid],
            "steps": {sid: merged.get(sid, False) for sid in step_ids},
        }
    return result


async def _compute_activity_counts(user_id: str) -> dict:
    """Count games, annotated clips, framed projects, and completed projects across all profiles."""
    db_paths = _get_profile_db_paths(user_id)
    if not db_paths:
        return {"games_annotated": 0, "clips_annotated": 0, "projects_framed": 0, "projects_completed": 0}

    games = 0
    clips = 0
    projects_framed = 0
    projects_completed = 0

    for db_path in db_paths:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            cursor = conn.cursor()

            row = cursor.execute("SELECT COUNT(*) FROM games").fetchone()
            games += row[0] if row else 0

            row = cursor.execute("SELECT COUNT(*) FROM raw_clips").fetchone()
            clips += row[0] if row else 0

            # Projects with at least one completed framing export
            row = cursor.execute(
                """SELECT COUNT(DISTINCT p.id) FROM projects p
                   JOIN export_jobs ej ON ej.project_id = p.id
                   WHERE ej.type = 'framing' AND ej.status = 'complete'"""
            ).fetchone()
            projects_framed += row[0] if row else 0

            # Projects with at least one completed overlay export
            row = cursor.execute(
                """SELECT COUNT(DISTINCT p.id) FROM projects p
                   JOIN export_jobs ej ON ej.project_id = p.id
                   WHERE ej.type = 'overlay' AND ej.status = 'complete'"""
            ).fetchone()
            projects_completed += row[0] if row else 0

            conn.close()
        except Exception as e:
            logger.warning(f"[Admin] Could not read activity counts from {db_path}: {e}")

    return {
        "games_annotated": games,
        "clips_annotated": clips,
        "projects_framed": projects_framed,
        "projects_completed": projects_completed,
    }


# Credit amount → price in cents mapping (mirrors payments.py CREDIT_PACKS)
_CREDIT_AMOUNT_TO_CENTS = {
    120: 499,
    400: 1299,
    1000: 2499,
}


def _compute_money_spent_cents(purchase_credit_amounts: list[int]) -> int:
    """Map individual Stripe purchase credit amounts to total dollars spent (in cents)."""
    total = 0
    for amount in purchase_credit_amounts:
        total += _CREDIT_AMOUNT_TO_CENTS.get(amount, 0)
    return total


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


def _default_user_stats(user: dict) -> dict:
    """Return a user dict with zeroed-out stats (used when stat computation fails)."""
    default_quests = {
        qdef["id"]: {"completed": 0, "total": len(qdef["step_ids"]), "reward_claimed": False}
        for qdef in QUEST_DEFINITIONS
    }
    return {
        **user,
        "quest_progress": default_quests,
        "gpu_seconds_total": None,
        "credits_spent": 0,
        "credits_purchased": 0,
        "money_spent_cents": 0,
        "games_annotated": 0,
        "clips_annotated": 0,
        "projects_framed": 0,
        "projects_completed": 0,
    }


async def _get_user_stats(user: dict, credit_stats: dict) -> dict:
    """Fetch per-user stats in parallel (quest progress + GPU total + activity counts)."""
    user_id = user["user_id"]
    quest_progress, gpu_total, activity = await asyncio.gather(
        _compute_quest_progress(user_id),
        _compute_gpu_total(user_id),
        _compute_activity_counts(user_id),
    )

    # Credit stats from auth DB (pre-fetched in batch)
    user_credit = credit_stats.get(user_id, {"credits_spent": 0, "credits_purchased": 0, "purchase_credit_amounts": []})
    money_spent_cents = _compute_money_spent_cents(user_credit["purchase_credit_amounts"])

    return {
        **user,
        "quest_progress": quest_progress,
        "gpu_seconds_total": gpu_total,
        "credits_spent": user_credit["credits_spent"],
        "credits_purchased": user_credit["credits_purchased"],
        "money_spent_cents": money_spent_cents,
        **activity,
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
    """List all users with credits, quest progress, GPU usage, and activity stats. Admin only."""
    _require_admin()

    users = get_all_users_for_admin()
    credit_stats = get_credit_stats_for_admin()
    results = await asyncio.gather(
        *[_get_user_stats(u, credit_stats) for u in users],
        return_exceptions=True,
    )

    # If any individual user's stats failed, still include them with defaults
    final = []
    for user, result in zip(users, results):
        if isinstance(result, BaseException):
            logger.warning(f"[Admin] Stats failed for {user.get('email', user['user_id'])}: {result}")
            final.append(_default_user_stats(user))
        else:
            final.append(result)
    return final


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

    from ..services.user_db import set_credits
    new_balance = set_credits(user_id, request.amount)
    return {"balance": new_balance}


# ---------------------------------------------------------------------------
# T1510: Impersonation
# ---------------------------------------------------------------------------

import os as _os  # local alias; module-level os not imported here

_SECURE_COOKIES = _os.getenv("SECURE_COOKIES", "false").lower() == "true"
# Must match auth.py: cross-site deploys (Pages ↔ Fly) need SameSite=None
_SAMESITE = "none" if _SECURE_COOKIES else "lax"


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key="rb_session",
        value=session_id,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        samesite=_SAMESITE,
        secure=_SECURE_COOKIES,
        path="/",
    )


def _clear_machine_pin_cookie(response: Response) -> None:
    """T1190 hook: clear fly_machine_id so the next request re-routes to the
    correct Fly machine for whichever user we are now acting as. No-op until
    T1190 ships — safe to call either way (set_cookie with empty value + max_age=0
    deletes it on the browser)."""
    response.delete_cookie("fly_machine_id", path="/")


@router.post("/impersonate/stop")
async def stop_impersonation(request: Request, response: Response):
    """Stop impersonating and restore the admin's own session."""
    session_id = request.cookies.get("rb_session")
    sess = validate_session(session_id) if session_id else None

    if not sess or not sess.get("impersonator_user_id"):
        raise HTTPException(status_code=400, detail="not_impersonating")

    admin_id = sess["impersonator_user_id"]
    target_id = sess["user_id"]
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    log_impersonation(admin_id, target_id, "stop", ip, user_agent)

    invalidate_session(session_id)
    restore_sid = find_or_create_admin_restore_session(admin_id)
    _set_session_cookie(response, restore_sid)
    _clear_machine_pin_cookie(response)

    return {"ok": True, "admin_user_id": admin_id}


@router.post("/impersonate/{target_user_id}")
async def impersonate(target_user_id: str, request: Request, response: Response):
    """Start impersonating a target user. Admin only.

    Target user_id comes from the path param only — never from a client store.
    Admin cannot impersonate another admin (privilege laundering).
    """
    _require_admin()
    admin_id = get_current_user_id()

    if admin_id == target_user_id:
        raise HTTPException(status_code=400, detail="cannot_impersonate_self")

    target = get_user_by_id(target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="target_not_found")

    if is_admin(target_user_id):
        raise HTTPException(
            status_code=403, detail="cannot_impersonate_another_admin"
        )

    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    log_impersonation(admin_id, target_user_id, "start", ip, user_agent)

    session_id = create_impersonation_session(
        target_user_id, admin_id, ttl_minutes=IMPERSONATION_TTL_MINUTES
    )
    _set_session_cookie(response, session_id)
    _clear_machine_pin_cookie(response)

    return {
        "ok": True,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "ttl_minutes": IMPERSONATION_TTL_MINUTES,
    }
