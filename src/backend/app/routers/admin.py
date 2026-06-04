"""
Admin Router — Admin panel endpoints.

All /api/admin/* endpoints require the requesting user to be in the admin_users table.
GET /api/admin/me is the only exception — it returns {is_admin: bool} safely for any user.

T3020/T3450: Stats from user_segments + user_actions. No more R2 profile
downloads or SQLite counting.
"""

import asyncio
import logging
import math
from typing import Optional

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
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

def _compute_money_spent_cents(purchase_credit_amounts: list[int]) -> int:
    """Map individual Stripe purchase credit amounts to total dollars spent (in cents)."""
    from ..analytics import CREDIT_AMOUNT_TO_CENTS
    total = 0
    for amount in purchase_credit_amounts:
        total += CREDIT_AMOUNT_TO_CENTS.get(amount, 0)
    return total


def _compute_last_step(actions: set[str]) -> str:
    from ..analytics import FUNNEL_STEPS, FLOW_EVENTS
    for step in reversed(FUNNEL_STEPS):
        if step in actions:
            return FLOW_EVENTS[step]["label"]
    return "Signed Up"


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
    origin: str = Query(None),
    acquired_from: str = Query(None),
    acquired_to: str = Query(None),
    filter: str = Query(None),
):
    """List users with milestone stats from Postgres. Paginated by user count. Admin only."""
    _require_admin()

    where_parts, params = _build_segment_filter(origin, acquired_from, acquired_to, filter)

    where_clause = ""
    if where_parts:
        where_clause = "WHERE " + " AND ".join(where_parts)

    with get_pg() as conn:
        cur = conn.cursor()

        cur.execute(f"""
            SELECT COUNT(*) AS cnt
            FROM users u
            JOIN user_segments s ON u.user_id = s.user_id
            {where_clause}
        """, params)
        total_users = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total_users / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size

        cur.execute(f"""
            SELECT
                u.user_id, u.email,
                s.origin, s.acquired_at,
                s.total_spent_cents, s.last_active_at,
                s.total_usage_seconds, s.current_session_start
            FROM users u
            JOIN user_segments s ON u.user_id = s.user_id
            {where_clause}
            ORDER BY s.last_active_at DESC NULLS LAST
            LIMIT %s OFFSET %s
        """, params + [page_size, offset])

        rows = cur.fetchall()
        page_user_ids = [row["user_id"] for row in rows]

        if page_user_ids:
            cur.execute("""
                SELECT user_id, action, count
                FROM user_actions
                WHERE user_id = ANY(%s)
            """, (page_user_ids,))
            action_rows = cur.fetchall()
        else:
            action_rows = []

        actions_by_user: dict[str, dict[str, int]] = {}
        for ar in action_rows:
            actions_by_user.setdefault(ar["user_id"], {})[ar["action"]] = ar["count"]

        from ..analytics import FUNNEL_STEPS, FLOW_EVENTS

        funnel_join = f"JOIN user_segments s ON a.user_id = s.user_id {where_clause}" if where_parts else ""
        funnel_params = list(params) if where_parts else []
        cur.execute(f"""
            SELECT a.action, COUNT(DISTINCT a.user_id) AS users
            FROM user_actions a
            {funnel_join}
            GROUP BY a.action
        """, funnel_params)
        action_totals = {r["action"]: r["users"] for r in cur.fetchall()}

        funnel_totals = {"signed_up": total_users}
        for step in FUNNEL_STEPS:
            label = FLOW_EVENTS[step]["label"]
            key = label.lower().replace(" ", "_")
            funnel_totals[key] = action_totals.get(step, 0)

    credit_stats = get_credit_stats_for_admin(page_user_ids)

    users = []
    for row in rows:
        user_id = row["user_id"]
        user_credit = credit_stats.get(user_id, {
            "credits_spent": 0, "credits_purchased": 0,
            "credits_balance": 0, "purchase_credit_amounts": [],
        })

        user_actions = actions_by_user.get(user_id, {})
        last_step = _compute_last_step(set(user_actions.keys()))
        session_count = user_actions.get("session_started", 0)
        action_count = sum(user_actions.values())

        effective_usage = row["total_usage_seconds"] or 0
        if row["current_session_start"] and row["last_active_at"]:
            now_utc = datetime.now(timezone.utc)
            if (now_utc - row["last_active_at"]).total_seconds() < 1800:
                unclosed = int((now_utc - row["current_session_start"]).total_seconds())
                effective_usage += min(unclosed, 1800)

        users.append({
            "user_id": user_id,
            "email": row["email"],
            "origin": row["origin"],
            "acquired_at": str(row["acquired_at"]) if row["acquired_at"] else None,
            "game_created_count": user_actions.get("game_created", 0),
            "clip_created_count": user_actions.get("clip_created", 0),
            "export_completed_count": user_actions.get("export_completed", 0),
            "export_failed_count": user_actions.get("export_failed", 0),
            "share_completed_count": user_actions.get("share_completed", 0),
            "credit_purchase_count": user_actions.get("credit_purchased", 0),
            "credits": user_credit["credits_balance"],
            "credits_spent": user_credit["credits_spent"],
            "credits_purchased": user_credit["credits_purchased"],
            "total_spent_cents": row["total_spent_cents"] or 0,
            "last_active_at": row["last_active_at"].isoformat() if row["last_active_at"] else None,
            "session_count": session_count,
            "last_step": last_step,
            "action_count": action_count,
            "total_usage_seconds": effective_usage,
        })

    return {
        "users": users,
        "page": page,
        "page_size": page_size,
        "total_users": total_users,
        "total_pages": total_pages,
        "funnel_totals": funnel_totals,
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

from app.utils.cookies import set_cookie as _set_cookie_raw, delete_cookie as _delete_cookie_raw


def _set_session_cookie(response: Response, session_id: str) -> None:
    _set_cookie_raw(response, "rb_session", session_id)


def _clear_machine_pin_cookie(response: Response) -> None:
    """T1190 hook: clear fly_machine_id so the next request re-routes to the
    correct Fly machine for whichever user we are now acting as."""
    _delete_cookie_raw(response, "fly_machine_id")


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
# Analytics dashboards (T3030)
# ---------------------------------------------------------------------------

@router.get("/analytics/funnel")
async def analytics_funnel(
    request: Request,
    origin: str = Query("all"),
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
):
    _require_admin()
    d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else date.today()

    from ..analytics import FUNNEL_STEPS, FLOW_EVENTS

    with get_pg() as conn:
        cur = conn.cursor()

        origin_filter = ""
        params: list = [d_from, d_to]
        if origin != "all":
            origin_filter = "AND s.origin = %s"
            params.append(origin)

        cur.execute(f"""
            SELECT s.origin,
                   COUNT(DISTINCT s.user_id) AS signed_up
            FROM user_segments s
            WHERE s.acquired_at BETWEEN %s AND %s {origin_filter}
            GROUP BY s.origin
        """, params)
        signup_rows = {r["origin"]: r["signed_up"] for r in cur.fetchall()}

        cur.execute(f"""
            SELECT s.origin, a.action,
                   COUNT(DISTINCT a.user_id) AS users
            FROM user_actions a
            JOIN user_segments s ON a.user_id = s.user_id
            WHERE s.acquired_at BETWEEN %s AND %s {origin_filter}
            GROUP BY s.origin, a.action
        """, params)
        action_rows = cur.fetchall()

        by_origin: dict[str, dict] = {}
        for o, signup_count in signup_rows.items():
            row_data = {"origin": o, "signed_up": signup_count}
            for step in FUNNEL_STEPS:
                label = FLOW_EVENTS[step]["label"]
                row_data[label.lower().replace(" ", "_")] = 0
            by_origin[o] = row_data

        for ar in action_rows:
            o = ar["origin"]
            if o not in by_origin:
                continue
            cfg = FLOW_EVENTS.get(ar["action"])
            if cfg and cfg["label"]:
                key = cfg["label"].lower().replace(" ", "_")
                by_origin[o][key] = ar["users"]

        rows = list(by_origin.values())

        if origin == "all" and rows:
            totals = {"origin": "all", "signed_up": sum(r["signed_up"] for r in rows)}
            for step in FUNNEL_STEPS:
                label = FLOW_EVENTS[step]["label"]
                key = label.lower().replace(" ", "_")
                totals[key] = sum(r.get(key, 0) for r in rows)
            rows = [totals] + rows

    return {"funnel": rows, "from": str(d_from), "to": str(d_to)}


@router.get("/analytics/channels")
async def analytics_channels(
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
):
    _require_admin()
    d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else date.today()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                s.origin,
                COUNT(DISTINCT s.user_id) AS users,
                COUNT(DISTINCT s.user_id) FILTER (WHERE s.referrer_id IS NULL) AS direct,
                COUNT(DISTINCT s.user_id) FILTER (WHERE s.referrer_id IS NOT NULL) AS viral,
                COUNT(DISTINCT CASE WHEN a_exp.action = 'export_completed' THEN s.user_id END) AS exported,
                COUNT(DISTINCT CASE WHEN a_pur.action = 'credit_purchased' THEN s.user_id END) AS purchased,
                COALESCE(SUM(a_exp.count), 0) AS total_exports,
                SUM(s.total_spent_cents) AS revenue_cents
            FROM user_segments s
            LEFT JOIN user_actions a_exp ON s.user_id = a_exp.user_id AND a_exp.action = 'export_completed'
            LEFT JOIN user_actions a_pur ON s.user_id = a_pur.user_id AND a_pur.action = 'credit_purchased'
            WHERE s.acquired_at BETWEEN %s AND %s
            GROUP BY s.origin
            ORDER BY SUM(s.total_spent_cents) DESC NULLS LAST
        """, (d_from, d_to))
        rows = cur.fetchall()

    channels = []
    for r in rows:
        users = r["users"]
        revenue = r["revenue_cents"] or 0
        channels.append({
            "origin": r["origin"],
            "users": users,
            "direct": r["direct"],
            "viral": r["viral"],
            "exported": r["exported"],
            "export_pct": round(r["exported"] / users * 100, 1) if users else 0,
            "purchased": r["purchased"],
            "purchase_pct": round(r["purchased"] / users * 100, 1) if users else 0,
            "avg_exports": round(r["total_exports"] / users, 1) if users else 0,
            "revenue_cents": revenue,
        })

    return {"channels": channels}


@router.get("/analytics/cohorts")
async def analytics_cohorts(
    granularity: str = Query("week"),
    origin: str = Query("all"),
):
    from ..analytics import FUNNEL_STEPS, FLOW_EVENTS

    _require_admin()
    trunc = "week" if granularity == "week" else "month"
    params: list = []

    origin_filter = ""
    if origin != "all":
        origin_filter = "WHERE s.origin = %s"
        params.append(origin)

    with get_pg() as conn:
        cur = conn.cursor()

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                COUNT(*) AS signups,
                COALESCE(SUM(s.total_spent_cents), 0) AS revenue_cents
            FROM user_segments s
            {origin_filter}
            GROUP BY cohort_period
            ORDER BY cohort_period DESC
        """, [trunc] + params)
        signup_data = {}
        for r in cur.fetchall():
            cp = str(r["cohort_period"])
            signup_data[cp] = {"signups": r["signups"], "revenue_cents": r["revenue_cents"] or 0}

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                a.action,
                COUNT(DISTINCT a.user_id) AS users
            FROM user_actions a
            JOIN user_segments s ON a.user_id = s.user_id
            {origin_filter}
            GROUP BY cohort_period, a.action
            ORDER BY cohort_period DESC
        """, [trunc] + params)
        action_rows = cur.fetchall()

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (a.first_at - s.created_at)) / 86400.0
                ) AS median_days_to_export
            FROM user_segments s
            JOIN user_actions a ON s.user_id = a.user_id AND a.action = 'export_completed'
            {origin_filter}
            GROUP BY cohort_period
        """, [trunc] + params)
        tte_rows = {str(r["cohort_period"]): round(float(r["median_days_to_export"]), 1) if r["median_days_to_export"] else None for r in cur.fetchall()}

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                COUNT(DISTINCT s.user_id) FILTER (
                    WHERE s.last_active_at >= s.created_at + INTERVAL '7 days'
                ) AS returned
            FROM user_segments s
            {origin_filter}
            GROUP BY cohort_period
        """, [trunc] + params)
        return_rows = {str(r["cohort_period"]): r["returned"] for r in cur.fetchall()}

    by_cohort: dict[str, dict] = {}
    for cp, data in signup_data.items():
        by_cohort[cp] = {
            "cohort_period": cp,
            "signups": data["signups"],
            "revenue_cents": data["revenue_cents"],
        }

    for ar in action_rows:
        cp = str(ar["cohort_period"])
        if cp not in by_cohort:
            continue
        cfg = FLOW_EVENTS.get(ar["action"])
        if cfg and cfg["label"]:
            key = cfg["label"].lower().replace(" ", "_") + "_pct"
            s = by_cohort[cp]["signups"]
            by_cohort[cp][key] = round(ar["users"] / s * 100) if s else 0

    cohorts = []
    for cp in sorted(by_cohort.keys(), reverse=True):
        row = by_cohort[cp]
        for step in FUNNEL_STEPS:
            label = FLOW_EVENTS[step]["label"]
            key = label.lower().replace(" ", "_") + "_pct"
            row.setdefault(key, 0)
        row["time_to_export_days"] = tte_rows.get(cp)
        returned = return_rows.get(cp, 0)
        s = row["signups"]
        row["return_7d_pct"] = round(returned / s * 100) if s else 0
        cohorts.append(row)

    return {"cohorts": cohorts, "granularity": granularity}


@router.get("/analytics/journey/{user_id}")
async def analytics_journey(user_id: str):
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE user_id = %s", (user_id,))
        user_row = cur.fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute("""
            SELECT origin, referrer_id, acquired_at, last_active_at, created_at
            FROM user_segments WHERE user_id = %s
        """, (user_id,))
        seg = cur.fetchone()

        if not seg:
            raise HTTPException(status_code=404, detail="No segment data for user")

        cur.execute("""
            SELECT action, first_at, count
            FROM user_actions
            WHERE user_id = %s
            ORDER BY first_at NULLS LAST
        """, (user_id,))
        action_rows = cur.fetchall()

    completed = []

    completed.append({
        "event": "signup_completed",
        "at": seg["created_at"].isoformat() if seg["created_at"] else None,
    })

    from ..analytics import FLOW_EVENTS
    seen_actions = set()
    for ar in action_rows:
        seen_actions.add(ar["action"])
        entry: dict = {"event": ar["action"], "at": ar["first_at"].isoformat() if ar["first_at"] else None}
        if ar["count"] is not None:
            entry["count"] = ar["count"]
        completed.append(entry)

    pending = [{"event": ev, "at": None} for ev in FLOW_EVENTS if ev not in seen_actions]

    completed.sort(key=lambda x: x["at"] or "")
    milestones = completed + pending

    session_count = next((ar["count"] for ar in action_rows if ar["action"] == "session_started"), 0)

    return {
        "user_id": user_id,
        "email": user_row["email"],
        "origin": seg["origin"],
        "acquired_at": str(seg["acquired_at"]) if seg["acquired_at"] else None,
        "milestones": milestones,
        "session_count": session_count,
        "last_active_at": seg["last_active_at"].isoformat() if seg["last_active_at"] else None,
    }


@router.get("/analytics/user/{user_id}/actions")
async def analytics_user_actions(
    user_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    _require_admin()

    from ..services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (user_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

    import json
    from ..services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        total_row = conn.execute("SELECT COUNT(*) as cnt FROM user_action_log").fetchone()
        total = total_row["cnt"]

        offset = (page - 1) * page_size
        rows = conn.execute(
            "SELECT id, action, context, created_at FROM user_action_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (page_size, offset),
        ).fetchall()

    actions = []
    for r in rows:
        ctx = None
        if r["context"]:
            try:
                ctx = json.loads(r["context"])
            except (json.JSONDecodeError, TypeError):
                ctx = r["context"]
        actions.append({
            "id": r["id"],
            "action": r["action"],
            "context": ctx,
            "created_at": r["created_at"],
        })

    return {"actions": actions, "total": total, "page": page, "page_size": page_size}


def _build_segment_filter(origin, acquired_from, acquired_to, user_filter):
    where_parts = []
    params = []
    if origin:
        where_parts.append("s.origin = %s")
        params.append(origin)
    if acquired_from:
        where_parts.append("s.acquired_at >= %s")
        params.append(date.fromisoformat(acquired_from))
    if acquired_to:
        where_parts.append("s.acquired_at <= %s")
        params.append(date.fromisoformat(acquired_to))
    if user_filter == "paying":
        where_parts.append("s.total_spent_cents > 0")
    elif user_filter == "active_7d":
        where_parts.append("s.last_active_at > now() - INTERVAL '7 days'")
    elif user_filter == "has_exports":
        where_parts.append(
            "EXISTS (SELECT 1 FROM user_actions a WHERE a.user_id = s.user_id AND a.action = 'export_completed')"
        )
    elif user_filter == "invited_others":
        where_parts.append(
            "s.user_id IN (SELECT DISTINCT referrer_id FROM user_segments WHERE referrer_id IS NOT NULL)"
        )
    elif user_filter == "was_invited":
        where_parts.append("s.referrer_id IS NOT NULL")
    return where_parts, params


@router.get("/analytics/pulse")
async def analytics_pulse(
    days: int = Query(30, ge=7, le=90),
    origin: str = Query(None),
    acquired_from: str = Query(None),
    acquired_to: str = Query(None),
    filter: str = Query(None),
):
    _require_admin()
    today = date.today()
    start = today - timedelta(days=days - 1)

    filter_parts, filter_params = _build_segment_filter(origin, acquired_from, acquired_to, filter)
    has_filter = bool(filter_parts)

    with get_pg() as conn:
        cur = conn.cursor()

        if has_filter:
            seg_where = "WHERE " + " AND ".join(filter_parts)

            cur.execute(f"""
                SELECT s.acquired_at::date AS d, COUNT(*) AS cnt
                FROM user_segments s
                {seg_where} AND s.acquired_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, filter_params + [start, today])
            signup_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            cur.execute(f"""
                SELECT a.first_at::date AS d, COUNT(DISTINCT a.user_id) AS cnt
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id
                {seg_where} AND a.action = 'export_completed' AND a.first_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, filter_params + [start, today])
            export_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            if origin and not acquired_from and not acquired_to and not filter:
                cur.execute("""
                    SELECT counter_date AS d, sessions_started AS cnt
                    FROM daily_counters
                    WHERE origin_type = %s AND counter_date BETWEEN %s AND %s
                    ORDER BY counter_date
                """, (origin, start, today))
                active_by_date = {r["d"]: r["cnt"] for r in cur.fetchall() if r["cnt"]}
            else:
                cur.execute(f"""
                    SELECT s.last_active_at::date AS d, COUNT(*) AS cnt
                    FROM user_segments s
                    {seg_where} AND s.last_active_at::date BETWEEN %s AND %s
                    GROUP BY d ORDER BY d
                """, filter_params + [start, today])
                active_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            cur.execute(f"""
                SELECT COALESCE(SUM(s.total_spent_cents), 0) AS total
                FROM user_segments s
                {seg_where}
            """, filter_params)
            revenue_total = cur.fetchone()["total"]

            cur.execute(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN a.action = 'share_completed' THEN a.count END), 0) AS shares,
                    COALESCE(SUM(CASE WHEN a.action = 'share_viewed' THEN a.count END), 0) AS views
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id
                {seg_where} AND a.action IN ('share_completed', 'share_viewed')
            """, filter_params)
            sv = cur.fetchone()
            total_shares, total_views = sv["shares"], sv["views"]

        else:
            cur.execute("""
                SELECT counter_date, signups, exports_completed, credit_purchases,
                       COALESCE(shares_completed, 0) AS shares_completed,
                       COALESCE(shares_viewed, 0) AS shares_viewed
                FROM daily_counters
                WHERE origin_type = 'all' AND counter_date BETWEEN %s AND %s
                ORDER BY counter_date
            """, (start, today))
            counter_rows = cur.fetchall()
            counter_by_date = {r["counter_date"]: r for r in counter_rows}

            def _cv(d, col):
                r = counter_by_date.get(d)
                return r[col] if r else 0

            signup_by_date = {d: _cv(d, "signups") for d in [(start + timedelta(days=i)) for i in range(days)] if _cv(d, "signups")}
            export_by_date = {d: _cv(d, "exports_completed") for d in [(start + timedelta(days=i)) for i in range(days)] if _cv(d, "exports_completed")}

            active_by_date = {d: _cv(d, "sessions_started") for d in [(start + timedelta(days=i)) for i in range(days)] if _cv(d, "sessions_started")}

            cur.execute("SELECT COALESCE(SUM(total_spent_cents), 0) AS total FROM user_segments")
            revenue_total = cur.fetchone()["total"]

            date_range_tmp = [(start + timedelta(days=i)) for i in range(days)]
            total_shares = sum(_cv(d, "shares_completed") for d in date_range_tmp)
            total_views = sum(_cv(d, "shares_viewed") for d in date_range_tmp)

    date_range = [(start + timedelta(days=i)) for i in range(days)]

    signups_spark = [signup_by_date.get(d, 0) for d in date_range]
    exports_spark = [export_by_date.get(d, 0) for d in date_range]
    active_spark = [active_by_date.get(d, 0) for d in date_range]

    viral_pct = round(total_views / total_shares * 100, 1) if total_shares else 0
    viral_spark = []
    for d in date_range:
        s_val = signup_by_date.get(d, 0)
        viral_spark.append(0)

    def make_card(sparkline, today_val=None, week_ago_val=None):
        t = today_val if today_val is not None else (sparkline[-1] if sparkline else 0)
        w = week_ago_val if week_ago_val is not None else (sparkline[-8] if len(sparkline) >= 8 else 0)
        change = round((t - w) / w * 100, 1) if w else (100.0 if t else 0.0)
        return {"today": t, "last_week_same_day": w, "change_pct": change, "sparkline": sparkline}

    return {
        "cards": {
            "signups": make_card(signups_spark),
            "exports": make_card(exports_spark),
            "active_users": make_card(active_spark),
            "revenue": {"today": revenue_total, "sparkline": [], "change_pct": 0},
            "viral_conversion": {"today": viral_pct, "sparkline": [], "change_pct": 0},
        },
        "days": days,
    }


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


