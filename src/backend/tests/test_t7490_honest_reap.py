"""
T7490: Honest reap of stale pending uploads.

`list_pending_uploads` (GET /api/games/pending-uploads) used to silently DELETE a
stale resume record, which left any orphaned games row (still 'pending' from T1540's
annotate-during-upload anchor) invisible on the Games tab forever. The honest reap
must, for each stale row:
  1. Abort the orphaned R2 multipart (best-effort — a failed abort must NOT block),
  2. Flip a matching still-'pending' game to 'upload_failed' so it renders a visible,
     user-actionable card (Retry / Discard),
  3. Delete the dead pending_uploads row.
Idempotent on re-run; a stale row with NO matching game just deletes cleanly; a still
valid upload is left untouched.

Run with: pytest src/backend/tests/test_t7490_honest_reap.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t7490_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "cd34ef56"  # Valid 8-char hex for middleware regex


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from app.database import get_db_connection
from app.utils.encoding import encode_data


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


def _game_status(game_id: int):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()
        return row["status"] if row else None


def _pending_upload_exists(session_id: str) -> bool:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM pending_uploads WHERE id = ?", (session_id,))
        return cursor.fetchone() is not None


def _client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


def _patch_r2(monkeypatch, *, valid: bool, abort_result: bool = True):
    """Control the two R2 helpers list_pending_uploads calls and record abort calls."""
    aborts = []
    monkeypatch.setattr(
        "app.routers.games_upload.r2_is_multipart_upload_valid",
        lambda key, upload_id: valid,
    )

    def _abort(key, upload_id):
        aborts.append((key, upload_id))
        return abort_result

    monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload", _abort)
    return aborts


def test_stale_with_matching_pending_game_marks_failed(monkeypatch):
    """Stale record + matching pending game -> game becomes upload_failed, R2 multipart
    aborted, pending_uploads row deleted."""
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    upload_id = f"upl_{uuid.uuid4().hex}"
    game_id = _make_pending_game(blake3_hash)
    session_id = _make_pending_upload(blake3_hash, upload_id)

    aborts = _patch_r2(monkeypatch, valid=False)

    with _client() as client:
        resp = client.get("/api/games/pending-uploads")

    assert resp.status_code == 200
    # Stale rows never appear in the returned list.
    assert resp.json()["pending_uploads"] == []
    # Orphaned game is now visible via a distinct status.
    assert _game_status(game_id) == "upload_failed"
    # Dead resume record is gone.
    assert not _pending_upload_exists(session_id)
    # The R2 multipart was aborted with the correct key/upload id.
    assert aborts == [(f"games/{blake3_hash}.mp4", upload_id)]


def test_stale_with_no_matching_game_deletes_cleanly(monkeypatch):
    """A stale record with no matching game row just deletes — nothing to preserve."""
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    upload_id = f"upl_{uuid.uuid4().hex}"
    session_id = _make_pending_upload(blake3_hash, upload_id)

    aborts = _patch_r2(monkeypatch, valid=False)

    with _client() as client:
        resp = client.get("/api/games/pending-uploads")

    assert resp.status_code == 200
    assert resp.json()["pending_uploads"] == []
    assert not _pending_upload_exists(session_id)
    assert aborts == [(f"games/{blake3_hash}.mp4", upload_id)]


def test_reap_is_idempotent_on_double_run(monkeypatch):
    """Running the reap twice must not error and must leave the game upload_failed."""
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    game_id = _make_pending_game(blake3_hash)
    _make_pending_upload(blake3_hash, f"upl_{uuid.uuid4().hex}")

    _patch_r2(monkeypatch, valid=False)

    with _client() as client:
        first = client.get("/api/games/pending-uploads")
        second = client.get("/api/games/pending-uploads")

    assert first.status_code == 200
    assert second.status_code == 200
    # Second run has no stale record left; game status is stable.
    assert _game_status(game_id) == "upload_failed"


def test_abort_failure_does_not_block_reap(monkeypatch):
    """A failed R2 abort (returns False) must not stop the game being marked or the
    record being deleted — the response still succeeds."""
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    game_id = _make_pending_game(blake3_hash)
    session_id = _make_pending_upload(blake3_hash, f"upl_{uuid.uuid4().hex}")

    _patch_r2(monkeypatch, valid=False, abort_result=False)

    with _client() as client:
        resp = client.get("/api/games/pending-uploads")

    assert resp.status_code == 200
    assert _game_status(game_id) == "upload_failed"
    assert not _pending_upload_exists(session_id)


def test_retry_reuses_upload_failed_game_no_duplicate(monkeypatch):
    """Retry re-selects the file -> create_game('pending') must resume INTO the
    upload_failed game (same id), flip it back to 'pending', and never spawn a
    duplicate row."""
    blake3_hash = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"[:64]
    game_id = _make_pending_game(blake3_hash)
    _make_pending_upload(blake3_hash, f"upl_{uuid.uuid4().hex}")
    # Reap it to upload_failed.
    _patch_r2(monkeypatch, valid=False)
    with _client() as client:
        client.get("/api/games/pending-uploads")
    assert _game_status(game_id) == "upload_failed"

    # Retry: the re-upload creates a pending game for the same hash.
    with _client() as client:
        resp = client.post(
            "/api/games",
            json={"videos": [{"blake3_hash": blake3_hash, "sequence": 0}], "status": "pending"},
        )
    assert resp.status_code == 200
    assert resp.json()["game_id"] == game_id, "retry spawned a duplicate game"
    assert _game_status(game_id) == "pending", "reused game not reset to pending"

    # Exactly one game row for this hash.
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM games WHERE blake3_hash = ?", (blake3_hash,))
        assert cursor.fetchone()[0] == 1


def test_valid_upload_is_not_reaped(monkeypatch):
    """A still-valid multipart is returned as resumable and left completely untouched."""
    blake3_hash = f"hash_{uuid.uuid4().hex[:32]}"
    game_id = _make_pending_game(blake3_hash)
    session_id = _make_pending_upload(blake3_hash, f"upl_{uuid.uuid4().hex}")

    aborts = _patch_r2(monkeypatch, valid=True)

    with _client() as client:
        resp = client.get("/api/games/pending-uploads")

    assert resp.status_code == 200
    sessions = {u["session_id"] for u in resp.json()["pending_uploads"]}
    assert session_id in sessions
    # Untouched: game still pending, record still present, no abort fired.
    assert _game_status(game_id) == "pending"
    assert _pending_upload_exists(session_id)
    assert aborts == []
