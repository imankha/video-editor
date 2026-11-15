"""Admin analytics aggregation (T5940): the segment-dimension table builder, the channel
grouping rules, and the journey retry-burst / failure rollups behind the
/api/admin/analytics/* views. Extracted from routers/admin/analytics.py so the router
keeps the HTTP surface and this module keeps the queries it shares across views.
"""

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from ..analytics import (
    EVENT_INSTRUMENTED_AT,
    RETRY_BURST_ACTIONS,
)
from ..analytics import detect_retry_bursts as _detect_retry_bursts

logger = logging.getLogger(__name__)

COUNTRY_UNKNOWN = "unknown"

def _append_country(where_parts: list, params: list, country: str | None) -> None:
    """The segment condition for a CountryFilter value, on alias `s`. `unknown` is the NULLs,
    which is what the Channels "unknown" row counts."""
    if country == COUNTRY_UNKNOWN:
        where_parts.append("s.country IS NULL")
    elif country:
        where_parts.append("s.country = %s")
        params.append(country)

def _test_exclusion(exclude_test: bool, seg: str = "s") -> str:
    """WHERE fragment excluding internal/test accounts, or '' when off.

    The SINGLE place the test-exclusion predicate lives (DRY). Returns a static,
    param-free string so it composes into any where_parts list by append. It is
    INDEPENDENT of _build_segment_filter's single-value userFilter -- the "Real"
    pill never joins the exclusive segment set, so Real + Paying = real paying
    users.

    T8630 r5: prefer the LIVE `users.is_test_account`, but fall back to the
    per-row `{seg}.was_test_account` snapshot for a DELETED account (whose `users`
    row is gone but whose de-identified `user_segments` row is kept for revenue
    attribution), else treat as not-test. So a deleted payer keeps the exact
    exclusion status it had while live instead of dropping out of every
    `exclude_test=true` view and leaking into Unattributed revenue. Every consumer
    must LEFT JOIN `users u` (so a deleted account's segment row survives the join)
    AND expose the `{seg}` (user_segments) alias that carries was_test_account.
    """
    return f"NOT COALESCE(u.is_test_account, {seg}.was_test_account, false)" if exclude_test else ""

# Per-user ledger revenue, pre-aggregated to ONE row per user so it LEFT JOINs a
# grouped segment query without fanning out the other per-user subqueries (the
# same one-row-per-user discipline the exports/purchases subqueries already use;
# see the T7980 cartesian-fanout note in analytics_channels). GROUP BY user_id is
# served by idx_payments_user (user_id is its leading column).
_LEDGER_REVENUE_BY_USER = (
    "(SELECT user_id, SUM(amount_cents) AS revenue_cents FROM payments GROUP BY user_id)"
)


# T15120: the channel read-out dimensions, as literal SQL (never the client's value).
# A NULL or blank field groups as "unknown", shown and never dropped (T8650).
ChannelDimension = Literal["origin", "utm_source", "utm_campaign", "utm_content",
                           "click_source", "referral_channel", "country"]
_CHANNEL_GROUP_EXPR = {
    "origin": "s.origin",
    "utm_source": "COALESCE(NULLIF(s.utm_source, ''), 'unknown')",
    "utm_campaign": "COALESCE(NULLIF(s.utm_campaign, ''), 'unknown')",
    "utm_content": "COALESCE(NULLIF(s.utm_content, ''), 'unknown')",
    "click_source": "COALESCE(NULLIF(s.click_source, ''), 'unknown')",
    "referral_channel": "COALESCE(r.channel, 'none')",
    "country": "COALESCE(s.country, 'unknown')",
}
# referrals.referred_id is unique, so this join cannot fan a signup out.
_REFERRAL_JOIN = " LEFT JOIN referrals r ON r.referred_id = s.user_id"

# T15200: the origin dimension's synthetic bucket for a referred sign-up whose inherited
# origin would otherwise land it in a paid campaign's row (see _origin_group_expr).
REFERRAL_PROGRAMME_GROUP = "referral_programme"


