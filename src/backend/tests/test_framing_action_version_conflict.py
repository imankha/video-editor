"""
T4330 -- two-writer 409 `version_conflict` for framing actions, plus the
pre-migration (`framing_version` column absent) degrade-gracefully behavior.

Design doc: docs/plans/tasks/T4330-design.md section 2.6/2.7.
Task file: docs/plans/tasks/write-correctness/T4330-action-client-serialization-conflicts.md

Framing has NO version counter today -- `working_clips` has no `framing_version`
column, `FramingAction.expected_version` exists on the Pydantic model but is
never read, and neither `_save_clip_framing_data` (crop/segment/trim) nor the
`set_rotation` branch bump any counter.

These tests are written test-first (Stage 3) and are ALL expected to FAIL until:
  - migration v044 adds `working_clips.framing_version INTEGER NOT NULL DEFAULT 0`
  - `_get_clip_framing_data` reads it and the 409 check is added
  - `_save_clip_framing_data` AND the `set_rotation` branch both bump it and
    return `new_version`
  - the check/bump is skipped (not an error) when the column is absent
    (pre-migration, via `column_exists`)
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import column_exists, get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_framing_conflict_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def test_project_with_clip():
    """Create a test project with a working clip for framing version-conflict testing."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Framing Conflict Project', '9:16')
        """)
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (
                project_id, uploaded_filename, version,
                crop_data, segments_data
            )
            VALUES (?, 'test_clip.mp4', 1, NULL, NULL)
        """, (project_id,))
        clip_id = cursor.lastrowid

        conn.commit()

        yield project_id, clip_id

        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _framing_column_present() -> bool:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        return column_exists(cursor, "working_clips", "framing_version")


class TestFramingActionVersionConflict:
    """Two-writer 409 against the new `framing_version` counter."""

    def test_stale_expected_version_returns_409_on_crop_keyframe(self, test_project_with_clip):
        project_id, clip_id = test_project_with_clip

        # Writer A commits a crop keyframe -- framing_version bumps 0 -> 1.
        response_a = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {"frame": 0, "x": 0, "y": 0, "width": 100, "height": 100},
            },
        )
        assert response_a.status_code == 200
        assert response_a.json().get("new_version") == 1, (
            "add_crop_keyframe must bump and return framing_version as new_version"
        )

        # Writer B holds the stale version (0) it read before A committed.
        response_b = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {"frame": 50, "x": 0, "y": 0, "width": 100, "height": 100},
                "expected_version": 0,
            },
        )

        assert response_b.status_code == 409
        body = response_b.json()
        assert body["success"] is False
        assert body["error"] == "version_conflict"
        assert body["current_version"] == 1

    def test_stale_expected_version_returns_409_on_set_rotation(self, test_project_with_clip):
        """The design decision is uniform: the check + bump apply to set_rotation too,
        not just _save_clip_framing_data's crop/segment/trim paths."""
        project_id, clip_id = test_project_with_clip

        response_a = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_rotation", "data": {"rotation": 2.0}},
        )
        assert response_a.status_code == 200
        assert response_a.json().get("new_version") == 1, (
            "set_rotation must ALSO bump framing_version (design doc: uniform across all write paths)"
        )

        response_b = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_rotation", "data": {"rotation": -4.0}, "expected_version": 0},
        )

        assert response_b.status_code == 409
        body = response_b.json()
        assert body["error"] == "version_conflict"
        assert body["current_version"] == 1

    def test_trim_range_bumps_the_counter(self, test_project_with_clip):
        """set_trim_range routes through _save_clip_framing_data -- must also bump."""
        project_id, clip_id = test_project_with_clip

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_trim_range", "data": {"start": 1.0, "end": 3.0}},
        )
        assert response.status_code == 200
        assert response.json().get("new_version") == 1

    def test_null_expected_version_skips_the_check(self, test_project_with_clip):
        """Back-compat: an action with no expected_version (first write of a session) must land."""
        project_id, clip_id = test_project_with_clip

        # Seed a version bump so current != 0, proving the check is genuinely skipped.
        client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 0, "y": 0, "width": 100, "height": 100}},
        )

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 50, "x": 0, "y": 0, "width": 100, "height": 100}},
            # expected_version omitted
        )

        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_matching_expected_version_succeeds(self, test_project_with_clip):
        project_id, clip_id = test_project_with_clip

        first = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "add_crop_keyframe", "data": {"frame": 0, "x": 0, "y": 0, "width": 100, "height": 100}},
        )
        current_version = first.json()["new_version"]

        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {"frame": 50, "x": 0, "y": 0, "width": 100, "height": 100},
                "expected_version": current_version,
            },
        )

        assert response.status_code == 200
        assert response.json()["new_version"] == current_version + 1


