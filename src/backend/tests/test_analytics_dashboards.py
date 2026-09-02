"""Tests for analytics dashboard endpoints and daily_counters."""

from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import _counter_buffer, create_user_segment, record_milestone
from app.services.auth_db import create_user


@pytest.fixture()
def analytics_setup(pg_conn):
    create_user("admin-user", email="test-admin@test.local")
    create_user("user-a", email="a@test.com")
    create_user("user-b", email="b@test.com")

    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )

    create_user_segment("user-a", "organic", None, "otp")
    create_user_segment("user-b", "organic", "user-a", "google")

    # T7510: game_created is now the upload ATTEMPT; a clip_created for user-a
    # means their upload durably succeeded, so the fixture emits the outcome
    # event too (real usage: you can't clip a game that never finished uploading).
    record_milestone("user-a", "game_created")
    record_milestone("user-a", "game_upload_succeeded")
    record_milestone("user-a", "clip_created")
    record_milestone("user-a", "export_completed")
    record_milestone("user-b", "game_created")
    yield


@pytest.fixture()
def analytics_with_journey(analytics_setup, pg_conn):
    record_milestone("user-a", "share_completed")
    record_milestone("user-a", "share_completed")
    yield


@pytest.fixture()
def client(analytics_setup, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client_journey(analytics_with_journey, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


class TestDailyCounters:
    def test_create_segment_increments_signups(self, pg_conn):
        create_user("test-user", email="test@test.com")
        create_user_segment("test-user", "organic", None, "otp")
        _counter_buffer.flush()

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT signups FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'organic'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["signups"] >= 1

            cur.execute(
                "SELECT signups FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["signups"] >= 1

    def test_record_milestone_increments_counter(self, analytics_setup, pg_conn):
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT games_created FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["games_created"] >= 2

    def test_pwa_installed_has_no_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "pwa_installed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'")
            row = cur.fetchone()
            assert "pwa_installed" not in (row or {})


class TestFunnelEndpoint:
    def test_non_admin_403(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth("user-a"))
        assert resp.status_code == 403

    def test_returns_funnel_shape(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "funnel" in data
        assert "from" in data
        assert "to" in data
        assert len(data["funnel"]) >= 1
        totals = data["funnel"][0]
        assert totals["origin"] == "all"
        assert totals["signed_up"] >= 2

    def test_origin_filter(self, client):
        resp = client.get("/api/admin/analytics/funnel?origin=organic", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        for row in data["funnel"]:
            assert row["origin"] == "organic"

    def test_funnel_stages_decrease(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth())
        data = resp.json()
        totals = data["funnel"][0]
        assert totals["signed_up"] >= totals["uploaded"]
        assert totals["uploaded"] >= totals["clipped"]


class TestChannelsEndpoint:
    def test_returns_channels(self, client):
        resp = client.get("/api/admin/analytics/channels", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "channels" in data
        assert len(data["channels"]) >= 1
        ch = data["channels"][0]
        assert "origin" in ch
        assert "users" in ch
        assert "export_pct" in ch
        assert "avg_exports" in ch
        assert "revenue_cents" in ch

    def test_no_cartesian_fanout_across_platforms(self, client, pg_conn):
        # T7980: a user with export rows on MULTIPLE platforms and multiple purchase rows
        # must contribute their TRUE export count and TRUE spend, not (exp_rows x pur_rows).
        # user_actions PK includes platform, so this fixture reproduces the fan-out shape:
        # 3 export rows (2+3+1 = 6 exports) x 2 purchase rows would 12x exports and 6x
        # revenue under the old double-LEFT-JOIN.
        # user-c is in conftest's _TEST_USER_IDS cleanup set and unused by analytics_setup.
        create_user("user-c", email="fanout@test.com")
        create_user_segment("user-c", "fanout_origin", None, "otp")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            for platform, cnt in [("web", 2), ("ios", 3), ("unknown", 1)]:
                cur.execute(
                    "INSERT INTO user_actions (user_id, action, platform, count) VALUES (%s, %s, %s, %s)",
                    ("user-c", "export_completed", platform, cnt),
                )
            for platform in ("web", "ios"):
                cur.execute(
                    "INSERT INTO user_actions (user_id, action, platform, count) VALUES (%s, %s, %s, %s)",
                    ("user-c", "credit_purchased", platform, 1),
                )
            cur.execute(
                "UPDATE user_segments SET total_spent_cents = 500 WHERE user_id = 'user-c'"
            )

        resp = client.get("/api/admin/analytics/channels", headers=_auth())
        assert resp.status_code == 200
        ch = next(c for c in resp.json()["channels"] if c["origin"] == "fanout_origin")
        assert ch["users"] == 1
        assert ch["exported"] == 1
        assert ch["purchased"] == 1
        assert ch["revenue_cents"] == 500          # not 500 * 6
        assert ch["avg_exports"] == 6.0            # 6 true exports / 1 exporter, not 12


class TestCohortsEndpoint:
    def test_returns_cohorts(self, client):
        resp = client.get("/api/admin/analytics/cohorts", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "cohorts" in data
        assert "granularity" in data
        assert data["granularity"] == "week"
        if data["cohorts"]:
            c = data["cohorts"][0]
            assert "cohort_period" in c
            assert "signups" in c
            assert "uploaded_pct" in c

    def test_month_granularity(self, client):
        resp = client.get("/api/admin/analytics/cohorts?granularity=month", headers=_auth())
        assert resp.status_code == 200
        assert resp.json()["granularity"] == "month"


class TestJourneyEndpoint:
    def test_returns_journey(self, client_journey):
        resp = client_journey.get("/api/admin/analytics/journey/user-a", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "user-a"
        assert data["email"] == "a@test.com"
        assert "milestones" in data
        assert data["session_count"] >= 0

        completed = [m for m in data["milestones"] if m["at"] is not None]
        pending = [m for m in data["milestones"] if m["at"] is None]
        assert len(completed) >= 5
        assert len(pending) >= 1

    def test_journey_404_unknown_user(self, client):
        resp = client.get("/api/admin/analytics/journey/nonexistent", headers=_auth())
        assert resp.status_code == 404

    def test_journey_403_non_admin(self, client):
        resp = client.get("/api/admin/analytics/journey/user-a", headers=_auth("user-a"))
        assert resp.status_code == 403

    def test_journey_includes_failed_upload_gap_and_reasons(self, client_journey):
        # user-a already has game_created (attempt) from the fixture but no
        # game_upload_succeeded/failed — record a failure so the journey shows
        # the honest attempted-vs-succeeded gap plus the reason breakdown.
        record_milestone("user-a", "game_upload_failed", reason="timeout")
        resp = client_journey.get("/api/admin/analytics/journey/user-a", headers=_auth())
        assert resp.status_code == 200
        milestones = {m["event"]: m for m in resp.json()["milestones"]}
        # game_created (the ATTEMPT) fired bare -- a normal completed milestone,
        # no failure info attached (failures live on the OUTCOME base, below).
        assert milestones["game_created"]["at"] is not None
        assert "failures" not in milestones["game_created"]
        # "game_upload_failed:timeout" never fires bare, only reason-suffixed, so
        # its rollup becomes the game_upload_failed entry itself (0 succeeded,
        # failed_count from the reason breakdown) rather than a pending placeholder.
        failed = milestones["game_upload_failed"]
        assert failed["failures"] == {"timeout": 1}
        assert failed["failed_count"] == 1
        assert failed["count"] == 0

    def test_journey_retry_burst_signal(self, client_journey):
        # >=3 of the SAME attempt action within 60s -> a retry-burst flag,
        # derived at read time (no new storage) per T7510 tier-5 (partial).
        for _ in range(3):
            record_milestone("user-a", "game_created")
        resp = client_journey.get("/api/admin/analytics/journey/user-a", headers=_auth())
        assert resp.status_code == 200
        bursts = resp.json()["frustration_signals"]["retry_bursts"]
        assert "game_created" in bursts
        assert bursts["game_created"][0]["count"] >= 3


class TestRetryBurstDetection:
    """Pure-function coverage for _detect_retry_bursts (T7510 tier-5, partial).

    No DB involved -- deterministic timestamps in, deterministic bursts out.
    Kept independent of the journey integration tests above, which share
    user-a's real (unpatched-per-request) SQLite user_action_log across the
    suite and so can't assert a precise ABSENCE of historical bursts."""

    def test_three_within_window_is_a_burst(self):
        from app.routers.admin import _detect_retry_bursts
        ts = [
            "2026-08-20T10:00:00.000000Z",
            "2026-08-20T10:00:20.000000Z",
            "2026-08-20T10:00:45.000000Z",
        ]
        bursts = _detect_retry_bursts(ts)
        assert len(bursts) == 1
        assert bursts[0]["count"] == 3

    def test_two_within_window_is_not_a_burst(self):
        from app.routers.admin import _detect_retry_bursts
        ts = ["2026-08-20T10:00:00.000000Z", "2026-08-20T10:00:20.000000Z"]
        assert _detect_retry_bursts(ts) == []

    def test_three_spread_beyond_window_is_not_a_burst(self):
        from app.routers.admin import _detect_retry_bursts
        ts = [
            "2026-08-20T10:00:00.000000Z",
            "2026-08-20T10:05:00.000000Z",
            "2026-08-20T10:10:00.000000Z",
        ]
        assert _detect_retry_bursts(ts) == []

    def test_empty_timestamps_returns_no_bursts(self):
        from app.routers.admin import _detect_retry_bursts
        assert _detect_retry_bursts([]) == []


class TestPulseEndpoint:
    def test_returns_pulse_cards(self, client):
        resp = client.get("/api/admin/analytics/pulse", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "cards" in data
        assert "days" in data
        for key in ("signups", "exports", "active_users", "revenue", "viral_conversion"):
            card = data["cards"][key]
            assert "today" in card
            assert "last_week_same_day" in card
            assert "change_pct" in card
            assert "sparkline" in card
            assert isinstance(card["sparkline"], list)
            assert len(card["sparkline"]) > 0
            assert all(isinstance(v, (int, float)) for v in card["sparkline"])
            assert isinstance(card["change_pct"], (int, float))

    def test_pulse_custom_days(self, client):
        resp = client.get("/api/admin/analytics/pulse?days=14", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["days"] == 14
        for key in ("signups", "exports", "active_users", "revenue", "viral_conversion"):
            assert len(data["cards"][key]["sparkline"]) == 14

    def _direct_referral_rate(self, days=30):
        # Direct referred/total over the endpoint's exact window (start = today-(days-1)).
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE referrer_id IS NOT NULL) AS referred
                FROM user_segments
                WHERE acquired_at::date
                      BETWEEN CURRENT_DATE - make_interval(days => %s) AND CURRENT_DATE
            """, (days - 1,))
            row = cur.fetchone()
        return round(row["referred"] / row["total"] * 100, 1) if row["total"] else None

    def test_viral_conversion_is_bounded_referral_rate(self, client):
        # T7960: "Viral Conv." must be referred signups / total signups (bounded 0-100%),
        # NOT the old unbounded views-per-share ratio (which read e.g. 2000%). The fixture
        # has user-b referred by user-a, so at least one referred signup exists -> > 0.
        resp = client.get("/api/admin/analytics/pulse", headers=_auth())
        assert resp.status_code == 200
        card = resp.json()["cards"]["viral_conversion"]
        assert card["today"] is not None and card["today"] > 0
        # A conversion rate can never exceed 100% -- guards against the 2000% regression.
        assert card["today"] <= 100

    def test_viral_conversion_matches_referrer_id_counts(self, client, pg_conn):
        # Cross-check the card against a direct count of user_segments.referrer_id.
        resp = client.get("/api/admin/analytics/pulse", headers=_auth())
        assert resp.json()["cards"]["viral_conversion"]["today"] == self._direct_referral_rate()


class TestUploadSuccessRateAlarm:
    """T8170: the T8160 outage sat at 29% upload success for ~2 days with no
    alert -- a red banner + CRITICAL log must fire when the rate genuinely
    collapses (>= MIN_ATTEMPTS with rate < THRESHOLD), and must NOT fire on a
    quiet day with too few attempts to mean anything.

    ISOLATION: `daily_counters` is a shared, cumulative-per-day Postgres table
    that `pg_conn`'s fixture does NOT reset (only user_actions/segments/etc.
    are cleaned per test) -- any other test in the SAME run touching
    game_uploads_succeeded/failed for TODAY (this file's other tests, T7970's
    daily-counter test, ...) leaves its contribution sitting in the row every
    later test reads. `_reset_upload_counters` zeroes today's row explicitly
    at the start of each test here so the rate/alarm assertions are exact and
    order-independent (found live in CI: a prior test's leftover 1 succeeded
    turned this class's intended 0% into an observed 50%).

    FIXED LOCAL-CLOCK CAVEAT (T8250, resolved): the pulse endpoint used to compute
    its date window with Python's LOCAL `date.today()` while `_reset_upload_counters`/
    `record_milestone` key off Postgres's `CURRENT_DATE` (UTC) -- running this class
    near the UTC day boundary in a negative-UTC-offset timezone used to read
    `card["today"] is None` even though the write side was correct. Fixed by switching
    the pulse window to `datetime.now(UTC).date()`; see TestPulseUtcDateWindow below
    for the regression test (mocks the local clock directly, so it reproduces
    deterministically regardless of the host's real timezone)."""

    def _reset_upload_counters(self):
        # analytics_setup buffers a game_upload_succeeded for user-a that is NOT yet
        # flushed to Postgres when a test starts -- flush it first so the UPDATE
        # actually zeroes it, instead of leaving it to land AFTER the reset when this
        # test's own _counter_buffer.flush() call fires (found live: it silently added
        # 1 succeeded on top of every test's own numbers -- 0/1 read back as 50%).
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE daily_counters SET game_uploads_succeeded = 0, game_uploads_failed = 0 "
                "WHERE counter_date = CURRENT_DATE"
            )

    def _record_and_flush(self, user_id: str, succeeded: int, failed: int):
        self._reset_upload_counters()
        for _ in range(succeeded):
            record_milestone(user_id, "game_upload_succeeded")
        for _ in range(failed):
            record_milestone(user_id, "game_upload_failed", reason="r2_rejected")
        _counter_buffer.flush()

    def test_collapsed_rate_with_enough_attempts_sets_alarm_true(self, client, pg_conn, caplog):
        # 2 succeeded / 8 failed = 20% over 10 attempts -- well past both the
        # THRESHOLD (70%) and MIN_ATTEMPTS (5) guards, matching the real outage shape.
        self._record_and_flush("user-a", succeeded=2, failed=8)

        import logging
        with caplog.at_level(logging.CRITICAL, logger="app.routers.admin"):
            # T8110: exclude_test defaults ON, which forces the per-user
            # user_actions path; this test seeds/resets daily_counters, so pin
            # exclude_test=false to exercise the daily_counters alarm arithmetic.
            resp = client.get("/api/admin/analytics/pulse?exclude_test=false", headers=_auth())

        assert resp.status_code == 200
        card = resp.json()["cards"]["upload_success_rate"]
        assert card["today"] == 20.0
        assert card["alarm"] is True
        assert any("[T8170]" in r.message and "collapsed" in r.message for r in caplog.records), (
            "expected a CRITICAL [T8170] log line when the alarm fires"
        )

    def test_healthy_rate_never_sets_alarm(self, client, pg_conn):
        # 9 succeeded / 1 failed = 90% over 10 attempts -- above threshold, no alarm.
        self._record_and_flush("user-a", succeeded=9, failed=1)

        # T8110: pin exclude_test=false so pulse reads the seeded daily_counters
        # (the default ON path aggregates cumulative user_actions instead).
        resp = client.get("/api/admin/analytics/pulse?exclude_test=false", headers=_auth())
        assert resp.status_code == 200
        card = resp.json()["cards"]["upload_success_rate"]
        assert card["today"] == 90.0
        assert card["alarm"] is False

    def test_low_sample_size_never_sets_alarm_even_at_zero_percent(self, client, pg_conn):
        # 0 succeeded / 1 failed = 0% -- but only 1 attempt, below MIN_ATTEMPTS. A
        # single unlucky attempt on a quiet day must not read as a fleet-wide collapse.
        self._record_and_flush("user-a", succeeded=0, failed=1)

        # T8110: pin exclude_test=false so pulse reads the seeded daily_counters
        # (the default ON path aggregates cumulative user_actions instead).
        resp = client.get("/api/admin/analytics/pulse?exclude_test=false", headers=_auth())
        assert resp.status_code == 200
        card = resp.json()["cards"]["upload_success_rate"]
        assert card["today"] == 0.0
        assert card["alarm"] is False

    def test_no_attempts_alarm_is_false_not_missing(self, client):
        # The default analytics_setup fixture records no game_upload_succeeded/failed
        # milestones for a fresh window -- today is None ("--" on the card) and alarm
        # must still be a real boolean, never absent (the frontend indexes it directly).
        resp = client.get("/api/admin/analytics/pulse", headers=_auth())
        assert resp.status_code == 200
        card = resp.json()["cards"]["upload_success_rate"]
        assert card["alarm"] is False


class TestPulseUtcDateWindow:
    """T8250: `daily_counters` rows are keyed on Postgres's `CURRENT_DATE` (UTC,
    analytics.py `_DailyCounterBuffer.flush`). The pulse endpoint's `today`/`start`
    window must match that UTC convention, not Python's naive local-time
    `date.today()` -- a mismatch silently excludes today's rows for any admin in a
    negative-UTC-offset timezone for a ~7-8h window after local midnight.

    Reproduced by patching `app.routers.admin.date` to a `date` subclass whose
    `today()` returns "yesterday" relative to the REAL current UTC date -- this
    simulates the local-lags-UTC scenario deterministically, independent of the
    host's actual timezone (so it fails reliably pre-fix and passes post-fix in CI,
    which runs in UTC and would never otherwise hit this boundary).
    """

    def _reset_upload_counters(self):
        # See TestUploadSuccessRateAlarm._reset_upload_counters -- same isolation need.
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE daily_counters SET game_uploads_succeeded = 0, game_uploads_failed = 0 "
                "WHERE counter_date = CURRENT_DATE"
            )

    def test_daily_counters_row_visible_when_local_clock_lags_utc(self, client, pg_conn):
        self._reset_upload_counters()
        record_milestone("user-a", "game_upload_succeeded")
        record_milestone("user-a", "game_upload_succeeded")
        _counter_buffer.flush()

        class LocalDateLagsUtc(date):
            @classmethod
            def today(cls):
                return datetime.now(UTC).date() - timedelta(days=1)

        # T8110: pin exclude_test=false so pulse reads the seeded daily_counters
        # (the default ON path aggregates cumulative user_actions instead).
        with patch("app.routers.admin.date", LocalDateLagsUtc):
            resp = client.get("/api/admin/analytics/pulse?exclude_test=false", headers=_auth())

        assert resp.status_code == 200
        card = resp.json()["cards"]["upload_success_rate"]
        # Pre-fix: today's row falls outside the mocked local-lagging window ->
        # attempts=0 -> today=None. Post-fix: datetime.now(UTC).date() ignores the
        # mocked local date.today(), so the window still ends on the real UTC day.
        assert card["succeeded"] == 2
        assert card["failed"] == 0
        assert card["attempts"] == 2
        assert card["today"] == 100.0

    def test_signup_card_visible_when_local_clock_lags_utc(self, client, pg_conn):
        # Same boundary bug, different card: daily_counters.signups instead of
        # game_uploads_* -- confirms the fix isn't upload-metric-specific (every
        # sparkline/card shares the same today/start window). daily_counters is a
        # shared cumulative table (not reset per test -- see TestUploadSuccessRateAlarm
        # docstring), so read the real expected value directly instead of hardcoding
        # a count that would be order-dependent on other tests in this run.
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT signups FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
        expected_today_signups = row["signups"] if row else 0
        # Sanity: analytics_setup's create_user_segment calls landed a real row today.
        assert expected_today_signups > 0

        class LocalDateLagsUtc(date):
            @classmethod
            def today(cls):
                return datetime.now(UTC).date() - timedelta(days=1)

        with patch("app.routers.admin.date", LocalDateLagsUtc):
            resp = client.get("/api/admin/analytics/pulse?exclude_test=false", headers=_auth())

        assert resp.status_code == 200
        card = resp.json()["cards"]["signups"]
        # Pre-fix: the mocked local-lagging window never covers real CURRENT_DATE (no
        # daily_counters row exists for the mocked, older date range) -> today reads 0.
        assert card["today"] == expected_today_signups


class TestUserActions:
    def test_record_milestone_upserts_action(self, analytics_setup, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'game_created'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] >= 1

    def test_new_event_records_to_actions(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'annotation_completed'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] == 1

    def test_repeat_event_increments_count(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        record_milestone("user-a", "annotation_completed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count FROM user_actions WHERE user_id = 'user-a' AND action = 'annotation_completed'"
            )
            row = cur.fetchone()
            assert row["count"] == 2

    def test_new_event_daily_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT annotations_completed FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["annotations_completed"] >= 1

    def test_event_without_daily_col_skips_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "framing_opened")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'framing_opened'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] == 1

    def test_unknown_event_ignored(self, analytics_setup, pg_conn):
        record_milestone("user-a", "nonexistent_event")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_actions WHERE user_id = 'user-a' AND action = 'nonexistent_event'"
            )
            assert cur.fetchone() is None


class TestDashboardEndpoint:
    """T8020: GET /api/admin/dashboard composes the 5 individual admin reads into ONE
    response. These tests prove (a) it fires the same underlying reads and (b) the
    Query-sentinel trap is avoided -- each section MUST equal what the individual endpoint
    returns for its own defaults. If a combined-call arg were left bound to a `Query(...)`
    FieldInfo (truthy) instead of None, the filtered section would DIFFER from its
    unfiltered individual endpoint and these equality asserts would fail."""

    def test_dashboard_returns_all_five_sections(self, client):
        resp = client.get("/api/admin/dashboard", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"users", "pulse", "channels", "cohorts", "platforms"}

    def test_dashboard_sections_match_individual_endpoints(self, client):
        combined = client.get("/api/admin/dashboard", headers=_auth())
        assert combined.status_code == 200
        data = combined.json()

        # Each section must be byte-identical to the individual endpoint's default
        # (unfiltered) response -- the direct proof no Query(...) sentinel leaked in.
        users = client.get("/api/admin/users", headers=_auth())
        pulse = client.get("/api/admin/analytics/pulse", headers=_auth())
        channels = client.get("/api/admin/analytics/channels", headers=_auth())
        cohorts = client.get("/api/admin/analytics/cohorts", headers=_auth())
        platforms = client.get("/api/admin/analytics/platforms", headers=_auth())
        for r in (users, pulse, channels, cohorts, platforms):
            assert r.status_code == 200

        assert data["users"] == users.json()
        assert data["pulse"] == pulse.json()
        assert data["channels"] == channels.json()
        assert data["cohorts"] == cohorts.json()
        assert data["platforms"] == platforms.json()

    def test_dashboard_users_uses_first_page_defaults(self, client):
        # list_users default is page=1, page_size=DEFAULT_PAGE_SIZE -- confirm the combined
        # call passes those explicitly (not a Query sentinel) by checking the echoed paging.
        data = client.get("/api/admin/dashboard", headers=_auth()).json()
        assert data["users"]["page"] == 1
        assert data["users"]["page_size"] == 10

    def test_dashboard_requires_admin(self, client):
        # Non-admin caller gets 403, same gate as the individual endpoints.
        resp = client.get("/api/admin/dashboard", headers={"X-User-ID": "user-a"})
        assert resp.status_code == 403
