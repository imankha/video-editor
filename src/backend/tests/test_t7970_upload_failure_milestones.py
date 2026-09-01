"""
T7970: upload failures now recorded as `game_upload_failed` milestones.

Before T7970 the ONLY emitter of `game_upload_failed` was the stale-pending
reaper (`list_pending_uploads`, reason=user_abandoned) — see T7490 — so the
admin "Upload Success" denominator was success-only by construction. T7970
adds `_record_upload_failure` calls at the REAL in-flight failure sites in
`app/routers/games_upload.py`:
  - prepare_upload: invalid hash/size -> refused; create_multipart None -> sync_failed
  - finalize_upload: complete-multipart False -> sync_failed; head missing -> sync_failed;
    size mismatch -> network
  - cancel_upload (explicit user cancel) -> user_abandoned
  - upload_failure_beacon, ONLY phase == "uploading" -> classified from the client's
    own failure message (T8170: `_classify_uploading_phase_failure`) into network /
    r2_rejected / timeout / unknown, no longer hardcoded to `network` (preparing/
    finalizing are deliberately NOT recorded server-side here, to avoid double-counting
    the server-side prepare/finalize branches that already recorded them)

This file proves those call sites emit the right milestone end-to-end through the
real endpoints (TestClient) against real dev Postgres (pg_conn fixture).

Run with: pytest src/backend/tests/test_t7970_upload_failure_milestones.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import get_db_connection
from app.utils.encoding import encode_data

TEST_USER_ID = f"test_t7970_{uuid.uuid4().hex[:8]}"
# "testdefault" (not an 8-hex id) is pre-seeded by conftest's session-scoped
# _set_default_profile_context fixture into session_init._init_cache, so the
# X-Profile-ID ownership guard (T7520) and the real R2 durable-sync path both
# resolve it without a slow/failing cold-profile R2 round trip for a
# never-before-seen dynamic test user (mirrors test_t7010_clip_game_logging.py).
TEST_PROFILE_ID = "testdefault"


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


def _get_action(user_id: str, action: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
            (user_id, action),
        )
        return cur.fetchone()


def _action_count(user_id: str, action: str) -> int:
    row = _get_action(user_id, action)
    return row["count"] if row else 0


def _make_pending_upload(blake3_hash: str, upload_id: str, file_size: int = 50 * 1024 * 1024) -> str:
    session_id = uuid.uuid4().hex
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO pending_uploads
               (id, blake3_hash, file_size, original_filename, r2_upload_id, parts_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (session_id, blake3_hash, file_size, "clip.mp4", upload_id, encode_data([])),
        )
        conn.commit()
    return session_id


def _client():
    from fastapi.testclient import TestClient

    from app.main import app
    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


@pytest.fixture(autouse=True)
def _r2_guard_enabled(monkeypatch):
    """prepare/finalize/cancel gate their whole handler on R2_ENABLED, which reads
    os.getenv() at `app.storage` import time -- BEFORE app.main's load_dotenv() runs
    under pytest's collection order -- so it is False for every test unless patched.
    Only the ROUTER's copy is flipped True (not app.middleware.db_sync's own copy),
    so the durable_sync dependency's `should_sync` gate stays False and finalize's
    Depends(durable_sync) never attempts a REAL R2 upload of this dynamic test
    user's profile.sqlite -- avoiding an unrelated 503 from genuine R2 I/O while
    still exercising the router's own R2_ENABLED-gated failure branches via the
    monkeypatched r2_* helper functions each test sets up individually.
    """
    monkeypatch.setattr("app.routers.games_upload.R2_ENABLED", True)
    yield


@pytest.fixture(autouse=True)
def _pg_user(pg_conn):
    """Register TEST_USER_ID in Postgres so record_milestone's writes (user_actions,
    daily_counters via _counter_buffer) have a real origin, mirroring
    TestUploadOutcomeTaxonomy in test_analytics.py. pg_conn's _TEST_USER_IDS cleanup
    whitelist doesn't include our dynamic id, so this user is NOT auto-purged between
    runs -- harmless (each run gets a fresh uuid suffix) and avoids widening the
    conftest whitelist for a single test file. create_user is called once per test
    (fixture is function-scoped) against the SAME TEST_USER_ID, so guard against the
    unique-constraint violation on the 2nd+ test with ON CONFLICT semantics.
    """
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (TEST_USER_ID,))
        already_exists = cur.fetchone() is not None
    if not already_exists:
        create_user(TEST_USER_ID, email=f"{TEST_USER_ID}@test.com")
        create_user_segment(TEST_USER_ID, "organic", None, "otp")
    yield


def test_finalize_complete_multipart_failure_records_sync_failed(monkeypatch):
    """Finalize F3: r2_complete_multipart_upload returns False -> HTTP 500 AND a
    game_upload_failed:sync_failed milestone (the headline non-reaper E2E path)."""
    blake3_hash = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"[:64]
    upload_id = f"upl_{uuid.uuid4().hex}"
    session_id = _make_pending_upload(blake3_hash, upload_id)

    monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: False)
    monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload", lambda *a, **k: True)

    before = _action_count(TEST_USER_ID, "game_upload_failed:sync_failed")

    with _client() as client:
        resp = client.post(
            "/api/games/finalize-upload",
            json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "\"abc123\""}],
            },
        )

    assert resp.status_code == 500
    after = _action_count(TEST_USER_ID, "game_upload_failed:sync_failed")
    assert after >= before + 1


def test_finalize_size_mismatch_records_network(monkeypatch):
    """Finalize F5: R2-reported size != declared size -> HTTP 400 AND a
    game_upload_failed:network milestone."""
    blake3_hash = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"[:64]
    upload_id = f"upl_{uuid.uuid4().hex}"
    declared_size = 50 * 1024 * 1024
    session_id = _make_pending_upload(blake3_hash, upload_id, file_size=declared_size)

    monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: True)
    monkeypatch.setattr(
        "app.routers.games_upload.r2_head_object_global",
        lambda *a, **k: {"ContentLength": declared_size - 1},
    )
    monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload", lambda *a, **k: True)
    monkeypatch.setattr("app.routers.games_upload.r2_set_object_metadata_global", lambda *a, **k: None)

    before = _action_count(TEST_USER_ID, "game_upload_failed:network")

    with _client() as client:
        resp = client.post(
            "/api/games/finalize-upload",
            json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "\"abc123\""}],
            },
        )

    assert resp.status_code == 400
    after = _action_count(TEST_USER_ID, "game_upload_failed:network")
    assert after >= before + 1


def test_prepare_upload_invalid_file_size_records_refused():
    """prepare-upload: an out-of-range file_size is a real rejected attempt ->
    HTTP 400 AND a game_upload_failed:refused milestone."""
    blake3_hash = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"[:64]

    before = _action_count(TEST_USER_ID, "game_upload_failed:refused")

    with _client() as client:
        resp = client.post(
            "/api/games/prepare-upload",
            json={
                "blake3_hash": blake3_hash,
                "file_size": 0,
                "original_filename": "clip.mp4",
            },
        )

    assert resp.status_code == 400
    after = _action_count(TEST_USER_ID, "game_upload_failed:refused")
    assert after >= before + 1


def test_cancel_upload_records_user_abandoned(monkeypatch):
    """cancel_upload happy path (explicit user cancel via DELETE) -> HTTP 200
    {"status": "cancelled"} AND a game_upload_failed:user_abandoned milestone."""
    blake3_hash = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"[:64]
    upload_id = f"upl_{uuid.uuid4().hex}"
    session_id = _make_pending_upload(blake3_hash, upload_id)

    monkeypatch.setattr("app.routers.games_upload.r2_abort_multipart_upload", lambda *a, **k: True)

    before = _action_count(TEST_USER_ID, "game_upload_failed:user_abandoned")

    with _client() as client:
        resp = client.delete(f"/api/games/upload/{session_id}")

    assert resp.status_code == 200
    assert resp.json() == {"status": "cancelled"}
    after = _action_count(TEST_USER_ID, "game_upload_failed:user_abandoned")
    assert after >= before + 1


def test_beacon_phase_uploading_records_network():
    """upload-failure-beacon with phase=uploading is the one client-side failure the
    server never otherwise sees -> HTTP 204 AND a milestone row. A genuine transport
    drop ("network error", from uploadPart's xhr.onerror) classifies as `network`."""
    before = _action_count(TEST_USER_ID, "game_upload_failed:network")

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "uploading", "reason": "Part 1 network error"},
        )

    assert resp.status_code == 204
    after = _action_count(TEST_USER_ID, "game_upload_failed:network")
    assert after >= before + 1


