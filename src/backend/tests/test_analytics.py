"""Tests for analytics: create_user_segment, _determine_origin, record_milestone, update_session."""

from datetime import datetime, timezone, timedelta

import pytest
from app.analytics import (
    create_user_segment,
    record_milestone,
    update_session,
    close_session,
    session_engaged_seconds,
    SESSION_IDLE_CAP_SECONDS,
    FLOW_EVENTS,
    _determine_origin,
)
from app.services.auth_db import create_user
from app.services.sharing_db import record_referral


def _get_segment(user_id: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
        return cur.fetchone()


def _get_action(user_id: str, action: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_actions WHERE user_id = %s AND action = %s", (user_id, action))
        return cur.fetchone()


class TestCreateUserSegment:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com", google_id="g123")

    def test_creates_organic_segment(self, pg_conn):
        create_user_segment("user-a", "organic", None, "otp")
        row = _get_segment("user-a")
        assert row is not None
        assert row["origin"] == "organic"
        assert row["referrer_id"] is None
        assert row["signup_method"] == "otp"
        assert row["acquired_at"] == datetime.now(timezone.utc).date()
        assert row["total_spent_cents"] == 0

    def test_creates_campaign_segment(self, pg_conn):
        create_user_segment("user-b", "ig_summer", None, "google")
        row = _get_segment("user-b")
        assert row is not None
        assert row["origin"] == "ig_summer"
        assert row["referrer_id"] is None
        assert row["signup_method"] == "google"

    def test_creates_viral_segment(self, pg_conn):
        create_user_segment("user-a", "organic", None, "otp")
        create_user_segment("user-b", "organic", "user-a", "google")
        row = _get_segment("user-b")
        assert row is not None
        assert row["origin"] == "organic"
        assert row["referrer_id"] == "user-a"

    def test_idempotent_on_conflict(self, pg_conn):
        create_user_segment("user-a", "organic", None, "otp")
        create_user_segment("user-a", "ig_summer", None, "google")
        row = _get_segment("user-a")
        assert row["origin"] == "organic"


class TestDetermineOrigin:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")
        create_user("user-c", email="c@test.com")

    def test_organic_no_ref(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", None)
        assert origin == "organic"
        assert referrer_id is None

    def test_campaign_ref_nonhex(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", "ig_summer_camp")
        assert origin == "ig_summer_camp"
        assert referrer_id is None

    def test_viral_from_invite_code(self, pg_conn):
        from app.services.sharing_db import persist_invite_code
        create_user_segment("user-a", "organic", None, "otp")
        persist_invite_code("user-a", "abc12345")
        origin, referrer_id = _determine_origin("user-b", "abc12345")
        assert origin == "organic"
        assert referrer_id == "user-a"

    def test_viral_inherits_campaign_origin(self, pg_conn):
        from app.services.sharing_db import persist_invite_code
        create_user_segment("user-a", "ig_summer", None, "otp")
        persist_invite_code("user-a", "abc12345")
        origin, referrer_id = _determine_origin("user-b", "abc12345")
        assert origin == "ig_summer"
        assert referrer_id == "user-a"

    def test_viral_chain_propagation(self, pg_conn):
        from app.services.sharing_db import persist_invite_code
        create_user_segment("user-a", "ig_summer", None, "otp")
        persist_invite_code("user-a", "a1b2c3d4")
        record_referral("user-a", "user-b", "invite_link", "a1b2c3d4")
        create_user_segment("user-b", "ig_summer", "user-a", "google")
        persist_invite_code("user-b", "e5f6a7b8")

        origin, referrer_id = _determine_origin("user-c", "e5f6a7b8")
        assert origin == "ig_summer"
        assert referrer_id == "user-b"


    def test_unresolved_hex_falls_to_utm_campaign(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", "deadbeef", utm_campaign="summer_sale")
        assert origin == "summer_sale"
        assert referrer_id is None

    def test_unresolved_hex_falls_to_click_source(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", "deadbeef", click_source="facebook")
        assert origin == "facebook_unknown"
        assert referrer_id is None

    def test_unresolved_hex_no_fallback_is_organic(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", "deadbeef")
        assert origin == "organic"
        assert referrer_id is None

    def test_utm_campaign_without_ref(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", None, utm_campaign="brand_search")
        assert origin == "brand_search"
        assert referrer_id is None

    def test_click_source_without_ref_or_utm(self, pg_conn):
        origin, referrer_id = _determine_origin("user-b", None, click_source="google")
        assert origin == "google_unknown"
        assert referrer_id is None

    def test_utm_campaign_beats_click_source(self, pg_conn):
        origin, referrer_id = _determine_origin(
            "user-b", None, utm_campaign="summer_sale", click_source="facebook"
        )
        assert origin == "summer_sale"
        assert referrer_id is None

    def test_nonhex_ref_beats_utm_campaign(self, pg_conn):
        origin, referrer_id = _determine_origin(
            "user-b", "ig_summer_camp", utm_campaign="should_not_win"
        )
        assert origin == "ig_summer_camp"
        assert referrer_id is None


class TestCreateUserSegmentUtm:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_utm_fields_stored(self, pg_conn):
        create_user_segment(
            "user-a", "summer_sale", None, "google",
            utm_source="facebook",
            utm_medium="paid_social",
            utm_campaign="summer_sale",
            utm_content="video_v2",
            utm_term="soccer",
            click_source="facebook",
        )
        row = _get_segment("user-a")
        assert row["utm_source"] == "facebook"
        assert row["utm_medium"] == "paid_social"
        assert row["utm_campaign"] == "summer_sale"
        assert row["utm_content"] == "video_v2"
        assert row["utm_term"] == "soccer"
        assert row["click_source"] == "facebook"

    def test_utm_fields_null_for_viral(self, pg_conn):
        create_user("user-b", email="b@test.com")
        create_user_segment("user-a", "ig_summer", "user-b", "otp")
        row = _get_segment("user-a")
        assert row["utm_source"] is None
        assert row["utm_campaign"] is None
        assert row["click_source"] is None


class TestRecordMilestone:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_game_created_upserts_action(self, pg_conn):
        record_milestone("user-a", "game_created")
        row = _get_action("user-a", "game_created")
        assert row is not None
        assert row["count"] == 1
        assert row["first_at"] is not None

    def test_second_call_increments_count(self, pg_conn):
        record_milestone("user-a", "game_created")
        first_at = _get_action("user-a", "game_created")["first_at"]

        record_milestone("user-a", "game_created")
        row = _get_action("user-a", "game_created")
        assert row["first_at"] == first_at
        assert row["count"] == 2

    def test_all_event_types(self, pg_conn):
        for event in FLOW_EVENTS:
            record_milestone("user-a", event)
        assert _get_action("user-a", "game_created")["count"] == 1
        assert _get_action("user-a", "clip_created")["count"] == 1
        assert _get_action("user-a", "export_completed")["count"] == 1

    def test_fire_and_forget_invalid_user(self, pg_conn):
        record_milestone("nonexistent-user", "game_created")

    def test_fire_and_forget_unknown_event(self, pg_conn):
        record_milestone("user-a", "unknown_event")


class TestAttemptOutcomeTaxonomy:
    """T7510: attempt/outcome/failure-reason taxonomy on record_milestone."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_new_outcome_events_registered(self, pg_conn):
        # The durable-completion events must exist so record_milestone accepts
        # them instead of logging "Unknown event".
        for event in (
            "game_upload_succeeded",
            "game_upload_failed",
            "clip_save_attempted",
            "clip_save_failed",
            "share_attempted",
            "move_attempted",
            "move_succeeded",
            "payment_failed",
        ):
            assert event in FLOW_EVENTS, f"{event} missing from FLOW_EVENTS"

    def test_previously_dropped_engagement_events_registered(self, pg_conn):
        # These bridged from frontend achievements to milestone names that were
        # NOT in FLOW_EVENTS, so record_milestone silently dropped them.
        for event in (
            "add_clip_opened",
            "watched_annotate_tutorial",
            "watched_framing_tutorial",
            "watched_overlay_tutorial",
            "watched_publish_tutorial",
        ):
            assert event in FLOW_EVENTS, f"{event} missing from FLOW_EVENTS"

    def test_game_created_relabeled_as_attempt(self, pg_conn):
        # The reported lie: game_created was labeled "Uploaded". It fires on the
        # pending insert BEFORE bytes upload, so it is an ATTEMPT.
        assert FLOW_EVENTS["game_created"]["label"] == "Upload Attempted"
        assert FLOW_EVENTS["game_upload_succeeded"]["label"] == "Uploaded"

    def test_failure_reason_encoded_in_action(self, pg_conn):
        record_milestone("user-a", "game_upload_failed", reason="timeout")
        assert _get_action("user-a", "game_upload_failed:timeout")["count"] == 1
        # A different reason is a distinct, queryable dimension.
        record_milestone("user-a", "game_upload_failed", reason="network")
        assert _get_action("user-a", "game_upload_failed:network")["count"] == 1
        assert _get_action("user-a", "game_upload_failed:timeout")["count"] == 1

    def test_failure_reason_folds_into_daily_counter(self, pg_conn):
        from app.analytics import _counter_buffer
        record_milestone("user-a", "game_upload_failed", reason="timeout")
        record_milestone("user-a", "game_upload_failed", reason="network")
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT game_uploads_failed FROM daily_counters "
                "WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            # both reasons aggregate into the one daily fail column
            assert cur.fetchone()["game_uploads_failed"] >= 2

    def test_success_increments_daily_counter(self, pg_conn):
        from app.analytics import _counter_buffer
        record_milestone("user-a", "game_upload_succeeded")
        _counter_buffer.flush()
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT game_uploads_succeeded FROM daily_counters "
                "WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            assert cur.fetchone()["game_uploads_succeeded"] >= 1

    def test_reason_recorded_in_user_action_log_context(self, pg_conn):
        # The per-user journey trail carries the machine-readable reason.
        record_milestone("user-a", "game_upload_failed", reason="refused")
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection("user-a") as conn:
            rows = conn.execute(
                "SELECT action, context FROM user_action_log "
                "WHERE action = 'game_upload_failed:refused'"
            ).fetchall()
        assert rows, "failure event not written to user_action_log"
        import json as _json
        assert _json.loads(rows[0][1])["reason"] == "refused"


class TestRecordImpression:
    """T7515 tier 3: blocking-dialog / error-toast impression counting."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        from app.user_context import reset_user_id, set_current_user_id
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")
        set_current_user_id("user-a")
        # user.sqlite persists across tests (pg_conn only resets Postgres); clear
        # the per-user log so each test's user_action_log assertions are isolated.
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection("user-a") as conn:
            conn.execute("DELETE FROM user_action_log")
            conn.commit()
        yield
        reset_user_id()

    def test_impression_upserts_named_action_row(self, pg_conn):
        from app.analytics import record_impression
        record_impression("dialog", "Tag not submitted")
        # Name is slugified into a bounded, queryable per-name aggregate row,
        # mirroring T7510's game_upload_failed:{reason} shape.
        row = _get_action("user-a", "dialog_impression:tag_not_submitted")
        assert row is not None and row["count"] == 1

    def test_repeat_impression_increments_count(self, pg_conn):
        from app.analytics import record_impression
        record_impression("toast", "Copy failed")
        record_impression("toast", "Copy failed")
        assert _get_action("user-a", "toast_impression:copy_failed")["count"] == 2

    def test_unknown_kind_is_dropped(self, pg_conn):
        from app.analytics import record_impression
        record_impression("banner", "whatever")
        assert _get_action("user-a", "banner_impression:whatever") is None

    def test_session_count_and_name_ride_user_action_log(self, pg_conn):
        from app.analytics import record_impression
        record_impression("dialog", "Tag not submitted", session_count=5)
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection("user-a") as conn:
            rows = conn.execute(
                "SELECT context FROM user_action_log "
                "WHERE action = 'dialog_impression:tag_not_submitted'"
            ).fetchall()
        assert rows, "impression not written to user_action_log"
        import json as _json
        ctx = _json.loads(rows[0][0])
        assert ctx["session_count"] == 5
        assert ctx["name"] == "Tag not submitted"

    def test_impersonation_leaves_zero_footprint(self, pg_conn, monkeypatch):
        from app.analytics import record_impression
        monkeypatch.setattr("app.analytics.get_current_impersonator_id", lambda: "admin-9")
        record_impression("dialog", "Tag not submitted")
        assert _get_action("user-a", "dialog_impression:tag_not_submitted") is None


class TestRecordSessionExit:
    """T7515 tier 4: session-exit breadcrumbs written to per-user user_action_log."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")
        # user.sqlite persists across tests; clear it so breadcrumb-row counts
        # aren't polluted by a sibling test's session_exit rows.
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection("user-a") as conn:
            conn.execute("DELETE FROM user_action_log")
            conn.commit()

    def _breadcrumbs(self, user_id="user-a"):
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            rows = conn.execute(
                "SELECT context FROM user_action_log WHERE action = 'session_exit'"
            ).fetchall()
        import json as _json
        return [_json.loads(r[0]) for r in rows]

    def test_writes_breadcrumb_to_user_action_log(self, pg_conn):
        from app.analytics import record_session_exit
        record_session_exit(
            "user-a",
            last_screen="annotate",
            dwell={"annotate": 42.0, "framing": 8.5},
            trail=["project-manager", "annotate", "framing", "annotate"],
        )
        crumbs = self._breadcrumbs()
        assert crumbs, "no session_exit breadcrumb written"
        ctx = crumbs[-1]
        assert ctx["last_screen"] == "annotate"
        assert ctx["dwell"]["annotate"] == 42.0
        assert ctx["trail"][-1] == "annotate"

    def test_unknown_screens_are_dropped(self, pg_conn):
        from app.analytics import record_session_exit
        record_session_exit(
            "user-a",
            last_screen="evil-screen",
            dwell={"annotate": 5.0, "evil-screen": 999.0},
            trail=["annotate", "evil-screen"],
        )
        ctx = self._breadcrumbs()[-1]
        assert ctx["last_screen"] is None  # unknown screen not echoed back
        assert "evil-screen" not in ctx["dwell"]
        assert "evil-screen" not in ctx["trail"]

    def test_empty_breadcrumb_writes_nothing(self, pg_conn):
        from app.analytics import record_session_exit
        record_session_exit("user-a", last_screen=None, dwell={}, trail=[])
        assert self._breadcrumbs() == []

    def test_impersonation_leaves_zero_footprint(self, pg_conn, monkeypatch):
        from app.analytics import record_session_exit
        monkeypatch.setattr("app.analytics.get_current_impersonator_id", lambda: "admin-9")
        record_session_exit("user-a", last_screen="annotate", dwell={"annotate": 5.0}, trail=["annotate"])
        assert self._breadcrumbs() == []


class TestUpdateSession:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_increments_on_gap(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_segments SET last_active_at = now() - INTERVAL '31 minutes' WHERE user_id = %s",
                ("user-a",),
            )
        update_session("user-a")
        row = _get_action("user-a", "session_started")
        assert row is not None
        assert row["count"] == 1

    def test_no_increment_within_window(self, pg_conn):
        update_session("user-a")
        row = _get_action("user-a", "session_started")
        assert row is not None
        assert row["count"] == 1  # initial insert, no increment

    def test_updates_last_active_at(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_segments SET last_active_at = now() - INTERVAL '1 hour' WHERE user_id = %s",
                ("user-a",),
            )
        before = _get_segment("user-a")["last_active_at"]
        update_session("user-a")
        after = _get_segment("user-a")["last_active_at"]
        assert after > before

    def test_fire_and_forget_invalid_user(self, pg_conn):
        update_session("nonexistent-user")

    def test_first_call_sets_current_session_start(self, pg_conn):
        """First update_session sets current_session_start (was NULL post-migration)."""
        seg_before = _get_segment("user-a")
        assert seg_before["current_session_start"] is None

        update_session("user-a")

        seg_after = _get_segment("user-a")
        assert seg_after["current_session_start"] is not None
        assert seg_after["total_usage_seconds"] == 0

    def test_same_session_does_not_accumulate(self, pg_conn):
        """Within 30min window, total_usage_seconds stays unchanged."""
        update_session("user-a")
        seg1 = _get_segment("user-a")
        assert seg1["current_session_start"] is not None

        update_session("user-a")
        seg2 = _get_segment("user-a")
        assert seg2["total_usage_seconds"] == 0
        assert seg2["current_session_start"] == seg1["current_session_start"]

    def test_new_session_accumulates_duration(self, pg_conn):
        """When 30min gap detected, previous session duration is accumulated."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - INTERVAL '45 minutes',
                       last_active_at = now() - INTERVAL '35 minutes',
                       total_usage_seconds = 100
                   WHERE user_id = %s""",
                ("user-a",),
            )

        update_session("user-a")

        seg = _get_segment("user-a")
        # Previous session: 45min ago start, 35min ago last active = 10min = 600s
        assert seg["total_usage_seconds"] == 100 + 600
        assert seg["current_session_start"] is not None
        assert seg["current_session_start"] > seg["last_active_at"] - timedelta(seconds=5)

    def test_new_session_null_start_no_accumulation(self, pg_conn):
        """Pre-migration user: current_session_start is NULL, gap detected, no accumulation."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       last_active_at = now() - INTERVAL '31 minutes',
                       current_session_start = NULL,
                       total_usage_seconds = 50
                   WHERE user_id = %s""",
                ("user-a",),
            )

        update_session("user-a")

        seg = _get_segment("user-a")
        assert seg["total_usage_seconds"] == 50
        assert seg["current_session_start"] is not None

    def test_multiple_sessions_accumulate(self, pg_conn):
        """Multiple session gaps accumulate total_usage_seconds correctly."""
        from app.services.pg import get_pg

        # Session 1: 10min duration
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - INTERVAL '50 minutes',
                       last_active_at = now() - INTERVAL '40 minutes',
                       total_usage_seconds = 0
                   WHERE user_id = %s""",
                ("user-a",),
            )
        update_session("user-a")
        seg1 = _get_segment("user-a")
        assert seg1["total_usage_seconds"] == 600

        # Session 2: 5min duration
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - INTERVAL '50 minutes',
                       last_active_at = now() - INTERVAL '45 minutes',
                       total_usage_seconds = %s
                   WHERE user_id = %s""",
                (seg1["total_usage_seconds"], "user-a"),
            )
        update_session("user-a")
        seg2 = _get_segment("user-a")
        assert seg2["total_usage_seconds"] == 900

    def test_concurrent_calls_count_one_session(self, pg_conn):
        """T7570: overlapping update_session calls for the same user must count
        exactly ONE new session, not one per call.

        Prod evidence showed session_started firing ~200ms apart (a fire-and-forget
        /me background task retried on a Fly cold-start, and/or an overlapping
        heartbeat), inflating counts ~2x. The mechanism is a lost-update race: two
        calls both SELECT the stale last_active_at, both see is_new_session=True,
        both increment. The FOR UPDATE row lock serializes the decide-and-roll so
        only the first observes a new session. This test fires many overlapping
        calls and asserts both stores record exactly one.

        Counterfactual: removing FOR UPDATE lets several calls race past the gate,
        pushing the PG count and the SQLite log row-count above 1.
        """
        import concurrent.futures

        from app.services.pg import get_pg
        from app.services.user_db import get_user_db_connection

        # Seed a genuine new-session boundary (idle > 30 min) and a clean slate.
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       last_active_at = now() - INTERVAL '31 minutes',
                       current_session_start = now() - INTERVAL '31 minutes',
                       total_usage_seconds = 0
                   WHERE user_id = %s""",
                ("user-a",),
            )
            cur.execute(
                "DELETE FROM user_actions WHERE user_id = %s AND action = 'session_started'",
                ("user-a",),
            )
        try:
            with get_user_db_connection("user-a") as uconn:
                uconn.execute("DELETE FROM user_action_log WHERE action = 'session_started'")
                uconn.commit()
        except Exception:
            pass

        N = 8
        with concurrent.futures.ThreadPoolExecutor(max_workers=N) as pool:
            futures = [pool.submit(update_session, "user-a") for _ in range(N)]
            for f in futures:
                f.result()

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT COALESCE(SUM(count), 0) AS total FROM user_actions "
                "WHERE user_id = %s AND action = 'session_started'",
                ("user-a",),
            )
            pg_count = cur.fetchone()["total"]
        assert pg_count == 1, f"expected exactly 1 session counted, got {pg_count}"

        with get_user_db_connection("user-a") as uconn:
            log_rows = uconn.execute(
                "SELECT COUNT(*) FROM user_action_log WHERE action = 'session_started'"
            ).fetchone()[0]
        assert log_rows == 1, f"expected exactly 1 SQLite log row, got {log_rows}"


class TestSessionEngagedSeconds:
    """T5660: pure-function accounting shared by the write side (banking) and the
    read side (admin panel estimate). No DB — just the arithmetic."""

    def _t(self, minutes_ago: float) -> datetime:
        return datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)

    def test_confirmed_span_is_uncapped(self):
        """A heavy continuous user (confirmed span >> cap) is NOT clamped — this
        is the D1 inversion fix. Banking an ended 2h session credits the full 2h."""
        start = self._t(120)
        last_active = self._t(0)
        secs = session_engaged_seconds(start, last_active, now=None)
        assert secs == pytest.approx(120 * 60, abs=2)
        assert secs > SESSION_IDLE_CAP_SECONDS  # not clamped to 30 min

    def test_now_none_adds_no_tail(self):
        """Banking an ended session (now=None) credits only the confirmed span."""
        start = self._t(10)
        last_active = self._t(4)
        secs = session_engaged_seconds(start, last_active, now=None)
        assert secs == pytest.approx(6 * 60, abs=2)

    def test_live_tail_within_cap_is_credited(self):
        """An open session with a fresh heartbeat gets confirmed span + the small
        tail since the last activity."""
        start = self._t(10)
        last_active = self._t(1)  # 60s ago, well within cap
        now = datetime.now(timezone.utc)
        secs = session_engaged_seconds(start, last_active, now)
        # confirmed 9 min + ~1 min tail
        assert secs == pytest.approx(10 * 60, abs=3)

    def test_idle_tail_beyond_cap_trimmed_to_zero(self):
        """An abandoned open tab (last activity older than the cap) credits only
        the confirmed span — the idle gap is trimmed to zero, not counted or even
        clamped to the cap. This is the D4 idle-over-count fix."""
        start = self._t(45)
        last_active = self._t(40)  # 40 min ago > 30 min cap
        now = datetime.now(timezone.utc)
        secs = session_engaged_seconds(start, last_active, now)
        assert secs == pytest.approx(5 * 60, abs=2)  # confirmed only, no idle tail

    def test_missing_session_start_is_zero(self):
        assert session_engaged_seconds(None, None, datetime.now(timezone.utc)) == 0

    def test_missing_last_active_falls_back_to_start(self):
        # last_active None -> treated as start -> confirmed 0. A within-cap tail is
        # still credited (live grace); a beyond-cap tail is trimmed to 0.
        near = self._t(5)  # 5 min < cap -> tail credited
        assert session_engaged_seconds(near, None, datetime.now(timezone.utc)) == pytest.approx(5 * 60, abs=3)
        far = self._t(40)  # 40 min > cap -> tail trimmed
        assert session_engaged_seconds(far, None, datetime.now(timezone.utc)) == 0


class TestCloseSessionBanking:
    """T5660: close_session is the tab-close beacon's banker (and logout's)."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def _open_session(self, start_min_ago: float, last_active_min_ago: float, base_total: int = 0):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - make_interval(mins => %s),
                       last_active_at = now() - make_interval(mins => %s),
                       total_usage_seconds = %s
                   WHERE user_id = %s""",
                (start_min_ago, last_active_min_ago, base_total, "user-a"),
            )

    def test_tab_close_banks_the_open_session(self, pg_conn):
        """(c) A beacon on tab-close banks the last (open) session without a
        logout or return visit — fixes D2. Confirmed 9 min + ~1 min live tail."""
        self._open_session(start_min_ago=10, last_active_min_ago=1, base_total=0)
        close_session("user-a")
        seg = _get_segment("user-a")
        assert seg["total_usage_seconds"] == pytest.approx(10 * 60, abs=5)
        assert seg["current_session_start"] is None  # session closed

    def test_idle_tail_beyond_cap_trimmed_on_bank(self, pg_conn):
        """(b) Banking trims the idle gap beyond the cap — an abandoned open tab
        banks only its confirmed span, not the idle time since last activity."""
        self._open_session(start_min_ago=45, last_active_min_ago=40, base_total=100)
        close_session("user-a")
        seg = _get_segment("user-a")
        # 100 base + 5 min confirmed, no idle tail from the 40-min gap
        assert seg["total_usage_seconds"] == pytest.approx(100 + 5 * 60, abs=3)

    def test_banked_equals_read_estimate_same_cap(self, pg_conn):
        """(a) The value close_session banks equals the admin panel's live-session
        estimate for the same state — both call session_engaged_seconds with the
        SAME cap. No write/read asymmetry (the original inversion)."""
        from app.services.pg import get_pg
        self._open_session(start_min_ago=20, last_active_min_ago=2, base_total=50)
        row = _get_segment("user-a")
        expected = (row["total_usage_seconds"] or 0) + session_engaged_seconds(
            row["current_session_start"], row["last_active_at"], datetime.now(timezone.utc)
        )
        close_session("user-a")
        seg = _get_segment("user-a")
        assert seg["total_usage_seconds"] == pytest.approx(expected, abs=3)

    def test_close_is_idempotent_no_double_bank(self, pg_conn):
        """A duplicate beacon (or beacon + logout) must not double-bank."""
        self._open_session(start_min_ago=10, last_active_min_ago=1, base_total=0)
        close_session("user-a")
        banked = _get_segment("user-a")["total_usage_seconds"]
        close_session("user-a")  # second call: no open session
        assert _get_segment("user-a")["total_usage_seconds"] == banked


class TestHeartbeatGapCap:
    """T5660: the heartbeat endpoint reuses update_session, so a backgrounded/idle
    gap that exceeds the cap starts a fresh session instead of inflating usage."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_backgrounded_gap_beyond_cap_not_credited(self, pg_conn):
        """(d) A heartbeat arriving after a >30-min idle gap banks only the prior
        confirmed span; the idle gap itself is never credited (no inflation)."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            # Prior session: 5 min confirmed, then a 40-min idle gap (tab hidden,
            # heartbeat paused). last_active is 40 min old -> next tick is a new session.
            cur.execute(
                """UPDATE user_segments SET
                       current_session_start = now() - INTERVAL '45 minutes',
                       last_active_at = now() - INTERVAL '40 minutes',
                       total_usage_seconds = 0
                   WHERE user_id = %s""",
                ("user-a",),
            )
        update_session("user-a")  # the heartbeat path
        seg = _get_segment("user-a")
        # Only the 5-min confirmed span banked; the 40-min idle gap is NOT added.
        assert seg["total_usage_seconds"] == pytest.approx(5 * 60, abs=3)

    def test_foreground_heartbeat_extends_without_banking(self, pg_conn):
        """A within-window heartbeat just extends last_active; the open session's
        span is not banked yet (it's credited live at read time)."""
        update_session("user-a")
        seg1 = _get_segment("user-a")
        assert seg1["current_session_start"] is not None
        assert seg1["total_usage_seconds"] == 0

        update_session("user-a")  # heartbeat 2, same session
        seg2 = _get_segment("user-a")
        assert seg2["total_usage_seconds"] == 0
        assert seg2["current_session_start"] == seg1["current_session_start"]
