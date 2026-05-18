"""
Tests for T2905: Share Annotated Playback via Link.

Covers:
- POST /api/games/{id}/share-playback (create annotation_playback shares)
- Deduplication (same email + game + share_type reuses token)
- Email dispatch via send_playback_share_email
- Pending share creation for non-users
- GET /api/shared/teammate/{token} accepts annotation_playback shares
- sharing_db.create_game_share with share_type parameter
"""

import json
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"
UNKNOWN_EMAIL = "stranger@example.com"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    # Ensure v003 migration constraint is applied (test DB may have old constraint)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check")
        cur.execute("""
            ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
            CHECK (share_type IN ('video', 'game', 'annotation_playback'))
        """)

    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.email.send_playback_share_email", new_callable=AsyncMock, return_value=True) as mock_email, \
         patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True):
        from app.main import app
        c = TestClient(app, raise_server_exceptions=True)
        c._mock_email = mock_email
        yield c


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _seed_game_with_clips(user_id: str = SHARER_ID) -> int:
    """Insert a game with clips and return the game_id."""
    from app.database import get_db_connection
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO games (name, blake3_hash)
               VALUES (?, ?)""",
            ("Test Game", "abc123hash"),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            """INSERT INTO game_videos (game_id, blake3_hash, sequence)
               VALUES (?, ?, ?)""",
            (game_id, "abc123hash", 1),
        )
        for i in range(3):
            cursor.execute(
                """INSERT INTO raw_clips (game_id, filename, name, tags, rating, start_time, end_time, video_sequence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (game_id, f"clip_{i+1}.mp4", f"Clip {i+1}", json.dumps(["Jake"]), 3, i * 10.0, i * 10.0 + 5.0, 1),
            )
        conn.commit()
        return game_id


# ---------------------------------------------------------------------------
# sharing_db unit tests
# ---------------------------------------------------------------------------

class TestCreateGameShareWithType:
    def test_creates_annotation_playback_share(self, isolated_auth_db):
        from app.services.sharing_db import create_game_share, get_game_share_by_token

        share = create_game_share(
            game_id=1,
            tag_name="",
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=RECIPIENT_EMAIL,
            game_name="Test Game",
            share_type="annotation_playback",
        )
        assert "share_token" in share
        assert share["recipient_email"] == RECIPIENT_EMAIL

        record = get_game_share_by_token(share["share_token"])
        assert record is not None
        assert record["share_type"] == "annotation_playback"

    def test_defaults_to_game_share_type(self, isolated_auth_db):
        from app.services.sharing_db import create_game_share, get_game_share_by_token

        share = create_game_share(
            game_id=1,
            tag_name=None,
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=RECIPIENT_EMAIL,
        )
        record = get_game_share_by_token(share["share_token"])
        assert record["share_type"] == "game"

    def test_share_type_stored_in_shares_table(self, isolated_auth_db):
        from app.services.sharing_db import create_game_share
        from app.services.pg import get_pg

        share = create_game_share(
            game_id=1,
            tag_name="",
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            share_type="annotation_playback",
        )
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT share_type FROM shares WHERE share_token = %s",
                (share["share_token"],),
            )
            row = cur.fetchone()
            assert row["share_type"] == "annotation_playback"


# ---------------------------------------------------------------------------
# POST /api/games/{id}/share-playback endpoint tests
# ---------------------------------------------------------------------------