def test_beacon_phase_uploading_r2_rejection_records_r2_rejected_not_network():
    """T8170: bug 47p / the T8160 outage's exact signature -- an R2 part PUT itself
    returning a non-2xx ("Part N upload failed: 404", from uploadPart's xhr.onload
    status branch) is NOT a dropped transport. Before T8170 this was hardcoded to
    `network`, hiding a 2-day prod outage behind a reason that pointed diagnosis at
    users' connections instead of our own self-abort bug."""
    before_rejected = _action_count(TEST_USER_ID, "game_upload_failed:r2_rejected")
    before_network = _action_count(TEST_USER_ID, "game_upload_failed:network")

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "uploading", "reason": "Part 2 upload failed: 404"},
        )

    assert resp.status_code == 204
    assert _action_count(TEST_USER_ID, "game_upload_failed:r2_rejected") >= before_rejected + 1
    assert _action_count(TEST_USER_ID, "game_upload_failed:network") == before_network


def test_beacon_phase_uploading_stalled_records_timeout():
    """'stalled'/'timed out' (uploadPart's watchdog reject reasons) classify as
    `timeout`, distinct from both `network` and `r2_rejected`."""
    before = _action_count(TEST_USER_ID, "game_upload_failed:timeout")

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "uploading", "reason": "Part 1 stalled (no progress for 30s)"},
        )

    assert resp.status_code == 204
    assert _action_count(TEST_USER_ID, "game_upload_failed:timeout") >= before + 1


