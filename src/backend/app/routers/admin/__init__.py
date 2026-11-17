"""
Admin package -- the /api/admin/* endpoints, one module per subject (T5940):

    session.py    GET /me and impersonation (holds `open_router`, the only unguarded pair)
    users.py      user directory, bulk email, test accounts, stuck uploads
    credits.py    grants, set-credits, credits backfill + gate
    revenue.py    Stripe revenue reconciliation
    ops.py        R2 usage, upload failures, share cleanup, migrations, backfills
    campaigns.py  campaign links
    referrals.py  referral stats
    bugs.py       bug reports
    analytics.py  analytics dashboards

Every sub-router is created with `dependencies=[Depends(require_admin)]` (T4610) and included
explicitly in main.py, `open_router` first. This module holds `require_admin` and the helpers
more than one sub-module shares; it defines no routes.

T3020/T3450: Stats from user_segments + user_actions. No more R2 profile
downloads or SQLite counting.
"""

import logging
from datetime import date
from typing import Annotated

from fastapi import HTTPException, Query

from ...analytics import ARRIVAL_SPORT_KEYS
from ...services.analytics import (  # noqa: F401 -- re-exported to the sub-modules
    _LEDGER_REVENUE_BY_USER,
    COUNTRY_UNKNOWN,
    SPORT_UNKNOWN,
    _append_country,
    _test_exclusion,
    and_predicates,
    sport_predicate,
)
from ...services.auth_db import is_admin
from ...services.pg import get_pg
from ...user_context import get_current_user_id

logger = logging.getLogger(__name__)


def require_admin():
    """Raise 403 if the current user is not an admin.

    T4610: attached once as a router-level dependency, never called per handler.
    Sync def -> threadpool: is_admin() makes blocking psycopg2 round-trips.
    """
    user_id = get_current_user_id()
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")


# T8170: upload_success_rate pulse-card alarm thresholds. The T8160 outage sat
# at 29% for ~2 days undetected -- below this rate, with a meaningful sample,
# is a real collapse, not noise.
UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT = 70.0
UPLOAD_SUCCESS_ALARM_MIN_ATTEMPTS = 5
UPLOAD_SUCCESS_ALARM_MIN_FAILED_USERS = 2

DEFAULT_PAGE_SIZE = 10

# T15100: a two-letter code, or the Channels "unknown" row. Annotated so direct callers
# (get_admin_dashboard) get a plain None default.
CountryFilter = Annotated[str | None, Query(pattern="^([A-Z]{2}|unknown)$")]


# T14930: "arrival sport (landing page)" -- a predicate on user_segments.utm_content
# restricted to ARRIVAL_SPORT_KEYS. `unknown` covers BOTH an ad's own utm_content and no
# utm_content at all: there is no inference between the two, only the known/unknown split.
# T16850: the predicate itself is services.analytics.sport_predicate (one definition).
SPORT_PATTERN = f"^({'|'.join(sorted(ARRIVAL_SPORT_KEYS))}|{SPORT_UNKNOWN})$"
SportFilter = Annotated[str | None, Query(pattern=SPORT_PATTERN)]


def _append_sport(where_parts: list, params: list, sport: str | None) -> None:
    """The segment condition for a SportFilter value, on alias `s`."""
    if sport:
        where_parts.append(sport_predicate(sport))


# ---------------------------------------------------------------------------
# Credit helpers
#
# T5840: credits moved to Postgres -- no more per-user user.sqlite R2 sync
# dance (`_refresh_target_user_db`/`_persist_target_user_db` are gone). Every
# grant/set now carries a real idempotency key, so a durability failure can
# 503 instead of the old `synced: false` best-effort report.
# ---------------------------------------------------------------------------

def _compute_last_step(actions: set[str]) -> str:
    from ...analytics import FLOW_EVENTS, FUNNEL_STEPS
    for step in reversed(FUNNEL_STEPS):
        if step in actions:
            return FLOW_EVENTS[step]["label"]
    return "Signed Up"


# ---------------------------------------------------------------------------
# T8110: test-account exclusion + whitelisted global sort for list_users
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# T8650: revenue AGGREGATES read the append-only `payments` ledger, never the
# `user_segments.total_spent_cents` cache. The cache is zeroed by account
# deletion (the row is dropped) and can be left un-writable for a segment-less
# payer, so basing a business revenue figure on it can only ever drift downward
# from the truth, permanently and invisibly (this epic exists because prod is
# $3.99 light from a deleted payer). `payments` has NO FK to `users`, so a
# deleted payer's money survives; these helpers are the single source for the
# grand-total and the grouped-view unattributed remainder. `total_spent_cents`
# remains ONLY a per-user display cache (see services/payments_ledger.py
# bump_total_spent and backend-services.md "Payments ledger").
# ---------------------------------------------------------------------------

