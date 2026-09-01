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
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..services import credit_ledger
from ..services.auth_db import (
    IMPERSONATION_TTL_MINUTES,
    create_impersonation_session,
    find_or_create_admin_restore_session,
    get_user_by_id,
    invalidate_session,
    is_admin,
    log_impersonation,
    validate_session,
)
from ..services.credit_ledger import CreditsUnavailable
from ..services.pg import get_pg
from ..storage import APP_ENV
from ..user_context import get_current_user_id
from ..utils.cookies import delete_cookie as _delete_cookie_raw
from ..utils.cookies import set_cookie as _set_cookie_raw

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# T8170: upload_success_rate pulse-card alarm thresholds. The T8160 outage sat
# at 29% for ~2 days undetected -- below this rate, with a meaningful sample,
# is a real collapse, not noise.
UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT = 70.0
UPLOAD_SUCCESS_ALARM_MIN_ATTEMPTS = 5

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
#
# T5840: credits moved to Postgres -- no more per-user user.sqlite R2 sync
# dance (`_refresh_target_user_db`/`_persist_target_user_db` are gone). Every
# grant/set now carries a real idempotency key, so a durability failure can
# 503 instead of the old `synced: false` best-effort report.
# ---------------------------------------------------------------------------

def _compute_money_spent_cents(purchase_credit_amounts: list[int]) -> int:
    """Map individual Stripe purchase credit amounts to total dollars spent (in cents)."""
    from ..analytics import CREDIT_AMOUNT_TO_CENTS
    total = 0
    for amount in purchase_credit_amounts:
        total += CREDIT_AMOUNT_TO_CENTS.get(amount, 0)
    return total


def _compute_last_step(actions: set[str]) -> str:
    from ..analytics import FLOW_EVENTS, FUNNEL_STEPS
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
# T8020: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def list_users(
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

        # LEFT JOIN (T4970): a user with no user_segments row (test-login/OTP-
        # bypass accounts, copied accounts — segments are created only in the
        # OAuth/OTP signup flows) must still be enumerated, not dropped. An
        # inner join here made such users invisible in GET /api/admin/users.
        # An origin/date filter (where_clause) still legitimately excludes NULL
        # segment fields, so filtered views are unchanged.
        cur.execute(f"""
            SELECT COUNT(*) AS cnt
            FROM users u
            LEFT JOIN user_segments s ON u.user_id = s.user_id
            {where_clause}
        """, params)
        total_users = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total_users / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size

        cur.execute(f"""
            SELECT
                u.user_id, u.email, u.created_at,
                s.origin, s.acquired_at,
                s.total_spent_cents, s.last_active_at,
                s.total_usage_seconds, s.current_session_start
            FROM users u
            LEFT JOIN user_segments s ON u.user_id = s.user_id
            {where_clause}
            ORDER BY s.last_active_at DESC NULLS LAST
            LIMIT %s OFFSET %s
        """, [*params, page_size, offset])

        rows = cur.fetchall()
        page_user_ids = [row["user_id"] for row in rows]

        if page_user_ids:
            cur.execute("""
                SELECT user_id, action, SUM(count) AS count
                FROM user_actions
                WHERE user_id = ANY(%s)
                GROUP BY user_id, action
            """, (page_user_ids,))
            action_rows = cur.fetchall()

            # T5770: trailing-7-day engaged usage per user — ONE grouped query
            # keyed by the page's user ids (no per-user N+1). day >= CURRENT_DATE
            # - 6 covers today..today-6 = 7 distinct days. Shows real recorded
            # buckets only (history is never backfilled).
            cur.execute("""
                SELECT user_id, COALESCE(SUM(seconds), 0) AS last_7d
                FROM user_usage_daily
                WHERE user_id = ANY(%s)
                  AND day >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY user_id
            """, (page_user_ids,))
            last_7d_by_user = {r["user_id"]: r["last_7d"] for r in cur.fetchall()}
        else:
            action_rows = []
            last_7d_by_user = {}

        actions_by_user: dict[str, dict[str, int]] = {}
        for ar in action_rows:
            actions_by_user.setdefault(ar["user_id"], {})[ar["action"]] = ar["count"]

        from ..analytics import FLOW_EVENTS, FUNNEL_STEPS, session_engaged_seconds

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

    credit_stats = credit_ledger.stats_for_admin(page_user_ids)

    users = []
    for row in rows:
        user_id = row["user_id"]
        user_credit = credit_stats.get(user_id)

        user_actions = actions_by_user.get(user_id, {})
        last_step = _compute_last_step(set(user_actions.keys()))
        session_count = user_actions.get("session_started", 0)
        action_count = sum(user_actions.values())

        # T5660: add the still-open session using the SAME accounting as the
        # write side (analytics.session_engaged_seconds) — confirmed span
        # (uncapped, so heavy continuous users aren't clamped) plus a capped idle
        # tail (so an abandoned open tab isn't counted). Symmetric with banking.
        effective_usage = row["total_usage_seconds"] or 0
        if row["current_session_start"] and row["last_active_at"]:
            effective_usage += session_engaged_seconds(
                row["current_session_start"], row["last_active_at"], datetime.now(UTC)
            )

        # T5770: average weekly usage — DERIVED at read time, stored NOWHERE
        # (no-redundant-state rule). Numerator is the same effective usage the
        # Usage column shows (all-time total + any still-open session). Weeks
        # since signup use the segment signup date (acquired_at), falling back to
        # users.created_at when there is no segment row (LEFT JOIN NULL); clamped
        # to a minimum of 1 week so a brand-new signup neither divides by zero nor
        # yields an absurd average. (The task named user_segments.signup_completed_at,
        # which does not exist on that table; acquired_at is its signup-date column.)
        signup_date = row["acquired_at"]
        if signup_date is None and row["created_at"] is not None:
            signup_date = row["created_at"].date()
        if signup_date is not None:
            days_since_signup = (datetime.now(UTC).date() - signup_date).days
            weeks_since_signup = max(1.0, days_since_signup / 7.0)
        else:
            weeks_since_signup = 1.0
        avg_weekly_seconds = round(effective_usage / weeks_since_signup)

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
            "credits": user_credit["credits_balance"] if user_credit else None,
            "credits_spent": user_credit["credits_spent"] if user_credit else 0,
            "credits_purchased": user_credit["credits_purchased"] if user_credit else 0,
            "total_spent_cents": row["total_spent_cents"] or 0,
            "last_active_at": row["last_active_at"].isoformat() if row["last_active_at"] else None,
            "session_count": session_count,
            "last_step": last_step,
            "action_count": action_count,
            "total_usage_seconds": effective_usage,
            "avg_weekly_seconds": avg_weekly_seconds,
            "last_7d_seconds": last_7d_by_user.get(user_id, 0),
        })

    return {
        "users": users,
        "page": page,
        "page_size": page_size,
        "total_users": total_users,
        "total_pages": total_pages,
        "funnel_totals": funnel_totals,
    }


# ---------------------------------------------------------------------------
# T4860: Bulk user actions (grant credits / send update email)
#
# These MUST be registered before /users/{user_id}/grant-credits below: FastAPI
# matches routes in definition order, and /users/bulk/grant-credits would
# otherwise be captured by the {user_id} route with user_id="bulk". A max of
# 100 ids per request keeps the sequential loops bounded. Partial failure is a
# first-class outcome (per-user result), never an all-or-nothing error.
# ---------------------------------------------------------------------------

BULK_MAX_IDS = 100
BULK_SUBJECT_MAX = 200
BULK_BODY_MAX = 10000


class BulkGrantCreditsRequest(BaseModel):
    user_ids: list[str]
    amount: int
    batch_id: str  # minted client-side (UUID) once per bulk click; a retry of the
    # SAME click reuses it (idempotent no-op on double-grant), a new click mints a new one


class BulkEmailRequest(BaseModel):
    user_ids: list[str] = []
    subject: str
    body: str
    test: bool = False


