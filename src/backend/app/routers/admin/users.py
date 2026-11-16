"""Admin user-directory endpoints: the user list (T8110 sort/test filter), bulk update email
(T4860), test-account flag, test-account data reset, and stuck uploads (T7480).

Split out of routers/admin.py by T5940; every URL is unchanged."""

import asyncio
import logging
import math
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...services import credit_ledger
from ...services.auth_db import get_user_by_id
from ...services.pg import get_pg
from ...user_context import get_current_user_id
from . import (
    _LEDGER_REVENUE_BY_USER,
    BULK_BODY_MAX,
    BULK_MAX_IDS,
    BULK_SUBJECT_MAX,
    DEFAULT_PAGE_SIZE,
    CountryFilter,
    SportFilter,
    _admin_user_population,
    _assert_payments_ledger_ready,
    _build_segment_filter,
    _campaign_name_join,
    _journey_user_population,
    _last_step_rank_sql,
    _order_by,
    _rank_to_label,
    _test_exclusion,
    require_admin,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users")
# T8020: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=50),
    origin: str = Query(None),
    acquired_from: str = Query(None),
    acquired_to: str = Query(None),
    filter: str = Query(None),
    build: int | None = None,  # plain default, not Query(None): direct callers may omit it
    sort: str = "last_active_at",
    sort_dir: str = "desc",
    exclude_test: bool = True,
    # T14740: a Journey drop-off. Annotated, so a direct caller (get_admin_dashboard) gets plain
    # defaults. Several stages = a collapsed group on the map.
    journey_stage: Annotated[list[str] | None, Query()] = None,
    journey_outcome: Annotated[str | None, Query(pattern="^(in_window|stuck|gone|lost)$")] = None,
    # T14910: a spend gate drill, the gate's own n - k. Segment filters are refused, not applied.
    spend_gate: Annotated[str | None, Query(pattern="^(signup_to_export_14d|finished_to_took_away)$")] = None,
    window_days: Annotated[int, Query(ge=1, le=365)] = 14,
    inactive_days: Annotated[int, Query(ge=1, le=365)] = 14,
    platform: Annotated[str | None, Query(pattern="^(mobile|desktop)$")] = None,
    country: CountryFilter = None,
    sport: SportFilter = None,
):
    """List users with milestone stats from Postgres. Paginated by user count. Admin only.

    T8110: the sort now applies over the WHOLE user set (not the page) via a
    single CTE that computes every sortable metric in Postgres, then ORDER BY the
    whitelisted fragment, then LIMIT/OFFSET -- so page-1-row-1 is the true DB
    max/min. `exclude_test` (default ON) hides internal accounts from the list AND
    the funnel totals, via the shared _test_exclusion predicate.

    T14740: `journey_stage` + `journey_outcome` narrow the list to the users the Journey map
    counts there, under the same filters: `origin`, `build`, `acquired_from/to` and
    `exclude_test` here are the map's `origin`, `build`, `from/to` and `exclude_test`.
    """
    if journey_stage and not journey_outcome:
        raise HTTPException(status_code=422, detail="journey_stage needs journey_outcome")
    if journey_stage and filter:
        raise HTTPException(status_code=422, detail="journey_stage and filter are exclusive")
    if spend_gate and (journey_stage or filter):
        raise HTTPException(status_code=422, detail="spend_gate excludes journey_stage and filter")
    if spend_gate and (origin or acquired_from or acquired_to or build is not None or country or sport):
        raise HTTPException(status_code=422, detail="spend_gate is the whole gate; segment filters would narrow it")

    # `sort`/`sort_dir` are validated to a hard whitelist BEFORE any DB work -- an
    # unknown key 422s and never reaches SQL.
    order_fragment = _order_by(sort, sort_dir)

    seg_parts, params = _build_segment_filter(
        origin, acquired_from, acquired_to, filter, user_alias="u", build=build, country=country,
        sport=sport,
    )
    funnel_seg_parts, funnel_params = _build_segment_filter(
        origin, acquired_from, acquired_to, filter, build=build, country=country, sport=sport,
    )
    excl = _test_exclusion(exclude_test)
    where_parts = [*seg_parts]
    if excl:
        where_parts.append(excl)
    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    population = _admin_user_population(include_deleted_payers=filter == "paying")

    with get_pg() as conn:
        cur = conn.cursor()
        _assert_payments_ledger_ready(cur)

        journey_ids = None
        if spend_gate:
            from ...services.analytics_spend_readiness import gate_lost_user_ids

            journey_ids = gate_lost_user_ids(cur, excl, datetime.now(UTC), spend_gate)
        elif journey_stage:
            from ...services.analytics_journey import stopped_user_ids

            try:
                journey_ids = stopped_user_ids(
                    cur, journey_stage, journey_outcome,
                    d_from=date.fromisoformat(acquired_from) if acquired_from else None,
                    d_to=date.fromisoformat(acquired_to) if acquired_to else datetime.now(UTC).date(),
                    origin=origin or "all", build=build, platform=platform, excl=excl,
                    window_days=window_days, inactive_days=inactive_days, now=datetime.now(UTC),
                )
            except KeyError as e:
                raise HTTPException(status_code=404, detail=f"Unknown journey stage {e.args[0]!r}") from None
        if journey_ids is not None:
            population = _journey_user_population()
            where_parts.append("u.user_id = ANY(%s)")
            where_clause = "WHERE " + " AND ".join(where_parts)
            params = [journey_ids, *params, journey_ids]  # population's %s, then the WHERE's
            funnel_seg_parts.append("a.user_id = ANY(%s)")
            funnel_params = [*funnel_params, journey_ids]

        # LEFT JOIN (T4970): a user with no user_segments row (test-login/OTP-
        # bypass accounts, copied accounts — segments are created only in the
        # OAuth/OTP signup flows) must still be enumerated, not dropped. An
        # inner join here made such users invisible in GET /api/admin/users.
        # An origin/date filter (where_clause) still legitimately excludes NULL
        # segment fields, so filtered views are unchanged.
        cur.execute(f"""
            SELECT COUNT(*) AS cnt
            FROM {population}
            LEFT JOIN user_segments s ON u.user_id = s.user_id
            {where_clause}
        """, params)
        total_users = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total_users / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size

        # T8110: one CTE computing every sortable metric across the WHOLE table so
        # the global ORDER BY ranks the entire user set before LIMIT/OFFSET. The
        # per-page action/last_7d/credits follow-up queries are folded in here.
        # Anchored on `users u LEFT JOIN user_segments s` (preserves T4970); every
        # metric CTE is LEFT-JOINed so a segment-less / action-less user still
        # lists. `last_step_rank` mirrors _compute_last_step (design §6).
        name_select, name_join = _campaign_name_join(cur)
        cur.execute(f"""
            WITH act AS (
                SELECT user_id,
                       SUM(count)                                            AS action_count,
                       SUM(count) FILTER (WHERE action = 'game_created')     AS game_created_count,
                       -- T11010: the Games pair's "tried" half. game_created is per
                       -- GAME while game_upload_succeeded is per VIDEO FILE, so a
                       -- multi-angle game read as 1/5 (success exceeding attempt).
                       -- game_upload_attempted fires once per file at the same
                       -- prepare_upload seam as its clip twin, so both halves now
                       -- share one grain. game_created_count stays as the funnel /
                       -- sort dimension it has always been.
                       SUM(count) FILTER (WHERE action = 'game_upload_attempted') AS game_upload_attempted_count,
                       SUM(count) FILTER (WHERE action = 'game_upload_succeeded') AS game_upload_succeeded_count,
                       SUM(count) FILTER (WHERE action = 'clip_created')     AS clip_created_count,
                       -- Clip tried/succeeded pair mirrors the Games one (T8220), but a
                       -- clip can land via EITHER of two flows: annotate-save
                       -- (clip_save_attempted -> clip_created) or direct upload
                       -- (clip_upload_attempted -> clip_uploaded, T8370) -- so "tried"
                       -- sums both attempt events. clip_created_count above stays the
                       -- annotate-only figure (existing sort key / back-compat); the
                       -- combined succeeded figure is computed in Python below.
                       -- T11010: clip_upload_attempted is now actually EMITTED
                       -- (prepare_upload, kind='clip'). Before that this half summed
                       -- one real event and one dead name, which is why every
                       -- direct-upload account read "0 tried / N succeeded".
                       SUM(count) FILTER (WHERE action IN ('clip_save_attempted', 'clip_upload_attempted'))
                                                                              AS clip_tried_count,
                       SUM(count) FILTER (WHERE action = 'clip_uploaded')     AS clip_uploaded_count,
                       SUM(count) FILTER (WHERE action = 'export_completed') AS export_completed_count,
                       -- T8230: split the generic Exports total into its per-type
                       -- events. export_completed >= framing_exported + overlay_exported
                       -- always (each per-type success fires the generic event at the
                       -- SAME call site); the remainder is "other" exports (recovered
                       -- jobs -- exports.py finalize -- which re-fire only the generic
                       -- event). Surfaced as detail columns; the total stays so that
                       -- remainder is never silently dropped.
                       SUM(count) FILTER (WHERE action = 'framing_exported')  AS framing_exported_count,
                       SUM(count) FILTER (WHERE action = 'overlay_exported')  AS overlay_exported_count,
                       SUM(count) FILTER (WHERE action = 'export_failed')    AS export_failed_count,
                       SUM(count) FILTER (WHERE action = 'share_completed')  AS share_completed_count,
                       SUM(count) FILTER (WHERE action = 'credit_purchased') AS credit_purchase_count,
                       SUM(count) FILTER (WHERE action = 'session_started')  AS session_count,
                       {_last_step_rank_sql()}                               AS last_step_rank
                FROM user_actions
                GROUP BY user_id
            ),
            u7 AS (
                SELECT user_id, COALESCE(SUM(seconds), 0) AS last_7d_seconds
                FROM user_usage_daily
                WHERE day >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY user_id
            ),
            bal AS (SELECT user_id, balance FROM credits),
            pay AS {_LEDGER_REVENUE_BY_USER}
            SELECT
                u.user_id, u.email, u.created_at, u.is_test_account, u.is_deleted,
                s.origin, {name_select}, s.acquired_at, s.total_spent_cents, s.last_active_at,
                s.total_usage_seconds, s.current_session_start,
                COALESCE(act.action_count, 0)           AS action_count,
                COALESCE(act.game_created_count, 0)     AS game_created_count,
                COALESCE(act.game_upload_attempted_count, 0) AS game_upload_attempted_count,
                COALESCE(act.game_upload_succeeded_count, 0) AS game_upload_succeeded_count,
                COALESCE(act.clip_created_count, 0)     AS clip_created_count,
                COALESCE(act.clip_tried_count, 0)       AS clip_tried_count,
                COALESCE(act.clip_uploaded_count, 0)    AS clip_uploaded_count,
                COALESCE(act.export_completed_count, 0) AS export_completed_count,
                COALESCE(act.framing_exported_count, 0) AS framing_exported_count,
                COALESCE(act.overlay_exported_count, 0) AS overlay_exported_count,
                COALESCE(act.export_failed_count, 0)    AS export_failed_count,
                COALESCE(act.share_completed_count, 0)  AS share_completed_count,
                COALESCE(act.credit_purchase_count, 0)  AS credit_purchase_count,
                COALESCE(act.session_count, 0)          AS session_count,
                act.last_step_rank,
                COALESCE(u7.last_7d_seconds, 0)         AS last_7d_seconds,
                bal.balance                             AS credits,
                pay.revenue_cents                       AS ledger_revenue_cents,
                -- banked usage only, for a STABLE sort key (the displayed Usage
                -- adds a live open-session tail in Python -- design §7A, so an
                -- online user's shown value can exceed its rank value by <=30min).
                COALESCE(s.total_usage_seconds, 0)      AS usage_sort_seconds,
                (COALESCE(s.total_usage_seconds, 0)::float
                    / GREATEST(1.0, EXTRACT(EPOCH FROM (now() - COALESCE(s.acquired_at, u.created_at))) / 604800.0)
                )                                       AS avg_weekly_sort
            FROM {population}
            LEFT JOIN user_segments s ON u.user_id = s.user_id
            LEFT JOIN act ON act.user_id = u.user_id
            LEFT JOIN u7  ON u7.user_id  = u.user_id
            LEFT JOIN bal ON bal.user_id = u.user_id
            LEFT JOIN pay ON pay.user_id = u.user_id
            {name_join}
            {where_clause}
            ORDER BY {order_fragment}
            LIMIT %s OFFSET %s
        """, [*params, page_size, offset])

        rows = cur.fetchall()
        page_user_ids = [row["user_id"] for row in rows]

        from ...analytics import FLOW_EVENTS, FUNNEL_STEPS, session_engaged_seconds

        # Funnel totals must honor BOTH the segment filter (needs user_segments s)
        # and the test-account exclusion (needs users u) -- thread the SAME
        # predicates, joining only the tables the active predicates reference.
        funnel_joins = ""
        if funnel_seg_parts:
            funnel_joins += " JOIN user_segments s ON a.user_id = s.user_id"
        if excl:
            # T8630 r5: the shared exclusion predicate now falls back to
            # s.was_test_account, so user_segments must be in scope. A segment
            # filter already INNER-joins it above; otherwise LEFT JOIN it just for
            # the flag. `users` stays an INNER join here, so this per-page funnel
            # count keeps excluding deleted accounts exactly as before -- u is
            # always present on a surviving row, so the was_test_account fallback
            # is inert and exists only so the shared predicate resolves.
            if not funnel_seg_parts:
                funnel_joins += " LEFT JOIN user_segments s ON a.user_id = s.user_id"
            funnel_joins += " JOIN users u ON a.user_id = u.user_id"
        funnel_where_parts = [*funnel_seg_parts]
        if excl:
            funnel_where_parts.append(excl)
        funnel_where = ("WHERE " + " AND ".join(funnel_where_parts)) if funnel_where_parts else ""
        cur.execute(f"""
            SELECT a.action, COUNT(DISTINCT a.user_id) AS users
            FROM user_actions a
            {funnel_joins}
            {funnel_where}
            GROUP BY a.action
        """, list(funnel_params))
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

        # last_step: map the SQL-computed funnel rank back to its label (design §6).
        last_step = _rank_to_label(row["last_step_rank"])

        # T5660: add the still-open session using the SAME accounting as the
        # write side (analytics.session_engaged_seconds) — confirmed span
        # (uncapped, so heavy continuous users aren't clamped) plus a capped idle
        # tail (so an abandoned open tab isn't counted). Symmetric with banking.
        # This is DISPLAY only; the sort ranks on banked usage_sort_seconds (§7A).
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
        # yields an absurd average. (Displayed value; the sort ranks on the SQL
        # banked-derived avg_weekly_sort -- §7A.)
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
            "email": "Deleted account" if row["is_deleted"] else row["email"],
            "is_deleted": row["is_deleted"],
            "is_test_account": row["is_test_account"],
            "origin": row["origin"],
            "campaign_name": row["campaign_name"],
            "acquired_at": str(row["acquired_at"]) if row["acquired_at"] else None,
            "game_created_count": row["game_created_count"],
            # T11010: the Games cell renders game_tried_count / game_succeeded_count.
            # Both are per-FILE (prepare_upload attempt -> finalize_upload success),
            # matching the clip pair below. game_created_count remains exposed for the
            # per-GAME funnel/sort dimension; the two are deliberately NOT mixed.
            "game_tried_count": row["game_upload_attempted_count"],
            "game_succeeded_count": row["game_upload_succeeded_count"],
            "clip_created_count": row["clip_created_count"],
            "clip_tried_count": row["clip_tried_count"],
            # T8370's clip_uploaded (direct-upload flow) landed after the T8220
            # tried/succeeded pair shipped for clip_created (annotate flow) alone --
            # sum both durable-success events so "succeeded" isn't missing an
            # entire upload path (see comment on clip_tried_count above).
            "clip_succeeded_count": row["clip_created_count"] + row["clip_uploaded_count"],
            "export_completed_count": row["export_completed_count"],
            "framing_exported_count": row["framing_exported_count"],
            "overlay_exported_count": row["overlay_exported_count"],
            "export_failed_count": row["export_failed_count"],
            "share_completed_count": row["share_completed_count"],
            "credit_purchase_count": row["credit_purchase_count"],
            "credits": user_credit["credits_balance"] if user_credit else None,
            "credits_spent": user_credit["credits_spent"] if user_credit else 0,
            "credits_purchased": user_credit["credits_purchased"] if user_credit else 0,
            # T8650: per-user DISPLAY CACHE only (fast per-page read). NOT a revenue
            # source -- aggregates read the payments ledger (see _ledger_revenue_total).
            "total_spent_cents": (
                row["ledger_revenue_cents"] if row["is_deleted"]
                else (row["total_spent_cents"] or 0)
            ),
            "last_active_at": row["last_active_at"].isoformat() if row["last_active_at"] else None,
            "session_count": row["session_count"],
            "last_step": last_step,
            "action_count": row["action_count"],
            "total_usage_seconds": effective_usage,
            "avg_weekly_seconds": avg_weekly_seconds,
            "last_7d_seconds": row["last_7d_seconds"],
        })

    return {
        "users": users,
        "page": page,
        "page_size": page_size,
        "total_users": total_users,
        "total_pages": total_pages,
        "funnel_totals": funnel_totals,
    }