def _ledger_revenue_total(cur, exclude_test: bool) -> int:
    """Grand-total net revenue straight from the ledger. `amount_cents` is signed
    (refunds and lost disputes are negative), so the SUM is already net.

    A deleted REAL payer must still count (the whole point of the ledger); a
    deleted TEST payer must NOT (or its money leaks into the real Unattributed
    remainder). T8630 r5: LEFT JOIN both `users` (live flag) and `user_segments`
    (the was_test_account snapshot kept on a deleted account) and exclude with the
    SAME predicate the grouped bucket views use -- NOT COALESCE(u.is_test_account,
    s.was_test_account, false) -- so this grand total and the buckets agree on
    exactly which payers are test accounts, whether alive or deleted. (Before r5
    a deleted test purchase was silently re-counted here: its `users` row was gone
    so the anti-join no longer recognised it.) `account_deleted_at` is NEVER a
    filter here."""
    if exclude_test:
        cur.execute(
            f"""
            SELECT COALESCE(SUM(p.amount_cents), 0) AS total
            FROM payments p
            LEFT JOIN users u ON u.user_id = p.user_id
            LEFT JOIN user_segments s ON s.user_id = p.user_id
            WHERE {_test_exclusion(True)}
            """
        )
    else:
        cur.execute("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments")
    return cur.fetchone()["total"]


_LIVE_USERS = (
    "SELECT user_id, email, created_at, is_test_account, false AS is_deleted "
    "FROM users"
)


def _journey_user_population() -> str:
    """User-table population for a Journey drop-off list (T14740). Takes one `%s`: the user ids.

    Account deletion keeps the de-identified user_segments row and the map counts it, so a
    deleted account in the id list stays listed or the rows would not equal the number clicked.
    """
    deleted = """
        SELECT s.user_id, NULL::text AS email, NULL::timestamptz AS created_at,
               COALESCE(s.was_test_account, false) AS is_test_account,
               true AS is_deleted
        FROM user_segments s
        LEFT JOIN users live_u ON live_u.user_id = s.user_id
        WHERE live_u.user_id IS NULL AND s.user_id = ANY(%s)
    """
    return f"({_LIVE_USERS} UNION ALL {deleted}) u"


def _admin_user_population(include_deleted_payers: bool) -> str:
    """User-table population, optionally including ledger-only payer tombstones.

    Deleted accounts have no email and cannot be impersonated or mutated.  They
    enter only the Paying view, where omitting them would make both the user count
    and filtered revenue contradict the append-only financial record.
    """
    if not include_deleted_payers:
        return f"({_LIVE_USERS}) u"
    deleted = f"""
        SELECT pay.user_id, NULL::text AS email, NULL::timestamptz AS created_at,
               COALESCE(s.was_test_account, false) AS is_test_account,
               true AS is_deleted
        FROM {_LEDGER_REVENUE_BY_USER} pay
        LEFT JOIN users live_u ON live_u.user_id = pay.user_id
        LEFT JOIN user_segments s ON s.user_id = pay.user_id
        WHERE live_u.user_id IS NULL AND pay.revenue_cents > 0
    """
    return f"({_LIVE_USERS} UNION ALL {deleted}) u"


def _ledger_positive_revenue_total(cur, exclude_test: bool) -> int:
    """Net revenue for every positive-net payer, including deleted accounts."""
    excl = f"WHERE {_test_exclusion(True)}" if exclude_test else ""
    cur.execute(f"""
        SELECT COALESCE(SUM(pay.revenue_cents), 0) AS total
        FROM {_LEDGER_REVENUE_BY_USER} pay
        LEFT JOIN users u ON u.user_id = pay.user_id
        LEFT JOIN user_segments s ON s.user_id = pay.user_id
        {excl}
        {'AND' if excl else 'WHERE'} pay.revenue_cents > 0
    """)
    return cur.fetchone()["total"]


def _assert_payments_ledger_ready(cur) -> None:
    """Never present an omitted historical backfill as legitimate zero revenue."""
    cur.execute("SELECT EXISTS(SELECT 1 FROM payments) AS has_ledger")
    if cur.fetchone()["has_ledger"]:
        return
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM user_segments WHERE total_spent_cents > 0) AS has_cache"
    )
    if cur.fetchone()["has_cache"]:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "payments_ledger_backfill_required",
                "message": "Revenue ledger is empty while historical purchases exist.",
            },
        )


