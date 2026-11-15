"""T2580: every finalized upload gets a stored yes/no for "index (moov) at the
front", read from ONE small ranged GET of the object's head -- never a full
download -- and the admin upload-failures endpoint reports how many recent
uploads cannot start at once.

Run with: pytest src/backend/tests/test_t2580_upload_index_check.py -v
"""
import io
import shutil
import struct
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE, get_db_connection

TEST_USER_ID = f"test_t2580_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
SIX_MB = 6 * 1024 * 1024


def _box(btype: bytes, payload_len: int) -> bytes:
    return struct.pack(">I", 8 + payload_len) + btype + b"\0" * payload_len


# ftyp, then moov before mdat: plays at once.
FASTSTART_HEAD = _box(b"ftyp", 24) + _box(b"moov", 400) + _box(b"mdat", 200)
# ftyp, free, then mdat first (moov at the end of the file): cannot start at once.
MOOV_AT_END_HEAD = _box(b"ftyp", 24) + _box(b"free", 0) + _box(b"mdat", 200)


class _FakeR2:
    """Records every get_object call; serves a ranged slice of `data`."""

    def __init__(self, data: bytes):
        self.data = data
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        rng = kwargs.get("Range")
        if rng is None:
            body = self.data
        else:
            start, end = rng.removeprefix("bytes=").split("-")
            body = self.data[int(start):int(end) + 1]
        return {"Body": io.BytesIO(body)}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


@pytest.fixture(autouse=True)
def _r2_guard_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.games_upload.R2_ENABLED", True, raising=False)
    yield


@pytest.fixture(autouse=True)
def _pg_user(pg_conn):
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    from tests.conftest import register_test_user_ids

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (TEST_USER_ID,))
        already_exists = cur.fetchone() is not None
    if not already_exists:
        create_user(TEST_USER_ID, email=f"{TEST_USER_ID}@test.com")
        register_test_user_ids(TEST_USER_ID)
        create_user_segment(TEST_USER_ID, "organic", None, "otp")
    yield


def _insert_pending(session_id: str, blake3_hash: str, kind: str):
    from app.utils.encoding import encode_data

    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO pending_uploads
               (id, blake3_hash, file_size, original_filename, r2_upload_id, parts_json, kind)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, blake3_hash, SIX_MB, "video.mp4", f"upl_{uuid.uuid4().hex}",
             encode_data([]), kind),
        )
        conn.commit()


def _stored_verdicts(blake3_hash: str) -> list[dict]:
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, kind, index_at_front FROM upload_index_checks WHERE blake3_hash = %s",
            (blake3_hash,),
        )
        return [dict(r) for r in cur.fetchall()]


def _finalize(monkeypatch, head_bytes: bytes, kind: str):
    fake = _FakeR2(head_bytes)
    monkeypatch.setattr("app.services.upload_index_check.get_r2_client", lambda: fake)
    monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: True)
    monkeypatch.setattr("app.routers.games_upload.r2_head_object_global",
                        lambda key: {"ContentLength": SIX_MB})
    blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
    session_id = f"upload_{uuid.uuid4().hex}"
    _insert_pending(session_id, blake3_hash, kind)
    with _client() as client:
        resp = client.post("/api/games/finalize-upload", json={
            "upload_session_id": session_id,
            "parts": [{"part_number": 1, "etag": "etag1"}],
            "blake3_hash": blake3_hash,
            "kind": kind,
        })
    assert resp.status_code == 200, resp.text
    return blake3_hash, fake


class TestFinalizeStoresVerdict:
    """T2580:C1 -- every newly finalized upload has a stored yes or no."""

    def test_faststart_game_is_stored_yes(self, monkeypatch):
        blake3_hash, _ = _finalize(monkeypatch, FASTSTART_HEAD, "game")
        assert _stored_verdicts(blake3_hash) == [
            {"user_id": TEST_USER_ID, "kind": "game", "index_at_front": True}]

    def test_moov_at_end_clip_is_stored_no(self, monkeypatch):
        blake3_hash, _ = _finalize(monkeypatch, MOOV_AT_END_HEAD, "clip")
        assert _stored_verdicts(blake3_hash) == [
            {"user_id": TEST_USER_ID, "kind": "clip", "index_at_front": False}]


class TestOneRangedRead:
    """T2580:C3 -- the check is one small ranged read, never a full download."""

    def test_finalize_reads_only_the_head_once(self, monkeypatch):
        _, fake = _finalize(monkeypatch, FASTSTART_HEAD + b"\0" * SIX_MB, "game")
        assert len(fake.calls) == 1
        rng = fake.calls[0].get("Range")
        assert rng is not None, "the check downloaded the whole object"
        start, end = rng.removeprefix("bytes=").split("-")
        assert int(start) == 0 and int(end) + 1 <= 64 * 1024


class TestBoxWalk:
    def test_verdicts(self):
        from app.services.upload_index_check import index_at_front

        assert index_at_front(FASTSTART_HEAD) is True
        assert index_at_front(MOOV_AT_END_HEAD) is False
        # Fragmented MP4 carries its (small) moov ahead of the first moof.
        assert index_at_front(_box(b"ftyp", 24) + _box(b"moov", 100) + _box(b"moof", 50)) is True
        # Not an MP4 at all: no index at the front.
        assert index_at_front(b"\x1aE\xdf\xa3" + b"\0" * 100) is False
        # A 64-bit largesize mdat ahead of moov.
        big_mdat = struct.pack(">I", 1) + b"mdat" + struct.pack(">Q", 10**9)
        assert index_at_front(_box(b"ftyp", 24) + big_mdat) is False


class TestAdminPanelCount:
    """T2580:C2 (backend half) -- the admin upload-failures payload counts
    recent uploads whose index is not at the front."""

    def test_index_checks_counts(self, monkeypatch):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS c, COUNT(*) FILTER (WHERE NOT index_at_front) AS n "
                        "FROM upload_index_checks WHERE checked_at::date = CURRENT_DATE")
            before = cur.fetchone()
        _finalize(monkeypatch, FASTSTART_HEAD, "game")
        _finalize(monkeypatch, MOOV_AT_END_HEAD, "game")
        _finalize(monkeypatch, MOOV_AT_END_HEAD, "clip")

        monkeypatch.setattr("app.routers.admin._require_admin", lambda: None)
        with _client() as client:
            resp = client.get("/api/admin/upload-failures")
        assert resp.status_code == 200, resp.text
        checks = resp.json()["index_checks"]
        assert checks["checked"] == before["c"] + 3
        assert checks["not_at_front"] == before["n"] + 2
