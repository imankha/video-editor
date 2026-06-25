"""
Tests for T3970: Expired game - block sharing, allow annotation playback.

Covers the backend expiry guard added to:
- POST /api/games/{id}/share          (game-only share)
- POST /api/games/{id}/share-playback (annotation playback share)

Both endpoints must reject a game whose storage has expired
(game_storage.storage_expires_at < utcnow) with HTTP 410, while an active
(non-expired) game stays shareable. Annotation/recap playback endpoints are
intentionally left open and are NOT exercised here.

NOTE: This suite is written but NOT run in-container -- the backend test suite
truncates the shared dev Postgres. Run it in CI / a safe env.
"""

import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"
UNKNOWN_EMAIL = "stranger@example.com"

EXPIRED_HASH = "expiredhash3970"
ACTIVE_HASH = "activehash3970"


# ---------------------------------------------------------------------------
# Fixtures (mirror tests/test_share_playback.py)
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

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
         patch("app.services.email.send_playback_share_email", new_callable=AsyncMock, return_value=True), \
         patch("app.services.email.send_game_share_email", new_callable=AsyncMock, return_value=True):
        from app.main import app
        c = TestClient(app, raise_server_exceptions=True)
        yield c


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _seed_game(blake3: str, expires_at: datetime | None, user_id: str = SHARER_ID) -> int:
    """Insert a game (+video, +clips) and, if expires_at given, a game_storage
    row pinning its storage expiry. Returns the game_id."""
    from app.database import get_db_connection
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("Test Game", blake3),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (game_id, blake3, 1),
        )
        for i in range(3):
            cursor.execute(
                """INSERT INTO raw_clips (game_id, filename, name, tags, rating, start_time, end_time, video_sequence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (game_id, f"clip_{i+1}.mp4", f"Clip {i+1}", json.dumps(["Jake"]), 3, i * 10.0, i * 10.0 + 5.0, 1),
            )
        if expires_at is not None:
            cursor.execute(
                """INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at)
                   VALUES (?, ?, ?)""",
                (blake3, 1000, expires_at.isoformat()),
            )
        conn.commit()
        return game_id


def _past() -> datetime:
    return datetime.utcnow() - timedelta(days=1)


def _future() -> datetime:
    return datetime.utcnow() + timedelta(days=30)


# ---------------------------------------------------------------------------
# Expired games are blocked from sharing
# ---------------------------------------------------------------------------

class TestExpiredGameShareBlocked:
    def test_share_game_rejects_expired(self, client):
        game_id = _seed_game(EXPIRED_HASH, _past())
        resp = client.post(
            f"/api/games/{game_id}/share",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 410
        assert "expired" in resp.json()["detail"].lower()

    def test_share_playback_rejects_expired(self, client):
        game_id = _seed_game(EXPIRED_HASH, _past())
        resp = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 410
        assert "expired" in resp.json()["detail"].lower()

    def test_expired_share_creates_no_share_row(self, client):
        from app.services.sharing_db import list_shares_for_game
        game_id = _seed_game(EXPIRED_HASH, _past())
        client.post(
            f"/api/games/{game_id}/share",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert list_shares_for_game(game_id, SHARER_ID) == []


# ---------------------------------------------------------------------------
# Active games stay shareable
# ---------------------------------------------------------------------------

class TestActiveGameStillShareable:
    def test_share_game_allows_active_future_expiry(self, client):
        game_id = _seed_game(ACTIVE_HASH, _future())
        resp = client.post(
            f"/api/games/{game_id}/share",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        assert resp.json()["all_sent"] is True

    def test_share_game_allows_when_no_storage_row(self, client):
        # No game_storage row at all => not expired.
        game_id = _seed_game(ACTIVE_HASH, None)
        resp = client.post(
            f"/api/games/{game_id}/share",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200

    def test_share_playback_allows_active(self, client):
        game_id = _seed_game(ACTIVE_HASH, _future())
        resp = client.post(
            f"/api/games/{game_id}/share-playback",
            json={"emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        assert resp.json()["all_sent"] is True
