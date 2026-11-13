"""T7420: activation report -- per monthly signup cohort, % reaching
export_completed (primary, scored vs the 40% scorecard target) and
share_completed (value-moment, requirement 2.2's "first shared reel within
two weeks") within 14 days of acquired_at.

Scope shrunk 2026-10-30 (owner-approved, see the task file): stage-conversion
and the non-activated stall distribution moved to T14020's Journey step
inspector over the shared JOURNEY_LADDER, so one ladder has one
implementation. This module stays the one locked metric pair + benchmarks --
pure read of user_segments/user_actions, no new storage of any kind.
"""

from datetime import date
from typing import Any

ACTIVATION_WINDOW_DAYS = 14

# Benchmarks to print beside the actuals (EPIC.md "Locked metric definitions"
# research, 2026-08-20): activation median ~30%, 50%+ is the fundable talking
# point; the scorecard (success criterion 3) scores export at 40%+. No locked
# numeric benchmark exists for share_completed (requirement 2.2's framing is
# qualitative -- "a clear majority") so it is tracked without a benchmark,
# never a fabricated target.
BENCHMARKS: dict[str, Any] = {
    "export_completed": {"target": 40.0, "median": 30.0, "great": 50.0},
}


def _cell(hit: int, aged: int) -> dict[str, Any] | None:
    """A reported cell, or None ("not yet measurable") when nobody has aged in."""
    if not aged:
        return None
    return {"pct": round(hit / aged * 100, 2), "hit": hit, "aged": aged}


def compute_activation_report(
    cur,
    excl: str,
    today: date,
    window_days: int = ACTIVATION_WINDOW_DAYS,
) -> dict[str, Any]:
    """Per monthly signup cohort: export_completed <=14d (primary) and
    share_completed <=14d (value-moment), both reported only once EVERY
    member of the cohort has aged past the window (same maturity convention
    as T16070's compute_day_n_retention) -- a partially-matured cohort is
    "maturing", never blended in with a fabricated number.

    `first_at` is per (user, action, platform); the EXISTS check below hits
    on ANY platform row within the window, which is exactly "MIN(first_at)
    across platforms <= deadline" without a separate aggregation step (same
    trick already used by `_segment_group_rows`'s first_highlight_14d).
    """
    excl_and = f"AND {excl}" if excl else ""
    aged_before = date(today.year, today.month, today.day)

    cur.execute(f"""
        WITH base AS (
            SELECT s.user_id,
                   date_trunc('month', s.acquired_at)::date AS cohort_month,
                   s.acquired_at AS acquired_at
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            WHERE s.acquired_at IS NOT NULL {excl_and}
        ),
        flags AS (
            SELECT b.user_id, b.cohort_month,
                   (b.acquired_at + %(window)s) <= %(today)s AS matured,
                   EXISTS (
                       SELECT 1 FROM user_actions a
                       WHERE a.user_id = b.user_id AND a.action = 'export_completed'
                         AND a.first_at <= (b.acquired_at + %(window)s)::timestamp AT TIME ZONE 'UTC'
                   ) AS exported,
                   EXISTS (
                       SELECT 1 FROM user_actions a
                       WHERE a.user_id = b.user_id AND a.action = 'share_completed'
                         AND a.first_at <= (b.acquired_at + %(window)s)::timestamp AT TIME ZONE 'UTC'
                   ) AS shared
            FROM base b
        )
        SELECT cohort_month,
               COUNT(*) AS cohort_size,
               COUNT(*) FILTER (WHERE matured) AS matured,
               COUNT(*) FILTER (WHERE matured AND exported) AS export_hit,
               COUNT(*) FILTER (WHERE matured AND shared) AS share_hit
        FROM flags
        GROUP BY cohort_month
        ORDER BY cohort_month DESC
    """, {"window": window_days, "today": aged_before})
    rows = cur.fetchall()

    cohorts = []
    for row in rows:
        cohort_size = row["cohort_size"]
        is_mature = row["matured"] == cohort_size
        cohorts.append({
            "cohort_month": str(row["cohort_month"]),
            "signups": cohort_size,
            "maturing": not is_mature,
            "export_completed": _cell(row["export_hit"], cohort_size) if is_mature else None,
            "share_completed": _cell(row["share_hit"], cohort_size) if is_mature else None,
        })

    return {
        "window_days": window_days,
        "cohorts": cohorts,
        "benchmarks": BENCHMARKS,
    }