@router.post("/users/bulk/grant-credits")
async def admin_bulk_grant_credits(request: BulkGrantCreditsRequest):
    """Grant credits to many users at once. Admin only.

    Loops sequentially and grants via credit_ledger.grant() with a per-user key
    derived from (admin, batch_id, target_user_id) -- a retry of the whole batch
    (same batch_id) cannot double-grant any user in it. Unknown ids are skipped
    and recorded, not fatal. Credits now live in Postgres, so there is no
    per-user R2 sync step and no `synced` field to report anymore.
    """
    _require_admin()

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if not request.user_ids:
        raise HTTPException(status_code=400, detail="user_ids must not be empty")
    if len(request.user_ids) > BULK_MAX_IDS:
        raise HTTPException(status_code=400, detail=f"Too many users (max {BULK_MAX_IDS})")

    admin_id = get_current_user_id()
    results: list[dict] = []
    granted = 0
    failed = 0
    for uid in request.user_ids:
        user = get_user_by_id(uid)
        if not user:
            results.append({"user_id": uid, "ok": False, "error": "user not found"})
            failed += 1
            continue
        key = f"admin:{admin_id}:{request.batch_id}:{uid}"
        try:
            result = credit_ledger.grant(uid, request.amount, "admin_grant", key)
        except CreditsUnavailable:
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
        except Exception as exc:
            logger.exception(f"[Admin] bulk grant-credits failed for {uid}")
            results.append({"user_id": uid, "ok": False, "error": str(exc)})
            failed += 1
            continue
        # M3: `ok=True` means the request succeeded (no error); `applied`
        # separately says whether IT was the call that moved the balance --
        # a batch_id retry re-reports every user's CURRENT balance with
        # applied=False, never double-granting but never silently reading as
        # a fresh grant either.
        results.append({"user_id": uid, "ok": True, "balance": result["balance"], "applied": result["applied"]})
        granted += 1

    return {"results": results, "granted": granted, "failed": failed}


@router.post("/users/bulk/email")
async def admin_bulk_email(request: BulkEmailRequest):
    """Send an individual branded update email to many users at once. Admin only.

    Renders the template body once, then sends one email per recipient
    sequentially via send_admin_update_email (never one email with many
    recipients — that would leak user emails to each other). Emails are resolved
    from the Postgres users table (project rule, never auth.sqlite). Awaits real
    per-recipient results — no background_tasks, the admin is watching. When
    test=true, user_ids is ignored and one email goes to the calling admin's own
    address so they can confirm rendering before any bulk send.
    """
    _require_admin()

    subject = request.subject.strip()
    body = request.body
    if not (1 <= len(subject) <= BULK_SUBJECT_MAX):
        raise HTTPException(status_code=400, detail=f"subject must be 1..{BULK_SUBJECT_MAX} chars")
    if not body.strip() or len(body) > BULK_BODY_MAX:
        raise HTTPException(status_code=400, detail=f"body must be 1..{BULK_BODY_MAX} chars")

    from ..services.email import body_text_to_html, send_admin_update_email
    body_html = body_text_to_html(body)

    if request.test:
        admin_id = get_current_user_id()
        admin = get_user_by_id(admin_id)
        admin_email = admin.get("email") if admin else None
        if not admin_email:
            raise HTTPException(status_code=400, detail="Admin account has no email on file")
        ok = await send_admin_update_email(admin_email, subject, body_html)
        result = {"user_id": admin_id, "email": admin_email, "ok": ok}
        if not ok:
            result["error"] = "send failed"
        return {"results": [result], "sent": 1 if ok else 0, "failed": 0 if ok else 1}

    if not request.user_ids:
        raise HTTPException(status_code=400, detail="user_ids must not be empty")
    if len(request.user_ids) > BULK_MAX_IDS:
        raise HTTPException(status_code=400, detail=f"Too many users (max {BULK_MAX_IDS})")

    results: list[dict] = []
    sent = 0
    failed = 0
    for uid in request.user_ids:
        user = get_user_by_id(uid)
        email = user.get("email") if user else None
        if not email:
            results.append({"user_id": uid, "ok": False, "error": "no email on file"})
            failed += 1
            continue
        try:
            ok = await send_admin_update_email(email, subject, body_html)
        except Exception as exc:
            logger.exception(f"[Admin] bulk email failed for {uid}")
            results.append({"user_id": uid, "email": email, "ok": False, "error": str(exc)})
            failed += 1
            continue
        if ok:
            results.append({"user_id": uid, "email": email, "ok": True})
            sent += 1
        else:
            results.append({"user_id": uid, "email": email, "ok": False, "error": "send failed"})
            failed += 1

    return {"results": results, "sent": sent, "failed": failed}


class GrantCreditsRequest(BaseModel):
    amount: int
    request_id: str  # minted client-side (UUID) per click; a retry of the SAME
    # click reuses it (idempotent no-op), a new click mints a new one


@router.post("/users/{user_id}/grant-credits")
async def admin_grant_credits(user_id: str, request: GrantCreditsRequest):
    """Grant credits to any user. Admin only.

    Idempotency key is (admin, request_id) -- a retried request_id changes
    nothing (structurally impossible to double-grant, T5840 AC), so unlike the
    old SQLite path this can safely 503 on a durability failure and be retried.
    """
    _require_admin()

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    admin_id = get_current_user_id()
    key = f"admin:{admin_id}:{request.request_id}"
    try:
        result = credit_ledger.grant(user_id, request.amount, "admin_grant", key)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    # M3: surface `applied` -- False means this request_id already ran (a
    # retry), so the 200 must not read as "credits granted just now". Without
    # this a stale-key retry (e.g. a UI bug reusing an old id) shows a green
    # "Credits granted!" while the balance silently did not move.
    return {"balance": result["balance"], "applied": result["applied"]}


class SetCreditsRequest(BaseModel):
    amount: int
    request_id: str


@router.post("/users/{user_id}/set-credits")
async def admin_set_credits(user_id: str, request: SetCreditsRequest):
    """Set a user's credit balance to an exact value. Admin only."""
    _require_admin()

    if request.amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    admin_id = get_current_user_id()
    key = f"adminset:{admin_id}:{request.request_id}"
    try:
        result = credit_ledger.set_balance(user_id, request.amount, key)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    # M3: applied is False both for a same-key retry (delta==0 short circuit
    # OR a reused key with a different target amount, refused) -- either way
    # the caller must be told nothing changed just now.
    return {"balance": result["balance"], "applied": result["applied"]}


# ---------------------------------------------------------------------------
# T5760: Stripe revenue reconciliation (Stripe as source of truth for money)
#
# On-demand only — NEVER on the main user-table load path (list_users makes zero
# Stripe calls). total_spent_cents is a local cache for admin speed; this compares
# it against per-user Stripe NET revenue (net of refunds AND lost disputes) and
# offers an explicit heal gesture. No new table — computed on demand.
# ---------------------------------------------------------------------------


def _load_local_spent_positive() -> dict:
    """user_id -> {email, local_cents} for every user whose local spend is > 0."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT u.user_id, u.email, s.total_spent_cents AS cents
            FROM user_segments s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.total_spent_cents > 0
        """)
        return {
            r["user_id"]: {"email": r["email"], "local_cents": r["cents"] or 0}
            for r in cur.fetchall()
        }


def _emails_for(user_ids: list[str]) -> dict:
    if not user_ids:
        return {}
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, email FROM users WHERE user_id = ANY(%s)", (user_ids,))
        return {r["user_id"]: r["email"] for r in cur.fetchall()}


def _compute_reconciliation() -> tuple[list, dict]:
    """Return (rows, stripe_agg). Fetches Stripe once; pure classification after.

    Covers only users with local spend > 0 OR live Stripe history — aligned rows for
    the whole user base would be noise. Stripe-only users get their email backfilled.
    """
    from ..services.revenue_reconciliation import (
        build_stripe_net_by_user,
        classify_users,
        fetch_stripe_intents,
    )

    stripe_agg = build_stripe_net_by_user(fetch_stripe_intents())
    local = _load_local_spent_positive()

    stripe_only = [uid for uid in stripe_agg if uid not in local]
    if stripe_only:
        for uid, email in _emails_for(stripe_only).items():
            local[uid] = {"email": email, "local_cents": 0}

    rows = classify_users(local, stripe_agg)
    return rows, stripe_agg


