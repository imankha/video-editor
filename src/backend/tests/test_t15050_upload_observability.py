"""T15050: an upload flow must be traceable, and a reason-less beacon must not
count as a failure.

What slowed down the 2026-11-04 investigation (T15020): two client flows sharing
one session could only be told apart by counting lifecycle lines by hand, a /parts
404 was filed as kind=game with no hash, and eight all-None beacons were booked as
terminal game failures.

Contract pinned here:
  1. flow_id appears on every [UPLOAD_LIFECYCLE], [UPLOAD_FAILURE] and
     [UPLOAD_BEACON] line of a flow, so one grep shows the whole flow.
  2. flow_id is stored on the upload_failures row.
  3. A /parts 404 is recorded with the client's kind and hash.
  4. A beacon with no reason is never terminal, and warns naming the client build.
  5. A flow_id that is not a plain token never reaches the log or the row.
  6. The writer keeps working before the postgres migration has run.
  7. app.log keeps at least 7 rotated days.

Run with: pytest src/backend/tests/test_t15050_upload_observability.py -v
"""
import logging
import logging.handlers
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE

TEST_USER_ID = f"test_t15050_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
SIX_MB = 6 * 1024 * 1024
ROUTER = "app.routers.games_upload"


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


@pytest.fixture
def r2(monkeypatch):
    """A fresh upload: nothing on R2 until finalize completes the multipart."""
    state = {"landed": False}
    monkeypatch.setattr(f"{ROUTER}.get_credit_balance", lambda user_id: {"balance": 10**9})
    monkeypatch.setattr(f"{ROUTER}.r2_head_object_global",
                        lambda key: {"ContentLength": SIX_MB} if state["landed"] else None)
    monkeypatch.setattr(f"{ROUTER}.r2_create_multipart_upload", lambda key: "upl_1")
    monkeypatch.setattr(f"{ROUTER}.r2_abort_orphan_multipart_uploads", lambda key, keep_upload_id=None: 0)
    monkeypatch.setattr(f"{ROUTER}.generate_multipart_urls", lambda **kw: [
        {"part_number": 1, "presigned_url": "u1", "start_byte": 0, "end_byte": SIX_MB - 1},
    ])

    def _complete(key, upload_id, parts):
        state["landed"] = True
        return True

    monkeypatch.setattr(f"{ROUTER}.r2_complete_multipart_upload", _complete)
    return state


def _new_hash() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


def _prepare(client, blake3_hash, flow_id, kind="clip"):
    return client.post("/api/games/prepare-upload", json={
        "blake3_hash": blake3_hash, "file_size": SIX_MB, "original_filename": "clip.mp4",
        "kind": kind, "flow_id": flow_id,
    })


def _lines(caplog, marker: str) -> list[str]:
    return [r.getMessage() for r in caplog.records if marker in r.getMessage()]


def _failure_rows(**where) -> list[dict]:
    from app.services.pg import get_pg

    column, value = next(iter(where.items()))
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM upload_failures WHERE {column} = %s ORDER BY id", (value,))
        return [dict(r) for r in cur.fetchall()]


def _beacon_rows() -> list[dict]:
    return [r for r in _failure_rows(user_id=TEST_USER_ID) if r["origin"] == "beacon"]


def _failed_milestones() -> int:
    from app.services.pg import get_pg

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) AS c FROM user_actions "
            "WHERE user_id = %s AND action LIKE '%%upload_failed:%%'",
            (TEST_USER_ID,),
        )
        return int(cur.fetchone()["c"])


class TestOneGrepShowsTheFlow:
    def test_prepare_parts_finalize_and_beacon_all_carry_the_flow_id(self, r2, caplog):
        caplog.set_level(logging.INFO)
        flow_id = str(uuid.uuid4())
        blake3_hash = _new_hash()

        with _client() as client:
            prepared = _prepare(client, blake3_hash, flow_id)
            assert prepared.status_code == 200, prepared.text
            session_id = prepared.json()["upload_session_id"]
            part = {"part_number": 1, "etag": "e1"}
            saved = client.patch(f"/api/games/upload/{session_id}/parts", json={
                "parts": [part], "flow_id": flow_id, "blake3_hash": blake3_hash, "kind": "clip",
            })
            assert saved.status_code == 200, saved.text
            finalized = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id, "parts": [part],
                "blake3_hash": blake3_hash, "kind": "clip", "flow_id": flow_id,
            })
            assert finalized.status_code == 200, finalized.text
            client.post("/api/games/upload-failure-beacon", json={
                "phase": "uploading", "reason": "stalled", "kind": "clip",
                "blake3_hash": blake3_hash, "flow_id": flow_id, "server_responded": False,
            })

        tagged = [r.getMessage() for r in caplog.records if f"flow_id={flow_id}" in r.getMessage()]
        for expected in ("[UPLOAD_LIFECYCLE] prepare", "[UPLOAD_LIFECYCLE] parts",
                         "[UPLOAD_LIFECYCLE] finalize success", "[UPLOAD_BEACON]", "[UPLOAD_FAILURE]"):
            assert any(expected in line for line in tagged), f"{expected} missing flow_id: {tagged}"

    def test_dedup_hit_logs_the_flow_too(self, monkeypatch, r2, caplog):
        """A prepare answered EXISTS is the whole flow; it must still be greppable."""
        caplog.set_level(logging.INFO)
        r2["landed"] = True
        flow_id = str(uuid.uuid4())
        with _client() as client:
            resp = _prepare(client, _new_hash(), flow_id)
        assert resp.json()["status"] == "exists"
        assert any(f"flow_id={flow_id}" in line for line in _lines(caplog, "[UPLOAD_LIFECYCLE]"))

    def test_finalize_failure_stores_the_flow_id_on_the_row(self, r2):
        flow_id = str(uuid.uuid4())
        session_id = f"upload_{uuid.uuid4().hex}"
        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id, "parts": [{"part_number": 1, "etag": "e"}],
                "blake3_hash": _new_hash(), "kind": "clip", "flow_id": flow_id,
            })
        assert resp.status_code == 404
        rows = _failure_rows(upload_session_id=session_id)
        assert [r["flow_id"] for r in rows] == [flow_id]

    def test_a_flow_id_that_is_not_a_token_is_dropped(self, r2, caplog):
        """It is client text on a log line: a newline would forge a log entry."""
        caplog.set_level(logging.INFO)
        session_id = f"upload_{uuid.uuid4().hex}"
        forged = "x\n[UPLOAD_LIFECYCLE] finalize success user=victim"
        with _client() as client:
            client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id, "parts": [{"part_number": 1, "etag": "e"}],
                "blake3_hash": _new_hash(), "kind": "clip", "flow_id": forged,
            })
        assert not [line for line in _lines(caplog, "user=victim")]
        assert [r["flow_id"] for r in _failure_rows(upload_session_id=session_id)] == [None]


