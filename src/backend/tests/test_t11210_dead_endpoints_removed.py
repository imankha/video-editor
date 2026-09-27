"""T11210/T11230 removal proof: dead endpoints deleted, surviving endpoints intact.

Regression test (not a characterization golden): pins that the dead routes
identified in T11210 (POST /api/export/chapters, POST
/api/export/concat-for-overlay, POST /api/projects/preview-clips) no longer
resolve, while POST /api/projects (bare create, still used by e2e/test_api.sh
fixture seeding) keeps resolving.

T11230 (2026-09-27): POST /api/projects/from-clips was the multi-clip "Create
reel" builder (its only caller was the deleted GameClipSelectorModal). The
single-clip-editor epic removes the Reels building surfaces, so this route is
now GONE too -- `test_projects_from_clips_route_removed` pins that. On unchanged
master from-clips is still registered, so that test fails by assertion there
(status 200/other, not 404/405) and passes on the branch after the deletion
commit.
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


def test_projects_bare_create_route_still_exists():
    response = client.post(
        "/api/projects", json={"name": "T11210 e2e fixture seed", "aspect_ratio": "16:9"}
    )
    assert response.status_code not in _ROUTE_NOT_FOUND, (
        "POST /api/projects (bare create) must keep resolving (used by "
        "e2e/T9285-recovery-preview.qa.spec.js, e2e/full-workflow.spec.js, "
        f"and test_api.sh) but responded {response.status_code}: {response.text}"
    )


def test_projects_preview_clips_route_removed():
    response = client.post("/api/projects/preview-clips", json={})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        f"POST /api/projects/preview-clips should be gone (T11210) but "
        f"responded {response.status_code}: {response.text}"
    )


def test_projects_from_clips_route_removed():
    response = client.post("/api/projects/from-clips", json={})
    assert response.status_code in _ROUTE_NOT_FOUND, (
        "POST /api/projects/from-clips should be gone (T11230 removed the "
        "multi-clip reel builder) but responded "
        f"{response.status_code}: {response.text}"
    )