def _require_stripe_configured():
    import stripe
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")


@router.get("/revenue-reconciliation")
async def revenue_reconciliation():
    """Per-user local vs Stripe-net revenue with delta + cause. Admin only, on-demand."""
    _require_admin()
    _require_stripe_configured()

    from ..services.revenue_reconciliation import GO_LIVE_DATE

    rows, _ = _compute_reconciliation()
    drifted = [r for r in rows if r["drifted"]]
    summary = {
        "total_users": len(rows),
        "drifted_users": len(drifted),
        "aligned_users": len(rows) - len(drifted),
        "total_local_cents": sum(r["local_cents"] for r in rows),
        "total_stripe_net_cents": sum(r["stripe_net_cents"] for r in rows),
        "total_delta_cents": sum(r["delta_cents"] for r in rows),
    }
    return {
        "rows": rows,
        "summary": summary,
        "go_live_date": GO_LIVE_DATE.isoformat(),
    }


class RevenueHealRequest(BaseModel):
    user_ids: list[str] | None = None
    all_drifted: bool = False


@router.post("/revenue-reconciliation/heal")
async def heal_revenue_reconciliation(request: RevenueHealRequest):
    """Adopt the Stripe net figure into total_spent_cents. Explicit admin gesture.

    Recomputes Stripe truth server-side (never trusts a client-supplied amount) and
    sets each target user's total_spent_cents to their Stripe net (net of refunds and
    lost disputes). ``all_drifted`` heals every drifted user; otherwise heals the
    given ``user_ids``.
    """
    _require_admin()
    _require_stripe_configured()

    from ..analytics import set_total_spent

    rows, stripe_agg = _compute_reconciliation()
    row_by_uid = {r["user_id"]: r for r in rows}

    if request.all_drifted:
        targets = [r["user_id"] for r in rows if r["drifted"]]
    elif request.user_ids:
        targets = request.user_ids
    else:
        raise HTTPException(status_code=400, detail="Provide user_ids or all_drifted")

    results = []
    for uid in targets:
        # Only heal users present in the freshly recomputed report. A user_id the
        # client sends that isn't in the report (never had local spend or live
        # Stripe history) would otherwise be silently zeroed — skip it instead.
        if uid not in row_by_uid:
            results.append({"user_id": uid, "skipped": "not in report", "healed": False})
            continue
        net_cents = stripe_agg.get(uid, {}).get("net_cents", 0)
        old_cents = set_total_spent(uid, net_cents)
        results.append({
            "user_id": uid,
            "old_cents": old_cents,
            "new_cents": net_cents,
            "healed": old_cents is not None,
        })

    return {"results": results, "healed": sum(1 for r in results if r["healed"])}


# ---------------------------------------------------------------------------
# T1510: Impersonation
# ---------------------------------------------------------------------------


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
# Upload lifecycle observability (T7480)
# ---------------------------------------------------------------------------

@router.get("/users/{user_id}/stuck-uploads")
async def stuck_uploads(user_id: str, older_than_hours: float = Query(default=0)):
    """T7480: list a user's abandoned game-upload sessions (prepared, never
    finalized) so an operator can see a stuck upload WITHOUT the browser console.

    Read-only: iterates the user's profiles, opens each profile.sqlite `mode=ro`
    (never writes, never syncs to R2), and returns each `pending_uploads` row with
    its age and live R2 multipart state (valid + parts uploaded). `older_than_hours`
    filters to sessions older than N hours (default 0 = all). Scoped to one named
    user by design — this is the incident-response tool for a specific account, not
    an all-users sweep (log tag `[UPLOAD_LIFECYCLE]` covers the fleet-wide view)."""
    _require_admin()

    from ..services.materialization import open_profile_db_readonly
    from ..services.user_db import get_profiles
    from ..storage import r2_is_multipart_upload_valid, r2_list_multipart_parts

    if not get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="user_not_found")

    now = datetime.now(UTC)
    cutoff_seconds = older_than_hours * 3600
    results: list[dict] = []

    def _read_pending_uploads(profile_id: str) -> list | None:
        # T8170: sqlite3.Connection defaults to check_same_thread=True, tied to
        # whatever worker thread ran open_profile_db_readonly. A prior version
        # opened the connection in its own to_thread call, then read/closed it
        # back on the event-loop thread — a cross-thread violation that raised
        # "SQLite objects created in a thread can only be used in that same
        # thread" on EVERY call (reproduced live on bknoto's account 2026-08-31).
        # Fix: open, read, AND close inside this ONE function, itself run via a
        # single to_thread call, so every operation stays on the same thread.
        conn = open_profile_db_readonly(user_id, profile_id)
        if conn is None:
            return None
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, blake3_hash, file_size, original_filename, "
                "r2_upload_id, parts_json, label, created_at "
                "FROM pending_uploads ORDER BY created_at DESC"
            )
            return cur.fetchall()
        finally:
            conn.close()

    for profile in get_profiles(user_id):
        profile_id = profile["id"]
        try:
            rows = await asyncio.to_thread(_read_pending_uploads, profile_id)
        except Exception as e:
            logger.warning(f"stuck-uploads: cannot read profile {profile_id}: {e}")
            continue
        if rows is None:
            continue

        for row in rows:
            age_seconds = None
            created_at = row["created_at"]
            if created_at:
                try:
                    parsed = datetime.fromisoformat(str(created_at).replace(" ", "T"))
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=UTC)
                    age_seconds = (now - parsed).total_seconds()
                except ValueError:
                    age_seconds = None

            if age_seconds is not None and age_seconds < cutoff_seconds:
                continue

            r2_key = f"games/{row['blake3_hash']}.mp4"
            upload_id = row["r2_upload_id"]
            valid = await asyncio.to_thread(
                r2_is_multipart_upload_valid, r2_key, upload_id
            )
            r2_parts = 0
            if valid:
                parts = await asyncio.to_thread(
                    r2_list_multipart_parts, r2_key, upload_id
                )
                r2_parts = len(parts) if parts else 0

            results.append({
                "profile_id": profile_id,
                "session_id": row["id"],
                "blake3_hash": row["blake3_hash"],
                "original_filename": row["original_filename"],
                "label": row["label"],
                "file_size": row["file_size"],
                "created_at": created_at,
                "age_hours": round(age_seconds / 3600, 2) if age_seconds is not None else None,
                "r2_upload_id": upload_id,
                "r2_multipart_valid": valid,
                "r2_parts_uploaded": r2_parts,
            })

    return {"user_id": user_id, "older_than_hours": older_than_hours, "stuck_uploads": results}


# ---------------------------------------------------------------------------
# Share cleanup (T2847)
# ---------------------------------------------------------------------------

