"""T7430: retention triangle + curves + WAU + return-after-gap for the admin
Retention Chart. Reuses the SAME cohort-key derivation as T16070's
compute_day_n_retention (date_trunc('week', acquired_at)) so the two surfaces
never disagree about which week a user belongs to. No new stored data beyond
T7400's rollup_action_weekly, which the action-level toggle reads read-only.
"""

import statistics
from datetime import date
from typing import Any

WEEKS_TRACKED = 8  # triangle/curve columns: weeks 0..7 since signup

# Owner rule 2026-11-03: seasons differ per sport/league, never a calendar -- low-volume
# weeks are detected from measured WAU, not an assumed season. This is the one named
# constant the chart prints next to the shading.
LOW_VOLUME_RATIO = 0.5
LOW_VOLUME_TRAILING_WEEKS = 12

RETURN_AFTER_GAP_DAYS = 120


def _cell(hit: int, aged: int) -> dict[str, Any] | None:
    if not aged:
        return None
    return {"pct": round(hit / aged * 100, 2), "hit": hit, "aged": aged}


def group_key_sql(group_expr: str | None) -> str:
    """The SQL key a chart curve groups on. None = the weekly signup cohort (the
    cohort-key derivation shared with compute_day_n_retention); otherwise the caller's
    Dimension-pill expression (campaign origin, signup build), NULL shown as
    "unrecorded" and never dropped. `group_expr` is app-defined SQL, never user input."""
    if group_expr is None:
        return "date_trunc('week', s.acquired_at)::date::text"
    return f"COALESCE(({group_expr})::text, 'unrecorded')"


def compute_retention_triangle(
    cur, excl: str, today: date, weeks: int = WEEKS_TRACKED,
    group_expr: str | None = None, group_join: str = "",
) -> dict[str, Any]:
    """One row per group; one cell per week_index 0..weeks-1 holding both the classic
    (active IN week N since the member's own signup week) and unbounded (active week N
    or any later week) rate. Each cell counts only the members old enough for week N
    (`aged`); None when nobody is -- never a fabricated 0. A weekly signup cohort
    (group_expr None) ages all-or-nothing, so its rows keep `cohort_week` as well."""
    excl_and = f"AND {excl}" if excl else ""
    cur.execute(f"""
        WITH base AS (
            SELECT s.user_id, {group_key_sql(group_expr)} AS grp,
                   date_trunc('week', s.acquired_at)::date AS cohort_week
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            {group_join}
            WHERE s.acquired_at IS NOT NULL {excl_and}
        ),
        weeks AS (SELECT generate_series(0, %(max_week)s) AS week_index),
        flags AS (
            SELECT b.grp, w.week_index,
                   (b.cohort_week + w.week_index * 7 + 6) <= %(today)s AS matured,
                   EXISTS (
                       SELECT 1 FROM user_usage_daily d
                       WHERE d.user_id = b.user_id
                         AND d.day BETWEEN b.cohort_week + w.week_index * 7
                                       AND b.cohort_week + w.week_index * 7 + 6
                   ) AS classic,
                   EXISTS (
                       SELECT 1 FROM user_usage_daily d
                       WHERE d.user_id = b.user_id
                         AND d.day >= b.cohort_week + w.week_index * 7
                   ) AS unbounded
            FROM base b CROSS JOIN weeks w
        )
        SELECT grp, week_index,
               COUNT(*) AS group_size,
               COUNT(*) FILTER (WHERE matured) AS aged,
               COUNT(*) FILTER (WHERE matured AND classic) AS classic_hit,
               COUNT(*) FILTER (WHERE matured AND unbounded) AS unbounded_hit
        FROM flags
        GROUP BY grp, week_index
        ORDER BY grp, week_index
    """, {"today": today, "max_week": weeks - 1})

    groups: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        grp = row["grp"]
        entry = groups.get(grp)
        if entry is None:
            entry = {"group": grp, "signups": row["group_size"], "small_n": row["group_size"] < 5, "weeks": {}}
            if group_expr is None:
                entry["cohort_week"] = grp
            groups[grp] = entry
        entry["weeks"][str(row["week_index"])] = {
            "classic": _cell(row["classic_hit"], row["aged"]),
            "unbounded": _cell(row["unbounded_hit"], row["aged"]),
        }

    return {
        "weeks_tracked": weeks,
        "cohorts": sorted(groups.values(), key=lambda c: c["group"], reverse=True),
    }


def compute_wau_series(cur, excl: str, today: date) -> list[dict[str, Any]]:
    """WAU + MAU + WAU/MAU by calendar week, from user_usage_daily day rows directly
    (no rollup dependency)."""
    excl_and = f"AND {excl}" if excl else ""
    cur.execute(f"""
        SELECT date_trunc('week', d.day)::date AS week, COUNT(DISTINCT d.user_id) AS wau
        FROM user_usage_daily d
        LEFT JOIN users u ON u.user_id = d.user_id
        LEFT JOIN user_segments s ON s.user_id = d.user_id
        WHERE d.seconds > 0 {excl_and}
        GROUP BY week
        ORDER BY week
    """)
    weekly = cur.fetchall()

    cur.execute(f"""
        SELECT date_trunc('month', d.day)::date AS month, COUNT(DISTINCT d.user_id) AS mau
        FROM user_usage_daily d
        LEFT JOIN users u ON u.user_id = d.user_id
        LEFT JOIN user_segments s ON s.user_id = d.user_id
        WHERE d.seconds > 0 {excl_and}
        GROUP BY month
    """)
    mau_by_month = {str(row["month"]): row["mau"] for row in cur.fetchall()}

    out = []
    for row in weekly:
        week = row["week"]
        mau = mau_by_month.get(str(date(week.year, week.month, 1)))
        wau = row["wau"]
        out.append({
            "week": str(week),
            "wau": wau,
            "mau": mau,
            "wau_mau_ratio": round(wau / mau, 4) if mau else None,
        })
    return out