class BulkEmailRequest(BaseModel):
    user_ids: list[str] = []
    subject: str
    body: str
    test: bool = False


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

    subject = request.subject.strip()
    body = request.body
    if not (1 <= len(subject) <= BULK_SUBJECT_MAX):
        raise HTTPException(status_code=400, detail=f"subject must be 1..{BULK_SUBJECT_MAX} chars")
    if not body.strip() or len(body) > BULK_BODY_MAX:
        raise HTTPException(status_code=400, detail=f"body must be 1..{BULK_BODY_MAX} chars")

    from ...services.email import body_text_to_html, send_admin_update_email
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


class TestAccountRequest(BaseModel):
    is_test: bool


@router.post("/users/{user_id}/test-account")
# Plain sync def -> threadpool, off the event loop (concurrency model). Registered
# in the /users/{user_id}/* group, AFTER /users/bulk/* (FastAPI definition-order
# matching -- see the bulk-route landmine in backend-services.md).
def admin_mark_test_account(user_id: str, request: TestAccountRequest):
    """Mark/unmark a user as an internal test account. Admin only, gesture-based.

    T8110: a single surgical UPDATE -- the only write path for is_test_account
    outside the v026 seed. The list + population aggregates read this flag to
    exclude internal accounts. Survives reload (a DB column, not view state), so
    a new test account is flagged from the UI without a migration.
    """
    admin_id = get_current_user_id()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET is_test_account = %s WHERE user_id = %s",
            (request.is_test, user_id),
        )
        # T7500: a zero-row UPDATE-by-id is a 404, not a silent success.
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    logger.info(
        "[ADMIN] %s set is_test_account=%s for user %s", admin_id, request.is_test, user_id
    )
    return {"user_id": user_id, "is_test_account": request.is_test}


