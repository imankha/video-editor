"""Tests for T3010 analytics: create_user_milestones, record_milestone, update_session, origin detection."""

from datetime import datetime, timezone, timedelta

import pytest
from app.analytics import create_user_milestones, record_milestone, update_session, MILESTONE_EVENTS
from app.services.auth_db import create_user
from app.services.sharing_db import record_referral


def _get_milestones(user_id: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_milestones WHERE user_id = %s", (user_id,))
        return cur.fetchone()


class TestCreateUserMilestones:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com", google_id="g123")

    def test_creates_organic_milestones(self, pg_conn):
        create_user_milestones("user-a", "organic", None, "otp")
        row = _get_milestones("user-a")
        assert row is not None
        assert row["origin_type"] == "organic"
        assert row["origin_channel"] is None
        assert row["signup_method"] == "otp"
        assert row["install_day"] == datetime.now(timezone.utc).date()
        assert row["session_count"] == 0
        assert row["game_created_count"] == 0

    def test_creates_viral_milestones(self, pg_conn):
        create_user_milestones("user-b", "viral", "invite_link", "google")
        row = _get_milestones("user-b")
        assert row is not None
        assert row["origin_type"] == "viral"
        assert row["origin_channel"] == "invite_link"
        assert row["signup_method"] == "google"

    def test_idempotent_on_conflict(self, pg_conn):
        create_user_milestones("user-a", "organic", None, "otp")
        create_user_milestones("user-a", "viral", "invite_link", "google")
        row = _get_milestones("user-a")
        assert row["origin_type"] == "organic"


class TestOriginDetection:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")

    def test_organic_user(self, pg_conn):
        from app.routers.auth import _get_origin_for_user
        origin_type, origin_channel = _get_origin_for_user("user-b")
        assert origin_type == "organic"
        assert origin_channel is None

    def test_viral_user_with_referral(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "abc123")
        from app.routers.auth import _get_origin_for_user
        origin_type, origin_channel = _get_origin_for_user("user-b")
        assert origin_type == "viral"
        assert origin_channel == "invite_link"


class TestRecordMilestone:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_milestones("user-a", "organic", None, "otp")

    def test_game_created_sets_first_and_increments(self, pg_conn):
        record_milestone("user-a", "game_created")
        row = _get_milestones("user-a")
        assert row["first_game_created_at"] is not None
        assert row["game_created_count"] == 1

    def test_second_call_increments_count_keeps_first_at(self, pg_conn):
        record_milestone("user-a", "game_created")
        first_at = _get_milestones("user-a")["first_game_created_at"]

        record_milestone("user-a", "game_created")
        row = _get_milestones("user-a")
        assert row["first_game_created_at"] == first_at
        assert row["game_created_count"] == 2

    def test_export_completed_sets_last_export_at(self, pg_conn):
        record_milestone("user-a", "export_completed")
        row = _get_milestones("user-a")
        assert row["first_export_completed_at"] is not None
        assert row["export_completed_count"] == 1
        assert row["last_export_at"] is not None

    def test_export_failed_no_first_col(self, pg_conn):
        record_milestone("user-a", "export_failed")
        row = _get_milestones("user-a")
        assert row["export_failed_count"] == 1

    def test_credits_consumed_no_first_col(self, pg_conn):
        record_milestone("user-a", "credits_consumed")
        row = _get_milestones("user-a")
        assert row["credits_consumed_count"] == 1

    def test_all_event_types(self, pg_conn):
        for event in MILESTONE_EVENTS:
            record_milestone("user-a", event)
        row = _get_milestones("user-a")
        assert row["game_created_count"] == 1
        assert row["clip_created_count"] == 1
        assert row["export_completed_count"] == 1
        assert row["export_failed_count"] == 1
        assert row["share_completed_count"] == 1
        assert row["credit_purchase_count"] == 1
        assert row["credits_consumed_count"] == 1

    def test_updates_last_active_at(self, pg_conn):
        before = _get_milestones("user-a")["last_active_at"]
        record_milestone("user-a", "clip_created")
        after = _get_milestones("user-a")["last_active_at"]
        assert after >= before

    def test_fire_and_forget_invalid_user(self, pg_conn):
        record_milestone("nonexistent-user", "game_created")

    def test_fire_and_forget_unknown_event(self, pg_conn):
        record_milestone("user-a", "unknown_event")


class TestUpdateSession:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_milestones("user-a", "organic", None, "otp")

    def test_increments_on_gap(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_milestones SET last_active_at = now() - INTERVAL '31 minutes' WHERE user_id = %s",
                ("user-a",),
            )
        update_session("user-a")
        row = _get_milestones("user-a")
        assert row["session_count"] == 1

    def test_no_increment_within_window(self, pg_conn):
        update_session("user-a")
        row = _get_milestones("user-a")
        assert row["session_count"] == 0

    def test_fire_and_forget_invalid_user(self, pg_conn):
        update_session("nonexistent-user")


class TestMigrationBackfill:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com", google_id="g1")
        create_user("user-b", email="b@test.com")

    def test_backfill_creates_rows_for_existing_users(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "code1")

        from app.migrations.postgres.v005_user_milestones import V005UserMilestones
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_milestones")
            V005UserMilestones().up(conn)

        row_a = _get_milestones("user-a")
        assert row_a is not None
        assert row_a["origin_type"] == "organic"
        assert row_a["signup_method"] == "google"

        row_b = _get_milestones("user-b")
        assert row_b is not None
        assert row_b["origin_type"] == "viral"
        assert row_b["origin_channel"] == "invite_link"
        assert row_b["signup_method"] == "otp"

    def test_backfill_idempotent(self, pg_conn):
        from app.migrations.postgres.v005_user_milestones import V005UserMilestones
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_milestones")
            V005UserMilestones().up(conn)
            V005UserMilestones().up(conn)

        row_a = _get_milestones("user-a")
        assert row_a is not None
