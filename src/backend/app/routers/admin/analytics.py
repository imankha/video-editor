"""Admin analytics endpoints (T3030): funnel, journey, rollups, spend readiness, pack mix,
channels, share funnel, cohorts, activation, retention, builds, countries, per-user journey
and actions, pulse, platforms, and the dashboard composer.

Split out of routers/admin.py by T5940; every URL is unchanged."""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...analytics import (
    RETRY_BURST_ACTIONS,
    usage_daily_has_upload_attempts,
    usage_daily_has_upload_outcomes,
)
from ...analytics import detect_retry_bursts as _detect_retry_bursts
from ...services.analytics import (
    _CHANNEL_GROUP_EXPR,
    _REFERRAL_JOIN,
    ChannelDimension,
    _channel_group,
    _origin_group_expr,
    _retry_bursts_for_stopped,
    _rollup_failures,
    _segment_group_rows,
    _segment_window_where,
)
from ...services.pg import get_pg
from . import (
    _LEDGER_REVENUE_BY_USER,
    DEFAULT_PAGE_SIZE,
    UPLOAD_SUCCESS_ALARM_MIN_ATTEMPTS,
    UPLOAD_SUCCESS_ALARM_MIN_FAILED_USERS,
    UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT,
    CountryFilter,
    SportFilter,
    _append_country,
    _assert_payments_ledger_ready,
    _build_segment_filter,
    _campaign_name_join,
    _deletions_for,
    _grouped_view_grand_total,
    _ledger_positive_revenue_total,
    _ledger_revenue_total,
    _test_exclusion,
    and_predicates,
    require_admin,
    sport_predicate,
)
from .users import list_users

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


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
    build: int | None = None,  # plain default, not Query(None): direct callers may omit it
    exclude_test: bool = True,
    country: CountryFilter = None,
):
    # T8250: default window compares against s.acquired_at (UTC timestamptz) -- match with
    # datetime.now(UTC).date(), not local date.today().
    d_from = date.fromisoformat(date_from) if date_from else datetime.now(UTC).date() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else datetime.now(UTC).date()

    from ...analytics import FLOW_EVENTS, FUNNEL_STEPS

    # T8110: exclude internal accounts from the population funnel. These queries
    # key on user_segments s, so join users u to reach the flag.
    # T8630 r5: LEFT JOIN so a deleted account's kept segment row survives the
    # join; the predicate falls back to s.was_test_account (see _test_exclusion).
    excl = _test_exclusion(exclude_test)
    excl_join = " LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    excl_and = f" AND {excl}" if excl else ""

    with get_pg() as conn:
        cur = conn.cursor()

        origin_filter = ""
        params: list = [d_from, d_to]
        if origin != "all":
            origin_filter = "AND s.origin = %s"
            params.append(origin)
        if build is not None:
            origin_filter += " AND s.signup_build = %s"
            params.append(build)
        country_conds: list[str] = []
        _append_country(country_conds, params, country)
        if country_conds:
            origin_filter += f" AND {country_conds[0]}"

        cur.execute(f"""
            SELECT s.origin,
                   COUNT(DISTINCT s.user_id) AS signed_up
            FROM user_segments s
            {excl_join}
            WHERE s.acquired_at BETWEEN %s AND %s {origin_filter}{excl_and}
            GROUP BY s.origin
        """, params)
        signup_rows = {r["origin"]: r["signed_up"] for r in cur.fetchall()}

        cur.execute(f"""
            SELECT s.origin, a.action,
                   COUNT(DISTINCT a.user_id) AS users
            FROM user_actions a
            JOIN user_segments s ON a.user_id = s.user_id
            {excl_join}
            WHERE s.acquired_at BETWEEN %s AND %s {origin_filter}{excl_and}
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


@router.get("/analytics/journey")
# T14010: plain def -> threadpool (T8000 pattern). Pure read of user_segments + user_actions;
# the fold lives in services/analytics_journey.py. Replaces the Funnel tab's endpoint use.
def analytics_journey_map(
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
    origin: str = Query("all"),
    build: int | None = None,
    # Device family: matches pwa-<family> and webapp-<family> (no iOS/Android split exists).
    platform: str | None = Query(None, pattern="^(mobile|desktop)$"),
    exclude_test: bool = True,
    window_days: int = Query(14, ge=1, le=365),
    inactive_days: int = Query(14, ge=1, le=365),
    country: CountryFilter = None,
    sport: SportFilter = None,
):
    from ...services.analytics_journey import build_journey

    # No `from` = every signup, matching the users list under the same (empty) global filter.
    d_from = date.fromisoformat(date_from) if date_from else None
    d_to = date.fromisoformat(date_to) if date_to else datetime.now(UTC).date()
    with get_pg() as conn:
        cur = conn.cursor()
        return build_journey(
            cur, d_from=d_from, d_to=d_to, origin=origin, build=build, country=country,
            platform=platform, excl=_test_exclusion(exclude_test), sport=sport,
            window_days=window_days, inactive_days=inactive_days, now=datetime.now(UTC),
        )


@router.get("/analytics/journey/step/{stage}")
# T14020: plain def -> threadpool (T8000 pattern). Same filters as the map; re-queried alone
# when the breakdown tab changes. Reads Postgres only except the retry-burst sample.
def analytics_journey_step(
    stage: str,
    by: str = Query("platform", pattern="^(platform|origin|build|cohort_month|country|arrival_sport|landing_path)$"),
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
    origin: str = Query("all"),
    build: int | None = None,
    platform: str | None = Query(None, pattern="^(mobile|desktop)$"),
    exclude_test: bool = True,
    window_days: int = Query(14, ge=1, le=365),
    inactive_days: int = Query(14, ge=1, le=365),
    country: CountryFilter = None,
    sport: SportFilter = None,
):
    d_from = date.fromisoformat(date_from) if date_from else None
    d_to = date.fromisoformat(date_to) if date_to else datetime.now(UTC).date()
    if stage == "visited":
        # T14960: not a per-user ladder stage -- no Postgres read, no people tab.
        from ...analytics import VISIT_BEACON_INSTRUMENTED_AT
        from ...services.analytics_journey import build_head_step
        from ...services.analytics_store import load_visit_totals

        totals, partial = load_visit_totals()
        result = build_head_step(
            totals, d_from=d_from or date.fromisoformat(VISIT_BEACON_INSTRUMENTED_AT),
            d_to=d_to, sport=sport,
        )
        result["partial"] = partial
        return result
    from ...services.analytics_journey import build_step

    with get_pg() as conn:
        cur = conn.cursor()
        try:
            result = build_step(
                cur, stage, by, d_from=d_from, d_to=d_to, origin=origin, build=build, country=country,
                platform=platform, excl=_test_exclusion(exclude_test), sport=sport,
                window_days=window_days, inactive_days=inactive_days, now=datetime.now(UTC),
            )
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Unknown journey stage {stage!r}") from None
    result["why"]["retry_bursts"] = _retry_bursts_for_stopped(result["people"])
    # T14030: "Where they left" from the newest journey rollup run (analytics.sqlite).
    from ...services.analytics_journey_rollup import journey_left, load_newest_rollup

    rollup, partial = load_newest_rollup()
    result["left"] = {**journey_left(rollup, stage), "partial": partial}
    return result


@router.post("/analytics/journey/rollup")
# T14030: plain def -> threadpool. Admin click only, no scheduler: walks every non-test
# user in-process through the JIT seam and writes one aggregate run to this writer's
# analytics.sqlite shard. Returns the run summary.
def analytics_journey_rollup():
    from ...services import analytics_journey_rollup as rollup
    from ...services.analytics_store import current_store

    try:
        return rollup.sweep(rollup.rollup_population(), current_store())
    except rollup.RollupStoreUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    except rollup.RollupAlreadyRunning as e:
        raise HTTPException(status_code=409, detail=str(e)) from None


@router.post("/analytics/rollup")
# T7400: plain def -> threadpool (T14030 pattern). Admin click only, no scheduler: walks
# every non-test user in-process through the JIT seam and writes one full-rebuild
# action-weekly/engagement-monthly run to this writer's analytics.sqlite shard.
def analytics_action_rollup():
    from ...services import analytics_rollup as rollup
    from ...services.analytics_store import current_store

    try:
        return rollup.sweep(rollup.rollup_population(), current_store())
    except rollup.ActionRollupStoreUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    except rollup.ActionRollupAlreadyRunning as e:
        raise HTTPException(status_code=409, detail=str(e)) from None


@router.get("/analytics/rollup")
# T7400: freshness/status read -- the newest run's meta across shards, no row data.
def analytics_action_rollup_status():
    from ...services.analytics_rollup import load_newest_action_rollup

    rollup, partial = load_newest_action_rollup()
    return {"computed_at": None, "partial": partial} if rollup is None else {**rollup["meta"], "partial": partial}


@router.get("/analytics/by-sport")
# T14950: "By sport" admin table source -- one read of the existing rollup's
# rollup_action_by_sport table (no per-user DB access at read, no new sweep trigger).
def analytics_by_sport():
    from ...services.analytics_rollup import load_newest_action_rollup

    rollup, partial = load_newest_action_rollup(tables=("rollup_action_by_sport",))
    if rollup is None:
        return {"computed_at": None, "partial": partial, "rows": []}
    rows = [
        {"month": month, "sport": sport, "action": action, "events": events, "distinct_users": distinct_users}
        for month, sport, action, events, distinct_users in rollup["rollup_action_by_sport"]
    ]
    return {**rollup["meta"], "partial": partial, "rows": rows}


@router.get("/analytics/spend-readiness")
# T14910: plain def -> threadpool (T8000 pattern). Read-only; the rules and the per-gate
# readers live in services/analytics_spend_readiness.py, thresholds in
# services/spend_readiness_constants.py.
def analytics_spend_readiness(exclude_test: bool = True, sport: SportFilter = None):
    # T14930: `sport` is accepted (and validated) so the admin's global Sport pill never 422s
    # here; the gate payload itself has no segment filters of any kind yet (not just sport).
    from ...services.analytics_spend_readiness import build_spend_readiness

    with get_pg() as conn:
        return build_spend_readiness(conn.cursor(), _test_exclusion(exclude_test), datetime.now(UTC))


@router.get("/analytics/spend-readiness/gate/{key}")
# T14910: one gate's Diagnose drawer (weekly, by build, by platform, by country), read on open.
def analytics_spend_readiness_gate(key: str, exclude_test: bool = True, sport: SportFilter = None):
    from ...services.analytics_spend_readiness import build_gate_diagnosis, has_diagnosis

    # Validate the key here; nothing below is caught, so a KeyError inside the builder is a
    # bug that surfaces as a 500, never a 404 (review follow-up 2026-11-06).
    if not has_diagnosis(key):
        raise HTTPException(status_code=404, detail=f"No diagnosis for gate {key!r}")
    with get_pg() as conn:
        return build_gate_diagnosis(conn.cursor(), _test_exclusion(exclude_test), datetime.now(UTC), key)


# T13330: pack mix windows -> days (None = all time). Counts + gross cents per pack,
# never per user.
_PACK_MIX_WINDOWS = {"30d": 30, "90d": 90, "all": None}


@router.get("/analytics/pack-mix")
# sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_pack_mix(exclude_test: bool = True, sport: SportFilter = None):
    """Purchases by pack from the payments ledger (kind='purchase' only: refunds
    are not packs sold). Same test-account predicate as the ledger revenue total,
    so a deleted test payer stays excluded. T16850: `sport` keeps the payers whose
    arrival sport it is (a payer with no segment row is "unknown")."""
    excl = and_predicates(_test_exclusion(exclude_test), sport_predicate(sport))
    excl_and = f" AND {excl}" if excl else ""
    windows: dict[str, list[dict]] = {}
    with get_pg() as conn:
        cur = conn.cursor()
        for name, days in _PACK_MIX_WINDOWS.items():
            since_and = " AND p.occurred_at >= now() - make_interval(days => %s)" if days else ""
            cur.execute(
                f"""
                SELECT COALESCE(p.pack, 'unknown') AS pack,
                       COUNT(*) AS purchases,
                       COALESCE(SUM(p.amount_cents), 0) AS gross_cents
                FROM payments p
                LEFT JOIN users u ON u.user_id = p.user_id
                LEFT JOIN user_segments s ON s.user_id = p.user_id
                WHERE p.kind = 'purchase'{since_and}{excl_and}
                GROUP BY COALESCE(p.pack, 'unknown')
                ORDER BY gross_cents DESC
                """,
                [days] if days else [],
            )
            windows[name] = [dict(r) for r in cur.fetchall()]
    return {"windows": windows}


@router.get("/analytics/channels")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_channels(
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
    exclude_test: bool = True,
    by: ChannelDimension = "origin",  # plain default: get_admin_dashboard calls this directly
    country: CountryFilter = None,
):
    """Campaigns dimension: one row per `by` value (default origin), labeled with its
    campaign name (T13980) where the value can be a registry id, carrying the same KPI
    columns as the Cohorts and Builds tables (T13990). Each row keys its value under the
    dimension's own name, so the default view's rows keep `origin` (T15120)."""
    where_clause, where_params, excl_join = _segment_window_where(date_from, date_to, "all", exclude_test, country)

    with get_pg() as conn:
        cur = conn.cursor()
        if by == "origin":
            group_expr, dim_join = _origin_group_expr(cur)
        else:
            group_expr = _CHANNEL_GROUP_EXPR[by]
            dim_join = _REFERRAL_JOIN if by == "referral_channel" else ""
        by_value = _segment_group_rows(
            cur, group_expr, [], where_clause, where_params, excl_join + dim_join,
        )
        names = {}
        if by in ("origin", "utm_campaign"):
            name_select, name_join = _campaign_name_join(cur, "v.value")
            cur.execute(f"""
                SELECT v.value, {name_select}
                FROM unnest(%s::text[]) AS v(value)
                {name_join}
            """, (list(by_value),))
            names = {r["value"]: r["campaign_name"] for r in cur.fetchall()}
        # T8650: revenue the origin buckets could not attribute (payers with no
        # segment row at all, or payers acquired outside this window) shown as an
        # explicit remainder so attributed + unattributed == the ledger grand total --
        # the project rule that a number must not hide what it excluded. T8630 r5:
        # deleted payers no longer fall here -- they keep a segment row and attribute
        # to their real origin.
        grand_total = _grouped_view_grand_total(cur, exclude_test, "all", country)

    channels = [
        {by: value, "campaign_name": names.get(value), "group": _channel_group(by, value, names.get(value)), **row}
        for value, row in sorted(
            by_value.items(), key=lambda kv: (-kv[1]["revenue_cents"], -kv[1]["signups"], kv[0])
        )
    ]
    attributed = sum(c["revenue_cents"] for c in channels)
    return {
        "by": by,
        "channels": channels,
        # attributed + unattributed == grand_total (T8650). Positive when deleted or
        # out-of-window payers hold money no origin bucket can claim.
        "unattributed_revenue_cents": grand_total - attributed,
    }


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
    from ...analytics import share_view_counts

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
    exclude_test: bool = True,
    country: CountryFilter = None,
):
    trunc = "week" if granularity == "week" else "month"
    where_clause, where_params, excl_join = _segment_window_where(date_from, date_to, origin, exclude_test, country)

    with get_pg() as conn:
        cur = conn.cursor()
        by_cohort = _segment_group_rows(
            cur, "date_trunc(%s, s.acquired_at)::date", [trunc], where_clause, where_params, excl_join
        )
        # T8650: revenue no cohort could attribute (payers with no segment row at all,
        # or payers acquired outside this window) -> explicit remainder so attributed +
        # unattributed == the grand total. Round 2 (item 5): the grand total is scoped to
        # the active `origin` filter, so `/cohorts?origin=X` reconciles WITHIN origin X
        # instead of absorbing every other origin's revenue into the remainder. T8630 r5:
        # deleted payers keep a segment row and attribute to their real cohort, so they
        # no longer fall into this remainder.
        cohort_grand_total = _grouped_view_grand_total(cur, exclude_test, origin, country)

    cohorts = [{"cohort_period": str(cp), **by_cohort[cp]} for cp in sorted(by_cohort, reverse=True)]
    attributed = sum(c["revenue_cents"] for c in cohorts)
    return {
        "cohorts": cohorts,
        "granularity": granularity,
        "unattributed_revenue_cents": cohort_grand_total - attributed,
    }


@router.get("/analytics/activation")
# sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_activation(
    exclude_test: bool = True,
    group: Literal["cohorts", "campaigns", "builds"] = "cohorts",
    sport: SportFilter = None,
):
    """T7420: export_completed <=14d (primary, scored vs the 40% scorecard target) and
    share_completed <=14d (value-moment) per group, with benchmark annotations. `group`
    follows the dashboard's Dimension pill (ruling 2026-11-13, same rule as the Retention
    chart): one row per signup month, per campaign (the origin dimension's T15200
    expression) or per signup build; every row carries `group` + display `label`.
    Scope-shrunk 2026-10-30 (owner-approved, see task file): stage-conversion/stall-
    distribution live in T14020's Journey step inspector instead. Reads existing Postgres only."""
    from ...analytics import segment_has_signup_build
    from ...services.analytics_activation import SIGNUP_MONTH_EXPR, compute_activation_report

    # T16850: the arrival-sport filter rides the builder's param-free population predicate.
    excl = and_predicates(_test_exclusion(exclude_test), sport_predicate(sport))
    with get_pg() as conn:
        cur = conn.cursor()
        group_expr, group_join = SIGNUP_MONTH_EXPR, ""
        if group == "campaigns":
            group_expr, group_join = _origin_group_expr(cur)
        elif group == "builds":
            if segment_has_signup_build(cur):
                group_expr = "s.signup_build"
            else:
                logger.error("[Admin] user_segments.signup_build missing (v039 not applied; run POST /api/admin/migrate-postgres)")
                group_expr = "NULL::integer"
        report = compute_activation_report(
            cur, excl, datetime.now(UTC).date(), group_expr=group_expr, group_join=group_join,
        )
        names = {}
        if group == "campaigns":
            name_select, name_join = _campaign_name_join(cur, "v.value")
            cur.execute(f"""
                SELECT v.value, {name_select}
                FROM unnest(%s::text[]) AS v(value)
                {name_join}
            """, ([c["group"] for c in report["cohorts"]],))
            names = {r["value"]: r["campaign_name"] for r in cur.fetchall()}

    for row in report["cohorts"]:
        row["label"] = names.get(row["group"]) or row["group"]
    if group == "campaigns":
        report["cohorts"].sort(key=lambda c: -c["signups"])
    elif group == "builds":
        report["cohorts"].sort(key=lambda c: (c["group"] == "unrecorded", -int(c["group"]) if c["group"] != "unrecorded" else 0))
    report["group"] = group
    return report


