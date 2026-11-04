"""T15020: two concurrent upload flows for the SAME file must converge on one
durable outcome instead of recording each other as failures.

Prod incident 2026-11-04 (cometlawal, Chromebook, Veo zip of ~30 clips): a second
clip batch for the same files started while the first was still running (the
empty-state "Add Video" button stayed clickable). prepare-upload handed the
second flow the first flow's session (resume), so whichever finalize ran second
found the pending row already deleted -> 404 session_not_found, recorded as
`game_upload_failed:refused` (kind unknown -> GAME default) for what was a clip
upload whose bytes were already durable. Its part PUTs 404'd (NoSuchUpload) once
the first flow completed the multipart, and its PATCH /parts 404'd too -- each one
a terminal failure in the aggregate. Upload success rate read 43.8% that day
from ONE user whose every file actually landed.

Contract pinned here (games_upload.py):
  1. finalize-upload with no pending row, given the client's blake3_hash + kind,
     HEADs the object: present -> 200 SUCCESS (already_finalized), no failure.
  2. finalize-upload with no pending row and no object -> 404 as before, but the
     failure is recorded with the CLIENT-declared kind, never the GAME default.
  3. finalize-upload whose CompleteMultipartUpload fails but whose object is
     already on R2 at the expected size (the other flow completed it) -> 200.
  4. PATCH /upload/{session}/parts on a missing session is NOT a terminal
     failure: the flow's outcome is decided at finalize.

Run with: pytest src/backend/tests/test_t15020_concurrent_upload_flows.py -v
"""
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE, get_db_connection

TEST_USER_ID = f"test_t15020_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
SIX_MB = 6 * 1024 * 1024


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


def _failure_rows(session_id: str) -> list[dict]:
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT kind, stage, reason, terminal FROM upload_failures "
            "WHERE upload_session_id = %s ORDER BY id",
            (session_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def _milestone_count(action: str) -> int:
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) AS c FROM user_actions WHERE user_id = %s AND action = %s",
            (TEST_USER_ID, action),
        )
        return int(cur.fetchone()["c"])


def _insert_pending(session_id: str, blake3_hash: str, upload_id: str, kind: str = "clip"):
    from app.utils.encoding import encode_data

    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO pending_uploads
               (id, blake3_hash, file_size, original_filename, r2_upload_id, parts_json, kind)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, blake3_hash, SIX_MB, "clip.mp4", upload_id, encode_data([]), kind),
        )
        conn.commit()


def _pending_exists(session_id: str) -> bool:
    with get_db_connection() as conn:
        row = conn.execute("SELECT 1 FROM pending_uploads WHERE id = ?", (session_id,)).fetchone()
        return row is not None


