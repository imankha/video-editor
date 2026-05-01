"""
Admin Router — Admin panel endpoints (T550, T1590).

All /api/admin/* endpoints require the requesting user to be in the admin_users table.
GET /api/admin/me is the only exception — it returns {is_admin: bool} safely for any user.

T1590: Profile-centric architecture. Stats are per-profile (not aggregated across profiles).
Profile DBs are pulled from R2 on demand with capacity-driven pagination.
"""

import asyncio
import logging
import math
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from ..database import USER_DATA_BASE
from ..storage import get_r2_client, R2_BUCKET, APP_ENV, R2_ENABLED
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

# Max profiles to fetch per page (controls R2 download concurrency)
DEFAULT_PAGE_SIZE = 10


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

# ---------------------------------------------------------------------------
# R2 helpers for admin (bypass ContextVar-dependent r2_key)
# ---------------------------------------------------------------------------

def _admin_r2_profile_key(user_id: str, profile_id: str, filename: str = "profile.sqlite") -> str:
    """Build R2 key for a profile file without ContextVar."""
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/{filename}"


def _admin_download_profile_db(user_id: str, profile_id: str) -> Optional[Path]:
    """Download profile.sqlite from R2 to standard local path. Returns path or None."""
    local_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if local_path.exists():
        return local_path  # Already cached from normal user activity

    client = get_r2_client()
    if not client:
        return None

    key = _admin_r2_profile_key(user_id, profile_id)
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(R2_BUCKET, key, str(local_path))
        logger.info(f"[Admin] Downloaded profile DB from R2: {key}")
        return local_path
    except client.exceptions.NoSuchKey:
        logger.debug(f"[Admin] Profile DB not found in R2: {key}")
        return None
    except Exception as e:
        logger.warning(f"[Admin] Failed to download profile DB: {key} - {e}")
        return None


def _admin_discover_profiles(user_id: str) -> list[str]:
    """List profile IDs for a user by scanning R2 keys. Returns list of profile_id strings."""
    client = get_r2_client()
    if not client:
        # Fallback to local filesystem when R2 is not enabled (dev)
        profiles_dir = USER_DATA_BASE / user_id / "profiles"
        if not profiles_dir.exists():
            return []
        return [
            d.name for d in profiles_dir.iterdir()
            if d.is_dir() and (d / "profile.sqlite").exists()
        ]

    prefix = f"{APP_ENV}/users/{user_id}/profiles/"
    try:
        response = client.list_objects_v2(Bucket=R2_BUCKET, Prefix=prefix, Delimiter="/")
        profile_ids = []
        for cp in response.get("CommonPrefixes", []):
            # cp["Prefix"] looks like "{env}/users/{uid}/profiles/{pid}/"
            parts = cp["Prefix"].rstrip("/").split("/")
            profile_ids.append(parts[-1])
        return profile_ids
    except Exception as e:
        logger.warning(f"[Admin] Failed to list profiles for {user_id}: {e}")
        return []


async def _admin_ensure_profile_db(user_id: str, profile_id: str) -> Optional[Path]:
    """Ensure profile DB is available locally (download from R2 if needed). Thread-safe."""
    return await asyncio.to_thread(_admin_download_profile_db, user_id, profile_id)


# ---------------------------------------------------------------------------
# Single-profile stat helpers (T1590: no cross-profile aggregation)
# ---------------------------------------------------------------------------

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


def _compute_quest_progress_single(db_path: Path) -> dict:
    """Compute per-quest progress for a single profile DB."""
    empty = {
        qdef["id"]: {"completed": 0, "total": len(qdef["step_ids"]), "reward_claimed": False}
        for qdef in QUEST_DEFINITIONS
    }
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        conn.row_factory = sqlite3.Row
        steps = _check_steps_on_conn(conn)

        # Check reward_claimed per quest
        cursor = conn.cursor()
        reward_claimed: dict[str, bool] = {}
        for qdef in QUEST_DEFINITIONS:
            qid = qdef["id"]
            row = cursor.execute(
                "SELECT 1 FROM credit_transactions WHERE source = ? LIMIT 1", (f"quest_{qid}",)
            ).fetchone()
            reward_claimed[qid] = row is not None

        conn.close()
    except Exception as e:
        logger.warning(f"[Admin] Could not read quest progress from {db_path}: {e}")
        return empty

    result = {}
    for qdef in QUEST_DEFINITIONS:
        qid = qdef["id"]
        step_ids = qdef["step_ids"]
        completed = sum(1 for sid in step_ids if steps.get(sid, False))
        result[qid] = {
            "completed": completed,
            "total": len(step_ids),
            "reward_claimed": reward_claimed[qid],
            "steps": {sid: steps.get(sid, False) for sid in step_ids},
        }
    return result