@router.get("/analytics/retention-chart")
# sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_retention_chart(
    exclude_test: bool = True,
    action: str | None = None,
    group: Literal["cohorts", "campaigns", "builds"] = "cohorts",
    cohort_bin: Literal["week", "month"] = "week",
    sport: SportFilter = None,
):
    """T7430: the investor-grade retention chart -- weekly cohort triangle
    (classic + unbounded), WAU/MAU series with low-volume-week shading, and the
    return-after-gap headline. `day_n` carries T16070's day-1/3/7/14/28 figures
    (compute_day_n_retention, same cohort-key derivation) for the chart's hover --
    there is no separate Day N endpoint or section (owner ruling 2026-11-13). `action`
    (optional) adds the action-level curve from T7400's rollup_action_weekly --
    None/empty cohorts when the rollup hasn't run yet, never an error. `group` follows
    the dashboard's Dimension pill (ruling 2026-11-13): one curve per signup week,
    per campaign (the origin dimension's T15200 expression) or per signup build; every
    curve row carries `group` + display `label`, and `day_n` is grouped the same way.
    `cohort_bin` is the weekly/monthly toggle for the Cohorts grouping (signup month
    instead of signup week); the other groupings ignore it."""
    from ...analytics import segment_has_signup_build
    from ...services.analytics_retention import compute_day_n_retention
    from ...services.analytics_retention_chart import (
        LOW_VOLUME_RATIO,
        LOW_VOLUME_TRAILING_WEEKS,
        RETURN_AFTER_GAP_DAYS,
        compute_action_retention,
        compute_retention_triangle,
        compute_return_after_gap,
        compute_wau_series,
        coverage_start,
        detect_low_volume_weeks,
    )

    # T16850: the arrival-sport filter rides every builder's param-free population
    # predicate (each joins user_segments s). The action curve reads a rollup with no
    # per-user grain, so it is not split by sport (`action.sport_applied`).
    excl = and_predicates(_test_exclusion(exclude_test), sport_predicate(sport))
    today = datetime.now(UTC).date()
    with get_pg() as conn:
        cur = conn.cursor()
        group_expr, group_join = None, ""
        if group == "cohorts" and cohort_bin == "month":
            group_expr = "date_trunc('month', s.acquired_at)::date"
        elif group == "campaigns":
            group_expr, group_join = _origin_group_expr(cur)
        elif group == "builds":
            if segment_has_signup_build(cur):
                group_expr = "s.signup_build"
            else:
                logger.error("[Admin] user_segments.signup_build missing (v039 not applied; run POST /api/admin/migrate-postgres)")
                group_expr = "NULL::integer"
        triangle = compute_retention_triangle(
            cur, excl, today, group_expr=group_expr, group_join=group_join,
        )
        wau = compute_wau_series(cur, excl, today)
        return_after_gap = compute_return_after_gap(cur, excl, today)
        coverage = coverage_start(cur, excl)
        day_n = compute_day_n_retention(cur, excl, today, group_expr=group_expr, group_join=group_join)
        names = {}
        if group == "campaigns":
            name_select, name_join = _campaign_name_join(cur, "v.value")
            cur.execute(f"""
                SELECT v.value, {name_select}
                FROM unnest(%s::text[]) AS v(value)
                {name_join}
            """, ([c["group"] for c in triangle["cohorts"]],))
            names = {r["value"]: r["campaign_name"] for r in cur.fetchall()}

    for row in triangle["cohorts"]:
        row["label"] = names.get(row["group"]) or row["group"]
    if group == "campaigns":
        triangle["cohorts"].sort(key=lambda c: -c["signups"])
    elif group == "builds":
        triangle["cohorts"].sort(key=lambda c: (c["group"] == "unrecorded", -int(c["group"]) if c["group"] != "unrecorded" else 0))

    low_volume_flags = detect_low_volume_weeks(wau)
    for row, flagged in zip(wau, low_volume_flags):
        row["low_volume"] = flagged

    result = {
        "triangle": triangle,
        "wau": wau,
        "return_after_gap": {"gap_days": RETURN_AFTER_GAP_DAYS, "cohorts": return_after_gap},
        "coverage_start": str(coverage) if coverage else None,
        "low_volume_rule": {"ratio": LOW_VOLUME_RATIO, "trailing_weeks": LOW_VOLUME_TRAILING_WEEKS},
        "group": group,
        "cohort_bin": cohort_bin,
        "day_n": day_n,
        "action": None,
    }
    if action:
        from ...services.analytics_rollup import load_newest_action_rollup

        rollup, partial = load_newest_action_rollup(tables=("rollup_action_weekly",))
        if rollup is None:
            result["action"] = {"action": action, "cohorts": [], "available": False, "partial": partial,
                                "sport_applied": False}
        else:
            result["action"] = {
                **compute_action_retention(rollup["rollup_action_weekly"], action),
                "available": True,
                "partial": partial,
                "computed_at": rollup["meta"]["computed_at"],
                "sport_applied": False,
            }
    return result


