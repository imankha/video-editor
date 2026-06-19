"""Tests for T2915 sport inheritance through invite (snapshot design).

The inviter's default sport is captured at invite-link creation and frozen onto
the referral row at signup. get_inherited_sport reads it straight off that row --
no cross-user lookup, no live mirror.
"""

import pytest
from app.services.auth_db import create_user
from app.services.sharing_db import get_inherited_sport, record_referral


def _row_sport(referred_id: str):
    from app.services.pg import get_pg  # import after pg_conn patches the pool

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT inherited_sport FROM referrals WHERE referred_id = %s", (referred_id,))
        row = cur.fetchone()
    return row["inherited_sport"] if row else None


class TestRecordReferralSnapshot:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")   # inviter
        create_user("user-b", email="b@test.com")   # invitee
        create_user("user-1", email="u1@test.com")

    def test_stores_snapshot(self, pg_conn):
        assert record_referral("user-a", "user-b", "invite_link", "code", inherited_sport="basketball") is True
        assert _row_sport("user-b") == "basketball"

    def test_null_when_omitted(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "code")
        assert _row_sport("user-b") is None

    def test_custom_sport_verbatim(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "code", inherited_sport="Underwater Hockey")
        assert _row_sport("user-b") == "Underwater Hockey"

    def test_first_referral_snapshot_wins(self, pg_conn):
        # ON CONFLICT (referred_id) DO NOTHING -> a later referral can't overwrite the snapshot
        record_referral("user-a", "user-b", "invite_link", "code", inherited_sport="basketball")
        record_referral("user-1", "user-b", "game_share", "x", inherited_sport="tennis")
        assert _row_sport("user-b") == "basketball"


class TestGetInheritedSport:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")
        create_user("user-c", email="c@test.com")  # un-referred

    def test_returns_snapshot_when_present(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "code", inherited_sport="basketball")
        assert get_inherited_sport("user-b") == "basketball"

    def test_none_when_no_referral(self, pg_conn):
        assert get_inherited_sport("user-c") is None

    def test_none_when_snapshot_null(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "code")  # no sport on the link
        assert get_inherited_sport("user-b") is None


class TestDefaultProfileSport:
    """The local-SQLite read that snapshots the inviter's sport onto links/shares."""

    def test_reads_default_profile(self, monkeypatch):
        from app.services import user_db
        monkeypatch.setattr(user_db, "get_profiles", lambda uid: [
            {"id": "p1", "sport": "tennis", "is_default": 0},
            {"id": "p2", "sport": "basketball", "is_default": 1},
        ])
        assert user_db.get_default_profile_sport("user-a") == "basketball"

    def test_falls_back_to_first(self, monkeypatch):
        from app.services import user_db
        monkeypatch.setattr(user_db, "get_profiles", lambda uid: [
            {"id": "p1", "sport": "golf", "is_default": 0},
        ])
        assert user_db.get_default_profile_sport("user-a") == "golf"

    def test_none_when_no_profiles(self, monkeypatch):
        from app.services import user_db
        monkeypatch.setattr(user_db, "get_profiles", lambda uid: [])
        assert user_db.get_default_profile_sport("user-a") is None

    def test_swallows_errors(self, monkeypatch):
        from app.services import user_db

        def _boom(uid):
            raise RuntimeError("sqlite unavailable")

        monkeypatch.setattr(user_db, "get_profiles", _boom)
        assert user_db.get_default_profile_sport("user-a") is None


class TestShareChannelInheritance:
    """Share invites capture the sharer's sport on the share row at creation, and
    attribution at signup freezes it onto the referral the invitee inherits from."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn, monkeypatch):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")
        # sharer's default profile is basketball (read locally at share creation)
        from app.services import user_db
        monkeypatch.setattr(user_db, "get_profiles", lambda uid: [
            {"id": "p1", "sport": "basketball", "is_default": 1},
        ])

    def test_game_share_snapshots_and_attributes_sport(self, pg_conn):
        from app.services.sharing_db import create_game_share, attribute_from_existing_shares
        create_game_share(
            game_id=1, tag_name="", sharer_user_id="sharer-user",
            sharer_profile_id="p1", recipient_email="recipient@test.com",
        )
        # share row carries the snapshot
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT sharer_default_sport FROM shares WHERE sharer_user_id = 'sharer-user'")
            assert cur.fetchone()["sharer_default_sport"] == "basketball"
        # attribution at signup freezes it onto the referral
        assert attribute_from_existing_shares("recipient-user", "recipient@test.com") is True
        assert get_inherited_sport("recipient-user") == "basketball"

    def test_video_share_snapshots_sport(self, pg_conn):
        from app.services.sharing_db import create_shares, attribute_from_existing_shares
        create_shares(
            video_id=1, sharer_user_id="sharer-user", sharer_profile_id="p1",
            video_filename="v.mp4", video_name="V", video_duration=1.0,
            recipient_emails=["recipient@test.com"], is_public=False,
        )
        assert attribute_from_existing_shares("recipient-user", "recipient@test.com") is True
        assert get_inherited_sport("recipient-user") == "basketball"