def _compute_activity_counts_single(db_path: Path) -> dict:
    """Count games, clips, framed, completed for a single profile DB."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        cursor = conn.cursor()

        games = cursor.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        clips = cursor.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0]
        projects_framed = cursor.execute(
            """SELECT COUNT(DISTINCT p.id) FROM projects p
               JOIN export_jobs ej ON ej.project_id = p.id
               WHERE ej.type = 'framing' AND ej.status = 'complete'"""
        ).fetchone()[0]
        projects_completed = cursor.execute(
            """SELECT COUNT(DISTINCT p.id) FROM projects p
               JOIN export_jobs ej ON ej.project_id = p.id
               WHERE ej.type = 'overlay' AND ej.status = 'complete'"""
        ).fetchone()[0]

        conn.close()
        return {
            "games_annotated": games,
            "clips_annotated": clips,
            "projects_framed": projects_framed,
            "projects_completed": projects_completed,
        }
    except Exception as e:
        logger.warning(f"[Admin] Could not read activity counts from {db_path}: {e}")
        return {"games_annotated": 0, "clips_annotated": 0, "projects_framed": 0, "projects_completed": 0}


def _compute_gpu_total_single(db_path: Path) -> Optional[float]:
    """Sum gpu_seconds for a single profile DB. Returns None if no data."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        row = conn.execute(
            "SELECT SUM(gpu_seconds) FROM export_jobs WHERE status = 'complete' AND gpu_seconds IS NOT NULL"
        ).fetchone()
        conn.close()
        if row and row[0] is not None:
            return round(row[0], 2)
        return None
    except Exception as e:
        logger.warning(f"[Admin] Could not read gpu_seconds from {db_path}: {e}")
        return None


async def _get_profile_stats(db_path: Path) -> dict:
    """Compute all stats for a single profile DB (runs in thread)."""
    def _compute():
        activity = _compute_activity_counts_single(db_path)
        quest = _compute_quest_progress_single(db_path)
        gpu = _compute_gpu_total_single(db_path)
        return {**activity, "quest_progress": quest, "gpu_seconds_total": gpu}
    return await asyncio.to_thread(_compute)


# Credit amount -> price in cents mapping (mirrors payments.py CREDIT_PACKS)
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me")
async def admin_me():
    """Check if the current user is an admin. Safe for all users — never 403."""
    user_id = get_current_user_id()
    return {"is_admin": is_admin(user_id), "environment": APP_ENV}


