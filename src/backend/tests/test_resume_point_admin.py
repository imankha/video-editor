"""T14990: the admin's "where they left off" row and the impersonation
landing point -- both carried on existing admin endpoints (no new route).

Covers:
  - GET /api/admin/analytics/journey/{user_id} carries `resume_point`
    (None when absent, resolved fields when present) and `signup_build`
    (the null-state message's "since build N").
  - POST /api/admin/impersonate/{id} carries the TARGET's resume point
    (read-only -- never writes it), so the frontend can land there.
"""
import pytest
from fastapi.testclient import TestClient

from app.services.auth_db import create_user
from app.services.resume_points import get_resume_point, upsert_resume_point
from tests.conftest import register_test_user_ids

ADMIN_EMAIL = "t14990-admin@test.local"


@pytest.fixture()
def client(pg_conn, tmp_path):
    from unittest.mock import patch

    create_user("t14990-admin", email=ADMIN_EMAIL)
    register_test_user_ids("t14990-admin")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (ADMIN_EMAIL,),
        )
    with patch("app.database.USER_DATA_BASE", tmp_path):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True, headers={"X-User-ID": "t14990-admin"})


def _target(user_id, email):
    from app.analytics import create_user_segment
    create_user(user_id, email=email)
    register_test_user_ids(user_id)
    create_user_segment(user_id, "organic", None, "otp")


class TestJourneyDetailResumePoint:
    def test_no_point_returns_none_but_signup_build_present(self, client):
        user_id = "t14990_no_point"
        _target(user_id, "t14990-no-point@test.local")
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute(
                "UPDATE user_segments SET signup_build = 412 WHERE user_id = %s", (user_id,)
            )

        r = client.get(f"/api/admin/analytics/journey/{user_id}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resume_point"] is None
        assert body["signup_build"] == 412

    def test_point_present_is_resolved_and_included(self, client):
        user_id = "t14990_with_point"
        _target(user_id, "t14990-with-point@test.local")
        upsert_resume_point(user_id, {
            "path": "/annotate/g/123", "profile_id": "prof-unresolvable",
            "screen": "annotate", "step": "mark", "t": 12.5, "dialog": None,
            "tab": None, "build": 412, "left_at": "2026-11-03T22:14:09Z",
        })

        r = client.get(f"/api/admin/analytics/journey/{user_id}")
        assert r.status_code == 200, r.text
        point = r.json()["resume_point"]
        assert point is not None
        assert point["path"] == "/annotate/g/123"
        assert point["screen"] == "annotate"
        assert point["step"] == "mark"
        assert point["t"] == 12.5
        # Profile doesn't exist in this user's (freshly created) user.sqlite,
        # and there's no profile.sqlite on disk -- resolved to None, not
        # fabricated, per the "no silent fallback" rule.
        assert point["profile_name"] is None
        assert point["object_title"] is None


class TestImpersonateCarriesTargetResumePoint:
    def test_impersonate_response_includes_target_resume_point(self, client):
        user_id = "t14990_imp_target"
        _target(user_id, "t14990-imp-target@test.local")
        upsert_resume_point(user_id, {"path": "/focus/p/8124", "screen": "framing"})

        r = client.post(f"/api/admin/impersonate/{user_id}")
        assert r.status_code == 200, r.text
        point = r.json()["resume_point"]
        assert point is not None
        assert point["path"] == "/focus/p/8124"
        # Read-only: impersonating never writes the target's own point.
        assert get_resume_point(user_id)["path"] == "/focus/p/8124"

    def test_impersonate_response_resume_point_none_when_absent(self, client):
        user_id = "t14990_imp_no_point"
        _target(user_id, "t14990-imp-no-point@test.local")

        r = client.post(f"/api/admin/impersonate/{user_id}")
        assert r.status_code == 200, r.text
        assert r.json()["resume_point"] is None
