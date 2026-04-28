"""
T1195: Session durability via per-session R2 objects.

Tests that sessions are persisted to R2 on creation, lazy-restored from R2
on cache+DB miss, and deleted from R2 on all invalidation paths.
"""
import json
from datetime import datetime, timedelta
from io import BytesIO
from unittest.mock import MagicMock, patch, call

import pytest

from app.services import auth_db


class _FakeClientError(Exception):
    def __init__(self, code: str = "500"):
        self.response = {"Error": {"Code": code}}
        super().__init__(f"ClientError {code}")


@pytest.fixture
def temp_auth_db(tmp_path, monkeypatch):
    """Isolated auth DB with R2 disabled by default."""
    db_path = tmp_path / "auth.sqlite"
    monkeypatch.setattr(auth_db, "AUTH_DB_PATH", db_path)
    monkeypatch.setattr(auth_db, "_r2_enabled", lambda: False)
    auth_db.init_auth_db()
    # Clear session cache between tests
    with auth_db._session_cache_lock:
        auth_db._session_cache.clear()
    yield db_path


@pytest.fixture
def r2_mock(monkeypatch):
    """Enable R2 and return a mock client for asserting R2 calls."""
    client = MagicMock()
    client.exceptions.ClientError = _FakeClientError
    monkeypatch.setattr(auth_db, "_r2_enabled", lambda: True)

    with patch("app.storage.get_r2_client", return_value=client), \
         patch("app.storage.R2_BUCKET", "test-bucket"), \
         patch("app.storage.APP_ENV", "test"):
        yield client


# ---------------------------------------------------------------------------
# persist_session_to_r2
# ---------------------------------------------------------------------------

def test_persist_writes_json_to_r2(temp_auth_db, r2_mock):
    """create_session should PutObject a JSON session to R2."""
    auth_db.create_user("u1", email="a@b.com")
    session_id = auth_db.create_session("u1")

    assert r2_mock.put_object.call_count == 1
    kw = r2_mock.put_object.call_args.kwargs
    assert kw["Bucket"] == "test-bucket"
    assert kw["Key"] == f"test/sessions/{session_id}.json"
    assert kw["ContentType"] == "application/json"

    body = json.loads(kw["Body"])
    assert body["user_id"] == "u1"
    assert body["email"] == "a@b.com"
    assert "expires_at" in body
    assert "created_at" in body


def test_persist_skipped_when_r2_disabled(temp_auth_db):
    """With R2 disabled, create_session should not attempt any R2 call."""
    auth_db.create_user("u1", email="a@b.com")
    session_id = auth_db.create_session("u1")
    assert session_id  # session created locally, no error


def test_persist_failure_does_not_break_login(temp_auth_db, r2_mock):
    """If R2 PutObject fails, create_session still succeeds (local DB + cache)."""
    r2_mock.put_object.side_effect = ConnectionError("R2 down")
    auth_db.create_user("u1", email="a@b.com")
    session_id = auth_db.create_session("u1")

    result = auth_db.validate_session(session_id)
    assert result is not None
    assert result["user_id"] == "u1"


# ---------------------------------------------------------------------------
# restore_session_from_r2
# ---------------------------------------------------------------------------

def test_restore_on_cache_and_db_miss(temp_auth_db, r2_mock):
    """validate_session should lazy-restore from R2 when cache + DB miss."""
    expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
    r2_body = json.dumps({
        "user_id": "u1",
        "email": "a@b.com",
        "expires_at": expires_at,
        "created_at": datetime.utcnow().isoformat(),
    }).encode()
    r2_mock.get_object.return_value = {"Body": BytesIO(r2_body)}
    # put_object will be called when we restore and re-insert — but we need
    # the user to exist for the JOIN in subsequent validate calls
    auth_db.create_user("u1", email="a@b.com")
    r2_mock.put_object.reset_mock()

    result = auth_db.validate_session("restored-session-id")

    assert result is not None
    assert result["user_id"] == "u1"
    assert result["email"] == "a@b.com"
    r2_mock.get_object.assert_called_once()
    assert r2_mock.get_object.call_args.kwargs["Key"] == "test/sessions/restored-session-id.json"

    # Second call should hit cache, not R2 again
    r2_mock.get_object.reset_mock()
    result2 = auth_db.validate_session("restored-session-id")
    assert result2 is not None
    assert r2_mock.get_object.call_count == 0