def _grouped_view_grand_total(cur, exclude_test: bool, origin: str | None = None,
                              country: str | None = None) -> int:
    """Ledger grand total for a grouped view's unattributed remainder, scoped to the
    view's SEGMENT filter (origin + test exclusion) but NOT its acquisition-date window
    -- so `remainder = grand_total - Σ bucket` counts payers in scope who fell outside
    the window, and (only when unfiltered) deleted payers with no segment row at all.

    T8650 round 2 (item 5): when a real `origin` filter is active the grand total must
    be scoped to THAT origin's payers, never the whole platform -- otherwise the
    remainder would silently absorb every other origin's revenue.

    T8630 r5: a deleted payer KEEPS its (de-identified) segment row now, so it IS in
    scope of an origin filter -- the users join is LEFT so the deleted row survives,
    and test exclusion falls back to the was_test_account snapshot (see
    _test_exclusion). Its money belongs in its real origin, matching the grouped
    bucket query, so attributed + remainder still reconciles within the origin.

    T15100: a `country` filter scopes the total the same way."""
    conds: list[str] = []
    params: list = []
    if origin and origin != "all":
        conds.append("s.origin = %s")
        params.append(origin)
    _append_country(conds, params, country)
    if conds:
        excl = _test_exclusion(exclude_test)
        join = " LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
        where = "WHERE " + " AND ".join([*conds, excl] if excl else conds)
        cur.execute(f"""
            SELECT COALESCE(SUM(pay.revenue_cents), 0) AS total
            FROM user_segments s{join}
            LEFT JOIN {_LEDGER_REVENUE_BY_USER} pay ON pay.user_id = s.user_id
            {where}
        """, params)
        return cur.fetchone()["total"]
    return _ledger_revenue_total(cur, exclude_test)


# Sort key (the 16 UserTable columns) -> a FIXED ORDER BY value fragment. Hard
# whitelist: a client `sort` not in this dict is a 422, never interpolated into
# SQL. Every fragment is an output-column alias or a qualified table column from
# the list_users CTE (see below). Direction + NULLS + tiebreaker are appended by
# _order_by so equal-metric rows can't repeat/skip across page boundaries.
_SORT_COLUMNS = {
    "email":                  "u.email",
    "origin":                 "s.origin",
    "last_step":              "last_step_rank",
    "acquired_at":            "s.acquired_at",
    "game_created_count":     "game_created_count",
    "clip_created_count":     "clip_created_count",
    "export_completed_count": "export_completed_count",
    "framing_exported_count": "framing_exported_count",
    "overlay_exported_count": "overlay_exported_count",
    "share_completed_count":  "share_completed_count",
    "credits":                "credits",
    "total_spent_cents":      (
        "CASE WHEN u.is_deleted THEN pay.revenue_cents ELSE s.total_spent_cents END"
    ),
    "action_count":           "action_count",
    "session_count":          "session_count",
    "total_usage_seconds":    "usage_sort_seconds",   # banked usage (design §7A)
    "avg_weekly_seconds":     "avg_weekly_sort",       # SQL banked-derived (§7A)
    "last_7d_seconds":        "last_7d_seconds",
    "last_active_at":         "s.last_active_at",
}


def _order_by(sort: str, sort_dir: str) -> str:
    """Map a whitelisted sort key + direction to an ORDER BY fragment, or 422.

    DESC -> NULLS LAST, ASC -> NULLS FIRST (absent/zero metric always at the far
    end). `u.user_id ASC` is appended as a total-order tiebreaker so LIMIT/OFFSET
    paging over equal values never repeats or drops a row (acceptance criterion).
    """
    frag = _SORT_COLUMNS.get(sort)
    if frag is None or sort_dir not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="invalid sort")
    nulls = "NULLS LAST" if sort_dir == "desc" else "NULLS FIRST"
    return f"{frag} {sort_dir.upper()} {nulls}, u.user_id ASC"


# Lazily-built (analytics is imported lazily to avoid a circular import at module
# load) SQL CASE + rank->label map for the sortable `last_step` column. The rank
# is the position in analytics.FUNNEL_STEPS; MAX(rank) over a user's actions =
# the furthest funnel step reached = exactly what _compute_last_step's
# reversed()-first-match returns. Generated FROM FUNNEL_STEPS so a future step
# insertion can't desync the sort from _compute_last_step.
_LAST_STEP_RANK_SQL: str | None = None
_RANK_TO_LABEL: dict[int, str] | None = None


def _build_last_step_rank():
    global _LAST_STEP_RANK_SQL, _RANK_TO_LABEL
    from ...analytics import FLOW_EVENTS, FUNNEL_STEPS
    arms = []
    rank_to_label: dict[int, str] = {}
    for i, step in enumerate(FUNNEL_STEPS):
        rank = i + 1
        # step names are internal module constants (FUNNEL_STEPS), never client
        # input -- safe to inline into the CASE.
        arms.append(f"WHEN '{step}' THEN {rank}")
        rank_to_label[rank] = FLOW_EVENTS[step]["label"]
    _LAST_STEP_RANK_SQL = "MAX(CASE action " + " ".join(arms) + " END)"
    _RANK_TO_LABEL = rank_to_label


