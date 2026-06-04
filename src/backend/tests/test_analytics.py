"""Tests for analytics: create_user_segment, _determine_origin, record_milestone, update_session."""

from datetime import datetime, timezone, timedelta

import pytest
from app.analytics import create_user_segment, record_milestone, update_session, FLOW_EVENTS, _determine_origin
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
