"""T14980: server-held resume point -- upsert/get/delete, vocabulary rejection,
the impersonation discard, the /api/auth/me payload, and the account-deletion
cascade.
"""

import asyncio

import pytest

from app.services.auth_db import create_user
from app.services.resume_points import (
    delete_resume_point,
    get_resume_point,
    upsert_resume_point,
)
from app.user_context import set_current_impersonator_id, set_current_user_id
from tests.conftest import register_test_user_ids


@pytest.fixture(autouse=True)
def _create_user(pg_conn):
    register_test_user_ids("user-resume-a")
    create_user("user-resume-a", email="resume-a@test.com")
    yield
    set_current_impersonator_id(None)


class TestUpsertAndGet:
    def test_upsert_then_get_roundtrips(self, pg_conn):
        point = {
            "path": "/focus/p/8124",
            "profile_id": "452babcd",
            "screen": "framing",
            "step": "crop",
            "t": 37.2,
            "dialog": None,
            "tab": None,
            "build": 412,
            "left_at": "2026-11-03T22:14:09Z",
        }
        assert upsert_resume_point("user-resume-a", point) is True

        got = get_resume_point("user-resume-a")
        assert got["path"] == "/focus/p/8124"
        assert got["profile_id"] == "452babcd"
        assert got["screen"] == "framing"
        assert got["step"] == "crop"
        assert got["t"] == 37.2
        assert got["build"] == 412

    def test_upsert_overwrites_in_place(self, pg_conn):
        upsert_resume_point("user-resume-a", {"path": "/annotate/g/1", "screen": "annotate"})
        upsert_resume_point("user-resume-a", {"path": "/annotate/g/2", "screen": "annotate"})

        got = get_resume_point("user-resume-a")
        assert got["path"] == "/annotate/g/2"

    def test_get_returns_none_when_no_row(self, pg_conn):
        assert get_resume_point("user-resume-a") is None


class TestVocabularyRejection:
    def test_missing_path_is_dropped(self, pg_conn):
        assert upsert_resume_point("user-resume-a", {"screen": "framing"}) is False
        assert get_resume_point("user-resume-a") is None

    def test_unknown_screen_is_nulled_but_point_still_stored(self, pg_conn):
        ok = upsert_resume_point("user-resume-a", {"path": "/home", "screen": "not-a-real-screen"})
        assert ok is True
        got = get_resume_point("user-resume-a")
        assert got["screen"] is None

    def test_step_not_in_screens_vocabulary_is_dropped(self, pg_conn):
        upsert_resume_point("user-resume-a", {
            "path": "/focus/p/1", "screen": "framing", "step": "mark",  # 'mark' is annotate-only
        })
        got = get_resume_point("user-resume-a")
        assert got["step"] is None

    def test_no_view_state_fields_in_schema(self, pg_conn):
        upsert_resume_point("user-resume-a", {
            "path": "/home", "screen": "project-manager",
            "filters": {"sort": "newest"}, "collapsed_panels": ["a"],
        })
        got = get_resume_point("user-resume-a")
        assert "filters" not in got
        assert "collapsed_panels" not in got


class TestImpersonationDiscard:
    def test_write_endpoint_discards_during_impersonation(self, pg_conn):
        from app.routers.users import ResumePointReport, set_resume_point

        set_current_user_id("user-resume-a")
        set_current_impersonator_id("admin-1")
        try:
            resp = asyncio.run(set_resume_point(
                ResumePointReport(path="/focus/p/999", screen="framing")
            ))
        finally:
            set_current_impersonator_id(None)

        assert resp.status_code == 204
        assert get_resume_point("user-resume-a") is None

    def test_write_endpoint_persists_when_not_impersonating(self, pg_conn):
        from app.routers.users import ResumePointReport, set_resume_point

        set_current_user_id("user-resume-a")
        set_current_impersonator_id(None)
        resp = asyncio.run(set_resume_point(
            ResumePointReport(path="/focus/p/999", screen="framing")
        ))

        assert resp.status_code == 204
        assert get_resume_point("user-resume-a")["path"] == "/focus/p/999"


class TestMePayload:
    def test_auth_me_includes_resume_point_for_a_real_session(self, pg_conn, tmp_path):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from app.main import app
        from app.services.auth_db import create_session

        upsert_resume_point("user-resume-a", {"path": "/focus/p/42", "screen": "framing"})
        sid = create_session("user-resume-a")

        with patch("app.database.USER_DATA_BASE", tmp_path):
            client = TestClient(app, raise_server_exceptions=True)
            client.cookies.set("rb_session", sid)
            resp = client.get("/api/auth/me")

        assert resp.status_code == 200
        assert resp.json()["resume_point"]["path"] == "/focus/p/42"

    def test_auth_me_resume_point_null_when_none_saved(self, pg_conn, tmp_path):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from app.main import app
        from app.services.auth_db import create_session

        sid = create_session("user-resume-a")

        with patch("app.database.USER_DATA_BASE", tmp_path):
            client = TestClient(app, raise_server_exceptions=True)
            client.cookies.set("rb_session", sid)
            resp = client.get("/api/auth/me")

        assert resp.status_code == 200
        assert resp.json()["resume_point"] is None

    def test_x_user_id_bypass_returns_null_resume_point(self, pg_conn):
        from fastapi.testclient import TestClient

        from app.main import app

        upsert_resume_point("user-resume-a", {"path": "/focus/p/42", "screen": "framing"})

        client = TestClient(app, raise_server_exceptions=True)
        resp = client.get("/api/auth/me", headers={"X-User-ID": "user-resume-a"})

        assert resp.status_code == 200
        assert resp.json()["resume_point"] is None  # X-User-ID bypass path never looks one up


class TestCascadeOnDelete:
    def test_deleting_user_deletes_resume_point(self, pg_conn):
        from app.services.pg import get_pg

        upsert_resume_point("user-resume-a", {"path": "/home", "screen": "project-manager"})
        assert get_resume_point("user-resume-a") is not None

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE user_id = %s", ("user-resume-a",))

        assert get_resume_point("user-resume-a") is None


class TestDeleteResumePoint:
    def test_delete_clears_the_row(self, pg_conn):
        upsert_resume_point("user-resume-a", {"path": "/home", "screen": "project-manager"})
        delete_resume_point("user-resume-a")
        assert get_resume_point("user-resume-a") is None


class TestSkipsSyncAndLock:
    def test_resume_point_path_is_in_skip_sync_paths(self):
        """The route must skip the per-user write lock and R2 sync (db_sync.py
        puts every POST/PUT/PATCH/DELETE under the lock unless the path is
        listed here) -- a navigation-frequency write cannot queue behind
        uploads."""
        from app.middleware.db_sync import RequestContextMiddleware

        assert any(
            "/api/me/resume-point".startswith(prefix)
            for prefix in RequestContextMiddleware.SKIP_SYNC_PATHS
        )