def _origin_group_expr(cur) -> tuple[str, str]:
    """origin dimension's group expression (T15200 separation rule). `_determine_origin`
    gives a referred sign-up its REFERRER's origin, so a referral chain through someone who
    joined via a paid campaign would otherwise count as another paid sign-up for that
    campaign. Only that case is redirected to REFERRAL_PROGRAMME_GROUP: any other origin
    (organic, a raw utm value, an unregistered ad-manager id) is unaffected whether or not
    the sign-up itself has a referrals row -- this is the Paid-ads/Referral-programme
    separation, not a general "was referred" flag. Migration-window guard: before v038
    there is no campaigns table, so this degrades to the plain origin (unchanged behavior)."""
    cur.execute("SELECT to_regclass('campaigns') AS t")
    if cur.fetchone()["t"] is None:
        return "s.origin", ""
    return (
        f"CASE WHEN camp.id IS NOT NULL AND ref.referred_id IS NOT NULL "
        f"THEN '{REFERRAL_PROGRAMME_GROUP}' ELSE s.origin END",
        " LEFT JOIN campaigns camp ON camp.id = s.origin LEFT JOIN referrals ref ON ref.referred_id = s.user_id",
    )


def _channel_group(by: str, value: str, campaign_name: str | None) -> str | None:
    """Paid-ads vs Referral-programme label for a channels row (T15200). Only meaningful
    for the origin dimension; other dimensions carry no such distinction."""
    if by != "origin":
        return None
    if value == REFERRAL_PROGRAMME_GROUP:
        return "referral"
    return "paid" if campaign_name is not None else None




# T13990: the funnel steps every dimension table shows, as "% of signups who ...".
# Keyed by action so the column key (`<label>_pct`) stays derived from FLOW_EVENTS.
DIMENSION_STEPS = ("game_upload_succeeded", "clip_created", "export_completed",
                   "share_completed", "credit_purchased")
# T15120: distinct-user counts beside the % columns (tries and successes together).
DIMENSION_COUNTS = {"game_upload_attempted": "upload_attempted",
                    "game_upload_succeeded": "upload_succeeded",
                    "paywall_shown": "paywall_shown",
                    "buy_modal_opened": "buy_modal_opened",
                    "credit_purchased": "payers"}
# T16340: the first moment an upload success can have its game_upload_attempted.
UPLOAD_ATTEMPTS_RECORDED_FROM = datetime.combine(
    date.fromisoformat(EVENT_INSTRUMENTED_AT["game_upload_attempted"]), time.min, tzinfo=UTC)
# T15120: the render events that make a first highlight, and the window to reach one.
FIRST_HIGHLIGHT_ACTIONS = ("credits_consumed", "export_completed")
FIRST_HIGHLIGHT_DAYS = 14


