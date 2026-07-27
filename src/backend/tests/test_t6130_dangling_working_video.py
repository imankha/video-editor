"""
T6130: a dangling working-video ref must reach a terminal, actionable state.

Background (see docs/plans/tasks/T6130-*, .claude/knowledge/export-pipeline.md):
    GET /api/projects/{id}/working_video/playback-url resolves
    working_videos.filename and presigns it WITHOUT checking the R2 object
    exists. A row whose R2 object is gone (env-copy/wipe provenance; no
    in-env code path deletes working_videos/*.mp4) therefore returned a
    cheerful 200 + a URL that 404s cross-origin. Because R2's 404 does not
    reliably carry CORS headers, the browser could not classify the miss, so
    the Overlay screen showed a generic "Video failed to load" with a Retry
    button that can never succeed instead of the T5440 "re-export to rebuild"
    terminal state.

Decision (invariant-vs-external): a missing R2 object is an EXTERNAL-failure
    state (R2 is external; no in-env path drops these objects), classified at
    the R2-object boundary exactly like T4990's SOURCE_UNAVAILABLE — NOT a
    banned defensive patch. The fix verifies existence and returns a typed 404
    so the already-wired frontend VideoAssetMissingError -> T5440 path fires
    reliably (the API's own 404 carries proper CORS, unlike R2's).

These tests pin the contract at the source (the endpoint). The frontend
already maps a playback-url 404 to the terminal T5440 state (OverlayScreen
attemptLoad), so no frontend change is required.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.routers import projects as projects_router

WORKING_VIDEO_PLAYBACK_URL_PATH = "/api/projects/999999/working_video/playback-url"


class _FakeCursor:
    def execute(self, *args, **kwargs):
        return self

    def fetchone(self):
        return {"filename": "working_999999_ff66933d.mp4"}


class _FakeConn:
    def cursor(self):
        return _FakeCursor()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _patch_row_and_presign(monkeypatch):
    """A working_videos row exists and presigning succeeds; only R2 object
    presence varies between tests."""
    monkeypatch.setattr(projects_router, "get_db_connection", lambda: _FakeConn())
    monkeypatch.setattr(
        projects_router,
        "_generate_working_video_presigned_url",
        lambda filename: f"https://r2.example.com/working_videos/{filename}?sig=abc",
    )


def test_dangling_object_returns_404_not_200(monkeypatch):
    """RED-FIRST: a row whose R2 object is gone must 404, not hand back a
    cheerful 200 + a URL that 404s cross-origin.

    Simulates R2 enabled (so the existence check runs) with the object absent.
    """
    _patch_row_and_presign(monkeypatch)
    monkeypatch.setattr(projects_router, "R2_ENABLED", True)
    monkeypatch.setattr(projects_router, "file_exists_in_r2", lambda user_id, path: False)

    client = TestClient(app)
    r = client.get(WORKING_VIDEO_PLAYBACK_URL_PATH, headers={"X-User-ID": "testdefault"})

    assert r.status_code == 404, (
        f"a dangling working-video ref (R2 object missing) must return 404 so the "
        f"frontend reaches the T5440 re-export state, got {r.status_code}: {r.text}"
    )


def test_present_object_returns_url(monkeypatch):
    """When R2 is enabled AND the object is present, the endpoint still returns
    the presigned URL (the existence check is a gate, not a rewrite)."""
    _patch_row_and_presign(monkeypatch)
    monkeypatch.setattr(projects_router, "R2_ENABLED", True)
    monkeypatch.setattr(projects_router, "file_exists_in_r2", lambda user_id, path: True)

    client = TestClient(app)
    r = client.get(WORKING_VIDEO_PLAYBACK_URL_PATH, headers={"X-User-ID": "testdefault"})

    assert r.status_code == 200, f"present object must return 200, got {r.status_code}: {r.text}"
    assert r.json().get("url", "").startswith("https://"), r.text


def test_verifies_the_working_video_key(monkeypatch):
    """The existence check must probe the SAME key that is presigned
    (working_videos/{filename}) — not some other object."""
    _patch_row_and_presign(monkeypatch)
    monkeypatch.setattr(projects_router, "R2_ENABLED", True)
    seen = {}

    def _spy(user_id, path):
        seen["path"] = path
        return True

    monkeypatch.setattr(projects_router, "file_exists_in_r2", _spy)

    client = TestClient(app)
    client.get(WORKING_VIDEO_PLAYBACK_URL_PATH, headers={"X-User-ID": "testdefault"})

    assert seen.get("path") == "working_videos/working_999999_ff66933d.mp4", (
        f"existence check probed the wrong key: {seen!r}"
    )


def test_r2_disabled_skips_check_and_returns_url(monkeypatch):
    """Regression: with R2 disabled we cannot verify existence — do NOT 404 a
    healthy row. (Local/dev + the existing T5642 return_url test rely on this;
    the presign helper already 404s on its own when R2 is truly off.)"""
    _patch_row_and_presign(monkeypatch)
    monkeypatch.setattr(projects_router, "R2_ENABLED", False)

    def _must_not_call(user_id, path):
        raise AssertionError("file_exists_in_r2 must not run when R2 is disabled")

    monkeypatch.setattr(projects_router, "file_exists_in_r2", _must_not_call)

    client = TestClient(app)
    r = client.get(WORKING_VIDEO_PLAYBACK_URL_PATH, headers={"X-User-ID": "testdefault"})

    assert r.status_code == 200, f"R2-disabled healthy row must not 404, got {r.status_code}: {r.text}"
