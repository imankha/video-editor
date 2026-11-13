"""T16070: day-1/3/7/14/28 return-rate table (admin panel).

Test-first (Stage 3): these fail until `app.services.analytics_retention`
exists. Scope: the shared counting function `compute_day_n_retention`, plus
a thin check that the admin endpoint wires it with the shared test-exclusion.
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


def _mark_test_account(user_id: str):
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE users SET is_test_account = true WHERE user_id = %s", (user_id,))


def _compute(today, checkpoints=(1, 3, 7, 14, 28), exclude_test=True):
    from app.routers.admin import _test_exclusion
    from app.services.analytics_retention import compute_day_n_retention
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        return compute_day_n_retention(cur, _test_exclusion(exclude_test), today, checkpoints)


class TestExactDayCounting:
    """Returned-on-day-N is exact-day activity, not 'any activity since signup'."""

    def test_day0_activity_does_not_count_toward_any_checkpoint(self, pg_conn):
        today = date(2026, 6, 20)
        signup = today - timedelta(days=30)
        _seed_user("user-a", signup)
        _add_daily("user-a", signup, 100)  # day 0, the signup day itself

        result = _compute(today, checkpoints=(1, 3, 7))
        cohort = result["cohorts"][0]
        for n in ("1", "3", "7"):
            assert cohort["days"][n]["hit"] == 0, f"day0 activity leaked into day{n}"

    def test_exact_day_match_counts_only_that_checkpoint(self, pg_conn):
        today = date(2026, 6, 20)
        signup = today - timedelta(days=30)
        _seed_user("user-a", signup)
        _add_daily("user-a", signup + timedelta(days=7), 50)  # exactly day 7

        result = _compute(today, checkpoints=(1, 3, 7, 14, 28))
        cohort = result["cohorts"][0]
        assert cohort["days"]["7"]["hit"] == 1
        for n in ("1", "3", "14", "28"):
            assert cohort["days"][n]["hit"] == 0


class TestMaturityBlanking:
    """A cohort cell is reported only once EVERY member has reached day N;
    otherwise it is None, never a fabricated 0."""

    def test_mixed_age_cohort_blanks_the_unmatured_checkpoint(self, pg_conn):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT date_trunc('week', DATE '2026-06-10')::date AS d")
            week_start = cur.fetchone()["d"]
        today = week_start + timedelta(days=9)
        # member A: age 9 (matured for day 7); member B: age 6 (NOT matured for day 7)
        _seed_user("user-a", week_start)
        _seed_user("user-b", week_start + timedelta(days=3))

        result = _compute(today, checkpoints=(7,))
        assert len(result["cohorts"]) == 1
        assert result["cohorts"][0]["cohort_week"] == str(week_start)
        assert result["cohorts"][0]["days"]["7"] is None

    def test_fully_matured_cohort_reports_a_cell(self, pg_conn):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT date_trunc('week', DATE '2026-06-10')::date AS d")
            week_start = cur.fetchone()["d"]
        today = week_start + timedelta(days=20)  # both members well past day 7
        _seed_user("user-a", week_start)
        _add_daily("user-a", week_start + timedelta(days=7), 10)
        _seed_user("user-b", week_start + timedelta(days=3))

        result = _compute(today, checkpoints=(7,))
        cell = result["cohorts"][0]["days"]["7"]
        assert cell == {"pct": 50.0, "hit": 1, "aged": 2}


class TestAdminExclusion:
    def test_test_account_excluded_from_cohort_and_all_weeks(self, pg_conn):
        today = date(2026, 6, 20)
        signup = today - timedelta(days=30)
        _seed_user("user-a", signup)
        _mark_test_account("user-a")
        _add_daily("user-a", signup + timedelta(days=7), 10)

        result = _compute(today, checkpoints=(7,))
        assert result["cohorts"] == []
        assert result["all_weeks"]["days"]["7"] is None

    def test_exclude_test_false_includes_it(self, pg_conn):
        today = date(2026, 6, 20)
        signup = today - timedelta(days=30)
        _seed_user("user-a", signup)
        _mark_test_account("user-a")
        _add_daily("user-a", signup + timedelta(days=7), 10)

        result = _compute(today, checkpoints=(7,), exclude_test=False)
        assert result["cohorts"][0]["days"]["7"]["hit"] == 1


class TestAllWeeksPooling:
    def test_all_weeks_pools_matured_members_across_cohorts(self, pg_conn):
        today = date(2026, 6, 20)
        register_test_user_ids("t16070-a", "t16070-b")
        _seed_user("t16070-a", today - timedelta(days=30))
        _add_daily("t16070-a", today - timedelta(days=23), 10)  # returned on day 7
        _seed_user("t16070-b", today - timedelta(days=60))
        # no activity for user-b on day 7

        result = _compute(today, checkpoints=(7,))
        assert result["all_weeks"]["days"]["7"] == {"pct": 50.0, "hit": 1, "aged": 2}