# ---------------------------------------------------------------------------
# Bug reports (T3100)
# ---------------------------------------------------------------------------

BUG_STATUSES = {"new", "testing", "done", "duplicate"}


@router.get("/bugs")
async def list_bugs(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List bug reports, optionally filtered by status. Paginated. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()

        where_clause = ""
        params: list = []
        if status:
            statuses = [s.strip() for s in status.split(",") if s.strip() in BUG_STATUSES]
            if statuses:
                where_clause = "WHERE status = ANY(%s)"
                params.append(statuses)

        cur.execute(f"SELECT COUNT(*) AS cnt FROM bug_reports {where_clause}", params)
        total = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size
        cur.execute(f"""
            SELECT id, reporter_email, description, page_url, build, status,
                   editor_context, duplicate_of, created_at
            FROM bug_reports {where_clause}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """, params + [page_size, offset])
        rows = cur.fetchall()

    bugs = []
    for row in rows:
        desc = row["description"]
        mode = None
        if row["editor_context"] and isinstance(row["editor_context"], dict):
            mode = row["editor_context"].get("mode")
        bugs.append({
            "id": row["id"],
            "reporter_email": row["reporter_email"],
            "description": desc[:200] if desc else None,
            "page_url": row["page_url"],
            "build": row["build"],
            "status": row["status"],
            "editor_mode": mode,
            "duplicate_of": row["duplicate_of"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    return {"bugs": bugs, "total": total, "page": page, "total_pages": total_pages}


@router.get("/bugs/{bug_id}")
async def get_bug(bug_id: int):
    """Get full bug detail including all JSONB fields and presigned screenshot URL. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM bug_reports WHERE id = %s", (bug_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Bug not found")

    from ..storage import generate_presigned_url_global

    screenshot_url = None
    if row["screenshot_r2_key"]:
        screenshot_url = generate_presigned_url_global(row["screenshot_r2_key"])

    logs_url = None
    if row.get("logs_r2_key"):
        logs_url = generate_presigned_url_global(row["logs_r2_key"])

    result = dict(row)
    for field in ("created_at", "updated_at", "resolved_at"):
        if result[field]:
            result[field] = result[field].isoformat()
    result["screenshot_url"] = screenshot_url
    result["logs_url"] = logs_url

    return result


@router.get("/bugs/{bug_id}/correlated")
async def get_correlated_bugs(bug_id: int):
    """Get all bugs in a duplicate cluster with metadata for delta analysis."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, duplicate_of FROM bug_reports WHERE id = %s", (bug_id,))
        bug = cur.fetchone()
        if not bug:
            raise HTTPException(status_code=404, detail="Bug not found")

        primary_id = bug["duplicate_of"] or bug["id"]

        cur.execute("""
            SELECT id, reporter_email, description, build, editor_context,
                   actions, console_logs, screenshot_r2_key, logs_r2_key,
                   status, duplicate_of, created_at
            FROM bug_reports
            WHERE id = %s OR duplicate_of = %s
            ORDER BY created_at ASC
        """, (primary_id, primary_id))
        cluster = cur.fetchall()

    if len(cluster) <= 1:
        return {"primary_id": primary_id, "cluster_size": len(cluster), "bugs": []}

    from ..storage import generate_presigned_url_global

    bugs = []
    for row in cluster:
        errors = []
        if row["console_logs"] and isinstance(row["console_logs"], list):
            for entry in row["console_logs"]:
                if isinstance(entry, dict) and entry.get("level") == "error":
                    msg = entry.get("message", "")
                    if msg and msg not in errors:
                        errors.append(msg)

        action_types = []
        if row["actions"] and isinstance(row["actions"], list):
            action_types = [
                a.get("type", a.get("action", "unknown"))
                for a in row["actions"] if isinstance(a, dict)
            ]

        screenshot_url = None
        if row["screenshot_r2_key"]:
            screenshot_url = generate_presigned_url_global(row["screenshot_r2_key"])

        logs_url = None
        if row.get("logs_r2_key"):
            logs_url = generate_presigned_url_global(row["logs_r2_key"])

        mode = None
        if row["editor_context"] and isinstance(row["editor_context"], dict):
            mode = row["editor_context"].get("mode")

        bugs.append({
            "id": row["id"],
            "is_primary": row["id"] == primary_id,
            "reporter_email": row["reporter_email"],
            "description": row["description"] or "",
            "build": row["build"],
            "editor_mode": mode,
            "editor_context": row["editor_context"],
            "action_types": action_types,
            "action_count": len(action_types),
            "error_messages": errors,
            "has_screenshot": bool(row["screenshot_r2_key"]),
            "screenshot_url": screenshot_url,
            "has_logs": bool(row.get("logs_r2_key")),
            "logs_url": logs_url,
            "status": row["status"],
            "duplicate_of": row["duplicate_of"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    return {
        "primary_id": primary_id,
        "cluster_size": len(cluster),
        "bugs": bugs,
    }


class BugUpdateRequest(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None
    duplicate_of: Optional[int] = None


@router.patch("/bugs/{bug_id}")
async def update_bug(bug_id: int, body: BugUpdateRequest):
    """Update bug status, notes, or duplicate_of. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, status FROM bug_reports WHERE id = %s", (bug_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Bug not found")

        updates = ["updated_at = NOW()"]
        params: list = []

        if body.status is not None:
            if body.status not in BUG_STATUSES:
                raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
            updates.append("status = %s")
            params.append(body.status)
            if body.status == "done":
                updates.append("resolved_at = NOW()")

        if body.admin_notes is not None:
            updates.append("admin_notes = %s")
            params.append(body.admin_notes)

        if body.duplicate_of is not None:
            if body.duplicate_of == bug_id:
                raise HTTPException(status_code=400, detail="Cannot mark as duplicate of itself")
            cur.execute("SELECT id FROM bug_reports WHERE id = %s", (body.duplicate_of,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="Duplicate target bug not found")
            updates.append("duplicate_of = %s")
            params.append(body.duplicate_of)
            updates.append("status = 'duplicate'")

        params.append(bug_id)
        cur.execute(
            f"UPDATE bug_reports SET {', '.join(updates)} WHERE id = %s RETURNING *",
            params,
        )
        updated = cur.fetchone()

    result = dict(updated)
    for field in ("created_at", "updated_at", "resolved_at"):
        if result[field]:
            result[field] = result[field].isoformat()
    return result


@router.delete("/bugs/purge")
async def purge_old_bugs(days: int = Query(14, ge=1, le=365)):
    """Delete resolved bugs older than N days. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, screenshot_r2_key, logs_r2_key FROM bug_reports "
            "WHERE status = 'done' AND resolved_at < NOW() - INTERVAL '%s days'",
            (days,),
        )
        rows = cur.fetchall()

        if not rows:
            return {"purged": 0}

        from ..storage import r2_delete_object_global

        for row in rows:
            for key in (row["screenshot_r2_key"], row["logs_r2_key"]):
                if key:
                    r2_delete_object_global(key)

        ids = [r["id"] for r in rows]
        cur.execute(
            "DELETE FROM bug_reports WHERE id = ANY(%s)",
            (ids,),
        )

    return {"purged": len(ids), "bug_ids": ids}


@router.delete("/bugs/{bug_id}")
async def delete_bug(bug_id: int):
    """Delete a bug report and its R2 assets. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, screenshot_r2_key, logs_r2_key FROM bug_reports WHERE id = %s",
            (bug_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bug not found")

        from ..storage import r2_delete_object_global

        for key in (row["screenshot_r2_key"], row["logs_r2_key"]):
            if key:
                r2_delete_object_global(key)

        cur.execute("DELETE FROM bug_reports WHERE id = %s", (bug_id,))

    return {"deleted": bug_id}


@router.get("/bugs/{bug_id}/screenshot")
async def get_bug_screenshot(bug_id: int):
    """Redirect to presigned R2 URL for the bug's screenshot. Admin only."""
    _require_admin()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT screenshot_r2_key FROM bug_reports WHERE id = %s", (bug_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Bug not found")
    if not row["screenshot_r2_key"]:
        raise HTTPException(status_code=404, detail="No screenshot for this bug")

    from ..storage import generate_presigned_url_global
    url = generate_presigned_url_global(row["screenshot_r2_key"])
    if not url:
        raise HTTPException(status_code=500, detail="Failed to generate screenshot URL")

    return RedirectResponse(url=url, status_code=307)
