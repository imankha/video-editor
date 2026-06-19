"""Tests for T2915 sport inheritance through invite.

Covers the Postgres default_sport mirror (set/get) and cross-user inheritance
via the referrals graph. mirror_default_sport reads the owner's local SQLite,
so get_profiles is stubbed for those cases.
"""

import pytest
from app.services.auth_db import create_user
from app.services.sharing_db import (
    get_inherited_sport,
    mirror_default_sport,
    record_referral,
    set_user_default_sport,
)


def _default_sport(user_id: str):
    from app.services.pg import get_pg  # import after pg_conn patches the pool

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT default_sport FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    return row["default_sport"] if row else None


class TestSetUserDefaultSport:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_sets_column(self, pg_conn):
        set_user_default_sport("user-a", "basketball")
        assert _default_sport("user-a") == "basketball"

    def test_overwrites_existing(self, pg_conn):
        set_user_default_sport("user-a", "soccer")
        set_user_default_sport("user-a", "lacrosse")
        assert _default_sport("user-a") == "lacrosse"

    def test_empty_sport_is_noop(self, pg_conn):
        set_user_default_sport("user-a", "soccer")
        set_user_default_sport("user-a", "")
        assert _default_sport("user-a") == "soccer"


class TestGetInheritedSport:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")  # inviter
        create_user("user-b", email="b@test.com")  # invitee
        create_user("user-c", email="c@test.com")  # un-referred

    def test_returns_inviter_sport_when_referral_exists(self, pg_conn):
        set_user_default_sport("user-a", "basketball")
        record_referral("user-a", "user-b", "invite_link", "code")
        assert get_inherited_sport("user-b") == "basketball"

    def test_returns_none_when_no_referral(self, pg_conn):
        set_user_default_sport("user-a", "basketball")
        assert get_inherited_sport("user-c") is None

    def test_returns_none_when_inviter_sport_null(self, pg_conn):
        # Inviter never mirrored a sport -> default_sport is NULL
        record_referral("user-a", "user-b", "invite_link", "code")
        assert get_inherited_sport("user-b") is None

    def test_custom_sport_inherited_verbatim(self, pg_conn):
        set_user_default_sport("user-a", "Underwater Hockey")
        record_referral("user-a", "user-b", "invite_link", "code")
        assert get_inherited_sport("user-b") == "Underwater Hockey"


class TestMirrorDefaultSport:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_mirrors_default_profile_sport(self, pg_conn, monkeypatch):
        monkeypatch.setattr(
            "app.services.user_db.get_profiles",
            lambda uid: [
                {"id": "p1", "sport": "tennis", "is_default": 0},
                {"id": "p2", "sport": "basketball", "is_default": 1},
            ],
        )
        mirror_default_sport("user-a")
        assert _default_sport("user-a") == "basketball"

    def test_falls_back_to_first_profile_when_no_default(self, pg_conn, monkeypatch):
        monkeypatch.setattr(
            "app.services.user_db.get_profiles",
            lambda uid: [{"id": "p1", "sport": "golf", "is_default": 0}],
        )
        mirror_default_sport("user-a")
        assert _default_sport("user-a") == "golf"

    def test_no_profiles_is_noop(self, pg_conn, monkeypatch):
        monkeypatch.setattr("app.services.user_db.get_profiles", lambda uid: [])
        mirror_default_sport("user-a")
        assert _default_sport("user-a") is None

    def test_swallows_errors(self, pg_conn, monkeypatch):
        def _boom(uid):
            raise RuntimeError("sqlite unavailable")

        monkeypatch.setattr("app.services.user_db.get_profiles", _boom)
        # Best-effort: must not raise into the caller
        mirror_default_sport("user-a")
        assert _default_sport("user-a") is None
