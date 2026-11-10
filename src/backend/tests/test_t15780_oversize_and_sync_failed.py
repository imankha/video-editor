"""T15780: a 10GB+ game file must be refused with a reason a parent can act
on, and a prepare 500 from CreateMultipartUpload must carry its cause.

Prod pull (2026-10-20 to 2026-11-09): two users' 10GB+ game files hit
`games_upload.py`'s "Invalid file size. Must be between 1 byte and 10GB."
with no next step, and one 29MB upload's `CreateMultipartUpload` 500'd with
`error_text` empty -- the only evidence (the ephemeral log line, T12890) was
already gone.

Contract pinned here:
  1. The server refusal text names the limit and a next step, never the
     old bare "Invalid file size..." sentence (games_upload.py L~334).
  2. `r2_create_multipart_upload` exposes the exception class/message it
     logged via an `error_out` dict, instead of only logging it.
  3. The `sync_failed` row prepare-upload writes when CreateMultipartUpload
     fails carries that `error_text`.
  4. A client pre-flight refusal (`upload-failure-beacon`, reason
     size_over_cap) books a terminal row with no blake3_hash and never
     books `game_upload_attempted` (that milestone only fires deep inside
     prepare-upload's success path, which a pre-flight refusal never calls).

Run with: pytest src/backend/tests/test_t15780_oversize_and_sync_failed.py -v
"""
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import botocore.exceptions
import pytest

import app.storage as storage
from app.database import USER_DATA_BASE

TEST_USER_ID = f"test_t15780_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
ROUTER = "app.routers.games_upload"


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    import shutil

    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _client(**headers):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID, **headers})


@pytest.fixture(autouse=True)
def _r2_enabled(monkeypatch):
    monkeypatch.setattr(f"{ROUTER}.R2_ENABLED", True, raising=False)
    yield


@pytest.fixture(autouse=True)
def _pg_user(pg_conn):
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (TEST_USER_ID,))
        already_exists = cur.fetchone() is not None
    if not already_exists:
        create_user(TEST_USER_ID, email=f"{TEST_USER_ID}@test.com")
        from tests.conftest import register_test_user_ids

        register_test_user_ids(TEST_USER_ID)
        create_user_segment(TEST_USER_ID, "organic", None, "otp")
    yield


def _new_hash() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


def _failure_rows(**where) -> list[dict]:
    from app.services.pg import get_pg

    column, value = next(iter(where.items()))
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM upload_failures WHERE {column} = %s ORDER BY id", (value,))
        return [dict(r) for r in cur.fetchall()]


def _attempted_count() -> int:
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) AS c FROM user_actions "
            "WHERE user_id = %s AND action = 'game_upload_attempted'",
            (TEST_USER_ID,),
        )
        return int(cur.fetchone()["c"])


# ---------------------------------------------------------------------------
# AC1/AC4: the server refusal copy
# ---------------------------------------------------------------------------

def test_oversize_refusal_names_the_limit_and_a_next_step():
    blake3_hash = _new_hash()
    with _client() as client:
        resp = client.post("/api/games/prepare-upload", json={
            "blake3_hash": blake3_hash,
            "file_size": 11 * 1024 * 1024 * 1024,  # 11GB, over the 10GB cap
            "original_filename": "DJI_huge.mp4",
            "kind": "game",
        })
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "Invalid file size" not in detail
    assert "10GB" in detail
    # A next step is named (trim / split), not just the bare limit.
    assert "Trim" in detail or "split" in detail


# ---------------------------------------------------------------------------
# AC3: error_text on the sync_failed row
# ---------------------------------------------------------------------------

def test_r2_create_multipart_upload_exposes_error_text_on_non_transient_rejection():
    """Storage-level: a definitive rejection (403) fills error_out, not just the log."""
    key = "games/deadbeef.mp4"
    client = MagicMock()
    client.create_multipart_upload.side_effect = botocore.exceptions.ClientError(
        {"Error": {"Code": "403", "Message": "AccessDenied"}},
        "CreateMultipartUpload",
    )
    error_out: dict = {}

    with patch("app.storage.get_r2_client", return_value=client):
        result = storage.r2_create_multipart_upload(key, error_out=error_out)

    assert result is None
    assert "ClientError" in error_out.get("error_text", "")
    assert "403" in error_out["error_text"] or "AccessDenied" in error_out["error_text"]


def test_r2_create_multipart_upload_success_leaves_error_out_untouched():
    key = "games/deadbeef.mp4"
    client = MagicMock()
    client.create_multipart_upload.return_value = {"UploadId": "up-1"}
    error_out: dict = {}

    with patch("app.storage.get_r2_client", return_value=client):
        result = storage.r2_create_multipart_upload(key, error_out=error_out)

    assert result == "up-1"
    assert error_out == {}


def test_prepare_upload_sync_failed_row_carries_error_text(monkeypatch):
    """Integration: a prepare-upload whose CreateMultipartUpload fails writes
    a sync_failed row with error_text naming the exception."""
    blake3_hash = _new_hash()
    monkeypatch.setattr(f"{ROUTER}.r2_head_object_global", lambda key: None)
    monkeypatch.setattr(f"{ROUTER}.get_credit_balance", lambda user_id: {"balance": 10**9})

    def _fake_create(key, content_type="video/mp4", error_out=None):
        if error_out is not None:
            error_out["error_text"] = "ClientError: An error occurred (403) AccessDenied"
        return None

    monkeypatch.setattr(f"{ROUTER}.r2_create_multipart_upload", _fake_create)

    with _client() as client:
        resp = client.post("/api/games/prepare-upload", json={
            "blake3_hash": blake3_hash, "file_size": 29 * 1024 * 1024,
            "original_filename": "samuel_game.mp4", "kind": "game",
        })

    assert resp.status_code == 500, resp.text
    rows = _failure_rows(blake3_hash=blake3_hash)
    sync_failed = [r for r in rows if r["reason"] == "sync_failed"]
    assert len(sync_failed) == 1, rows
    assert sync_failed[0]["error_text"] == "ClientError: An error occurred (403) AccessDenied"
    assert sync_failed[0]["http_status"] == 500


# ---------------------------------------------------------------------------
# AC2: the client pre-flight beacon
# ---------------------------------------------------------------------------

def test_size_over_cap_beacon_books_terminal_row_with_no_hash_and_no_attempt():
    before = _attempted_count()
    with _client() as client:
        resp = client.post("/api/games/upload-failure-beacon", json={
            "phase": "preparing", "reason": "size_over_cap", "kind": "game",
            "original_filename": "11 8 26.mp4", "file_size": 24_500_000_000,
            "server_responded": False,
        })
    assert resp.status_code == 204, resp.text

    rows = [r for r in _failure_rows(user_id=TEST_USER_ID) if r["reason"] == "size_over_cap"]
    assert rows, "no size_over_cap row written"
    row = rows[-1]
    assert row["stage"] == "preparing"
    assert row["terminal"] is True
    assert row["origin"] == "beacon"
    assert row["blake3_hash"] is None
    assert row["file_size"] == 24_500_000_000

    # The pre-flight refusal never calls prepare-upload, so it never books
    # the attempted milestone.
    assert _attempted_count() == before