@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=50),
):
    """List users with profile-centric stats. Paginated by profile count. Admin only."""
    _require_admin()

    # Step 1: Get all users from auth.sqlite (fast, no R2)
    users = get_all_users_for_admin()
    credit_stats = get_credit_stats_for_admin()

    # Step 2: Discover profiles for all users (R2 listing — metadata only, no downloads)
    # Build flat list of (user_dict, profile_id) pairs
    user_profiles: list[tuple[dict, str]] = []
    user_map: dict[str, dict] = {}

    async def _discover_for_user(user: dict):
        user_id = user["user_id"]
        profile_ids = await asyncio.to_thread(_admin_discover_profiles, user_id)
        return user, profile_ids

    discoveries = await asyncio.gather(*[_discover_for_user(u) for u in users])

    for user, profile_ids in discoveries:
        user_map[user["user_id"]] = user
        if not profile_ids:
            # User with no profiles still gets a row (user-level data only)
            user_profiles.append((user, None))
        else:
            for pid in profile_ids:
                user_profiles.append((user, pid))

    total_profiles = len(user_profiles)
    total_pages = max(1, math.ceil(total_profiles / page_size))
    page = min(page, total_pages)

    # Step 3: Slice to current page
    start = (page - 1) * page_size
    end = start + page_size
    page_items = user_profiles[start:end]

    # Step 4: Download profile DBs for this page and compute stats
    async def _get_profile_data(user: dict, profile_id: Optional[str]) -> tuple[str, Optional[str], dict]:
        if profile_id is None:
            return user["user_id"], None, {}
        db_path = await _admin_ensure_profile_db(user["user_id"], profile_id)
        if db_path is None:
            return user["user_id"], profile_id, {}
        stats = await _get_profile_stats(db_path)
        return user["user_id"], profile_id, stats

    profile_results = await asyncio.gather(*[
        _get_profile_data(user, pid) for user, pid in page_items
    ])

    # Step 5: Group results by user for response
    grouped: dict[str, dict] = {}
    for user_id, profile_id, stats in profile_results:
        if user_id not in grouped:
            user = user_map[user_id]
            user_credit = credit_stats.get(user_id, {
                "credits_spent": 0, "credits_purchased": 0,
                "credits_balance": 0, "purchase_credit_amounts": [],
            })
            grouped[user_id] = {
                "user_id": user_id,
                "email": user.get("email"),
                "credits": user_credit["credits_balance"],
                "credits_spent": user_credit["credits_spent"],
                "credits_purchased": user_credit["credits_purchased"],
                "money_spent_cents": _compute_money_spent_cents(user_credit["purchase_credit_amounts"]),
                "last_seen_at": user.get("last_seen_at"),
                "created_at": user.get("created_at"),
                "profiles": [],
            }
        if profile_id is not None:
            grouped[user_id]["profiles"].append({
                "profile_id": profile_id,
                **stats,
            })

    # Preserve order from page_items
    seen = set()
    result_users = []
    for user, pid in page_items:
        uid = user["user_id"]
        if uid not in seen:
            seen.add(uid)
            result_users.append(grouped[uid])

    return {
        "users": result_users,
        "page": page,
        "page_size": page_size,
        "total_profiles": total_profiles,
        "total_pages": total_pages,
    }


@router.get("/users/{user_id}/gpu-usage")
async def get_gpu_usage(user_id: str, profile_id: Optional[str] = Query(None)):
    """GPU usage drilldown. If profile_id given, scopes to that profile. Admin only."""
    _require_admin()

    # Determine which profile DBs to query
    if profile_id:
        db_path = await _admin_ensure_profile_db(user_id, profile_id)
        db_paths = [db_path] if db_path else []
    else:
        # All profiles for the user
        profile_ids = await asyncio.to_thread(_admin_discover_profiles, user_id)
        paths = await asyncio.gather(*[
            _admin_ensure_profile_db(user_id, pid) for pid in profile_ids
        ])
        db_paths = [p for p in paths if p is not None]

    if not db_paths:
        return {"total_gpu_seconds": None, "by_function": {}, "recent_jobs": []}

    total = 0.0
    by_function: dict[str, dict] = {}
    recent_jobs = []

    def _query_gpu(db_path: Path):
        _total = 0.0
        _by_fn = {}
        _jobs = []
        try:
            conn = sqlite3.connect(str(db_path), timeout=5)
            conn.row_factory = sqlite3.Row

            rows = conn.execute(
                """SELECT modal_function, COUNT(*) as cnt, SUM(gpu_seconds) as total_sec
                   FROM export_jobs
                   WHERE status = 'complete' AND gpu_seconds IS NOT NULL
                   GROUP BY modal_function"""
            ).fetchall()
            for row in rows:
                fn = row["modal_function"] or "unknown"
                _by_fn[fn] = {"count": row["cnt"], "total_seconds": round(row["total_sec"] or 0, 2)}
                _total += row["total_sec"] or 0

            job_rows = conn.execute(
                """SELECT id, type, gpu_seconds, status, created_at
                   FROM export_jobs
                   WHERE gpu_seconds IS NOT NULL
                   ORDER BY created_at DESC LIMIT 20"""
            ).fetchall()
            _jobs = [dict(r) for r in job_rows]
            conn.close()
        except Exception as e:
            logger.warning(f"[Admin] Could not read GPU usage from {db_path}: {e}")
        return _total, _by_fn, _jobs

    results = await asyncio.gather(*[asyncio.to_thread(_query_gpu, p) for p in db_paths])

    for _total, _by_fn, _jobs in results:
        total += _total
        for fn, data in _by_fn.items():
            if fn not in by_function:
                by_function[fn] = {"count": 0, "total_seconds": 0.0}
            by_function[fn]["count"] += data["count"]
            by_function[fn]["total_seconds"] = round(by_function[fn]["total_seconds"] + data["total_seconds"], 2)
        recent_jobs.extend(_jobs)

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