class TestFramingActionPreMigration:
    """
    Pre-migration behavior (design doc decision, Open Question 2 resolved as (a)):
    if `working_clips.framing_version` is ABSENT (deploy->migrate window), the
    action endpoint must skip the check/bump silently via `column_exists` --
    crop/trim/speed/rotation keep working with no conflict protection, no error.

    `ensure_database` always creates fresh test DBs with the column already
    present, and SQLite's DROP COLUMN guarantee is version-dependent, so an
    absent column is simulated by monkeypatching `column_exists` in
    `app.routers.clips` to report False for `framing_version` specifically
    (every other column check -- e.g. the `rotation` guard -- still resolves
    for real), reproducing exactly what a not-yet-migrated profile DB looks
    like to this endpoint.
    """

    def test_skips_check_and_bump_when_column_absent(self, test_project_with_clip, monkeypatch):
        import app.routers.clips as clips_module

        real_column_exists = clips_module.column_exists

        def fake_column_exists(cursor, table, column):
            if column == "framing_version":
                return False
            return real_column_exists(cursor, table, column)

        monkeypatch.setattr(clips_module, "column_exists", fake_column_exists)

        project_id, clip_id = test_project_with_clip

        # A stale expected_version would normally 409 -- with the column
        # absent, conflict detection is unavailable, so this must succeed
        # (skip the check) and never 500, and must NOT echo a new_version.
        response = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={
                "action": "add_crop_keyframe",
                "data": {"frame": 0, "x": 0, "y": 0, "width": 100, "height": 100},
                "expected_version": 999,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert "new_version" not in body or body["new_version"] is None

    def test_column_present_on_a_migrated_db(self):
        """`ensure_database`/v034 have landed -- fresh test DBs carry the column."""
        assert _framing_column_present() is True


class TestClipsListExposesFramingVersion:
    """T4330: GET /projects/{id}/clips must return the REAL framing_version.

    Regression for a real bug found live-testing the two-tab conflict flow:
    `list_project_clips`'s response construction used
    `clip['wc_framing_version'] if 'wc_framing_version' in clip else 0` --
    but `in` on a sqlite3.Row checks VALUES, not column names (unlike a plain
    dict), so that check was ALWAYS False and every response silently
    reported framing_version=0 regardless of the real counter. This is the
    exact value the frontend actionClient seeds its version tracker from
    (T4330's fix for the "tab's first action is never conflict-checked" gap)
    -- a wrong value here would have silently defeated that fix. Confirmed
    live via a direct curl bypassing the browser/dev-server entirely: the row
    dict logged framing_version=1 but the JSON response still said 0.
    """

    def test_list_clips_returns_real_framing_version_not_default(self, test_project_with_clip):
        project_id, clip_id = test_project_with_clip

        # Bump the counter via a real action (mirrors what live-testing did).
        bump = client.post(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/actions",
            json={"action": "set_rotation", "data": {"rotation": 2.0}, "expected_version": 0},
        )
        assert bump.status_code == 200
        assert bump.json()["new_version"] == 1

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response.status_code == 200
        clips = response.json()
        clip = next(c for c in clips if c["id"] == clip_id)

        # The regression: this silently read 0 no matter what the DB held.
        assert clip["framing_version"] == 1
        assert clip["rotation"] == 2.0