@router.get("/analytics/builds")
# sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_builds(
    origin: str = Query("all"),
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
    exclude_test: bool = True,
    country: CountryFilter = None,
):
    """T14000: the cohort table grouped by the deploy build each account signed up
    under (user_segments.signup_build, server-stamped), newest build first. Accounts
    that signed up before capture existed share one trailing `"unrecorded"` row, so
    the summed signups equal the cohort grid's for the same window and filters."""
    from ...analytics import segment_has_signup_build

    where_clause, where_params, excl_join = _segment_window_where(date_from, date_to, origin, exclude_test, country)

    with get_pg() as conn:
        cur = conn.cursor()
        if segment_has_signup_build(cur):
            build_expr, commit_expr = "s.signup_build", "s.signup_commit"
        else:
            logger.error("[Admin] user_segments.signup_build missing (v039 not applied; run POST /api/admin/migrate-postgres)")
            build_expr, commit_expr = "NULL::integer", "NULL::text"
        by_build = _segment_group_rows(cur, build_expr, [], where_clause, where_params, excl_join)
        cur.execute(f"""
            SELECT {build_expr} AS grp,
                   MIN(s.created_at) AS first_signup_at,
                   (array_agg({commit_expr} ORDER BY s.created_at))[1] AS commit_sha
            FROM user_segments s
            {excl_join}
            {where_clause}
            GROUP BY grp
        """, where_params)
        first_seen = {r["grp"]: r for r in cur.fetchall()}
        grand_total = _grouped_view_grand_total(cur, exclude_test, origin, country)

    builds = []
    for b in sorted(by_build, key=lambda b: (b is None, -(b or 0))):
        seen = first_seen[b]
        builds.append({
            "build": "unrecorded" if b is None else b,
            "commit_sha": seen["commit_sha"],
            "first_signup_at": seen["first_signup_at"].isoformat(),
            **by_build[b],
        })
    attributed = sum(r["revenue_cents"] for r in builds)
    return {"builds": builds, "unattributed_revenue_cents": grand_total - attributed}


