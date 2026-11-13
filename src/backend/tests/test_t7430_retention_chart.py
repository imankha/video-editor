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


def _triangle(today, weeks=8, exclude_test=True, group_expr=None):
    from app.routers.admin import _test_exclusion
    from app.services.analytics_retention_chart import compute_retention_triangle
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        return compute_retention_triangle(cur, _test_exclusion(exclude_test), today, weeks, group_expr=group_expr)


def _own_row(today, user_id, weeks):
    """The triangle row of one seeded user alone (grouped by user id): the dev/test
    Postgres also holds real users in the same signup weeks, so a weekly-cohort row is
    not this test's to assert on (fix round 2, T7430:C3)."""
    result = _triangle(today, weeks=weeks, group_expr="s.user_id")
    return next(c for c in result["cohorts"] if c["group"] == user_id)


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

        week1 = _own_row(today, "t7430-a", weeks=4)["weeks"]["1"]
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

        cohort = _own_row(today, "t7430-c", weeks=1)
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


class TestLowVolumeDormantUser:
    """C2: a user dormant through a DETECTED low-volume period still reads as retained
    in the unbounded view. 2014 dates: before any real usage row, so the WAU series'
    first weeks (and their trailing windows) are this test's own."""

    def test_user_dormant_through_flagged_weeks_is_not_churned_in_unbounded(self, pg_conn):
        from app.routers.admin import _test_exclusion
        from app.services.analytics_retention_chart import compute_wau_series, detect_low_volume_weeks
        from app.services.pg import get_pg

        start = date(2014, 1, 6)  # Monday
        steady = [f"t7430-lv{i}" for i in range(6)]
        register_test_user_ids(*steady, "t7430-dorm")
        for uid in steady:
            _seed_user(uid, start)
            for week in range(16):
                if week < 12 or week == 15 or uid == steady[0]:
                    _add_daily(uid, start + timedelta(weeks=week), 60)
        signup = start + timedelta(weeks=11)
        _seed_user("t7430-dorm", signup)
        _add_daily("t7430-dorm", signup, 60)  # week 0
        _add_daily("t7430-dorm", signup + timedelta(weeks=4), 60)  # back after weeks 1-3
        today = date(2014, 6, 1)

        with get_pg() as conn:
            wau = compute_wau_series(conn.cursor(), _test_exclusion(True), today)
        flags = dict(zip((r["week"] for r in wau), detect_low_volume_weeks(wau)))
        dormant_weeks = [str(signup + timedelta(weeks=w)) for w in (1, 2, 3)]
        assert [flags[w] for w in dormant_weeks] == [True, True, True]
        assert flags[str(signup)] is False and flags[str(signup + timedelta(weeks=4))] is False

        row = _own_row(today, "t7430-dorm", weeks=5)
        for w in ("1", "2", "3"):
            assert row["weeks"][w]["unbounded"] == {"pct": 100.0, "hit": 1, "aged": 1}
            assert row["weeks"][w]["classic"] == {"pct": 0.0, "hit": 0, "aged": 1}


class TestReturnAfterGap:
    """C3: % of a month's active users active again 120+ days after that month ends,
    with the month's cohort size; a month not yet 120 days past its end reports no rate.
    2013 dates: no real usage row is that old."""

    def _gap(self, today):
        from app.routers.admin import _test_exclusion
        from app.services.analytics_retention_chart import compute_return_after_gap
        from app.services.pg import get_pg

        with get_pg() as conn:
            rows = compute_return_after_gap(conn.cursor(), _test_exclusion(True), today)
        return next(r for r in rows if r["month"] == "2013-02-01")

    def _seed(self):
        register_test_user_ids("t7430-r1", "t7430-r2", "t7430-r3")
        for uid in ("t7430-r1", "t7430-r2", "t7430-r3"):
            _seed_user(uid, date(2013, 2, 4))
        _add_daily("t7430-r1", date(2013, 2, 10))
        _add_daily("t7430-r1", date(2013, 7, 15))  # 120+ days after Feb ends (2013-06-29)
        _add_daily("t7430-r2", date(2013, 2, 12))
        _add_daily("t7430-r2", date(2013, 6, 20))  # back, but under 120 days later
        _add_daily("t7430-r3", date(2013, 2, 14))  # never back

    def test_rate_counts_only_returns_120_plus_days_later_with_cohort_size(self, pg_conn):
        self._seed()
        assert self._gap(date(2013, 9, 1)) == {
            "month": "2013-02-01", "cohort_size": 3, "pct": 33.33, "hit": 1, "aged": 3,
        }

    def test_month_not_yet_120_days_past_its_end_has_no_rate(self, pg_conn):
        self._seed()
        assert self._gap(date(2013, 6, 1)) == {
            "month": "2013-02-01", "cohort_size": 3, "pct": None, "hit": None, "aged": None,
        }


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

    def test_endpoint_serves_a_clip_library_action_curve_from_the_rollup(self, pg_conn, monkeypatch):
        """C4: the admin endpoint reads T7400's rollup_action_weekly for the requested
        action (a T7450 clip-library event here) and returns its cohorts for the chart."""
        import app.routers.admin as admin
        import app.services.analytics_rollup as rollup

        monkeypatch.setattr(admin, "_require_admin", lambda: None)
        rows = [
            ("2026-06-01", "basketball", "collection_viewed", 0, 6),
            ("2026-06-01", "soccer", "collection_viewed", 0, 4),
            ("2026-06-01", "basketball", "collection_viewed", 2, 5),
            ("2026-06-01", "basketball", "export_completed", 0, 9),
        ]
        monkeypatch.setattr(
            rollup, "load_newest_action_rollup",
            lambda tables=None: ({"meta": {"computed_at": "2026-06-30T00:00:00"}, "rollup_action_weekly": rows}, False),
        )

        result = admin.analytics_retention_chart(group="cohorts", action="collection_viewed")

        assert result["action"]["available"] is True
        assert result["action"]["cohorts"] == [{
            "cohort_week": "2026-06-01", "base": 10,
            "weeks": {"0": {"pct": 100.0, "hit": 10, "aged": 10}, "2": {"pct": 50.0, "hit": 5, "aged": 10}},
        }]


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
