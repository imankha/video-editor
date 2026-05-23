"""
Admin Router — Admin panel endpoints.

All /api/admin/* endpoints require the requesting user to be in the admin_users table.
GET /api/admin/me is the only exception — it returns {is_admin: bool} safely for any user.

T3020: Milestones-based architecture. Stats come from a single Postgres JOIN
against user_milestones. No more R2 profile downloads or SQLite counting.
"""

import asyncio
import logging
import math

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from ..storage import APP_ENV
from ..user_context import get_current_user_id
from ..services.auth_db import (
    is_admin,
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
from ..services.pg import get_pg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

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
# Credit helpers
# ---------------------------------------------------------------------------

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
    """List users with milestone stats from Postgres. Paginated by user count. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) AS cnt FROM users")
        total_users = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total_users / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size

        cur.execute("""
            SELECT
                u.user_id, u.email,
                m.origin_type, m.origin_channel, m.install_day,
                m.game_created_count, m.clip_created_count,
                m.export_completed_count, m.export_failed_count,
                m.share_completed_count, m.credit_purchase_count,
                m.credits_consumed_count, m.session_count,
                m.last_active_at
            FROM users u
            LEFT JOIN user_milestones m ON u.user_id = m.user_id
            ORDER BY m.last_active_at DESC NULLS LAST
            LIMIT %s OFFSET %s
        """, (page_size, offset))

        rows = cur.fetchall()

    credit_stats = get_credit_stats_for_admin()

    users = []
    for row in rows:
        user_id = row["user_id"]
        user_credit = credit_stats.get(user_id, {
            "credits_spent": 0, "credits_purchased": 0,
            "credits_balance": 0, "purchase_credit_amounts": [],
        })
        users.append({
            "user_id": user_id,
            "email": row["email"],
            "origin_type": row["origin_type"],
            "origin_channel": row["origin_channel"],
            "install_day": str(row["install_day"]) if row["install_day"] else None,
            "game_created_count": row["game_created_count"] or 0,
            "clip_created_count": row["clip_created_count"] or 0,
            "export_completed_count": row["export_completed_count"] or 0,
            "export_failed_count": row["export_failed_count"] or 0,
            "share_completed_count": row["share_completed_count"] or 0,
            "credit_purchase_count": row["credit_purchase_count"] or 0,
            "credits": user_credit["credits_balance"],
            "credits_spent": user_credit["credits_spent"],
            "credits_purchased": user_credit["credits_purchased"],
            "money_spent_cents": _compute_money_spent_cents(user_credit["purchase_credit_amounts"]),
            "last_active_at": row["last_active_at"].isoformat() if row["last_active_at"] else None,
            "session_count": row["session_count"] or 0,
        })

    return {
        "users": users,
        "page": page,
        "page_size": page_size,
        "total_users": total_users,
        "total_pages": total_pages,
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

import os as _os

_SECURE_COOKIES = _os.getenv("SECURE_COOKIES", "false").lower() == "true"
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


# ---------------------------------------------------------------------------
# Share cleanup (T2847)
# ---------------------------------------------------------------------------

@router.post("/cleanup-shares")
async def cleanup_shares():
    """Run share table retention cleanup. Admin only."""
    _require_admin()

    from ..services.sharing_db import (
        cleanup_resolved_pending_shares,
        expire_stale_pending_shares,
        cleanup_old_shares,
    )

    resolved = cleanup_resolved_pending_shares()
    expired = expire_stale_pending_shares()
    old = cleanup_old_shares()

    return {
        "resolved_pending_deleted": resolved,
        "stale_pending_expired": expired,
        "old_shares_deleted": old,
    }


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

@router.post("/migrate")
async def run_migrations():
    """Run all pending migrations for all users on this environment."""
    _require_admin()
    result = await asyncio.to_thread(_run_all_migrations)
    return result


def _run_all_migrations() -> dict:
    from ..migrations import run_all_migrations
    return run_all_migrations()


# ---------------------------------------------------------------------------
# Referral stats (T2910)
# ---------------------------------------------------------------------------

@router.get("/referrals/leaderboard")
async def referral_leaderboard():
    """Referral counts per user, ordered descending."""
    _require_admin()
    from ..services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.referrer_id, u.email, COUNT(*) AS referral_count
            FROM referrals r
            JOIN users u ON u.user_id = r.referrer_id
            GROUP BY r.referrer_id, u.email
            ORDER BY referral_count DESC
        """)
        return cur.fetchall()


@router.get("/referrals/by-channel")
async def referrals_by_channel():
    """Referral counts broken down by channel."""
    _require_admin()
    from ..services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT channel, COUNT(*) AS count
            FROM referrals
            GROUP BY channel
            ORDER BY count DESC
        """)
        return cur.fetchall()


@router.get("/referrals/user/{user_id}")
async def referrals_for_user(user_id: str):
    """Direct referrals for a single user."""
    _require_admin()
    from ..services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT r.referred_id, u.email, r.channel, r.source_id, r.created_at
            FROM referrals r
            JOIN users u ON u.user_id = r.referred_id
            WHERE r.referrer_id = %s
            ORDER BY r.created_at DESC
        """, (user_id,))
        return cur.fetchall()


@router.get("/referrals/tree/{user_id}")
async def referral_tree(user_id: str):
    """Recursive referral tree size (depth <= 5)."""
    _require_admin()
    from ..services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            WITH RECURSIVE tree AS (
                SELECT referred_id, 1 AS depth
                FROM referrals WHERE referrer_id = %s
                UNION ALL
                SELECT r.referred_id, t.depth + 1
                FROM referrals r
                JOIN tree t ON r.referrer_id = t.referred_id
                WHERE t.depth < 5
            )
            SELECT depth, COUNT(*) AS count FROM tree GROUP BY depth ORDER BY depth
        """, (user_id,))
        rows = cur.fetchall()
        total = sum(r["count"] for r in rows)
        return {"user_id": user_id, "total": total, "by_depth": rows}