def _last_step_rank_sql() -> str:
    if _LAST_STEP_RANK_SQL is None:
        _build_last_step_rank()
    return _LAST_STEP_RANK_SQL  # type: ignore[return-value]


def _rank_to_label(rank) -> str:
    if _RANK_TO_LABEL is None:
        _build_last_step_rank()
    if rank is None:
        return "Signed Up"
    return _RANK_TO_LABEL.get(rank, "Signed Up")  # type: ignore[union-attr]

BULK_MAX_IDS = 100
BULK_SUBJECT_MAX = 200
BULK_BODY_MAX = 10000


def _deletions_for(user_ids: list) -> dict:
    """user_id -> deleted_at (datetime) from the latest account_deletions row.

    T8640 Decision D: explains an id-only row ("account deleted 2026-08-24") instead
    of a bare UUID. Only the most recent deletion event per user_id is surfaced."""
    if not user_ids:
        return {}
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT ON (user_id) user_id, deleted_at
            FROM account_deletions
            WHERE user_id = ANY(%s)
            ORDER BY user_id, deleted_at DESC
        """, (user_ids,))
        return {r["user_id"]: r["deleted_at"] for r in cur.fetchall()}


# ---------------------------------------------------------------------------
def _campaign_name_join(cur, origin_col: str = "s.origin") -> tuple[str, str]:
    """(select expression, join clause) that label an origin with its campaign's
    name, aliased `campaign_name` (NULL for any origin that is not a registered
    campaign). Migration-window guard: before v038 runs there is no campaigns
    table, so every row reads NULL (logged) instead of the admin view 500ing."""
    cur.execute("SELECT to_regclass('campaigns') AS t")
    row = cur.fetchone()
    if row is None or row["t"] is None:
        logger.error("[Admin] campaigns table missing (v038 not applied; run POST /api/admin/migrate-postgres)")
        return "NULL::text AS campaign_name", ""
    return "camp.name AS campaign_name", f"LEFT JOIN campaigns camp ON camp.id = {origin_col}"


def _build_segment_filter(origin, acquired_from, acquired_to, user_filter, user_alias="s", build=None,
                          country=None, sport=None):
    where_parts = []
    params = []
    if origin:
        where_parts.append("s.origin = %s")
        params.append(origin)
    if build is not None:
        # T14000: the Builds dimension's row click (user_segments.signup_build).
        where_parts.append("s.signup_build = %s")
        params.append(build)
    _append_country(where_parts, params, country)
    _append_sport(where_parts, params, sport)
    if acquired_from:
        where_parts.append("s.acquired_at >= %s")
        params.append(date.fromisoformat(acquired_from))
    if acquired_to:
        where_parts.append("s.acquired_at <= %s")
        params.append(date.fromisoformat(acquired_to))
    if user_filter == "paying":
        # T8657: "paying" is decided by the LEDGER (net revenue > 0), not the
        # `total_spent_cents` cache. The cache is zeroed by account deletion, left
        # un-writable for a segment-less payer, and overwritten by the reconciliation
        # heal, so a cache-based selector both DROPS backfill-only payers (cache never
        # moved) and KEEPS refunded-to-zero ones -- diverging from the ledger totals
        # every other admin revenue figure reads since T8650. Reuse the shared
        # per-user pre-aggregate rather than adding a third copy of the SUM. Callers
        # choose the population alias: segment-scoped analytics use `s`, while the
        # admin Paying table uses its ledger-aware `u` population so deleted payer
        # tombstones remain selectable.
        where_parts.append(
            f"{user_alias}.user_id IN (SELECT user_id FROM {_LEDGER_REVENUE_BY_USER} pay "
            "WHERE pay.revenue_cents > 0)"
        )
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
    elif user_filter == "upload_no_outcome":
        # T15770: attempted at least one upload (game_upload_attempted) more times
        # than it has a recorded outcome (succeeded or any failed reason) -- the
        # build-7102 shape (4 of 12 uploaders) that the plain success-rate denominator
        # used to hide entirely. Per-user, correlated: no GROUP BY at the users
        # query's grain, so this has to self-contain its own aggregation.
        where_parts.append(f"""
            EXISTS (
                SELECT 1 FROM user_actions att
                WHERE att.user_id = {user_alias}.user_id AND att.action = 'game_upload_attempted'
                AND att.count > COALESCE((
                    SELECT SUM(o.count) FROM user_actions o
                    WHERE o.user_id = att.user_id
                      AND (o.action = 'game_upload_succeeded' OR o.action LIKE 'game_upload_failed:%%')
                ), 0)
            )
        """)
    return where_parts, params