class TestFinalizeAfterConcurrentFlow:
    def test_missing_session_but_object_landed_is_success_not_failure(self, monkeypatch):
        """Contract 1: the other flow already finalized this file (row gone, bytes
        durable). The duplicate finalize answers SUCCESS and records nothing."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        session_id = f"upload_{uuid.uuid4().hex}"
        seen_keys = []

        def _head(key):
            seen_keys.append(key)
            return {"ContentLength": SIX_MB}

        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", _head)
        refused_before = _milestone_count("game_upload_failed:refused")

        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "etag1"}],
                "blake3_hash": blake3_hash,
                "kind": "clip",
            })

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "success"
        assert body["blake3_hash"] == blake3_hash
        assert body["kind"] == "clip"
        assert body["already_finalized"] is True
        # HEAD went to the CLIP namespace for this user, never games/{hash}.
        assert seen_keys and all("raw_clips/" in k and blake3_hash in k for k in seen_keys), seen_keys
        assert _failure_rows(session_id) == []
        assert _milestone_count("game_upload_failed:refused") == refused_before

    def test_missing_session_and_no_object_records_client_kind(self, monkeypatch):
        """Contract 2: a genuinely lost session is still a 404, but a CLIP upload is
        recorded as a clip failure -- it must not inflate the game upload rate."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        session_id = f"upload_{uuid.uuid4().hex}"
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: None)
        game_refused_before = _milestone_count("game_upload_failed:refused")

        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "etag1"}],
                "blake3_hash": blake3_hash,
                "kind": "clip",
            })

        assert resp.status_code == 404, resp.text
        rows = _failure_rows(session_id)
        assert rows == [{"kind": "clip", "stage": "finalizing", "reason": "session_not_found", "terminal": True}], rows
        assert _milestone_count("game_upload_failed:refused") == game_refused_before

    def test_pre_t15020_client_without_hash_still_gets_404_under_game_default(self, monkeypatch):
        """A finalize body with no hash/kind (a build older than T15020) cannot be
        answered by HEAD: it stays the historical 404, filed under GAME, and the
        HEAD helper is never called with nothing to look up."""
        session_id = f"upload_{uuid.uuid4().hex}"
        heads = []
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: heads.append(key))

        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "etag1"}],
            })

        assert resp.status_code == 404, resp.text
        assert heads == []
        rows = _failure_rows(session_id)
        assert rows == [{"kind": "game", "stage": "finalizing", "reason": "session_not_found", "terminal": True}], rows

    def test_game_milestone_fires_once_per_released_row(self, monkeypatch):
        """A GAME finalize emits game_upload_succeeded exactly once; the duplicate
        finalize for the same session (row gone, object landed) emits nothing."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        session_id = f"upload_{uuid.uuid4().hex}"
        _insert_pending(session_id, blake3_hash, f"upl_{uuid.uuid4().hex}", kind="game")
        monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: True)
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: {"ContentLength": SIX_MB})
        monkeypatch.setattr("app.routers.games_upload.r2_set_object_metadata_global", lambda *a, **k: True)
        before = _milestone_count("game_upload_succeeded")
        body = {
            "upload_session_id": session_id,
            "parts": [{"part_number": 1, "etag": "etag1"}],
            "blake3_hash": blake3_hash,
            "kind": "game",
        }

        with _client() as client:
            first = client.post("/api/games/finalize-upload", json=body)
            second = client.post("/api/games/finalize-upload", json=body)

        assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
        assert second.json()["already_finalized"] is True
        assert _milestone_count("game_upload_succeeded") == before + 1
        assert _failure_rows(session_id) == []

    def test_complete_fails_but_object_landed_is_success(self, monkeypatch):
        """Contract 3: CompleteMultipartUpload fails (the other flow completed the
        same multipart first) but HEAD shows the object at the expected size."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        session_id = f"upload_{uuid.uuid4().hex}"
        _insert_pending(session_id, blake3_hash, f"upl_{uuid.uuid4().hex}", kind="clip")

        aborted = []
        monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: False)
        monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload",
                            lambda key, upload_id: aborted.append(upload_id) or True)
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global",
                            lambda key: {"ContentLength": SIX_MB})
        metadata_calls = []
        monkeypatch.setattr("app.routers.games_upload.r2_set_object_metadata_global",
                            lambda key, meta: metadata_calls.append(key) or True)

        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "etag1"}],
                "blake3_hash": blake3_hash,
                "kind": "clip",
            })

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "success"
        assert resp.json()["file_size"] == SIX_MB
        assert not _pending_exists(session_id), "the pending row is released once the bytes are durable"
        assert aborted == [], "never abort a multipart whose object already landed"
        assert metadata_calls == [], "the flow that completed the multipart owns the object metadata"
        assert _failure_rows(session_id) == []


class TestSavePartsOnMissingSession:
    def test_missing_session_is_recorded_non_terminal(self):
        """Contract 4: the resume-state save for a session another flow already
        finalized is a 404 the client tolerates; it must not count as a terminal
        upload failure (that verdict belongs to finalize)."""
        session_id = f"upload_{uuid.uuid4().hex}"
        refused_before = _milestone_count("game_upload_failed:refused")

        with _client() as client:
            resp = client.patch(f"/api/games/upload/{session_id}/parts", json={
                "parts": [{"part_number": 1, "etag": "etag1"}],
            })

        assert resp.status_code == 404, resp.text
        rows = _failure_rows(session_id)
        assert len(rows) == 1 and rows[0]["reason"] == "session_not_found", rows
        assert rows[0]["terminal"] is False
        assert _milestone_count("game_upload_failed:refused") == refused_before