def _segment_group_rows(cur, group_expr: str, group_params: list, where_clause: str,
                       where_params: list, excl_join: str) -> dict:
    """The KPI columns every admin dimension table shows (Campaigns, Cohorts, Builds --
    T13990: one column set for all three): signups, ledger revenue, upload success %
    (game uploads succeeded / succeeded + failed, null with no outcome), the % of
    signups that reached each funnel step, the DIMENSION_COUNTS distinct-user counts and
    `first_highlight_14d` {aged, hit, pct}: of signups acquired at least 14 days ago, the
    share with a render by midnight UTC 14 days after their acquired_at DATE (pct null
    with none aged). Grouped by `group_expr` (aliased `grp`). Returns {group value: row}."""
    from ..analytics import FLOW_EVENTS

    aged_before = datetime.now(UTC).date() - timedelta(days=FIRST_HIGHLIGHT_DAYS)
    cur.execute(f"""
        SELECT
            {group_expr} AS grp,
            COUNT(*) AS signups,
            COUNT(*) FILTER (WHERE s.acquired_at <= %s) AS aged,
            COUNT(*) FILTER (WHERE s.acquired_at <= %s AND EXISTS (
                SELECT 1 FROM user_actions fh
                WHERE fh.user_id = s.user_id AND fh.action = ANY(%s)
                  AND fh.first_at <= (s.acquired_at + %s)::timestamp AT TIME ZONE 'UTC'
            )) AS hit,
            -- T8650: revenue from the payments ledger (pre-aggregated per user). T8630
            -- r5: a deleted payer KEEPS its segment row and the users join is LEFT, so
            -- it stays in its real group instead of dropping to the unattributed remainder.
            COALESCE(SUM(pay.revenue_cents), 0) AS revenue_cents,
            -- T15290: deleted_u is its OWN unconditional LEFT JOIN (excl_join above only
            -- joins `users` when exclude_test is on) -- a deleted account's email is
            -- always NULL (account_deletions.record_account_deletion commits the
            -- DELETE FROM users and the audit row together), so this count is exactly
            -- "how many of this group's kept segment rows belong to a deleted account".
            COUNT(*) FILTER (WHERE deleted_u.user_id IS NULL) AS deleted
        FROM user_segments s
        LEFT JOIN {_LEDGER_REVENUE_BY_USER} pay ON pay.user_id = s.user_id
        LEFT JOIN users deleted_u ON deleted_u.user_id = s.user_id
        {excl_join}
        {where_clause}
        GROUP BY grp
    """, [*group_params, aged_before, aged_before, list(FIRST_HIGHLIGHT_ACTIONS),
          FIRST_HIGHLIGHT_DAYS, *where_params])
    rows = {
        r["grp"]: {
            "signups": r["signups"],
            "revenue_cents": r["revenue_cents"] or 0,
            "deleted": r["deleted"],
            "first_highlight_14d": {
                "aged": r["aged"],
                "hit": r["hit"],
                "pct": round(r["hit"] / r["aged"] * 100, 2) if r["aged"] else None,
            },
        }
        for r in cur.fetchall()
    }

    # One row per (group, action): distinct users drive the step %, summed occurrences
    # drive upload success (failed outcomes carry a ":<reason>" suffix).
    cur.execute(f"""
        SELECT
            {group_expr} AS grp,
            a.action,
            COUNT(DISTINCT a.user_id) AS users,
            SUM(a.count) AS occurrences
        FROM user_actions a
        JOIN user_segments s ON a.user_id = s.user_id
        {excl_join}
        {where_clause}
        GROUP BY grp, a.action
    """, [*group_params, *where_params])
    for ar in cur.fetchall():
        row = rows.get(ar["grp"])
        if row is None:
            continue
        if ar["action"] in DIMENSION_STEPS:
            key = FLOW_EVENTS[ar["action"]]["label"].lower().replace(" ", "_") + "_pct"
            row[key] = round(ar["users"] / row["signups"] * 100, 2) if row["signups"] else 0
        if ar["action"] in DIMENSION_COUNTS:
            row[DIMENSION_COUNTS[ar["action"]]] = ar["users"]

    # T15770: the denominator counts every ATTEMPT, not just the ones that got an
    # outcome -- an attempt that stalled with no success/failure row (abandoned tab,
    # dead client) used to vanish from the rate (build-7102: 4 of 12 uploaders).
    # T16340: game_upload_attempted only records since T11010 (2026-09-22), while
    # successes record since 2026-08-26, so older successes had no attempt and the
    # Unrecorded build read 131.66% on prod. Only upload events from the day attempts
    # began count, on both sides. user_actions keeps lifetime counts and the FIRST
    # occurrence only, so a user whose first upload event is older cannot be split
    # by date: all of that user's upload events are left out of both sides (the rate
    # then describes users who started uploading since 2026-09-22). Nothing caps the
    # rate (owner ruling 2026-11-13): more successes than attempts in the window is a
    # miscount to find at its source, so it shows as it is and logs a warning.
    cur.execute(f"""
        SELECT grp,
               COALESCE(SUM(attempted) FILTER (WHERE first_upload_at >= %s), 0) AS tries,
               COALESCE(SUM(succeeded) FILTER (WHERE first_upload_at >= %s), 0) AS succeeded,
               COALESCE(SUM(failed) FILTER (WHERE first_upload_at >= %s), 0) AS failed,
               COUNT(*) FILTER (WHERE first_upload_at < %s) AS older_users
        FROM (
            SELECT
                {group_expr} AS grp,
                MIN(a.first_at) AS first_upload_at,
                COALESCE(SUM(a.count) FILTER (WHERE a.action = 'game_upload_attempted'), 0) AS attempted,
                COALESCE(SUM(a.count) FILTER (WHERE a.action = 'game_upload_succeeded'), 0) AS succeeded,
                COALESCE(SUM(a.count) FILTER (WHERE a.action LIKE 'game_upload_failed:%%'), 0) AS failed
            FROM user_actions a
            JOIN user_segments s ON a.user_id = s.user_id
            {excl_join}
            {where_clause}
              AND (a.action IN ('game_upload_attempted', 'game_upload_succeeded')
                   OR a.action LIKE 'game_upload_failed:%%')
            GROUP BY grp, a.user_id
        ) per_user
        GROUP BY grp
    """, [UPLOAD_ATTEMPTS_RECORDED_FROM] * 4 + [*group_params, *where_params])
    uploads = {r["grp"]: r for r in cur.fetchall()}

    for grp, row in rows.items():
        for count_key in DIMENSION_COUNTS.values():
            row.setdefault(count_key, 0)
        for step in DIMENSION_STEPS:
            row.setdefault(FLOW_EVENTS[step]["label"].lower().replace(" ", "_") + "_pct", 0)
        outcome = uploads.get(grp)
        tries = int(outcome["tries"]) if outcome else 0
        successes = int(outcome["succeeded"]) if outcome else 0
        failures = int(outcome["failed"]) if outcome else 0
        row["upload_tries"] = tries
        row["upload_successes"] = successes
        row["upload_success_pct"] = round(successes / tries * 100, 2) if tries else None
        row["upload_no_outcome"] = tries - successes - failures
        # Upload events, all from before attempts were recorded: no rate to show.
        row["upload_not_tracked"] = bool(outcome) and outcome["older_users"] > 0 and (
            tries + successes + failures == 0)
        if successes > tries:
            logger.warning(
                f"[T16340] Upload successes exceed attempts for group {grp!r}: "
                f"{successes} successes / {tries} attempts since "
                f"{UPLOAD_ATTEMPTS_RECORDED_FROM:%Y-%m-%d} -- an upload event is miscounted"
            )
    return rows