class TestSharePlaybackEndpoint:
    def test_creates_share_and_sends_email(self, client):
        game_id = _seed_game_with_clips()
        resp = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["all_sent"] is True
        assert len(data["results"]) == 1
        assert data["results"][0]["email"] == UNKNOWN_EMAIL
        assert data["results"][0]["sent"] is True

        client._mock_email.assert_called_once()
        call_kwargs = client._mock_email.call_args
        assert call_kwargs.kwargs["recipient_email"] == UNKNOWN_EMAIL
        assert call_kwargs.kwargs["game_name"] == "Test Game"

    def test_creates_shares_row_with_annotation_playback_type(self, client):
        from app.services.sharing_db import list_shares_for_game
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        shares = list_shares_for_game(game_id, SHARER_ID)
        assert len(shares) == 1
        assert shares[0]["share_type"] == "annotation_playback"

    def test_creates_share_games_row_with_game_id(self, client):
        from app.services.sharing_db import get_game_share_by_token, list_shares_for_game
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        shares = list_shares_for_game(game_id, SHARER_ID)
        token = shares[0]["share_token"]
        record = get_game_share_by_token(token)
        assert record["game_id"] == game_id
        assert record["game_name"] == "Test Game"

    def test_creates_pending_share_for_non_user(self, client):
        from app.services.sharing_db import get_pending_shares_for_email
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        pending = get_pending_shares_for_email(UNKNOWN_EMAIL)
        assert len(pending) == 1
        assert pending[0]["game_id"] == game_id

    def test_pending_share_contains_clip_data(self, client):
        from app.services.sharing_db import get_pending_shares_for_email
        from app.utils.encoding import decode_data
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        pending = get_pending_shares_for_email(UNKNOWN_EMAIL)
        clip_data = decode_data(bytes(pending[0]["clip_data"]))
        assert len(clip_data) == 3
        assert clip_data[0]["name"] == "Clip 1"

    def test_duplicate_share_reuses_token(self, client):
        from app.services.sharing_db import list_shares_for_game
        game_id = _seed_game_with_clips()

        resp1 = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp1.status_code == 200

        resp2 = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp2.status_code == 200

        shares = list_shares_for_game(game_id, SHARER_ID)
        assert len(shares) == 1

    def test_duplicate_share_does_not_resend_email(self, client):
        game_id = _seed_game_with_clips()

        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        client._mock_email.reset_mock()

        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        client._mock_email.assert_not_called()

    def test_returns_404_for_nonexistent_game(self, client):
        resp = client.post(
            "/api/games/99999/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 404

    def test_multiple_emails_creates_multiple_shares(self, client):
        from app.services.sharing_db import list_shares_for_game
        game_id = _seed_game_with_clips()
        resp = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL, "other@example.com"]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 2
        assert data["all_sent"] is True

        shares = list_shares_for_game(game_id, SHARER_ID)
        assert len(shares) == 2

    def test_email_failure_revokes_share(self, client):
        from app.services.sharing_db import list_shares_for_game
        client._mock_email.return_value = False

        game_id = _seed_game_with_clips()
        resp = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["all_sent"] is False
        assert data["results"][0]["sent"] is False

        shares = list_shares_for_game(game_id, SHARER_ID)
        assert len(shares) == 1
        assert shares[0]["revoked_at"] is not None

    def test_share_games_stores_clip_names(self, client):
        from app.services.sharing_db import get_game_share_by_token, list_shares_for_game
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        shares = list_shares_for_game(game_id, SHARER_ID)
        record = get_game_share_by_token(shares[0]["share_token"])
        clip_names = record["clip_names"]
        if isinstance(clip_names, str):
            clip_names = json.loads(clip_names)
        assert clip_names == ["Clip 1", "Clip 2", "Clip 3"]

    def test_share_games_stores_first_clip_start(self, client):
        from app.services.sharing_db import get_game_share_by_token, list_shares_for_game
        game_id = _seed_game_with_clips()
        client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        shares = list_shares_for_game(game_id, SHARER_ID)
        record = get_game_share_by_token(shares[0]["share_token"])
        assert record["first_clip_start"] == 0.0

    def test_materializes_for_single_profile_recipient(self, client):
        game_id = _seed_game_with_clips()
        mock_materialize = MagicMock(return_value={"game_id": game_id, "inserted": 3, "merged": 0, "skipped": False})
        with patch("app.services.user_db.get_profiles", return_value=[{"id": "testdefault"}]), \
             patch("app.services.materialization.materialize_game_share", mock_materialize):
            resp = client.post(
                f"/api/games/{game_id}/share-playback",
                json={"emails": [RECIPIENT_EMAIL]},
                headers=_auth_headers(SHARER_ID),
            )
        assert resp.status_code == 200
        mock_materialize.assert_called_once()
        call_kwargs = mock_materialize.call_args.kwargs
        assert call_kwargs["sharer_user_id"] == SHARER_ID
        assert call_kwargs["recipient_user_id"] == RECIPIENT_ID
        assert call_kwargs["game_id"] == game_id
        assert call_kwargs["tag_name"] == ""


# ---------------------------------------------------------------------------
# GET /api/shared/teammate/{token} tests
# ---------------------------------------------------------------------------

