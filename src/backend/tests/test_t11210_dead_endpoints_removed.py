"""T11210 removal proof: dead endpoints deleted, surviving endpoint intact.

Regression test (not a characterization golden): pins that the four dead
routes identified in T11210 (POST /api/export/chapters, POST
/api/export/concat-for-overlay, POST /api/projects (bare create), POST
/api/projects/preview-clips) no longer resolve, while POST
/api/projects/from-clips -- still used by the single-clip export flow --
keeps resolving. On unchanged master these dead routes are still registered,
so this test fails by assertion there (status 200/other, not 404/405) and
passes on the branch after the T11210 deletion commit.
"""

import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11210_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})

_ROUTE_NOT_FOUND = {404, 405}


def test_export_chapters_route_removed():
    response = client.post("/api/export/chapters", json={})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        f"POST /api/export/chapters should be gone (T11210) but responded "
        f"{response.status_code}: {response.text}"
    )


def test_export_concat_for_overlay_route_removed():
    response = client.post("/api/export/concat-for-overlay", json={})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        f"POST /api/export/concat-for-overlay should be gone (T11210) but "
        f"responded {response.status_code}: {response.text}"
    )


def test_projects_bare_create_route_removed():
    response = client.post("/api/projects", json={"name": "T11210 dead route"})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        f"POST /api/projects (bare create) should be gone (T11210) but "
        f"responded {response.status_code}: {response.text}"
    )


def test_projects_preview_clips_route_removed():
    response = client.post("/api/projects/preview-clips", json={})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        f"POST /api/projects/preview-clips should be gone (T11210) but "
        f"responded {response.status_code}: {response.text}"
    )


def test_projects_from_clips_route_still_exists():
    response = client.post("/api/projects/from-clips", json={})
    assert response.status_code not in _ROUTE_NOT_FOUND, (
        "POST /api/projects/from-clips must keep resolving (still used by "
        f"the single-clip export flow) but responded {response.status_code}: "
        f"{response.text}"
    )
