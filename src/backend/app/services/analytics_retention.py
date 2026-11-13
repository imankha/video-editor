"""T16070: day-1/3/7/14/28 return-rate table (admin panel).

Shared counting function so T7430's richer retention chart reuses the SAME
return definition instead of writing a second one (see that task's note on
the cohort-key derivation needing to stay identical).
"""

from datetime import date
from typing import Any

# The five standard checkpoints (so figures compare against published
# consumer-app benchmarks). App-defined, never user input -- safe to splice
# as integer literals into the generated SQL below.
RETENTION_CHECKPOINTS: tuple[int, ...] = (1, 3, 7, 14, 28)


def _flag_columns(checkpoints: tuple[int, ...]) -> str:
    return ",\n            ".join(
        f"EXISTS (\n"
        f"                SELECT 1 FROM user_usage_daily d\n"
        f"                WHERE d.user_id = b.user_id AND d.day = b.signup_date + {n}\n"
        f"            ) AS returned_{n},\n"
        f"            (b.signup_date + {n}) <= %(today)s AS matured_{n}"
        for n in checkpoints
    )


def _agg_columns(checkpoints: tuple[int, ...]) -> str:
    return ",\n               ".join(
        f"COUNT(*) FILTER (WHERE matured_{n}) AS matured_{n}, "
        f"COUNT(*) FILTER (WHERE matured_{n} AND returned_{n}) AS hit_{n}"
        for n in checkpoints
    )


def _cell(hit: int, aged: int) -> dict[str, Any] | None:
    """A reported cell, or None ("not yet measurable") when nobody has aged in."""
    if not aged:
        return None
    return {"pct": round(hit / aged * 100, 2), "hit": hit, "aged": aged}


def compute_day_n_retention(
    cur,
    excl: str,
    today: date,
    checkpoints: tuple[int, ...] = RETENTION_CHECKPOINTS,
) -> dict[str, Any]:
    """Day-1/3/7/14/28 return rate by weekly signup cohort, plus one "all
    weeks" row pooling every matured member across cohorts.

    Returned-on-day-N means an exact `user_usage_daily` row for
    `signup_date + N` (day 0, the signup day itself, is never a checkpoint
    and never counted towards any later day). A cohort's cell for day N is
    reported only once EVERY member of that signup week has reached day N
    (``matured_N == cohort_size``); otherwise it is ``None`` ("not yet
    measurable"), never a fabricated 0. The "all weeks" row pools every
    person old enough for day N regardless of whether their own cohort has
    fully matured.

    ``excl`` is the caller's ``_test_exclusion(...)`` predicate
    (``routers/admin.py``), shared with every other cohort view so a user
    excluded from one is excluded from all. ``today`` is passed in rather
    than read from ``CURRENT_DATE`` so callers (and tests) control it
    exactly -- the same pattern as ``build_spend_readiness(cur, excl, now)``.
    """
    flags = _flag_columns(checkpoints)
    agg = _agg_columns(checkpoints)
    excl_and = f"AND {excl}" if excl else ""

    cur.execute(f"""
        WITH base AS (
            SELECT s.user_id,
                   date_trunc('week', s.acquired_at)::date AS cohort_week,
                   s.acquired_at::date AS signup_date
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            WHERE s.acquired_at IS NOT NULL {excl_and}
        ),
        flags AS (
            SELECT b.user_id, b.cohort_week,
            {flags}
            FROM base b
        )
        SELECT cohort_week,
               COUNT(*) AS cohort_size,
               {agg}
        FROM flags
        GROUP BY cohort_week
        ORDER BY cohort_week DESC
    """, {"today": today})
    cohort_rows = cur.fetchall()

    cur.execute(f"""
        WITH base AS (
            SELECT s.user_id, s.acquired_at::date AS signup_date
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            WHERE s.acquired_at IS NOT NULL {excl_and}
        ),
        flags AS (
            SELECT b.user_id,
            {flags}
            FROM base b
        )
        SELECT {agg}
        FROM flags
    """, {"today": today})
    all_weeks_row = cur.fetchone()

    cohorts = []
    for row in cohort_rows:
        cohort_size = row["cohort_size"]
        days = {}
        for n in checkpoints:
            matured = row[f"matured_{n}"]
            hit = row[f"hit_{n}"]
            # A cohort is only measurable once ALL its members matured -- a
            # partially-matured cohort reports every checkpoint as None, not
            # the pooled subset (that honesty belongs to the all-weeks row).
            days[str(n)] = _cell(hit, cohort_size) if matured == cohort_size else None
        cohorts.append({
            "cohort_week": str(row["cohort_week"]),
            "signups": cohort_size,
            "days": days,
        })

    all_days = {
        str(n): _cell(all_weeks_row[f"hit_{n}"], all_weeks_row[f"matured_{n}"])
        for n in checkpoints
    }

    return {
        "checkpoints": list(checkpoints),
        "cohorts": cohorts,
        "all_weeks": {"days": all_days},
    }