class TestGetSharedTeammateAnnotationPlayback:
    def test_accepts_annotation_playback_share_type(self, client):
        from app.services.sharing_db import create_game_share
        share = create_game_share(
            game_id=1,
            tag_name="",
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            game_name="Test Game",
            game_blake3="abc123",
            clip_names=["Clip 1", "Clip 2"],
            share_type="annotation_playback",
        )
        resp = client.get(f"/api/shared/teammate/{share['share_token']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["game_name"] == "Test Game"
        assert data["sharer_email"] == SHARER_EMAIL
        assert data["clip_count"] == 2
        assert data["clip_names"] == ["Clip 1", "Clip 2"]

    def test_returns_valid_data_for_annotation_playback(self, client):
        from app.services.sharing_db import create_game_share
        share = create_game_share(
            game_id=1,
            tag_name="",
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            game_name="Test Game",
            share_type="annotation_playback",
        )
        resp = client.get(f"/api/shared/teammate/{share['share_token']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["materialized"] is False
        assert data["recipient_has_account"] is False

    def test_still_accepts_game_share_type(self, client):
        from app.services.sharing_db import create_game_share
        share = create_game_share(
            game_id=1,
            tag_name=None,
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            game_name="A Game",
            share_type="game",
        )
        resp = client.get(f"/api/shared/teammate/{share['share_token']}")
        assert resp.status_code == 200

    def test_rejects_video_share_type(self, client):
        from app.services.sharing_db import create_game_share
        share = create_game_share(
            game_id=1,
            tag_name=None,
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            share_type="video",
        )
        resp = client.get(f"/api/shared/teammate/{share['share_token']}")
        assert resp.status_code == 404

    def test_revoked_annotation_playback_returns_410(self, client):
        from app.services.sharing_db import create_game_share, revoke_share
        share = create_game_share(
            game_id=1,
            tag_name="",
            sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault",
            recipient_email=UNKNOWN_EMAIL,
            share_type="annotation_playback",
        )
        revoke_share(share["share_token"], SHARER_ID)
        resp = client.get(f"/api/shared/teammate/{share['share_token']}")
        assert resp.status_code == 410

    def test_nonexistent_token_returns_404(self, client):
        resp = client.get("/api/shared/teammate/nonexistent-token-xyz")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Email template tests
# ---------------------------------------------------------------------------

class TestPlaybackShareEmail:
    @pytest.mark.asyncio
    async def test_send_playback_share_email_dev_mode(self, isolated_auth_db):
        import os
        with patch.dict(os.environ, {"RESEND_API_KEY": ""}, clear=False):
            from app.services.email import send_playback_share_email
            result = await send_playback_share_email(
                recipient_email="test@example.com",
                sharer_email="sharer@example.com",
                game_name="Big Game",
                share_token="test-token-123",
            )
            assert result is True

    @pytest.mark.asyncio
    async def test_send_playback_share_email_with_api_key(self, isolated_auth_db):
        import os

        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key"}, clear=False), \
             patch("app.services.email.retry_async_call", new_callable=AsyncMock, return_value=mock_response) as mock_retry:
            from app.services.email import send_playback_share_email
            result = await send_playback_share_email(
                recipient_email="test@example.com",
                sharer_email="sharer@example.com",
                game_name="Big Game",
                share_token="test-token-123",
            )
            assert result is True
            mock_retry.assert_called_once()
            call_args = mock_retry.call_args
            assert call_args.kwargs["operation"] == "resend_playback_share"

    @pytest.mark.asyncio
    async def test_send_playback_share_email_failure(self, isolated_auth_db):
        import os

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        with patch.dict(os.environ, {"RESEND_API_KEY": "re_test_key"}, clear=False), \
             patch("app.services.email.retry_async_call", new_callable=AsyncMock, return_value=mock_response):
            from app.services.email import send_playback_share_email
            result = await send_playback_share_email(
                recipient_email="test@example.com",
                sharer_email="sharer@example.com",
                game_name="Big Game",
                share_token="test-token-123",
            )
            assert result is False


# ---------------------------------------------------------------------------
# Migration test
# ---------------------------------------------------------------------------

class TestV003Migration:
    def test_migration_adds_annotation_playback_to_constraint(self, pg_conn):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO users (user_id, email) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                ("migration-test-user", "migration@test.com"),
            )
            cur.execute(
                """INSERT INTO shares (share_token, share_type, sharer_user_id, sharer_profile_id, recipient_email)
                   VALUES (%s, %s, %s, %s, %s)""",
                ("migration-test-token", "annotation_playback", "migration-test-user", "p1", "test@test.com"),
            )
            cur.execute(
                "SELECT share_type FROM shares WHERE share_token = %s",
                ("migration-test-token",),
            )
            row = cur.fetchone()
            assert row["share_type"] == "annotation_playback"

            # Cleanup
            cur.execute("DELETE FROM shares WHERE share_token = %s", ("migration-test-token",))
            cur.execute("DELETE FROM users WHERE user_id = %s", ("migration-test-user",))