@router.post("/cleanup-shares")
async def cleanup_shares():
    """Run share table retention cleanup. Admin only."""
    _require_admin()

    from ..services.sharing_db import (
        cleanup_old_shares,
        cleanup_resolved_pending_shares,
        expire_stale_pending_shares,
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

@router.post("/migrate-postgres")
async def run_postgres_migration():
    """Run pending Postgres-track migrations. Admin only.

    T5087: this used to also sweep every user's SQLite DBs as a bulk backstop
    (POST /api/admin/migrate); that sweep is deleted -- user_db/profile_db
    migrate JIT at the per-user seam (T5083/T5085, hardened by T8190) and have
    no bulk-sweep counterpart anymore. Postgres remains the one track that is
    deploy/admin-triggered by design (never JIT, since it is a shared DB with
    no per-user seam to hang the migration off of)."""
    _require_admin()
    return await asyncio.to_thread(_run_migrate_postgres)


def _run_migrate_postgres() -> dict:
    from ..migrations import migrate_postgres
    return migrate_postgres()


@router.get("/migration-status")
async def migration_status(user_id: str | None = Query(default=None)):
    """READ-ONLY migration status (T5970). No user_id -> code head versions only
    (zero cost). With user_id -> also the ACTUAL R2 schema version of each of that
    user's registered profiles, so an operator can ask "is this env at head?" without
    running the mutating full-R2-walk migrate. Side-effect-free (temp download + read
    + delete; no R2 write)."""
    _require_admin()
    from ..migrations import get_migration_status, get_migration_status_for_user

    if user_id is None:
        return get_migration_status()
    return await asyncio.to_thread(get_migration_status_for_user, user_id)


# ---------------------------------------------------------------------------
# Recap backfill (T4140)
# ---------------------------------------------------------------------------

# Single-flight state for the recap backfill. The real run is dispatched to a
# background thread and the request returns immediately: the db_sync middleware
# holds the caller's per-user WRITE lock for the whole request, so a synchronous
# multi-minute re-encode starves every other write from that user (observed:
# 13 minutes of queued Copy Link clicks in dev). The backfill itself only
# reads the profile DB and writes R2 objects, so it does not need the lock.
_BACKFILL_STATE: dict = {"running": False, "last_result": None, "task": None}


@router.post("/backfill-hiq-recaps")
async def backfill_hiq_recaps(limit: int = Query(25, ge=1, le=500),
                              dry_run: bool = Query(False)):
    """Upgrade legacy 480p recaps to full-quality hi-q re-edit masters (T4140).

    Heavy per-game re-encode, so it is throttled/batched by `limit` and NOT run
    on startup. Only games whose game video still exists (in-grace) are upgraded;
    already-reclaimed games keep their 480p recap. Pass `dry_run=true` for a
    fast synchronous candidate count. The real run returns 202-style
    `{"started": true}` immediately and executes in the background — GET this
    same path to poll `running`/`last_result` (a repeat POST while idle would
    start ANOTHER run).
    """
    _require_admin()
    from ..services.auto_export import backfill_hiq_recaps as _backfill

    if dry_run:
        return await asyncio.to_thread(_backfill, limit, True)

    if _BACKFILL_STATE["running"]:
        return {"started": False, "already_running": True,
                "last_result": _BACKFILL_STATE["last_result"]}

    _BACKFILL_STATE["running"] = True

    async def _run_in_background():
        try:
            _BACKFILL_STATE["last_result"] = await asyncio.to_thread(_backfill, limit, False)
        except Exception as exc:
            logger.exception("[Backfill] background run failed")
            _BACKFILL_STATE["last_result"] = {"error": str(exc)}
        finally:
            _BACKFILL_STATE["running"] = False

    _BACKFILL_STATE["task"] = asyncio.create_task(_run_in_background())
    return {"started": True, "limit": limit,
            "note": "running in background; GET this path to poll "
                    "running/last_result"}


@router.get("/backfill-hiq-recaps")
async def backfill_hiq_recaps_status():
    """Read-only status of the recap backfill (see POST above)."""
    _require_admin()
    return {"running": _BACKFILL_STATE["running"],
            "last_result": _BACKFILL_STATE["last_result"]}


_POSTER_BACKFILL_STATE: dict = {"running": False, "last_result": None, "task": None}


@router.post("/backfill-share-posters")
async def backfill_share_posters(limit: int = Query(25, ge=1, le=500),
                                 dry_run: bool = Query(False),
                                 force: bool = Query(False)):
    """Generate posters for PUBLISHED reels that have none (T4890).

    Reels published before the poster feature carry no og:image, so their share
    links unfurl text-only until backfilled. Per-video ffmpeg frame grab, so it is
    throttled/batched by `limit` and NOT run on startup. Only reels whose video
    object still exists are processed; reels whose poster already exists are healed
    (no re-encode). Pass `dry_run=true` for a synchronous candidate count. The real
    run returns immediately and executes in the background -- GET this same path to
    poll `running`/`last_result`.

    The frame is chosen by `select_poster_frame` -- the open-play window's own
    start (already past the slow-mo skip margin), or 2 seconds into it when
    there's no slow-mo section (T6630 round 8; was always +2s, which stacked
    with the skip), or the user's pre-export marker (T5410). It is NOT the
    first frame; that was the pre-T5410 behaviour.

    `force=true` REGENERATES posters for ALL published reels, not just ones missing
    a poster -- this is how legacy posters are upgraded to the current selection.
    **Without it the candidate set is usually 0**, because existing reels already
    have a poster (just an older one). Rows with `poster_source IN ('overlay',
    'upload')` are ALWAYS skipped (`skipped_override`), even under force -- a user's
    manual cover choice is never clobbered by a sweep. See `backfill_posters` for
    the full per-row contract.
    """
    _require_admin()
    from ..services.poster import backfill_posters as _backfill

    if dry_run:
        return await asyncio.to_thread(_backfill, limit, True, force)

    if _POSTER_BACKFILL_STATE["running"]:
        return {"started": False, "already_running": True,
                "last_result": _POSTER_BACKFILL_STATE["last_result"]}

    _POSTER_BACKFILL_STATE["running"] = True

    async def _run_in_background():
        try:
            _POSTER_BACKFILL_STATE["last_result"] = await asyncio.to_thread(_backfill, limit, False, force)
        except Exception as exc:
            logger.exception("[PosterBackfill] background run failed")
            _POSTER_BACKFILL_STATE["last_result"] = {"error": str(exc)}
        finally:
            _POSTER_BACKFILL_STATE["running"] = False

    _POSTER_BACKFILL_STATE["task"] = asyncio.create_task(_run_in_background())
    return {"started": True, "limit": limit,
            "note": "running in background; GET this path to poll running/last_result"}


@router.get("/backfill-share-posters")
async def backfill_share_posters_status():
    """Read-only status of the share-poster backfill (see POST above)."""
    _require_admin()
    return {"running": _POSTER_BACKFILL_STATE["running"],
            "last_result": _POSTER_BACKFILL_STATE["last_result"]}


# ---------------------------------------------------------------------------
# Analytics dashboards (T3030)
# ---------------------------------------------------------------------------

@router.get("/analytics/funnel")
# T8000: plain def -> FastAPI runs the whole (blocking psycopg2) body in its threadpool, off
# the single event loop, so a slow admin query can't stall every other user's request. See
# .claude/knowledge/backend-services.md "Request concurrency model". No await ceremony needed.
def analytics_funnel(
    request: Request,
    origin: str = Query("all"),
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
):
    _require_admin()
    d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else date.today()

    from ..analytics import FLOW_EVENTS, FUNNEL_STEPS

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
            rows = [totals, *rows]

    return {"funnel": rows, "from": str(d_from), "to": str(d_to)}


@router.get("/analytics/channels")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_channels(
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
):
    _require_admin()
    d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else date.today()

    with get_pg() as conn:
        cur = conn.cursor()
        # T7980: pre-aggregate exports and purchases to ONE row per user BEFORE joining to
        # user_segments. user_actions' PK is (user_id, action, PLATFORM), so a single user
        # has multiple export_completed rows (e.g. platform='unknown' from the worker,
        # platform='web' from the request path). Joining that fan-out directly against the
        # purchases table multiplied every user's revenue by (export_rows x purchase_rows)
        # and their export SUM by purchase_rows -- inflating avg_exports, revenue_cents, AND
        # the ORDER BY revenue ranking. Collapsing each action to a per-user subquery first
        # makes each user contribute exactly one row, eliminating the cartesian fan-out.
        cur.execute("""
            SELECT
                s.origin,
                COUNT(*) AS users,
                COUNT(*) FILTER (WHERE s.referrer_id IS NULL) AS direct,
                COUNT(*) FILTER (WHERE s.referrer_id IS NOT NULL) AS viral,
                COUNT(*) FILTER (WHERE exp.export_count > 0) AS exported,
                COUNT(pur.user_id) AS purchased,
                COALESCE(SUM(exp.export_count), 0) AS total_exports,
                COALESCE(SUM(s.total_spent_cents), 0) AS revenue_cents
            FROM user_segments s
            LEFT JOIN (
                SELECT user_id, SUM(count) AS export_count
                FROM user_actions
                WHERE action = 'export_completed'
                GROUP BY user_id
            ) exp ON exp.user_id = s.user_id
            LEFT JOIN (
                SELECT DISTINCT user_id
                FROM user_actions
                WHERE action = 'credit_purchased'
            ) pur ON pur.user_id = s.user_id
            WHERE s.acquired_at BETWEEN %s AND %s
            GROUP BY s.origin
            ORDER BY revenue_cents DESC NULLS LAST
        """, (d_from, d_to))
        rows = cur.fetchall()

    channels = []
    for r in rows:
        users = r["users"]
        exported = r["exported"]
        revenue = r["revenue_cents"] or 0
        channels.append({
            "origin": r["origin"],
            "users": users,
            "direct": r["direct"],
            "viral": r["viral"],
            "exported": exported,
            "export_pct": round(exported / users * 100, 1) if users else 0,
            "purchased": r["purchased"],
            "purchase_pct": round(r["purchased"] / users * 100, 1) if users else 0,
            # T7980: "avg exports" = exports per EXPORTING user (what the label promises),
            # not per all segment users. Denominator is exporters, so a channel where 4 of
            # 100 users exported 3 clips each reads 3.0, not 0.12.
            "avg_exports": round(r["total_exports"] / exported, 1) if exported else 0,
            "revenue_cents": revenue,
        })

    return {"channels": channels}


@router.get("/analytics/share-funnel")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
# limit lowered 100 -> 25 (and hard-capped) because each returned link's sharer costs one R2
# HEAD via share_view_counts -> get_user_db_connection (user_db.py); at limit=100 that was up
# to ~100 sequential network round-trips per page load, scaling with share count, not users.
def analytics_share_funnel(limit: int = Query(25, ge=1, le=100)):
    """Read-only per-link growth funnel for public game links (T5740).

    Answers ONE question per link: views -> claims -> activated accounts, so we can
    tell whether the watch-first loop converts. No new tables and no new writes:
      - views:     the sharer's already-logged `share_viewed` events (per token)
      - claims:    distinct claimers in share_claims (T5730)
      - activated: claimers who then recorded an `export_completed` milestone
    Analytics stays OFF any user path -- this is a normal admin query (T4840)."""
    _require_admin()
    from ..analytics import share_view_counts

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id, s.share_token, s.sharer_user_id, s.shared_at, s.revoked_at,
                   u.email AS sharer_email,
                   sg.game_id, sg.game_name,
                   COUNT(DISTINCT sc.claimer_user_id) AS claims,
                   COUNT(DISTINCT sc.claimer_user_id)
                       FILTER (WHERE act.user_id IS NOT NULL) AS activated
            FROM shares s
            JOIN share_games sg ON sg.share_id = s.id
            LEFT JOIN users u ON u.user_id = s.sharer_user_id
            LEFT JOIN share_claims sc ON sc.share_id = s.id
            LEFT JOIN (
                SELECT DISTINCT user_id FROM user_actions
                WHERE action = 'export_completed' AND count > 0
            ) act ON act.user_id = sc.claimer_user_id
            WHERE s.share_type = 'game_link'
            GROUP BY s.id, u.email, sg.game_id, sg.game_name
            ORDER BY s.shared_at DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()

    # Views live per-token in each sharer's SQLite -- group by sharer so each
    # sharer DB is opened at most once for the whole page.
    tokens_by_sharer: dict[str, list[str]] = {}
    for r in rows:
        tokens_by_sharer.setdefault(r["sharer_user_id"], []).append(r["share_token"])
    views_by_token: dict[str, int] = {}
    view_lookup_failed: set[str] = set()
    for sharer_id, tokens in tokens_by_sharer.items():
        counts = share_view_counts(sharer_id, tokens)
        if counts is None:
            view_lookup_failed.add(sharer_id)
        else:
            views_by_token.update(counts)

    links = []
    for r in rows:
        unknown_views = r["sharer_user_id"] in view_lookup_failed
        links.append({
            "share_token": r["share_token"],
            "game_id": r["game_id"],
            "game_name": r["game_name"] or "Untitled Game",
            "sharer_email": r["sharer_email"],
            "created_at": r["shared_at"].isoformat() if r["shared_at"] else None,
            "revoked": r["revoked_at"] is not None,
            # None -> the sharer's view log couldn't be read (honest 'unknown'),
            # distinct from 0 (read fine, nobody watched).
            "views": None if unknown_views else views_by_token.get(r["share_token"], 0),
            "claims": r["claims"],
            "activated": r["activated"],
        })

    return {"links": links, "activation_metric": "export_completed"}


@router.get("/analytics/cohorts")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_cohorts(
    granularity: str = Query("week"),
    origin: str = Query("all"),
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
):
    from ..analytics import FLOW_EVENTS, FUNNEL_STEPS

    _require_admin()
    trunc = "week" if granularity == "week" else "month"

    # T8000: default to a 12-month window so these four full-history aggregations don't scan
    # the ever-growing signup history on every admin page load (idx_segments_acquired drives a
    # bounded segment set instead). Overridable via the from/to params for deeper look-backs.
    d_from = date.fromisoformat(date_from) if date_from else date.today() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else date.today()
    where_parts = ["s.acquired_at BETWEEN %s AND %s"]
    where_params: list = [d_from, d_to]
    if origin != "all":
        where_parts.append("s.origin = %s")
        where_params.append(origin)
    where_clause = "WHERE " + " AND ".join(where_parts)

    with get_pg() as conn:
        cur = conn.cursor()

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                COUNT(*) AS signups,
                COALESCE(SUM(s.total_spent_cents), 0) AS revenue_cents
            FROM user_segments s
            {where_clause}
            GROUP BY cohort_period
            ORDER BY cohort_period DESC
        """, [trunc, *where_params])
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
            {where_clause}
            GROUP BY cohort_period, a.action
            ORDER BY cohort_period DESC
        """, [trunc, *where_params])
        action_rows = cur.fetchall()

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (a.first_at - s.created_at)) / 86400.0
                ) AS median_days_to_export
            FROM user_segments s
            JOIN user_actions a ON s.user_id = a.user_id AND a.action = 'export_completed'
            {where_clause}
            GROUP BY cohort_period
        """, [trunc, *where_params])
        tte_rows = {str(r["cohort_period"]): round(float(r["median_days_to_export"]), 1) if r["median_days_to_export"] else None for r in cur.fetchall()}

        cur.execute(f"""
            SELECT
                date_trunc(%s, s.acquired_at)::date AS cohort_period,
                COUNT(DISTINCT s.user_id) FILTER (
                    WHERE s.last_active_at >= s.created_at + INTERVAL '7 days'
                ) AS returned
            FROM user_segments s
            {where_clause}
            GROUP BY cohort_period
        """, [trunc, *where_params])
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


# T7510 frustration-signal tier 5 (partial — retry-burst only; repeat-visit and
# rapid-fire are DEFERRED to T7515). These are the funnel's ATTEMPT-side actions
# a user can plausibly hammer against a broken CTA.
RETRY_BURST_ACTIONS = ("game_created", "clip_save_attempted", "share_attempted", "move_attempted")


def _detect_retry_bursts(timestamps: list[str], window_sec: int = 60, threshold: int = 3) -> list[dict]:
    """Read-time-only derivation, no new storage (per §7 tier 5 scope). A
    retry-burst is >= `threshold` attempts of the SAME action within any
    `window_sec` sliding window — the signature of a user hammering a broken
    CTA (bigajosue's repeated failed-upload attempts in one sitting)."""
    from datetime import datetime as _dt

    parsed = sorted(
        _dt.fromisoformat(t.replace("Z", "+00:00")) for t in timestamps if t
    )
    bursts = []
    i = 0
    n = len(parsed)
    while i < n:
        j = i
        while j < n and (parsed[j] - parsed[i]).total_seconds() <= window_sec:
            j += 1
        count = j - i
        if count >= threshold:
            bursts.append({
                "count": count,
                "window_start": parsed[i].isoformat(),
                "window_end": parsed[j - 1].isoformat(),
            })
            i = j  # advance past this cluster instead of re-counting it
        else:
            i += 1
    return bursts


def _rollup_failures(action_rows: list[dict]) -> dict[str, dict]:
    """T7510: roll up ``{base_event}:{reason}`` failure rows under their base event.

    Failed attempts are stored in the ``user_actions`` aggregate as
    ``"<base_event>:<reason>"`` rows (e.g. ``game_upload_failed:timeout``). This
    collapses them into ``{base_event: {"count": <sum>, "failures": {reason: count}}}``
    so the journey view can render an attempted-vs-succeeded gap plus the
    per-reason breakdown, without exploding the funnel base keys.

    ``count`` is the total across all reasons for that base event; ``failures``
    is the per-reason breakdown. Only rows whose action name contains ``':'`` are
    treated as failure rows — base events (no colon) are left to the caller.
    """
    rollup: dict[str, dict] = {}
    for ar in action_rows:
        action = ar["action"]
        if ":" not in action:
            continue
        base, reason = action.split(":", 1)
        cnt = ar["count"] or 0
        agg = rollup.setdefault(base, {"count": 0, "failures": {}})
        agg["count"] += cnt
        agg["failures"][reason] = agg["failures"].get(reason, 0) + cnt
    return rollup


@router.get("/analytics/journey/{user_id}")
# T8010: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_journey(user_id: str):
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
            SELECT action, MIN(first_at) AS first_at, SUM(count) AS count,
                   jsonb_object_agg(platform, count) AS platform_counts
            FROM user_actions
            WHERE user_id = %s
            GROUP BY action
            ORDER BY MIN(first_at) NULLS LAST
        """, (user_id,))
        action_rows = cur.fetchall()

    completed = []

    completed.append({
        "event": "signup_completed",
        "at": seg["created_at"].isoformat() if seg["created_at"] else None,
    })

    from ..analytics import FLOW_EVENTS

    # T7510: roll up "<base>:<reason>" failure rows under their base event so the
    # journey renders an attempted-vs-succeeded gap plus per-reason breakdown.
    failure_rollup = _rollup_failures(action_rows)

    seen_actions = set()
    failure_first_at: dict[str, str] = {}
    for ar in action_rows:
        action = ar["action"]
        if ":" in action:
            # Failure row — folded into its base event's milestone below, not a
            # standalone milestone. Track the earliest attempt time per base.
            base = action.split(":", 1)[0]
            at = ar["first_at"].isoformat() if ar["first_at"] else None
            if at and (base not in failure_first_at or at < failure_first_at[base]):
                failure_first_at[base] = at
            continue
        seen_actions.add(action)
        entry: dict = {"event": action, "at": ar["first_at"].isoformat() if ar["first_at"] else None}
        if ar["count"] is not None:
            entry["count"] = ar["count"]
        if ar["platform_counts"]:
            entry["platforms"] = ar["platform_counts"]
        if action in failure_rollup:
            # Base event that ALSO has failures (e.g. some succeeded, some failed).
            entry["failures"] = failure_rollup[action]["failures"]
            entry["failed_count"] = failure_rollup[action]["count"]
        completed.append(entry)

    # T7510: base events that appear ONLY as failures (never succeeded) still need a
    # milestone so the dashboard shows "attempted N, 0 succeeded, reasons: ...".
    for base, agg in failure_rollup.items():
        if base in seen_actions:
            continue
        seen_actions.add(base)
        completed.append({
            "event": base,
            "at": failure_first_at.get(base),
            "count": 0,
            "failed_count": agg["count"],
            "failures": agg["failures"],
        })

    pending = [{"event": ev, "at": None} for ev in FLOW_EVENTS if ev not in seen_actions]

    completed.sort(key=lambda x: x["at"] or "")
    milestones = completed + pending

    session_count = next((ar["count"] for ar in action_rows if ar["action"] == "session_started"), 0)

    # T7510 tier 5 (partial): retry-burst, derived at read time from the
    # per-user SQLite action log — no new storage.
    from ..services.user_db import get_user_db_connection
    placeholders = ",".join("?" for _ in RETRY_BURST_ACTIONS)
    with get_user_db_connection(user_id) as user_conn:
        burst_rows = user_conn.execute(
            f"SELECT action, created_at FROM user_action_log WHERE action IN ({placeholders})",
            RETRY_BURST_ACTIONS,
        ).fetchall()
    timestamps_by_action: dict[str, list[str]] = {}
    for r in burst_rows:
        timestamps_by_action.setdefault(r["action"], []).append(r["created_at"])
    retry_bursts = {
        action: bursts
        for action, ts in timestamps_by_action.items()
        if (bursts := _detect_retry_bursts(ts))
    }

    return {
        "user_id": user_id,
        "email": user_row["email"],
        "origin": seg["origin"],
        "acquired_at": str(seg["acquired_at"]) if seg["acquired_at"] else None,
        "milestones": milestones,
        "session_count": session_count,
        "last_active_at": seg["last_active_at"].isoformat() if seg["last_active_at"] else None,
        "frustration_signals": {"retry_bursts": retry_bursts},
    }


@router.get("/analytics/user/{user_id}/clip-phases")
async def analytics_user_clip_phases(user_id: str):
    """T7860: per-user clip/reel lifecycle-phase inventory (read-only).

    Clip tier (created/focus_started/focused, furthest-phase-exclusive) + reel
    tier (completed/published, furthest-phase-exclusive) + orthogonal reel flags
    (intro explicit vs inherited, downloaded, shared, watched). Aggregated across
    all the user's profiles and broken out per profile. Derived at read time from
    the tables that already encode phase — NO new persisted state, NO writes, NO
    R2 sync (each profile.sqlite is opened mode=ro through the shared connection
    path). A multi-clip reel is one final_videos row, so it counts as 1 published.
    """
    _require_admin()

    from ..services.clip_phases import compute_user_clip_phases

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    # One offload: the whole inventory is synchronous, and sqlite3 connections are
    # thread-affine, so open/read/close every profile DB on the SAME thread.
    return await asyncio.to_thread(compute_user_clip_phases, user_id, row["email"])


@router.get("/analytics/user/{user_id}/actions")
# T8010: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_user_actions(
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
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_pulse(
    days: int = Query(30, ge=7, le=90),
    origin: str = Query(None),
    acquired_from: str = Query(None),
    acquired_to: str = Query(None),
    filter: str = Query(None),
):
    _require_admin()
    # T7990: "today" is the UTC calendar day. This is DELIBERATE, not an accident: the
    # daily_counters and user_actions rows this endpoint reads are stamped CURRENT_DATE in
    # Postgres (UTC, analytics.py), so the tile boundary MUST match the data's boundary. For
    # a US-timezone admin this means "today" flips 5-8h early relative to their local day, so
    # late-evening activity lands in what reads as "yesterday" on the panel. We accept that
    # (no per-viewer timezone shift) rather than misalign the tiles from their own counters.
    # The cohort table's Monday-start week grouping (date_trunc('week', ...)) is likewise UTC
    # and independent -- documented so the two boundaries staying UTC is a choice, not drift.
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
            """, [*filter_params, start, today])
            signup_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            cur.execute(f"""
                SELECT a.first_at::date AS d, COUNT(DISTINCT a.user_id) AS cnt
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id
                {seg_where} AND a.action = 'export_completed' AND a.first_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, [*filter_params, start, today])
            export_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            # T7510: upload success rate over the same segment filter. Sourced from
            # user_actions (segment-scoped) since daily_counters can't honor an
            # arbitrary segment filter. Failed rows carry a ":<reason>" suffix.
            cur.execute(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN a.action = 'game_upload_succeeded' THEN a.count END), 0) AS succeeded,
                    COALESCE(SUM(CASE WHEN a.action LIKE 'game_upload_failed:%%' THEN a.count END), 0) AS failed
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id
                {seg_where} AND (a.action = 'game_upload_succeeded' OR a.action LIKE 'game_upload_failed:%%')
            """, filter_params)
            ur = cur.fetchone()
            upload_succeeded_total, upload_failed_total = ur["succeeded"], ur["failed"]

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
                """, [*filter_params, start, today])
                active_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            cur.execute(f"""
                SELECT COALESCE(SUM(s.total_spent_cents), 0) AS total
                FROM user_segments s
                {seg_where}
            """, filter_params)
            revenue_total = cur.fetchone()["total"]

            cur.execute(f"""
                SELECT a.first_at::date AS d, COUNT(DISTINCT a.user_id) AS cnt
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id
                {seg_where} AND a.action = 'credit_purchased'
                    AND a.first_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, [*filter_params, start, today])
            revenue_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

        else:
            cur.execute("""
                SELECT counter_date, signups, exports_completed, credit_purchases,
                       COALESCE(sessions_started, 0) AS sessions_started,
                       COALESCE(game_uploads_succeeded, 0) AS game_uploads_succeeded,
                       COALESCE(game_uploads_failed, 0) AS game_uploads_failed
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
            revenue_by_date = {d: _cv(d, "credit_purchases") for d in date_range_tmp if _cv(d, "credit_purchases")}

            # T7510: upload success rate from the new daily_counters columns.
            upload_succeeded_total = sum(_cv(d, "game_uploads_succeeded") for d in date_range_tmp)
            upload_failed_total = sum(_cv(d, "game_uploads_failed") for d in date_range_tmp)

    date_range = [(start + timedelta(days=i)) for i in range(days)]

    signups_spark = [signup_by_date.get(d, 0) for d in date_range]
    exports_spark = [export_by_date.get(d, 0) for d in date_range]
    active_spark = [active_by_date.get(d, 0) for d in date_range]
    revenue_spark = [revenue_by_date.get(d, 0) for d in date_range]

    # T7960: "Viral Conv." now measures referral conversion (referred signups / total
    # signups) over the window, bounded 0-100%, using the referrer_id attribution signal
    # (the same signal as the channels endpoint's `viral` column). This replaces the prior
    # views-per-share ratio, which was UNBOUNDED (one share link viewed 20x read as 2000%)
    # and had nothing to do with referrals. Honors the active segment filter.
    viral_where = ("WHERE " + " AND ".join(filter_parts)) if has_filter else "WHERE TRUE"
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE s.referrer_id IS NOT NULL) AS referred
            FROM user_segments s
            {viral_where} AND s.acquired_at::date BETWEEN %s AND %s
        """, [*filter_params, start, today])
        vr = cur.fetchone()
        cur.execute(f"""
            SELECT s.acquired_at::date AS d, COUNT(*) AS cnt
            FROM user_segments s
            {viral_where} AND s.referrer_id IS NOT NULL
                AND s.acquired_at::date BETWEEN %s AND %s
            GROUP BY d ORDER BY d
        """, [*filter_params, start, today])
        referred_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}
    # referred/total can never exceed 100% -- an honest, bounded conversion rate. null when
    # no signups landed in the window, so the card renders "--" instead of a fake 0%.
    viral_total, viral_referred = vr["total"], vr["referred"]
    viral_pct = round(viral_referred / viral_total * 100, 1) if viral_total else None
    # Sparkline = per-day referred-signup COUNT (a referral-activity trend), mirroring the
    # revenue card's aggregate-headline + per-day-count sparkline shape.
    viral_spark = [referred_by_date.get(d, 0) for d in date_range]

    def make_card(sparkline, today_val=None, week_ago_val=None):
        t = today_val if today_val is not None else (sparkline[-1] if sparkline else 0)
        w = week_ago_val if week_ago_val is not None else (sparkline[-8] if len(sparkline) >= 8 else 0)
        change = round((t - w) / w * 100, 1) if w else (100.0 if t else 0.0)
        return {"today": t, "last_week_same_day": w, "change_pct": change, "sparkline": sparkline}

    revenue_card = make_card(revenue_spark)
    revenue_card["today"] = revenue_total
    viral_card = make_card(viral_spark)
    viral_card["today"] = viral_pct

    # T7510: upload success rate = succeeded / (succeeded + failed). Guard
    # divide-by-zero -> null so the card renders "--" when there were no attempts
    # (an honest "no data", not a misleading 0% or 100%).
    upload_attempts_total = upload_succeeded_total + upload_failed_total
    upload_success_rate = (
        round(upload_succeeded_total / upload_attempts_total * 100, 1)
        if upload_attempts_total else None
    )
    # T8170: the T8160 outage sat at 29% success for ~2 days with no alert --
    # nobody noticed until a bug report. A real collapse with a meaningful sample
    # size must be unmissable: mark the card + fire a greppable CRITICAL log every
    # time an admin loads the dashboard while it's true (cheap, no new infra; a Fly
    # log alert can hook this later per the task). MIN_ATTEMPTS guards a quiet day
    # (e.g. 1 failed out of 1 attempt) from reading as a false collapse.
    upload_success_alarm = (
        upload_attempts_total >= UPLOAD_SUCCESS_ALARM_MIN_ATTEMPTS
        and upload_success_rate is not None
        and upload_success_rate < UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT
    )
    if upload_success_alarm:
        logger.critical(
            f"[T8170] Upload success rate collapsed: {upload_success_rate}% "
            f"({upload_succeeded_total}/{upload_attempts_total} succeeded) -- "
            f"below the {UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT}% alarm threshold"
        )
    upload_success_card = {
        "today": upload_success_rate,
        "last_week_same_day": None,
        "change_pct": 0.0,
        "sparkline": [],
        "succeeded": upload_succeeded_total,
        "failed": upload_failed_total,
        "attempts": upload_attempts_total,
        "alarm": upload_success_alarm,
    }

    return {
        "cards": {
            "signups": make_card(signups_spark),
            "exports": make_card(exports_spark),
            "active_users": make_card(active_spark),
            "revenue": revenue_card,
            "viral_conversion": viral_card,
            "upload_success_rate": upload_success_card,
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
# Platform analytics
# ---------------------------------------------------------------------------

@router.get("/analytics/platforms")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_platforms(
    action: str | None = Query(None),
):
    """Platform breakdown: % of users and actions on mobile/desktop/pwa."""
    _require_admin()
    from ..services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()

        action_filter = "WHERE action = %s" if action else ""
        action_params = [action] if action else []

        cur.execute(f"""
            SELECT platform,
                   COUNT(DISTINCT user_id) AS users,
                   SUM(count) AS total_actions
            FROM user_actions
            {action_filter}
            GROUP BY platform
            ORDER BY total_actions DESC
        """, action_params)
        rows = cur.fetchall()

        total_users = sum(r["users"] for r in rows)
        total_actions = sum(r["total_actions"] for r in rows)

        platforms = []
        for r in rows:
            platforms.append({
                "platform": r["platform"],
                "users": r["users"],
                "user_pct": round(r["users"] / total_users * 100, 1) if total_users else 0,
                "actions": r["total_actions"],
                "action_pct": round(r["total_actions"] / total_actions * 100, 1) if total_actions else 0,
            })

        by_action = []
        if not action:
            cur.execute("""
                SELECT action, platform,
                       COUNT(DISTINCT user_id) AS users,
                       SUM(count) AS total
                FROM user_actions
                GROUP BY action, platform
                ORDER BY action, total DESC
            """)
            action_platform_rows = cur.fetchall()
            action_totals: dict[str, int] = {}
            action_data: dict[str, list] = {}
            for r in action_platform_rows:
                action_totals[r["action"]] = action_totals.get(r["action"], 0) + r["total"]
                action_data.setdefault(r["action"], []).append({
                    "platform": r["platform"],
                    "users": r["users"],
                    "count": r["total"],
                })
            for act, plats in action_data.items():
                act_total = action_totals[act]
                for p in plats:
                    p["pct"] = round(p["count"] / act_total * 100, 1) if act_total else 0
                by_action.append({"action": act, "platforms": plats})

    return {
        "total_users": total_users,
        "total_actions": total_actions,
        "platforms": platforms,
        "by_action": by_action,
    }


@router.get("/dashboard")
# T8020: sync def -> threadpool, off the event loop (see backend-services.md concurrency
# model). Composes the 5 individual admin-dashboard reads into ONE round-trip, mirroring
# /api/bootstrap. Every callee is now a plain sync def (list_users joined that set in T8020),
# so this stays sync all the way down -- do NOT make it `async def` and call these inline,
# which would re-block the single event loop (the exact bug T8000/T8010/T8020 just fixed).
def get_admin_dashboard():
    """Combined admin-dashboard read: users + pulse + channels + cohorts + platforms in one
    response, so AdminScreen fires ONE request on mount instead of five (T8020).

    The individual routes stay for their other callers (campaign click-through, pagination,
    filtered search); this endpoint reuses their handler functions, not duplicate SQL.

    Callee args are passed EXPLICITLY: these are FastAPI route handlers whose defaults are
    `Query(...)` sentinels, resolved to real values only through the DI layer. Calling them as
    plain functions with an OMITTED arg would bind the parameter to the truthy `Query(...)`
    FieldInfo object, not `None` -- silently behaving as if a filter were supplied. Passing
    every parameter here keeps Python from ever falling back to the `Query(...)` default.

    Partial failure follows the /api/bootstrap precedent: NO per-section try/except, NO
    partial-data response -- if any callee raises, it propagates to a full 500.
    """
    _require_admin()
    return {
        "users": list_users(page=1, page_size=DEFAULT_PAGE_SIZE, origin=None,
                            acquired_from=None, acquired_to=None, filter=None),
        "pulse": analytics_pulse(days=30, origin=None, acquired_from=None,
                                 acquired_to=None, filter=None),
        "channels": analytics_channels(date_from=None, date_to=None),
        "cohorts": analytics_cohorts(granularity="week", origin="all",
                                     date_from=None, date_to=None),
        "platforms": analytics_platforms(action=None),
    }


# ---------------------------------------------------------------------------
# Bug reports (T3100)
# ---------------------------------------------------------------------------

BUG_STATUSES = {"new", "testing", "done", "duplicate"}


@router.get("/bugs")
async def list_bugs(
    status: str | None = Query(None),
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
        """, [*params, page_size, offset])
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
    status: str | None = None
    admin_notes: str | None = None
    duplicate_of: int | None = None


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


# ---------------------------------------------------------------------------
# T5840: Credits -> Postgres backfill + cutover gate.
#
# Dry-run report (no writes) vs apply, per design 3b -- this is a tool, not a
# versioned migration file: money needs a human-reviewed dry run, and a
# migration's up(conn) has no user context to force-download R2 with.
# Both idempotent/re-runnable: a second run only inserts ledger rows Postgres
# is still missing and recomputes balance = SUM(pg ledger).
# ---------------------------------------------------------------------------

class BackfillRequest(BaseModel):
    user_ids: list[str] | None = None
    limit: int | None = None
    offset: int = 0


@router.get("/credits/backfill-report")
async def credits_backfill_report(
    user_ids: str | None = Query(None),
    limit: int | None = Query(None, description="Chunk the full enumeration (M7) -- omit for all users"),
    offset: int = Query(0),
):
    """Dry run -- no writes. `user_ids` is an optional comma-separated list for a
    targeted preview; omitted means every user (optionally chunked via
    limit/offset -- each user costs an R2 download + several PG round trips,
    so an unbounded scan can run minutes past a proxy timeout once the user
    base is nontrivial). A COMPLETE unchunked run is saved as the stored
    report POST /credits/open-gate consumes."""
    _require_admin()
    from ..services.credit_backfill import reconcile_against_stripe, run_backfill

    ids = [u.strip() for u in user_ids.split(",") if u.strip()] if user_ids else None
    report = run_backfill(user_ids=ids, apply=False, limit=limit, offset=offset)
    # Stripe reconciliation is itself a full-population pass (PaymentIntent.list) --
    # skip it for a chunked page, it isn't scoped to `limit`/`offset` and would be
    # misleadingly repeated (and costly) on every page.
    if limit is None:
        report["stripe_reconciliation"] = reconcile_against_stripe()
    return report


@router.post("/credits/backfill")
async def credits_backfill_apply(request: BackfillRequest):
    """Apply -- inserts missing ledger rows and re-derives balances. Safe to
    re-run (idempotent); `user_ids` targets a re-run for specific accounts;
    `limit`/`offset` chunk a full-population apply run (M7)."""
    _require_admin()
    from ..services.credit_backfill import run_backfill

    return run_backfill(user_ids=request.user_ids, apply=True, limit=request.limit, offset=request.offset)


class OpenGateRequest(BaseModel):
    # Flag NAMES (e.g. "divergent", "ledger_mismatch", "negative_balance") the
    # admin has manually reviewed and accepts -- a row carrying ONLY
    # acknowledged flags (and zero delta) no longer blocks the gate.
    acknowledge_flags: list[str] = []
    # Raw override: opens the gate regardless of any remaining anomaly.
    # Logged loudly (WARNING) with the full anomalous user list for audit.
    force: bool = False


def _gate_blocking_rows(rows: list[dict], acknowledged: set[str]) -> list[dict]:
    """Rows that must block the gate. `no_user_db` is informational ONLY --
    it is the EXPECTED, permanent state for every purged/guest/never-synced
    account (BLOCKING-2: with unbounded real-world enumeration this flag is
    guaranteed on staging/prod, so treating it as blocking means the gate can
    never open). Any OTHER flag blocks unless explicitly acknowledged; a
    nonzero delta always blocks (it means backfill has real unapplied work --
    the fix is POST /credits/backfill, not an acknowledgement)."""
    blocking = []
    for r in rows:
        if r["status"] == "no_user_db":
            continue
        if (set(r["flags"]) - acknowledged) or r["delta"] != 0:
            blocking.append(r)
    return blocking


# M7: open-gate consumes the STORED report from the most recent COMPLETE
# GET backfill-report call instead of recomputing (a second full unbounded
# scan -- R2 downloads + Stripe list -- synchronously inside this request).
# A report older than this is refused (not silently reused) unless force=true.
GATE_REPORT_MAX_AGE_SECONDS = 1800  # 30 minutes


@router.post("/credits/open-gate")
async def credits_open_gate(request: OpenGateRequest = OpenGateRequest()):
    """Open the credits_ready cutover gate (design 4a/4b) -- mutations 503 until
    this runs. Refuses unless the STORED backfill report (from the most recent
    GET /credits/backfill-report) shows zero drift and no unacknowledged
    anomalies, so the gate can only open on a verified-clean (or explicitly
    human-reviewed) state. `no_user_db` never blocks -- it is the expected
    state for purged/guest accounts, not drift."""
    _require_admin()
    from datetime import UTC, datetime

    from ..services.credit_backfill import load_last_report
    from ..services.credit_ledger import reset_ready_cache_for_tests

    stored = load_last_report()
    if stored is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "no_report",
                "message": "No backfill report on file -- run GET /credits/backfill-report (full, unchunked) first.",
            },
        )

    age_seconds = (datetime.now(UTC) - stored["generated_at"]).total_seconds()
    if age_seconds > GATE_REPORT_MAX_AGE_SECONDS and not request.force:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "stale_report",
                "message": (
                    f"Stored report is {int(age_seconds)}s old (max {GATE_REPORT_MAX_AGE_SECONDS}s) -- "
                    "re-run GET /credits/backfill-report, or pass force=true to use it anyway."
                ),
                "report_generated_at": stored["generated_at"].isoformat(),
            },
        )

    report = stored["report"]
    acknowledged = set(request.acknowledge_flags)
    anomalous = _gate_blocking_rows(report["rows"], acknowledged)

    if anomalous and not request.force:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "drift_present",
                "message": (
                    "The stored backfill report shows drift or unacknowledged flags -- "
                    "run POST /credits/backfill, then GET /credits/backfill-report again "
                    "to refresh the stored report, or pass acknowledge_flags (after manual "
                    "review) / force=true to open anyway."
                ),
                "anomalous_count": len(anomalous),
                "anomalous_user_ids": [r["user_id"] for r in anomalous][:50],
                "report_generated_at": stored["generated_at"].isoformat(),
            },
        )

    if anomalous and request.force:
        logger.warning(
            f"[Admin] credits_ready gate FORCE-opened by {get_current_user_id()} with "
            f"{len(anomalous)} unresolved anomalous users: "
            f"{[r['user_id'] for r in anomalous]}"
        )

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO credit_migration_state (id, ready_at, backfilled_users)
               VALUES (1, now(), %s)
               ON CONFLICT (id) DO UPDATE SET ready_at = now(), backfilled_users = %s""",
            (report["summary"]["total_users"], report["summary"]["total_users"]),
        )
    reset_ready_cache_for_tests()
    logger.info(f"[Admin] credits_ready gate OPENED by {get_current_user_id()}")
    return {"opened": True, "backfilled_users": report["summary"]["total_users"]}
