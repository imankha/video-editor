"""T7430: retention chart (triangle, WAU, low-volume detection, return-after-gap,
action-level toggle). Reuses T16070's seeding helpers (same cohort-key derivation).

Fails until app.services.analytics_retention_chart exists.
"""

from datetime import date, timedelta

from app.analytics import create_user_segment
from app.services.auth_db import create_user

from .conftest import register_test_user_ids


def _seed_user(user_id: str, acquired_at: date):
    from app.services.pg import get_pg

    create_user(user_id, email=f"{user_id}@test.local")
    create_user_segment(user_id, "organic", None, "otp")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE user_segments SET acquired_at = %s WHERE user_id = %s",
            (acquired_at, user_id),
        )


def _add_daily(user_id: str, day: date, seconds: int = 60):
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO user_usage_daily (user_id, day, seconds)
               VALUES (%s, %s, %s)
               ON CONFLICT (user_id, day) DO UPDATE SET seconds = EXCLUDED.seconds""",
            (user_id, day, seconds),
        )


def _triangle(today, weeks=8, exclude_test=True):
    from app.routers.admin import _test_exclusion
    from app.services.analytics_retention_chart import compute_retention_triangle
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        return compute_retention_triangle(cur, _test_exclusion(exclude_test), today, weeks)


class TestTriangleClassicVsUnbounded:
    def test_lapsed_and_returned_user_counts_unbounded_but_not_classic(self, pg_conn):
        register_test_user_ids("t7430-a")
        today = date(2026, 6, 20)
        week_start_query = """SELECT date_trunc('week', DATE %s)::date AS d"""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(week_start_query, (today - timedelta(days=35),))
            cohort_week = cur.fetchone()["d"]

        _seed_user("t7430-a", cohort_week)
        # Active week 0 (signup week) and week 3, but NOT week 1 -- classic week 1
        # should miss, unbounded week 1 should still hit (active in-or-after).
        _add_daily("t7430-a", cohort_week, 10)
        _add_daily("t7430-a", cohort_week + timedelta(weeks=3), 10)

        result = _triangle(today, weeks=4)
        cohort = next(c for c in result["cohorts"] if c["cohort_week"] == str(cohort_week))
        week1 = cohort["weeks"]["1"]
        assert week1["classic"] == {"pct": 0.0, "hit": 0, "aged": 1}
        assert week1["unbounded"] == {"pct": 100.0, "hit": 1, "aged": 1}


class TestTriangleMaturityAndSmallN:
    def test_unmatured_week_is_none_not_zero(self, pg_conn):
        register_test_user_ids("t7430-b")
        today = date(2026, 6, 20)
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT date_trunc('week', DATE %s)::date AS d", (today - timedelta(days=3),))
            cohort_week = cur.fetchone()["d"]
        _seed_user("t7430-b", cohort_week)  # only 3 days old -- week 1 hasn't matured

        result = _triangle(today, weeks=2)
        cohort = next(c for c in result["cohorts"] if c["cohort_week"] == str(cohort_week))
        assert cohort["weeks"]["1"] == {"classic": None, "unbounded": None}

    def test_cohort_under_five_is_flagged_small_n(self, pg_conn):
        register_test_user_ids("t7430-c")
        today = date(2026, 6, 20)
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT date_trunc('week', DATE %s)::date AS d", (today - timedelta(days=30),))
            cohort_week = cur.fetchone()["d"]
        _seed_user("t7430-c", cohort_week)

        result = _triangle(today, weeks=1)
        cohort = next(c for c in result["cohorts"] if c["cohort_week"] == str(cohort_week))
        assert cohort["small_n"] is True
        assert cohort["signups"] == 1


class TestLowVolumeDetection:
    def test_week_far_below_trailing_median_is_flagged(self):
        from app.services.analytics_retention_chart import detect_low_volume_weeks

        series = [{"wau": 100} for _ in range(12)] + [{"wau": 10}]
        flags = detect_low_volume_weeks(series)
        assert flags[:12] == [False] * 12  # no trailing window yet
        assert flags[12] is True

    def test_week_near_trailing_median_is_not_flagged(self):
        from app.services.analytics_retention_chart import detect_low_volume_weeks

        series = [{"wau": 100} for _ in range(12)] + [{"wau": 90}]
        flags = detect_low_volume_weeks(series)
        assert flags[12] is False


class TestActionRetention:
    def test_empty_rollup_rows_return_no_cohorts(self):
        from app.services.analytics_retention_chart import compute_action_retention

        result = compute_action_retention([], "export_completed")
        assert result == {"action": "export_completed", "cohorts": []}

    def test_week_index_zero_is_the_base_for_percentages(self):
        from app.services.analytics_retention_chart import compute_action_retention

        rows = [
            ("2026-06-01", "basketball", "export_completed", 0, 10),
            ("2026-06-01", "basketball", "export_completed", 1, 4),
        ]
        result = compute_action_retention(rows, "export_completed")
        cohort = result["cohorts"][0]
        assert cohort["base"] == 10
        assert cohort["weeks"]["1"] == {"pct": 40.0, "hit": 4, "aged": 10}


def _set_segment(user_id: str, **cols):
    from app.services.pg import get_pg

    sets = ", ".join(f"{k} = %s" for k in cols)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE user_segments SET {sets} WHERE user_id = %s", (*cols.values(), user_id))


def _grouped(today, group_expr, weeks=4):
    from app.routers.admin import _test_exclusion
    from app.services.analytics_retention import compute_day_n_retention
    from app.services.analytics_retention_chart import compute_retention_triangle
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        excl = _test_exclusion(True)
        return (
            compute_retention_triangle(cur, excl, today, weeks, group_expr=group_expr),
            compute_day_n_retention(cur, excl, today, group_expr=group_expr),
        )


class TestGroupedByDimension:
    """Ruling 2026-11-13 (C6): the chart compares whatever the Dimension pill selects.
    A non-week group pools its members' own weeks-since-signup: a cell counts only the
    members old enough for that week (aged), never a fabricated 0."""

    def test_groups_by_campaign_origin_and_pools_members_across_signup_weeks(self, pg_conn):
        today = date(2026, 6, 29)  # Monday
        old_week, new_week = date(2026, 5, 4), date(2026, 6, 22)
        register_test_user_ids("t7430-g1", "t7430-g2", "t7430-g3")
        _seed_user("t7430-g1", old_week)
        _seed_user("t7430-g2", old_week)
        _seed_user("t7430-g3", new_week)  # same campaign, too young for week 1
        for uid in ("t7430-g1", "t7430-g2", "t7430-g3"):
            _set_segment(uid, origin="t7430camp")
        _add_daily("t7430-g1", old_week + timedelta(weeks=1), 10)

        triangle, day_n = _grouped(today, "s.origin")

        row = next(c for c in triangle["cohorts"] if c["group"] == "t7430camp")
        assert row["signups"] == 3
        assert row["weeks"]["1"]["classic"] == {"pct": 50.0, "hit": 1, "aged": 2}
        assert "cohort_week" not in row
        assert any(c["group"] == "t7430camp" for c in day_n["cohorts"])

    def test_groups_by_signup_build_with_unrecorded_bucket(self, pg_conn):
        today = date(2026, 6, 29)
        week = date(2026, 5, 4)
        register_test_user_ids("t7430-b1", "t7430-b2")
        _seed_user("t7430-b1", week)
        _seed_user("t7430-b2", week)
        _set_segment("t7430-b1", signup_build=9431)
        _set_segment("t7430-b2", signup_build=None)
        _add_daily("t7430-b1", week + timedelta(days=1), 10)  # day-1 return

        triangle, day_n = _grouped(today, "s.signup_build")

        groups = {c["group"] for c in triangle["cohorts"]}
        assert "9431" in groups and "unrecorded" in groups
        b = next(c for c in day_n["cohorts"] if c["group"] == "9431")
        assert b["days"]["1"] == {"pct": 100.0, "hit": 1, "aged": 1}

    def test_cohort_mode_rows_carry_group_equal_to_cohort_week(self, pg_conn):
        today = date(2026, 6, 29)
        week = date(2026, 5, 4)
        register_test_user_ids("t7430-c9")
        _seed_user("t7430-c9", week)

        triangle, day_n = _grouped(today, None)

        row = next(c for c in triangle["cohorts"] if c["cohort_week"] == str(week))
        assert row["group"] == str(week)
        assert next(c for c in day_n["cohorts"] if c["cohort_week"] == str(week))["group"] == str(week)


class TestMonthlyCohortBin:
    """Amended C1: the weekly/monthly toggle bins the Cohorts grouping by signup month."""

    def test_monthly_bin_groups_signups_by_month(self, pg_conn, monkeypatch):
        import app.routers.admin as admin

        monkeypatch.setattr(admin, "_require_admin", lambda: None)
        register_test_user_ids("t7430-m1", "t7430-m2")
        _seed_user("t7430-m1", date(2025, 3, 3))
        _seed_user("t7430-m2", date(2025, 3, 24))  # different week, same month

        weekly = admin.analytics_retention_chart(group="cohorts", cohort_bin="week")
        monthly = admin.analytics_retention_chart(group="cohorts", cohort_bin="month")

        assert {"2025-03-03", "2025-03-24"} <= {c["group"] for c in weekly["triangle"]["cohorts"]}
        march = next(c for c in monthly["triangle"]["cohorts"] if c["group"] == "2025-03-01")
        assert march["signups"] >= 2
        assert "2025-03-24" not in {c["group"] for c in monthly["triangle"]["cohorts"]}
        assert any(c["group"] == "2025-03-01" for c in monthly["day_n"]["cohorts"])
        assert monthly["cohort_bin"] == "month"