def test_restore_inserts_into_local_db(temp_auth_db, r2_mock):
    """After R2 restore, the session row exists in local SQLite."""
    expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()
    r2_body = json.dumps({
        "user_id": "u1",
        "email": "a@b.com",
        "expires_at": expires_at,
        "created_at": datetime.utcnow().isoformat(),
    }).encode()
    r2_mock.get_object.return_value = {"Body": BytesIO(r2_body)}
    auth_db.create_user("u1", email="a@b.com")

    auth_db.validate_session("local-check-sid")

    with auth_db.get_auth_db() as db:
        row = db.execute(
            "SELECT user_id, expires_at FROM sessions WHERE session_id = ?",
            ("local-check-sid",),
        ).fetchone()
    assert row is not None
    assert row["user_id"] == "u1"


def test_restore_returns_none_on_404(temp_auth_db, r2_mock):
    """If R2 object doesn't exist (404), validate_session returns None."""
    r2_mock.get_object.side_effect = _FakeClientError("404")

    result = auth_db.validate_session("nonexistent-sid")
    assert result is None


def test_restore_returns_none_on_expired_r2_session(temp_auth_db, r2_mock):
    """If the R2 session object has expired, validate_session returns None."""
    expired = (datetime.utcnow() - timedelta(days=1)).isoformat()
    r2_body = json.dumps({
        "user_id": "u1",
        "email": "a@b.com",
        "expires_at": expired,
        "created_at": datetime.utcnow().isoformat(),
    }).encode()
    r2_mock.get_object.return_value = {"Body": BytesIO(r2_body)}

    result = auth_db.validate_session("expired-sid")
    assert result is None


def test_restore_returns_none_on_r2_error(temp_auth_db, r2_mock):
    """Transient R2 errors degrade to None (no crash)."""
    r2_mock.get_object.side_effect = ConnectionError("timeout")

    result = auth_db.validate_session("error-sid")
    assert result is None


# ---------------------------------------------------------------------------
# delete_session_from_r2 — all invalidation paths
# ---------------------------------------------------------------------------

def test_invalidate_session_deletes_from_r2(temp_auth_db, r2_mock):
    """invalidate_session should DeleteObject from R2."""
    auth_db.create_user("u1", email="a@b.com")
    session_id = auth_db.create_session("u1")
    r2_mock.delete_object.reset_mock()

    auth_db.invalidate_session(session_id)

    r2_mock.delete_object.assert_called_once()
    assert r2_mock.delete_object.call_args.kwargs["Key"] == f"test/sessions/{session_id}.json"


def test_invalidate_user_sessions_deletes_all_from_r2(temp_auth_db, r2_mock):
    """invalidate_user_sessions should delete every session from R2."""
    auth_db.create_user("u1", email="a@b.com")
    sid1 = auth_db.create_session("u1")
    sid2 = auth_db.create_session("u1")
    r2_mock.delete_object.reset_mock()

    auth_db.invalidate_user_sessions("u1")

    assert r2_mock.delete_object.call_count == 2
    deleted_keys = {c.kwargs["Key"] for c in r2_mock.delete_object.call_args_list}
    assert f"test/sessions/{sid1}.json" in deleted_keys
    assert f"test/sessions/{sid2}.json" in deleted_keys


def test_delete_failure_does_not_break_invalidation(temp_auth_db, r2_mock):
    """If R2 DeleteObject fails, local invalidation still succeeds."""
    auth_db.create_user("u1", email="a@b.com")
    session_id = auth_db.create_session("u1")
    r2_mock.delete_object.side_effect = ConnectionError("R2 down")

    auth_db.invalidate_session(session_id)

    # Session should be gone locally
    result = auth_db.validate_session(session_id)
    # validate_session will try R2 restore — mock that as 404 too
    r2_mock.get_object.side_effect = _FakeClientError("404")
    result = auth_db.validate_session(session_id)
    assert result is None
