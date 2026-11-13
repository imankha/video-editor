"""T7420: activation report (export_completed/share_completed <=14d by
monthly signup cohort). Fails until app.services.analytics_activation exists.
"""

from datetime import UTC, date, datetime, timedelta

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


def _action(user_id: str, action: str, first_at: datetime, platform: str = "webapp-desktop"):
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_actions (user_id, action, platform, first_at, count) "
            "VALUES (%s, %s, %s, %s, 1) ON CONFLICT (user_id, action, platform) DO UPDATE "
            "SET first_at = EXCLUDED.first_at",
            (user_id, action, platform, first_at),
        )


def _report(today, exclude_test=True):
    from app.routers.admin import _test_exclusion
    from app.services.analytics_activation import compute_activation_report
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        return compute_activation_report(cur, _test_exclusion(exclude_test), today)


def _cohort(result, month):
    return next(c for c in result["cohorts"] if c["cohort_month"] == str(month))


class TestActivationWindowEdges:
    def test_export_on_day_13_counts(self, pg_conn):
        register_test_user_ids("t7420-d13")
        acquired = date(2026, 1, 1)
        today = acquired + timedelta(days=30)
        _seed_user("t7420-d13", acquired)
        _action("t7420-d13", "export_completed",
                datetime(2026, 1, 14, 12, 0, tzinfo=UTC))  # day 13, midday

        result = _report(today)
        cohort = _cohort(result, date(2026, 1, 1))
        assert cohort["export_completed"] == {"pct": 100.0, "hit": 1, "aged": 1}

    def test_export_at_day_14_midnight_boundary_counts(self, pg_conn):
        register_test_user_ids("t7420-d14")
        acquired = date(2026, 1, 1)
        today = acquired + timedelta(days=30)
        _seed_user("t7420-d14", acquired)
        _action("t7420-d14", "export_completed",
                datetime(2026, 1, 15, 0, 0, tzinfo=UTC))  # exactly day-14 midnight UTC

        result = _report(today)
        cohort = _cohort(result, date(2026, 1, 1))
        assert cohort["export_completed"] == {"pct": 100.0, "hit": 1, "aged": 1}

    def test_export_after_day_14_midnight_does_not_count(self, pg_conn):
        register_test_user_ids("t7420-d15")
        acquired = date(2026, 1, 1)
        today = acquired + timedelta(days=30)
        _seed_user("t7420-d15", acquired)
        _action("t7420-d15", "export_completed",
                datetime(2026, 1, 15, 0, 1, tzinfo=UTC))  # one minute past the deadline

        result = _report(today)
        cohort = _cohort(result, date(2026, 1, 1))
        assert cohort["export_completed"] == {"pct": 0.0, "hit": 0, "aged": 1}


class TestMaturingCohort:
    def test_cohort_younger_than_window_is_maturing_and_none(self, pg_conn):
        register_test_user_ids("t7420-young")
        today = date(2026, 6, 20)
        acquired = today - timedelta(days=3)  # only 3 days old -- not matured
        _seed_user("t7420-young", acquired)
        _action("t7420-young", "export_completed", datetime(2026, 6, 19, 0, 0, tzinfo=UTC))

        result = _report(today)
        cohort = _cohort(result, date(acquired.year, acquired.month, 1))
        assert cohort["maturing"] is True
        assert cohort["export_completed"] is None
        assert cohort["share_completed"] is None


class TestMinAcrossPlatforms:
    def test_min_first_at_across_platforms_is_used(self, pg_conn):
        register_test_user_ids("t7420-multi")
        acquired = date(2026, 2, 1)
        today = acquired + timedelta(days=60)
        _seed_user("t7420-multi", acquired)
        # mobile hits within the window; desktop's own first_at is outside it --
        # the min across platforms (mobile's) must decide the outcome.
        _action("t7420-multi", "export_completed",
                datetime(2026, 2, 10, 0, 0, tzinfo=UTC), platform="mobile")
        _action("t7420-multi", "export_completed",
                datetime(2026, 3, 1, 0, 0, tzinfo=UTC), platform="webapp-desktop")

        result = _report(today)
        cohort = _cohort(result, date(2026, 2, 1))
        assert cohort["export_completed"] == {"pct": 100.0, "hit": 1, "aged": 1}


class TestShareTrackedAlongsideExport:
    def test_share_and_export_computed_independently(self, pg_conn):
        register_test_user_ids("t7420-share")
        acquired = date(2026, 3, 1)
        today = acquired + timedelta(days=60)
        _seed_user("t7420-share", acquired)
        _action("t7420-share", "share_completed", datetime(2026, 3, 5, 0, 0, tzinfo=UTC))
        # no export_completed row at all for this user

        result = _report(today)
        cohort = _cohort(result, date(2026, 3, 1))
        assert cohort["share_completed"] == {"pct": 100.0, "hit": 1, "aged": 1}
        assert cohort["export_completed"] == {"pct": 0.0, "hit": 0, "aged": 1}

    def test_benchmarks_present_for_export_completed(self, pg_conn):
        register_test_user_ids("t7420-bench")
        today = date(2026, 6, 20)
        _seed_user("t7420-bench", today - timedelta(days=60))

        result = _report(today)
        assert result["benchmarks"]["export_completed"] == {"target": 40.0, "median": 30.0, "great": 50.0}
        assert result["window_days"] == 14