@router.get("/analytics/countries")
# sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_countries(
    date_from: str = Query(None, alias="from"),
    date_to: str = Query(None, alias="to"),
    exclude_test: bool = True,
):
    """T15100: the Country selector's options, most sign-ups first. Deliberately ignores the
    country filter, or picking one would empty the list of the others. Loads on every admin
    page, so unlike the country filter it probes for the column before v043 has run."""
    from ...analytics import segment_has_country

    where_clause, where_params, excl_join = _segment_window_where(date_from, date_to, "all", exclude_test)
    with get_pg() as conn:
        cur = conn.cursor()
        if not segment_has_country(cur):
            logger.error("[Admin] user_segments.country missing (v043 not applied; run POST /api/admin/migrate-postgres)")
            return {"countries": []}
        cur.execute(f"""
            SELECT s.country
            FROM user_segments s
            {excl_join}
            {where_clause} AND s.country IS NOT NULL
            GROUP BY s.country
            ORDER BY COUNT(*) DESC, s.country
        """, where_params)
        return {"countries": [r["country"] for r in cur.fetchall()]}


@router.get("/analytics/journey/{user_id}")
# T8010: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_journey(user_id: str):

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE user_id = %s", (user_id,))
        user_row = cur.fetchone()
        # T15290: a deleted account's `users` row is gone BUT its de-identified
        # user_segments row is kept (T8630 r4) -- 404ing here made every deleted
        # account invisible in the admin detail panel, the opposite of "deletion
        # visible in the admin". Fall through with email=None instead; deleted_at
        # below (from account_deletions, the audit trail, not a last_active_at
        # guess) is what the panel shows as the deletion status.
        email = user_row["email"] if user_row else None

        name_select, name_join = _campaign_name_join(cur)
        # T15010: landing_path probed like signup_build/country -- this page loads
        # on every admin user click, so it must not 500 before v044 has run.
        from ...analytics import segment_has_landing_path, segment_has_signup_build
        landing_path_select = "s.landing_path" if segment_has_landing_path(cur) else "NULL::text AS landing_path"
        # T14990: signup_build backs the "where they left off" null-state
        # message ("no resume point (never navigated since build N)") --
        # same migration-window guard as landing_path above.
        build_select = "s.signup_build" if segment_has_signup_build(cur) else "NULL::int AS signup_build"
        cur.execute(f"""
            SELECT s.origin, {name_select}, s.referrer_id, s.acquired_at, s.last_active_at, s.created_at,
                   {landing_path_select}, {build_select}
            FROM user_segments s {name_join} WHERE s.user_id = %s
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

    deleted_at = _deletions_for([user_id]).get(user_id)

    completed = []

    completed.append({
        "event": "signup_completed",
        "at": seg["created_at"].isoformat() if seg["created_at"] else None,
    })

    from ...analytics import FLOW_EVENTS

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
    from ...services.user_db import get_user_db_connection
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

    # T14020: session_exit breadcrumbs (T7515 tier 4) written to the per-user log,
    # read-only here: last screen, dwell per screen, screen trail.
    import json

    with get_user_db_connection(user_id) as user_conn:
        exit_rows = user_conn.execute(
            "SELECT context, created_at FROM user_action_log WHERE action = 'session_exit' "
            "ORDER BY created_at DESC LIMIT 20").fetchall()
    session_exits = []
    for r in exit_rows:
        try:
            ctx = json.loads(r["context"]) if r["context"] else {}
        except (json.JSONDecodeError, TypeError):
            logger.warning("[Admin] unreadable session_exit context for user=%s", user_id)
            continue
        session_exits.append({"at": r["created_at"], "last_screen": ctx.get("last_screen"),
                              "dwell": ctx.get("dwell") or {}, "trail": ctx.get("trail") or []})

    # T14990: "Where they left off" -- the server-held resume point (T14980),
    # read-only, with human titles resolved for the panel.
    from ...services.resume_points import get_resume_point, resolve_resume_point_titles
    raw_resume_point = get_resume_point(user_id)
    resume_point = resolve_resume_point_titles(user_id, raw_resume_point) if raw_resume_point else None

    return {
        "user_id": user_id,
        "email": "Deleted account" if email is None else email,
        "is_deleted": email is None,
        "deleted_at": deleted_at.isoformat() if deleted_at else None,
        "origin": seg["origin"],
        "campaign_name": seg["campaign_name"],
        "landing_path": seg["landing_path"],
        "acquired_at": str(seg["acquired_at"]) if seg["acquired_at"] else None,
        "milestones": milestones,
        "session_count": session_count,
        "last_active_at": seg["last_active_at"].isoformat() if seg["last_active_at"] else None,
        "frustration_signals": {"retry_bursts": retry_bursts},
        "session_exits": session_exits,
        "signup_build": seg["signup_build"],
        "resume_point": resume_point,
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

    from ...services.clip_phases import compute_user_clip_phases

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

    from ...services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (user_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

    import json

    from ...services.user_db import get_user_db_connection
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


def _upload_attempts_today(cur, segment_sql: str, params: list) -> int | None:
    """T16550: today's upload attempts for the pulse rate, from user_usage_daily `d`
    (`segment_sql` is the join + WHERE, `params` end with today). None when the day
    is not fully recorded: v049 has not run, or a row from before it holds NULL."""
    if not usage_daily_has_upload_attempts(cur):
        logger.error("[T16550] pulse has no upload attempts: run postgres migration v049")
        return None
    cur.execute(f"""
        SELECT COALESCE(SUM(d.game_uploads_attempted), 0) AS attempted,
               COUNT(*) FILTER (WHERE d.game_uploads_attempted IS NULL) AS unrecorded
        FROM user_usage_daily d{segment_sql} AND d.day = %s
    """, params)
    r = cur.fetchone()
    return None if r["unrecorded"] else r["attempted"]


@router.get("/analytics/pulse")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_pulse(
    days: int = Query(30, ge=7, le=90),
    origin: str = Query(None),
    acquired_from: str = Query(None),
    acquired_to: str = Query(None),
    filter: str = Query(None),
    build: int | None = None,  # plain default, not Query(None): direct callers may omit it
    exclude_test: bool = True,
    country: CountryFilter = None,
    sport: SportFilter = None,
):
    # T7990: "today" is the UTC calendar day. This is DELIBERATE, not an accident: the
    # daily_counters and user_actions rows this endpoint reads are stamped CURRENT_DATE in
    # Postgres (UTC, analytics.py), so the tile boundary MUST match the data's boundary. For
    # a US-timezone admin this means "today" flips 5-8h early relative to their local day, so
    # late-evening activity lands in what reads as "yesterday" on the panel. We accept that
    # (no per-viewer timezone shift) rather than misalign the tiles from their own counters.
    # The cohort table's Monday-start week grouping (date_trunc('week', ...)) is likewise UTC
    # and independent -- documented so the two boundaries staying UTC is a choice, not drift.
    # T8250: date.today() reads the LOCAL calendar day, which regresses the comment above.
    # T15140: so does any app-side clock near midnight. Ask the clock that stamps the rows.
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_DATE AS today")
        today = cur.fetchone()["today"]
    start = today - timedelta(days=days - 1)

    filter_parts, filter_params = _build_segment_filter(origin, acquired_from, acquired_to, filter, build=build,
                                                        country=country, sport=sport)
    # T8650: does the admin have a REAL segment filter active (origin/date/paying/...),
    # as opposed to only the default test-account exclusion? This decides whether the
    # Revenue headline is the platform-wide ledger grand total (no real filter -> deleted
    # payers included) or the ledger sum over just the filtered payer population (user
    # decision 2026-09-24: the Revenue card follows the dashboard filters).
    has_real_filter = bool(filter_parts)
    # T8110 (design §7B): the pre-aggregated daily_counters path (the `else`
    # branch below) has no per-user dimension, so it CANNOT exclude test accounts.
    # When exclude_test is on we force the segment/user_actions path by appending
    # the exclusion predicate to filter_parts (making has_filter true) and joining
    # users u into each segment query. This is the accepted default cost of a
    # test-account-free pulse (user decision 2026-09-01).
    # T8630 r5: LEFT JOIN so a deleted account's kept segment row survives the
    # join; the predicate falls back to s.was_test_account (see _test_exclusion).
    excl = _test_exclusion(exclude_test)
    if excl:
        filter_parts = [*filter_parts, excl]
    seg_join = " LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    has_filter = bool(filter_parts)

    with get_pg() as conn:
        cur = conn.cursor()
        _assert_payments_ledger_ready(cur)

        if has_filter:
            seg_where = "WHERE " + " AND ".join(filter_parts)

            cur.execute(f"""
                SELECT s.acquired_at::date AS d, COUNT(*) AS cnt
                FROM user_segments s{seg_join}
                {seg_where} AND s.acquired_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, [*filter_params, start, today])
            signup_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            cur.execute(f"""
                SELECT a.first_at::date AS d, COUNT(DISTINCT a.user_id) AS cnt
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id{seg_join}
                {seg_where} AND a.action = 'export_completed' AND a.first_at::date BETWEEN %s AND %s
                GROUP BY d ORDER BY d
            """, [*filter_params, start, today])
            export_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            # T7510: upload success rate over the same segment filter. daily_counters
            # can't honor an arbitrary segment filter, so this is per-user.
            # T15050: from user_usage_daily's day buckets, which give today's count AND
            # today's users (one row per user per day, so COUNT is already distinct).
            # user_actions can't: its count is lifetime and first_at dates a user's
            # FIRST ever occurrence, so a returning user's activity today was invisible.
            if usage_daily_has_upload_outcomes(cur):
                cur.execute(f"""
                    SELECT
                        COALESCE(SUM(d.game_uploads_succeeded), 0) AS succeeded,
                        COALESCE(SUM(d.game_uploads_failed), 0) AS failed,
                        COUNT(*) FILTER (WHERE d.game_uploads_succeeded > 0) AS succeeded_users,
                        COUNT(*) FILTER (WHERE d.game_uploads_failed > 0) AS failed_users
                    FROM user_usage_daily d
                    JOIN user_segments s ON d.user_id = s.user_id{seg_join}
                    {seg_where} AND d.day = %s
                """, [*filter_params, today])
                ur = cur.fetchone()
                upload_succeeded_users, upload_failed_users = ur["succeeded_users"], ur["failed_users"]
            else:
                # Pre-v042 window: the T8171 first_at approximation, no user counts.
                logger.error("[T15050] pulse has no per-user upload counts: run postgres migration v042")
                cur.execute(f"""
                    SELECT
                        COALESCE(SUM(CASE WHEN a.action = 'game_upload_succeeded' THEN a.count END), 0) AS succeeded,
                        COALESCE(SUM(CASE WHEN a.action LIKE 'game_upload_failed:%%' THEN a.count END), 0) AS failed
                    FROM user_actions a
                    JOIN user_segments s ON a.user_id = s.user_id{seg_join}
                    {seg_where} AND (a.action = 'game_upload_succeeded' OR a.action LIKE 'game_upload_failed:%%')
                        AND a.first_at::date = %s
                """, [*filter_params, today])
                ur = cur.fetchone()
                upload_succeeded_users = upload_failed_users = None
            upload_succeeded_total, upload_failed_total = ur["succeeded"], ur["failed"]
            upload_attempts_total = _upload_attempts_today(
                cur, f" JOIN user_segments s ON d.user_id = s.user_id{seg_join} {seg_where}",
                [*filter_params, today])

            # The origin-only daily_counters shortcut can't honor a per-user
            # exclusion, so skip it when excluding test accounts (T8110).
            if origin and not acquired_from and not acquired_to and not filter and not excl and not sport:
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
                    FROM user_segments s{seg_join}
                    {seg_where} AND s.last_active_at::date BETWEEN %s AND %s
                    GROUP BY d ORDER BY d
                """, [*filter_params, start, today])
                active_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}

            # T8650: revenue from the payments ledger, not the total_spent_cents cache.
            # The card FOLLOWS the dashboard filters (user decision 2026-09-24):
            #  - a REAL segment filter (origin/date/paying/...) -> sum the ledger over
            #    exactly the filtered payer population, using the SAME user_segments +
            #    seg_join + seg_where the Signups number above uses. A deleted payer has
            #    no segment row and so can never match a filter -- correct, no remainder.
            #  - only test-exclusion (the default view, no real filter) -> the platform
            #    grand total, which DOES count a deleted payer's money (no segment join).
            if filter == "paying" and not any((origin, acquired_from, acquired_to)):
                # A deleted payer may have no segment row (the historical
                # pre-T8630 production deletion does not). Paying is a financial
                # ledger predicate, so the filtered headline must retain those
                # tombstones instead of silently losing legitimate revenue.
                revenue_total = _ledger_positive_revenue_total(cur, exclude_test)
            elif has_real_filter:
                cur.execute(f"""
                    SELECT COALESCE(SUM(pay.revenue_cents), 0) AS total
                    FROM user_segments s{seg_join}
                    LEFT JOIN {_LEDGER_REVENUE_BY_USER} pay ON pay.user_id = s.user_id
                    {seg_where}
                """, filter_params)
                revenue_total = cur.fetchone()["total"]
            else:
                revenue_total = _ledger_revenue_total(cur, exclude_test)

            cur.execute(f"""
                SELECT a.first_at::date AS d, COUNT(DISTINCT a.user_id) AS cnt
                FROM user_actions a
                JOIN user_segments s ON a.user_id = s.user_id{seg_join}
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

            # T8650: platform net revenue from the payments ledger (grand total). This
            # else branch runs only when exclude_test is off and no filter is set, so
            # no test exclusion applies -- a straight SUM over the ledger.
            revenue_total = _ledger_revenue_total(cur, exclude_test)

            date_range_tmp = [(start + timedelta(days=i)) for i in range(days)]
            revenue_by_date = {d: _cv(d, "credit_purchases") for d in date_range_tmp if _cv(d, "credit_purchases")}

            # T7510: upload success rate from the new daily_counters columns.
            # T8171 fix: "today" must mean TODAY, matching every sibling card on
            # this endpoint (signups/exports/active_users use a single day's
            # value, see the T7990 comment above) -- summing the whole `days`
            # window kept a resolved incident inside "today" for the window's
            # entire length (e.g. T8160's Aug 30-31 outage stayed "today" for
            # up to 90 days under the max `days` query param).
            upload_succeeded_total = _cv(today, "game_uploads_succeeded")
            upload_failed_total = _cv(today, "game_uploads_failed")
            # T15050: daily_counters has no user grain. These can lead the totals above
            # by the counter buffer's flush interval.
            upload_succeeded_users = upload_failed_users = None
            if usage_daily_has_upload_outcomes(cur):
                cur.execute("""
                    SELECT
                        COUNT(*) FILTER (WHERE game_uploads_succeeded > 0) AS succeeded_users,
                        COUNT(*) FILTER (WHERE game_uploads_failed > 0) AS failed_users
                    FROM user_usage_daily WHERE day = %s
                """, [today])
                ur = cur.fetchone()
                upload_succeeded_users, upload_failed_users = ur["succeeded_users"], ur["failed_users"]
            else:
                logger.error("[T15050] pulse has no per-user upload counts: run postgres migration v042")
            upload_attempts_total = _upload_attempts_today(cur, " WHERE TRUE", [today])

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
            FROM user_segments s{seg_join}
            {viral_where} AND s.acquired_at::date BETWEEN %s AND %s
        """, [*filter_params, start, today])
        vr = cur.fetchone()
        cur.execute(f"""
            SELECT s.acquired_at::date AS d, COUNT(*) AS cnt
            FROM user_segments s{seg_join}
            {viral_where} AND s.referrer_id IS NOT NULL
                AND s.acquired_at::date BETWEEN %s AND %s
            GROUP BY d ORDER BY d
        """, [*filter_params, start, today])
        referred_by_date = {r["d"]: r["cnt"] for r in cur.fetchall()}
    # referred/total can never exceed 100% -- an honest, bounded conversion rate. null when
    # no signups landed in the window, so the card renders "--" instead of a fake 0%.
    viral_total, viral_referred = vr["total"], vr["referred"]
    viral_pct = round(viral_referred / viral_total * 100, 2) if viral_total else None
    # Sparkline = per-day referred-signup COUNT (a referral-activity trend), mirroring the
    # revenue card's aggregate-headline + per-day-count sparkline shape.
    viral_spark = [referred_by_date.get(d, 0) for d in date_range]

    # T13990: the population KPIs the dimension tables no longer carry, for exactly the
    # filtered population (selected campaign / cohort / build + filter pills). Exports are
    # collapsed to one row per user first: user_actions has one row per PLATFORM, so a
    # raw join would fan out the export sum (T7980).
    pop_where = ("WHERE " + " AND ".join(filter_parts)) if has_filter else ""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(f"""
            SELECT COUNT(*) AS signups,
                   COUNT(*) FILTER (WHERE s.last_active_at >= s.created_at + INTERVAL '7 days') AS returned,
                   COUNT(exp.user_id) AS exporters,
                   COALESCE(SUM(exp.export_count), 0) AS total_exports,
                   percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (exp.first_at - s.created_at)) / 86400.0
                   ) AS median_days_to_export
            FROM user_segments s{seg_join}
            LEFT JOIN (
                SELECT user_id, SUM(count) AS export_count, MIN(first_at) AS first_at
                FROM user_actions
                WHERE action = 'export_completed'
                GROUP BY user_id
            ) exp ON exp.user_id = s.user_id
            {pop_where}
        """, filter_params)
        pr = cur.fetchone()
    population = {
        # Exports per EXPORTING user (T7980 semantics), null with no exporters.
        "avg_exports": round(pr["total_exports"] / pr["exporters"], 2) if pr["exporters"] else None,
        "time_to_export_days": (
            round(float(pr["median_days_to_export"]), 2) if pr["median_days_to_export"] is not None else None
        ),
        "return_7d_pct": round(pr["returned"] / pr["signups"] * 100, 2) if pr["signups"] else 0,
    }

    def make_card(sparkline, today_val=None, week_ago_val=None):
        t = today_val if today_val is not None else (sparkline[-1] if sparkline else 0)
        w = week_ago_val if week_ago_val is not None else (sparkline[-8] if len(sparkline) >= 8 else 0)
        change = round((t - w) / w * 100, 2) if w else (100.0 if t else 0.0)
        return {"today": t, "last_week_same_day": w, "change_pct": change, "sparkline": sparkline}

    revenue_card = make_card(revenue_spark)
    revenue_card["today"] = revenue_total
    viral_card = make_card(viral_spark)
    viral_card["today"] = viral_pct

    # T16550: upload success rate = today's successes / today's ATTEMPTS, so an
    # abandoned upload (neither outcome) pulls it down. None ("--") when there were
    # no attempts or the day's attempts were not recorded (_upload_attempts_today).
    # Nothing caps it: an upload started before midnight and finished after reads
    # its success today with no attempt today (same rule as T16340's tables).
    upload_success_rate = (
        round(upload_succeeded_total / upload_attempts_total * 100, 2)
        if upload_attempts_total else None
    )
    # The alarm reads FINISHED uploads (succeeded / (succeeded + failed)): attempts
    # include routine abandons and unaffordable aborts that are not a pipeline
    # collapse, and a pending v049 must not mute the alarm.
    upload_finished_total = upload_succeeded_total + upload_failed_total
    upload_finished_rate = (
        round(upload_succeeded_total / upload_finished_total * 100, 2)
        if upload_finished_total else None
    )
    # T8170: the T8160 outage sat at 29% success for ~2 days with no alert --
    # nobody noticed until a bug report. A real collapse with a meaningful sample
    # size must be unmissable: mark the card + fire a greppable CRITICAL log every
    # time an admin loads the dashboard while it's true (cheap, no new infra; a Fly
    # log alert can hook this later per the task). MIN_ATTEMPTS guards a quiet day
    # (e.g. 1 failed out of 1 attempt) from reading as a false collapse.
    # T15050: failures from ONE user are that user's problem, not a collapse (one
    # user's 36 duplicated failures read as fleet-wide on 2026-11-04). failed_users
    # is None before v042: the old rule stands, so a pending migration can't mute this.
    # T15140: unless nobody succeeded. On a one-uploader day that lone user's failures are
    # all the evidence there is, and an outage looks exactly like this. 2026-11-04 stays
    # quiet: two other users had successes.
    upload_success_alarm = (
        upload_finished_total >= UPLOAD_SUCCESS_ALARM_MIN_ATTEMPTS
        and upload_finished_rate is not None
        and upload_finished_rate < UPLOAD_SUCCESS_ALARM_THRESHOLD_PCT
        and (
            upload_failed_users is None
            or upload_failed_users >= UPLOAD_SUCCESS_ALARM_MIN_FAILED_USERS
            or upload_succeeded_users == 0
        )
    )
    if upload_success_alarm:
        logger.critical(
            f"[T8170] Upload success rate collapsed: {upload_finished_rate}% of finished uploads "
            f"({upload_succeeded_total}/{upload_finished_total} succeeded; "
            f"{upload_failed_total} failures from {upload_failed_users} users, "
            f"{upload_succeeded_total} successes from {upload_succeeded_users} users) -- "
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
        "finished": upload_finished_total,
        "finished_rate": upload_finished_rate,
        "succeeded_users": upload_succeeded_users,
        "failed_users": upload_failed_users,
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
        "population": population,
        "days": days,
    }


# ---------------------------------------------------------------------------
# Platform analytics
# ---------------------------------------------------------------------------

@router.get("/analytics/platforms")
# T8000: sync def -> threadpool, off the event loop (see backend-services.md concurrency model).
def analytics_platforms(
    action: str | None = Query(None),
    build: int | None = None,  # plain default, not Query(None): direct callers may omit it
    exclude_test: bool = True,
    sport: SportFilter = None,
):
    """Platform breakdown: % of users and actions on mobile/desktop/pwa."""
    from ...services.pg import get_pg

    # T8110: this is a real population aggregate ("% of users/actions on
    # mobile/desktop/pwa") and the heavy test accounts skew it. user_actions has
    # no user join today, so alias it `ua` and join users u to reach the flag.
    # T8630 r5: LEFT JOIN so a deleted account's kept user_actions rows survive,
    # and also LEFT JOIN user_segments s so the predicate can fall back to the
    # was_test_account snapshot once the `users` row is gone (see _test_exclusion).
    # Both joins are keyed on ua.user_id and neither fans out (user_segments PK is
    # user_id, users PK is user_id), so the per-user/action counts are unchanged.
    excl = _test_exclusion(exclude_test)
    excl_join = (
        " LEFT JOIN user_segments s ON s.user_id = ua.user_id"
        " LEFT JOIN users u ON u.user_id = ua.user_id"
    ) if excl else ""
    # T14000: the Builds dimension's row click narrows the breakdown to accounts
    # that signed up under that build (needs user_segments s in scope).
    seg_conds: list[str] = []
    seg_params: list = []
    if build is not None:
        if not excl:
            excl_join = " LEFT JOIN user_segments s ON s.user_id = ua.user_id"
        seg_conds.append("s.signup_build = %s")
        seg_params.append(build)
    # T16850: arrival sport; an action row with no segment row is "unknown".
    if sport:
        if not excl_join:
            excl_join = " LEFT JOIN user_segments s ON s.user_id = ua.user_id"
        seg_conds.append(sport_predicate(sport))

    with get_pg() as conn:
        cur = conn.cursor()

        where_conds = [*seg_conds]
        action_params: list = [*seg_params]
        if action:
            where_conds.append("ua.action = %s")
            action_params.append(action)
        if excl:
            where_conds.append(excl)
        where_sql = ("WHERE " + " AND ".join(where_conds)) if where_conds else ""

        cur.execute(f"""
            SELECT ua.platform,
                   COUNT(DISTINCT ua.user_id) AS users,
                   SUM(ua.count) AS total_actions
            FROM user_actions ua
            {excl_join}
            {where_sql}
            GROUP BY ua.platform
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
                "user_pct": round(r["users"] / total_users * 100, 2) if total_users else 0,
                "actions": r["total_actions"],
                "action_pct": round(r["total_actions"] / total_actions * 100, 2) if total_actions else 0,
            })

        by_action = []
        if not action:
            by_action_conds = [*seg_conds, excl] if excl else seg_conds
            excl_where = ("WHERE " + " AND ".join(by_action_conds)) if by_action_conds else ""
            cur.execute(f"""
                SELECT ua.action, ua.platform,
                       COUNT(DISTINCT ua.user_id) AS users,
                       SUM(ua.count) AS total
                FROM user_actions ua
                {excl_join}
                {excl_where}
                GROUP BY ua.action, ua.platform
                ORDER BY ua.action, total DESC
            """, seg_params)
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
                    p["pct"] = round(p["count"] / act_total * 100, 2) if act_total else 0
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
def get_admin_dashboard(build: int | None = None, exclude_test: bool = True, country: CountryFilter = None,
                        sport: SportFilter = None):
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
    # T8110: thread exclude_test through every callee explicitly (Query-sentinel
    # discipline). Default ON -> the combined dashboard opens on real users.
    # T14000: `build` narrows the population sections (users, pulse, platforms); the
    # dimension tables (channels, cohorts) stay unfiltered so every row stays clickable.
    # T15100: `country` is a standing filter over everything here but platforms, which
    # takes no country. T16850: `sport` narrows users, pulse and platforms; the dimension
    # tables (channels, cohorts) are not split by sport.
    return {
        "users": list_users(page=1, page_size=DEFAULT_PAGE_SIZE, origin=None,
                            acquired_from=None, acquired_to=None, filter=None, build=build,
                            sort="last_active_at", sort_dir="desc", exclude_test=exclude_test,
                            country=country, sport=sport),
        "pulse": analytics_pulse(days=30, origin=None, acquired_from=None,
                                 acquired_to=None, filter=None, build=build, exclude_test=exclude_test,
                                 country=country, sport=sport),
        "channels": analytics_channels(date_from=None, date_to=None, exclude_test=exclude_test,
                                       country=country),
        "cohorts": analytics_cohorts(granularity="week", origin="all",
                                     date_from=None, date_to=None, exclude_test=exclude_test,
                                     country=country),
        "platforms": analytics_platforms(action=None, build=build, exclude_test=exclude_test, sport=sport),
        "countries": analytics_countries(date_from=None, date_to=None, exclude_test=exclude_test)["countries"],
    }