def test_beacon_phase_finalizing_does_not_double_count():
    """upload-failure-beacon with phase=finalizing must NOT record a new milestone --
    the server-side finalize branches already recorded that failure; recording again
    would double-count the SAME event and inflate the denominator."""
    before = _action_count(TEST_USER_ID, "game_upload_failed:network")

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "finalizing", "reason": "size_mismatch"},
        )

    assert resp.status_code == 204
    after = _action_count(TEST_USER_ID, "game_upload_failed:network")
    assert after == before


def test_beacon_phase_preparing_does_not_double_count():
    """Same anti-double-count rule for phase=preparing (prepare-upload's own
    validation/create branches already recorded that failure)."""
    before_refused = _action_count(TEST_USER_ID, "game_upload_failed:refused")
    before_sync_failed = _action_count(TEST_USER_ID, "game_upload_failed:sync_failed")

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "preparing", "reason": "create_multipart_failed"},
        )

    assert resp.status_code == 204
    assert _action_count(TEST_USER_ID, "game_upload_failed:refused") == before_refused
    assert _action_count(TEST_USER_ID, "game_upload_failed:sync_failed") == before_sync_failed


def test_daily_counter_rollup_increases_on_failure():
    """T7970 failures fold into the reason-agnostic daily_counters.game_uploads_failed
    column via the buffered _counter_buffer, same as game_upload_succeeded does."""
    from app.analytics import _counter_buffer
    from app.services.pg import get_pg

    def _daily_failed() -> int:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT game_uploads_failed FROM daily_counters "
                "WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            return row["game_uploads_failed"] if row else 0

    _counter_buffer.flush()
    baseline = _daily_failed()

    with _client() as client:
        resp = client.post(
            "/api/games/upload-failure-beacon",
            json={"phase": "uploading", "reason": "stalled"},
        )
    assert resp.status_code == 204

    _counter_buffer.flush()
    assert _daily_failed() >= baseline + 1