def detect_low_volume_weeks(
    wau_series: list[dict[str, Any]],
    ratio: float = LOW_VOLUME_RATIO,
    trailing_weeks: int = LOW_VOLUME_TRAILING_WEEKS,
) -> list[bool]:
    """A week is "low-volume" when its WAU falls below `ratio` of the trailing
    `trailing_weeks`-week median WAU (excluding itself) -- measured activity, never a
    season calendar (owner rule 2026-11-03). Shaded in the chart, never dropped. The
    first `trailing_weeks` weeks have no trailing window and are never flagged."""
    flags = []
    for i, row in enumerate(wau_series):
        trailing = [r["wau"] for r in wau_series[max(0, i - trailing_weeks):i]]
        if len(trailing) < trailing_weeks:
            flags.append(False)
            continue
        median = statistics.median(trailing)
        flags.append(median > 0 and row["wau"] < ratio * median)
    return flags


def compute_return_after_gap(
    cur, excl: str, today: date, gap_days: int = RETURN_AFTER_GAP_DAYS
) -> list[dict[str, Any]]:
    """% of users active in a given month who are active again >= gap_days after that
    month ends -- the long-horizon headline replacing season-over-season comparisons
    (owner rule 2026-11-03). A month reports only once it has matured (today is at
    least gap_days past month-end); otherwise None, never a fabricated 0."""
    excl_and = f"AND {excl}" if excl else ""
    cur.execute(f"""
        WITH months AS (
            SELECT DISTINCT d.user_id, date_trunc('month', d.day)::date AS month
            FROM user_usage_daily d
            LEFT JOIN users u ON u.user_id = d.user_id
            LEFT JOIN user_segments s ON s.user_id = d.user_id
            WHERE d.seconds > 0 {excl_and}
        ),
        flagged AS (
            SELECT m.user_id, m.month,
                   EXISTS (
                       SELECT 1 FROM user_usage_daily d2
                       WHERE d2.user_id = m.user_id
                         AND d2.day >= (m.month + INTERVAL '1 month')::date + %(gap)s
                   ) AS returned
            FROM months m
        )
        SELECT month, COUNT(*) AS cohort_size, COUNT(*) FILTER (WHERE returned) AS hit,
               (month + INTERVAL '1 month')::date + %(gap)s <= %(today)s AS matured
        FROM flagged
        GROUP BY month
        ORDER BY month
    """, {"gap": gap_days, "today": today})

    return [
        {
            "month": str(row["month"]),
            "cohort_size": row["cohort_size"],
            **(_cell(row["hit"], row["cohort_size"]) or {"pct": None, "hit": None, "aged": None}),
        } if row["matured"] else {"month": str(row["month"]), "cohort_size": row["cohort_size"], "pct": None, "hit": None, "aged": None}
        for row in cur.fetchall()
    ]


def coverage_start(cur, excl: str) -> date | None:
    """Earliest user_usage_daily day -- the "data begins" marker so weeks before
    v022's deploy never render as zero retention."""
    excl_and = f"AND {excl}" if excl else ""
    cur.execute(f"""
        SELECT MIN(d.day) AS first_day
        FROM user_usage_daily d
        LEFT JOIN users u ON u.user_id = d.user_id
        LEFT JOIN user_segments s ON s.user_id = d.user_id
        WHERE 1=1 {excl_and}
    """)
    row = cur.fetchone()
    return row["first_day"] if row else None


def compute_action_retention(rollup_rows: list[tuple], action: str) -> dict[str, Any]:
    """Action-level retention curve (export_completed / clip-library) pooled across
    sport, from T7400's rollup_action_weekly rows: (cohort_week, sport, action,
    week_index, distinct_users). week_index 0 is the cohort's base; later weeks report
    as a % of that base. Graceful empty result (not an error) when the action has no
    rows yet -- the "run rollup first" state the task calls for."""
    pooled: dict[str, dict[int, int]] = {}
    for cohort_week, _sport, row_action, week_index, distinct_users in rollup_rows:
        if row_action != action:
            continue
        by_week = pooled.setdefault(cohort_week, {})
        by_week[week_index] = by_week.get(week_index, 0) + distinct_users

    cohorts = []
    for cw in sorted(pooled, reverse=True):
        by_week = pooled[cw]
        base = by_week.get(0)
        if not base:
            continue
        cohorts.append({
            "cohort_week": cw,
            "base": base,
            "weeks": {str(wi): _cell(count, base) for wi, count in sorted(by_week.items())},
        })
    return {"action": action, "cohorts": cohorts}
