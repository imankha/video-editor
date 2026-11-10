"""T15770: an abandoned upload must reap into a terminal `user_abandoned`
upload_failures row on LOGIN, not only when the user reopens Add Game.

Before this task, the only writer of that terminal row was
`list_pending_uploads` (GET /api/games/pending-uploads), called solely from
useGameUpload.js when the upload surface is opened. A user who never comes
back (build-7102: 4 of 12 uploaders) left the attempt permanently invisible.
`reap_abandoned_pending_uploads` (games_upload.py) is now also called from the
background writes of GET /api/auth/me (login/app-load bootstrap).

Run with: pytest src/backend/tests/test_t15770_login_reap.py -v
"""
import asyncio
import shutil
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_db_connection
from app.services.auth_db import create_user
from app.utils.encoding import encode_data

TEST_USER_ID = f"test_t15770_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "ab12cd34"  # valid 8-char hex for middleware regex


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _make_pending_game(blake3_hash: str, name: str = "Interrupted Upload") -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash, status) VALUES (?, ?, 'pending')",
            (name, blake3_hash),
        )
        conn.commit()
        return cursor.lastrowid


def _make_pending_upload(blake3_hash: str, upload_id: str) -> str:
    session_id = uuid.uuid4().hex
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO pending_uploads
               (id, blake3_hash, file_size, original_filename, r2_upload_id, parts_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (session_id, blake3_hash, 50 * 1024 * 1024, "clip.mp4", upload_id, encode_data([])),
        )
        conn.commit()
    return session_id


def _pending_upload_exists(session_id: str) -> bool:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM pending_uploads WHERE id = ?", (session_id,))
        return cursor.fetchone() is not None


def _upload_failure_reasons(blake3_hash: str) -> list:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT reason FROM upload_failures WHERE user_id = %s AND blake3_hash = %s",
            (TEST_USER_ID, blake3_hash),
        )
        return [r["reason"] for r in cur.fetchall()]


class FakeRequest:
    """Minimal Request stand-in: a pre-resolved session (no cookie lookup needed)."""

    def __init__(self, session: dict):
        self.state = SimpleNamespace(session=session)
        self.headers: dict = {}
        self.cookies: dict = {}


@pytest.mark.asyncio
async def test_login_reaps_abandoned_upload_without_reopening_add_game(monkeypatch, pg_conn):
    import app.routers.auth as auth_mod

    create_user(TEST_USER_ID, email=f"{TEST_USER_ID}@test.com")

    # A stale pending upload: prepare happened, no parts, no finalize -- R2
    # multipart is gone (simulating an abandoned/dead client, T15770's shape).
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    game_id = _make_pending_game(blake3_hash)
    session_id = _make_pending_upload(blake3_hash, f"upl_{uuid.uuid4().hex}")
    monkeypatch.setattr("app.routers.games_upload.r2_is_multipart_upload_valid", lambda key, upload_id: False)
    monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload", lambda key, upload_id: True)

    request = FakeRequest({"user_id": TEST_USER_ID, "email": f"{TEST_USER_ID}@test.com", "terms_accepted_at": "x"})

    # The route itself never calls GET /api/games/pending-uploads -- only its
    # background writes do (login bootstrap), proving the reap does not
    # require the user to reopen Add Game.
    response = await auth_mod.auth_me(request)
    assert response["user_id"] == TEST_USER_ID

    # Drain the background task auth_me scheduled (fire-and-forget in prod;
    # awaited here so the assertion isn't racing it).
    tasks = [t for t in auth_mod._background_tasks if not t.done()]
    await asyncio.gather(*tasks)

    assert not _pending_upload_exists(session_id), "stale pending_uploads row was not reaped on login"
    assert "user_abandoned" in _upload_failure_reasons(blake3_hash), (
        "login must produce the terminal user_abandoned row without the user reopening Add Game"
    )
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM games WHERE id = ?", (game_id,))
        assert cursor.fetchone()["status"] == "upload_failed"