class TestPartsNotFoundIsFiledCorrectly:
    def test_parts_404_records_client_kind_hash_and_flow(self):
        flow_id = str(uuid.uuid4())
        blake3_hash = _new_hash()
        session_id = f"upload_{uuid.uuid4().hex}"
        with _client() as client:
            resp = client.patch(f"/api/games/upload/{session_id}/parts", json={
                "parts": [{"part_number": 1, "etag": "e"}],
                "flow_id": flow_id, "blake3_hash": blake3_hash, "kind": "clip",
            })
        assert resp.status_code == 404
        (row,) = _failure_rows(upload_session_id=session_id)
        assert (row["kind"], row["blake3_hash"], row["flow_id"]) == ("clip", blake3_hash, flow_id)
        assert row["terminal"] is False  # T15020: the outcome is decided at finalize

    def test_pre_t15050_client_body_still_works(self):
        session_id = f"upload_{uuid.uuid4().hex}"
        with _client() as client:
            resp = client.patch(f"/api/games/upload/{session_id}/parts", json={
                "parts": [{"part_number": 1, "etag": "e"}],
            })
        assert resp.status_code == 404
        (row,) = _failure_rows(upload_session_id=session_id)
        assert row["kind"] == "game"


class TestReasonlessBeacon:
    @pytest.mark.parametrize("body", [
        {"json": {}},
        {"json": {"phase": "uploading"}},
        {"json": {"phase": "hashing", "reason": "   "}},
        {"json": {"phase": "preparing", "reason": {"detail": "x"}, "server_responded": False}},
        {"content": b""},
        {"content": b"not json"},
    ])
    def test_never_terminal_and_books_no_failure(self, body):
        before = _failed_milestones()
        with _client(**{"X-Client-Build": "7102"}) as client:
            resp = client.post("/api/games/upload-failure-beacon", **body)
        assert resp.status_code == 204
        rows = _beacon_rows()
        assert rows and rows[-1]["terminal"] is False
        assert rows[-1]["reason"] == "unknown"
        assert _failed_milestones() == before

    def test_warns_naming_the_client_build_and_why_the_body_was_empty(self, caplog):
        caplog.set_level(logging.WARNING)
        with _client(**{"X-Client-Build": "7102"}) as client:
            client.post("/api/games/upload-failure-beacon", content=b"")
        warnings = [r for r in caplog.records
                    if r.levelno == logging.WARNING and "reason-less" in r.getMessage()]
        assert warnings, "expected a reason-less beacon WARNING"
        message = warnings[0].getMessage()
        assert "client_build=7102" in message
        assert "body_error=JSONDecodeError" in message

    def test_a_beacon_with_a_reason_is_still_terminal(self):
        """Regression: the guard must not swallow real client failures."""
        before = _failed_milestones()
        with _client() as client:
            client.post("/api/games/upload-failure-beacon", json={
                "phase": "uploading", "reason": "Part 3 upload failed: 404", "kind": "clip",
                "server_responded": False,
            })
        assert _beacon_rows()[-1]["terminal"] is True
        assert _failed_milestones() == before + 1


class TestWriterBeforeMigration:
    def test_row_is_still_written_when_the_flow_id_column_is_missing(self, monkeypatch):
        """Postgres migrations run after deploy: until then the INSERT must not name
        the column, or every failure in that window is lost."""
        from contextlib import contextmanager
        from unittest.mock import MagicMock

        from app.services import upload_failures

        cursor = MagicMock()
        cursor.fetchone.return_value = None  # information_schema: no flow_id column

        @contextmanager
        def _fake_pg():
            conn = MagicMock()
            conn.cursor.return_value = cursor
            yield conn

        monkeypatch.setattr(upload_failures, "get_pg", _fake_pg)
        monkeypatch.setattr(upload_failures, "_flow_id_column_present", False)
        upload_failures.record_upload_failure(
            kind="clip", stage="uploading", reason="network", terminal=False,
            user_id="u", flow_id="abc",
        )
        inserts = [c.args[0] for c in cursor.execute.call_args_list if "INSERT INTO upload_failures" in c.args[0]]
        assert len(inserts) == 1
        assert "flow_id" not in inserts[0]


class TestLogRetention:
    def test_app_log_keeps_at_least_seven_rotated_days(self):
        import app.main  # noqa: F401  (installs the handler)

        handlers = [h for h in logging.getLogger().handlers
                    if isinstance(h, logging.handlers.TimedRotatingFileHandler)
                    and h.baseFilename.endswith("app.log")]
        assert handlers, "expected the app.log rotating handler"
        assert handlers[0].backupCount >= 7