@router.post("/users/{user_id}/reset-data")
async def admin_reset_test_account_data(user_id: str):
    """Clear project/clip data (profiles/clips/exports) for a TEST account only.

    Data-only reset: keeps the login, session, credits, profile identity, and
    games -- see app/services/test_account_reset.py for the exact scope and
    why it's safe to run against a live server (CAS, migration seam).

    Gated server-side on `users.is_test_account` (NOT just a UI affordance) --
    this must never be reachable against a real user's data. Acquires the
    TARGET user's write lock (not the admin's) so it can't race that user's
    own in-flight requests; a background worker (export_worker, etc.) is a
    known, accepted gap documented in the service module.
    """
    admin_id = get_current_user_id()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email, is_test_account FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if not row["is_test_account"]:
        raise HTTPException(
            status_code=403,
            detail="Only accounts flagged is_test_account can be reset this way",
        )

    from ...middleware.db_sync import _get_user_write_lock
    from ...services.test_account_reset import (
        ActiveExportInProgress,
        TestAccountResetFailed,
        reset_test_account_data,
    )

    async with _get_user_write_lock(user_id):
        try:
            result = await asyncio.to_thread(reset_test_account_data, user_id)
        except ActiveExportInProgress as e:
            raise HTTPException(status_code=409, detail=str(e)) from None
        except TestAccountResetFailed as e:
            raise HTTPException(status_code=503, detail=str(e)) from None

    logger.info(
        "[ADMIN] %s reset test-account data for %s (%s): %s",
        admin_id, user_id, row["email"], result,
    )
    return {"user_id": user_id, **result}


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

    from ...routers.games_upload import _pending_kind, upload_object_key
    from ...services.materialization import open_profile_db_readonly
    from ...services.user_db import get_profiles
    from ...storage import r2_is_multipart_upload_valid, r2_list_multipart_parts

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
            # T10270 class 9 (the T8370 landmine, again): SELECT * so `kind` is
            # present when the column exists -- an explicit column list that
            # omits it makes _pending_kind() resolve to GAME unconditionally
            # (the column was never selected), even on an already-migrated DB.
            cur.execute("SELECT * FROM pending_uploads ORDER BY created_at DESC")
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

            # T10270 class 9: derive the key by kind instead of hardcoding the
            # GAME namespace -- a CLIP row's bytes live at raw_clips/{hash}.mp4
            # (per-profile), not games/{hash}.mp4, so the old hardcode HEADed
            # the wrong object and reported every live clip upload as dead.
            kind = _pending_kind(row)
            r2_key = upload_object_key(kind, row['blake3_hash'], user_id)
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
                "kind": kind,
                "file_size": row["file_size"],
                "created_at": created_at,
                "age_hours": round(age_seconds / 3600, 2) if age_seconds is not None else None,
                "r2_upload_id": upload_id,
                "r2_multipart_valid": valid,
                "r2_parts_uploaded": r2_parts,
            })

    return {"user_id": user_id, "older_than_hours": older_than_hours, "stuck_uploads": results}
