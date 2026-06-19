"""Tests for T2910 referral graph: record_referral, resolve_invite_code, channel mapping."""

import hashlib

import pytest
from app.services.auth_db import create_user
from app.services.sharing_db import (
    SHARE_TYPE_TO_CHANNEL,
    attribute_from_existing_shares,
    persist_invite_code,
    record_referral,
    resolve_invite_code,
)


class TestRecordReferral:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")
        create_user("user-1", email="u1@test.com")
        create_user("user-2", email="u2@test.com")

    def test_creates_row(self, pg_conn):
        result = record_referral("user-a", "user-b", "invite_link", "abc123")
        assert result is True
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM referrals WHERE referred_id = %s", ("user-b",))
            row = cur.fetchone()
        assert row is not None
        assert row["referrer_id"] == "user-a"
        assert row["channel"] == "invite_link"
        assert row["source_id"] == "abc123"

    def test_self_referral_returns_false(self, pg_conn):
        result = record_referral("user-a", "user-a", "invite_link")
        assert result is False

    def test_duplicate_referred_id_returns_false(self, pg_conn):
        record_referral("user-a", "user-b", "invite_link", "abc")
        result = record_referral("user-1", "user-b", "game_share", "xyz")
        assert result is False

    def test_same_referrer_multiple_referred(self, pg_conn):
        assert record_referral("user-a", "user-b", "invite_link") is True
        assert record_referral("user-a", "user-1", "game_share") is True


class TestResolveInviteCode:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_returns_user_id_for_known_code(self, pg_conn):
        code = hashlib.sha256("user-a".encode()).hexdigest()[:8]
        persist_invite_code("user-a", code)
        result = resolve_invite_code(code)
        assert result == "user-a"

    def test_returns_none_for_unknown_code(self, pg_conn):
        result = resolve_invite_code("xxxxxxxx")
        assert result is None


class TestPersistInviteCode:
    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_stores_code_on_first_call(self, pg_conn):
        persist_invite_code("user-a", "testcode")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT invite_code FROM users WHERE user_id = %s", ("user-a",))
            row = cur.fetchone()
        assert row["invite_code"] == "testcode"

    def test_does_not_overwrite_existing_code(self, pg_conn):
        persist_invite_code("user-a", "first")
        persist_invite_code("user-a", "second")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT invite_code FROM users WHERE user_id = %s", ("user-a",))
            row = cur.fetchone()
        assert row["invite_code"] == "first"


class TestChannelMapping:
    def test_all_share_types_map(self):
        assert SHARE_TYPE_TO_CHANNEL["video"] == "reel_share"
        assert SHARE_TYPE_TO_CHANNEL["game"] == "game_share"
        assert SHARE_TYPE_TO_CHANNEL["annotation_playback"] == "annotation_share"
        assert SHARE_TYPE_TO_CHANNEL["collection"] == "collection_share"

    def test_no_extra_keys(self):
        assert set(SHARE_TYPE_TO_CHANNEL.keys()) == {
            "video", "game", "annotation_playback", "collection"}


class TestInviteLinkAttribution:
    """Integration: signup with ref param creates referral via invite_link channel."""

    @pytest.fixture(autouse=True)
    def _create_referrer(self, pg_conn):
        create_user("user-a", email="referrer@test.com")
        code = hashlib.sha256("user-a".encode()).hexdigest()[:8]
        persist_invite_code("user-a", code)

    def test_signup_with_ref_creates_referral(self, pg_conn):
        code = hashlib.sha256("user-a".encode()).hexdigest()[:8]
        create_user("user-b", email="referred@test.com")
        referrer_id = resolve_invite_code(code)
        assert referrer_id == "user-a"
        result = record_referral(referrer_id, "user-b", "invite_link", code)
        assert result is True

    def test_signup_with_ref_then_share_only_first_wins(self, pg_conn):
        code = hashlib.sha256("user-a".encode()).hexdigest()[:8]
        create_user("user-b", email="referred@test.com")
        record_referral("user-a", "user-b", "invite_link", code)
        result = record_referral("user-a", "user-b", "game_share", "share-99")
        assert result is False


class TestAttributeFromExistingShares:
    """Share-based attribution at signup for gallery/reel shares."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")

    def _insert_share(self, sharer_id, recipient_email, share_type="video"):
        from app.services.pg import get_pg
        import uuid
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO shares (share_token, share_type, sharer_user_id,
                   sharer_profile_id, recipient_email)
                   VALUES (%s, %s, %s, 'profile-1', %s) RETURNING id""",
                (str(uuid.uuid4()), share_type, sharer_id, recipient_email),
            )
            return cur.fetchone()["id"]

    def test_attributes_from_video_share(self, pg_conn):
        self._insert_share("sharer-user", "recipient@test.com", "video")
        result = attribute_from_existing_shares("recipient-user", "recipient@test.com")
        assert result is True
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM referrals WHERE referred_id = 'recipient-user'")
            row = cur.fetchone()
        assert row["referrer_id"] == "sharer-user"
        assert row["channel"] == "reel_share"

    def test_attributes_from_game_share(self, pg_conn):
        self._insert_share("sharer-user", "recipient@test.com", "game")
        result = attribute_from_existing_shares("recipient-user", "recipient@test.com")
        assert result is True
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM referrals WHERE referred_id = 'recipient-user'")
            row = cur.fetchone()
        assert row["channel"] == "game_share"

    def test_no_shares_returns_false(self, pg_conn):
        result = attribute_from_existing_shares("recipient-user", "nobody@test.com")
        assert result is False

    def test_self_share_not_attributed(self, pg_conn):
        self._insert_share("recipient-user", "recipient@test.com", "video")
        result = attribute_from_existing_shares("recipient-user", "recipient@test.com")
        assert result is False

    def test_invite_link_wins_over_share(self, pg_conn):
        """If invite_link already attributed, share attribution is a no-op."""
        self._insert_share("sharer-user", "recipient@test.com", "video")
        record_referral("sharer-user", "recipient-user", "invite_link", "code123")
        result = attribute_from_existing_shares("recipient-user", "recipient@test.com")
        assert result is False
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT channel FROM referrals WHERE referred_id = 'recipient-user'")
            row = cur.fetchone()
        assert row["channel"] == "invite_link"