def _segment_window_where(date_from, date_to, origin: str, exclude_test: bool,
                          country: str | None = None) -> tuple[str, list, str]:
    """(where clause, params, users join) shared by the Channels, Cohorts and Builds views:
    the acquisition window, the `origin` and `country` filters, and the test-account exclusion.

    T8000: default to a 12-month window so the full-history aggregations don't scan
    the ever-growing signup history on every admin page load (idx_segments_acquired
    drives a bounded segment set instead). Overridable via the from/to params.
    T8250: the window compares against s.acquired_at (UTC) -- datetime.now(UTC).date(),
    not local date.today()."""
    d_from = date.fromisoformat(date_from) if date_from else datetime.now(UTC).date() - timedelta(days=365)
    d_to = date.fromisoformat(date_to) if date_to else datetime.now(UTC).date()
    where_parts = ["s.acquired_at BETWEEN %s AND %s"]
    where_params: list = [d_from, d_to]
    if origin != "all":
        where_parts.append("s.origin = %s")
        where_params.append(origin)
    _append_country(where_parts, where_params, country)
    # T8110: exclude internal accounts. The predicate rides the shared where clause;
    # each query's FROM adds the users u join so `u` resolves.
    # T8630 r5: LEFT JOIN so a deleted account's kept segment row survives the
    # join; the predicate falls back to s.was_test_account (see _test_exclusion).
    excl = _test_exclusion(exclude_test)
    excl_join = " LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    if excl:
        where_parts.append(excl)
    return "WHERE " + " AND ".join(where_parts), where_params, excl_join



# RETRY_BURST_ACTIONS and the burst detector (T7510 tier 5) live in analytics.py.


RETRY_BURST_SAMPLE = 50


def _retry_bursts_for_stopped(people: dict[str, list]) -> dict:
    """T14020: retry bursts need the per-user SQLite log, so the inspector reads at most
    RETRY_BURST_SAMPLE of the users who stopped (stuck first, then gone, then in-window).
    Returns {sampled, with_bursts, by_action: {action: users}}; read-only. Each foreign
    user.sqlite open is an R2 freshness HEAD, so the reads overlap (map_users)."""
    from .analytics_journey_rollup import map_users
    from .user_db import get_user_db_connection

    ids = [p["user_id"] for o in ("stuck", "gone", "in_window") for p in people[o]][:RETRY_BURST_SAMPLE]
    placeholders = ",".join("?" for _ in RETRY_BURST_ACTIONS)

    def bursting_actions(uid: str) -> list[str]:
        with get_user_db_connection(uid) as conn:
            rows = conn.execute(
                f"SELECT action, created_at FROM user_action_log WHERE action IN ({placeholders})",
                RETRY_BURST_ACTIONS,
            ).fetchall()
        stamps: dict[str, list[str]] = {}
        for r in rows:
            stamps.setdefault(r["action"], []).append(r["created_at"])
        return [a for a, ts in stamps.items() if _detect_retry_bursts(ts)]

    by_action: dict[str, int] = {}
    with_bursts = 0
    for hit in map_users(bursting_actions, ids):
        with_bursts += bool(hit)
        for a in hit:
            by_action[a] = by_action.get(a, 0) + 1
    return {"sampled": len(ids), "with_bursts": with_bursts, "by_action": by_action}


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
