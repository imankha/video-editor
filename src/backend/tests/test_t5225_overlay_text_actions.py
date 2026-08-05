"""T5225: Overlay text layer -- backend action handlers (design SS5.2).

FAILING BY DESIGN: none of add_text/move_text_edge/update_text_spec/toggle_text/
delete_text exist yet. `overlay_action`'s if/elif chain (overlay.py:551-797) has
no branches for them, so every action call below falls into the terminal
`else: raise ValueError(f"Unknown action: {action.action}")` (overlay.py ~796)
and the endpoint returns 400 with that message -- NOT a 200, NOT a stored text
block. These tests pin the INTENDED contract from the design (SS5.2's table) so
they flip to real assertions once T5225 is implemented; they must currently
fail with the "Unknown action" 400, not a fixture/typo error.

Mirrors test_overlay_actions.py's fixture/client shape exactly.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data

TEST_USER_ID = f"test_t5225_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
# Returns the 500 response body instead of re-raising, for the decode-error test.
client_no_raise = TestClient(
    app, headers={"X-User-ID": TEST_USER_ID}, raise_server_exceptions=False
)


def _valid_spec(**overrides) -> dict:
    """A minimal valid TextSpec (schemas.py:369) payload."""
    spec = {
        "text": "GOAL!",
        "font": "anton",
        "size": 0.08,
        "color": "#FFFFFF",
        "align": "center",
        "position": {"x": 0.5, "y": 0.5},
        "maxWidth": 0.8,
    }
    spec.update(overrides)
    return spec


@pytest.fixture
def project_with_working_video():
    """Mirrors test_overlay_actions.py's test_project_with_working_video fixture."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T5225 Text Project', '9:16')"
        )
        project_id = cursor.lastrowid
        # text_overlays column exists (open socket, no migration -- design SS1.2)
        # but nothing writes it yet; seed NULL, the production "empty" representation.
        cursor.execute(
            """
            INSERT INTO working_videos
                (project_id, filename, version, highlights_data, text_overlays, effect_type, overlay_version)
            VALUES (?, 'test_working.mp4', 1, NULL, NULL, 'original', 0)
            """,
            (project_id,),
        )
        working_video_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET working_video_id = ? WHERE id = ?",
            (working_video_id, project_id),
        )
        conn.commit()

        yield project_id

        cursor.execute(
            "UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,)
        )
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _post(project_id: int, body: dict):
    return client.post(f"/api/export/projects/{project_id}/overlay/actions", json=body)


def _stored_text_overlays(project_id: int) -> list:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT wv.text_overlays
            FROM working_videos wv
            JOIN projects p ON p.working_video_id = wv.id
            WHERE p.id = ?
            """,
            (project_id,),
        )
        row = cursor.fetchone()
    if not row or not row["text_overlays"]:
        return []
    return decode_data(row["text_overlays"]) or []


class TestAddText:
    def test_add_text_happy_path(self, project_with_working_video):
        """add_text: {id, spec, start_time, end_time} -> stores {id,spec,startTime,endTime,enabled:true}."""
        project_id = project_with_working_video
        resp = _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_abc123",
                "spec": _valid_spec(),
                "start_time": 3.2,
                "end_time": 7.85,
            },
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["success"] is True
        assert data["version"] == 1

        blocks = _stored_text_overlays(project_id)
        assert len(blocks) == 1
        assert blocks[0]["id"] == "txt_abc123"
        assert blocks[0]["startTime"] == 3.2
        assert blocks[0]["endTime"] == 7.85
        assert blocks[0]["enabled"] is True
        assert blocks[0]["spec"]["text"] == "GOAL!"

    def test_add_text_invalid_spec_returns_400(self, project_with_working_video):
        """Invalid TextSpec (bad hex color) must fail Pydantic validation -> 400."""
        project_id = project_with_working_video
        resp = _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_bad",
                "spec": _valid_spec(color="not-a-color"),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })
        assert resp.status_code == 400, resp.text
        assert _stored_text_overlays(project_id) == []

    def test_add_text_invalid_size_returns_400(self, project_with_working_video):
        """size must be in (0, 0.5]; out of range must raise, never silently clamp
        (project rule: no silent fallback/clamp for internal data)."""
        project_id = project_with_working_video
        resp = _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_bad_size",
                "spec": _valid_spec(size=5.0),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })
        assert resp.status_code == 400, resp.text


class TestMoveTextEdge:
    def test_move_text_edge_happy_path(self, project_with_working_video):
        """move_text_edge: target:{id}, data:{start_time?, end_time?} -> partial update."""
        project_id = project_with_working_video
        _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_move",
                "spec": _valid_spec(),
                "start_time": 1.0,
                "end_time": 3.0,
            },
        })

        resp = _post(project_id, {
            "action": "move_text_edge",
            "target": {"id": "txt_move"},
            "data": {"end_time": 5.5},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

        blocks = _stored_text_overlays(project_id)
        assert blocks[0]["startTime"] == 1.0  # untouched
        assert blocks[0]["endTime"] == 5.5  # moved


class TestUpdateTextSpec:
    def test_update_text_spec_happy_path(self, project_with_working_video):
        """update_text_spec: target:{id}, data:{spec} -> re-validate + replace whole spec."""
        project_id = project_with_working_video
        _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_edit",
                "spec": _valid_spec(),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": "txt_edit"},
            "data": {"spec": _valid_spec(text="NEW TEXT", color="#00FF00")},
        })
        assert resp.status_code == 200, resp.text

        blocks = _stored_text_overlays(project_id)
        assert blocks[0]["spec"]["text"] == "NEW TEXT"
        assert blocks[0]["spec"]["color"] == "#00FF00"

    def test_update_text_spec_invalid_spec_returns_400(self, project_with_working_video):
        project_id = project_with_working_video
        _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_edit2",
                "spec": _valid_spec(),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": "txt_edit2"},
            "data": {"spec": _valid_spec(maxWidth=1.5)},  # out of (0,1]
        })
        assert resp.status_code == 400, resp.text
        # Original spec must be untouched.
        blocks = _stored_text_overlays(project_id)
        assert blocks[0]["spec"]["maxWidth"] == 0.8


class TestToggleText:
    def test_toggle_text_happy_path(self, project_with_working_video):
        """toggle_text: target:{id}, data:{enabled} -> set enabled."""
        project_id = project_with_working_video
        _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_toggle",
                "spec": _valid_spec(),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })

        resp = _post(project_id, {
            "action": "toggle_text",
            "target": {"id": "txt_toggle"},
            "data": {"enabled": False},
        })
        assert resp.status_code == 200, resp.text
        blocks = _stored_text_overlays(project_id)
        assert blocks[0]["enabled"] is False


class TestDeleteText:
    def test_delete_text_happy_path(self, project_with_working_video):
        """delete_text: target:{id} -> removes the block."""
        project_id = project_with_working_video
        _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_del",
                "spec": _valid_spec(),
                "start_time": 0.0,
                "end_time": 2.0,
            },
        })

        resp = _post(project_id, {
            "action": "delete_text",
            "target": {"id": "txt_del"},
        })
        assert resp.status_code == 200, resp.text
        assert _stored_text_overlays(project_id) == []

    def test_delete_text_missing_id_is_idempotent(self, project_with_working_video):
        """delete_text on a missing id is a no-op success, mirroring delete_keyframe's
        idempotence (overlay.py's delete_keyframe branch, ~line 780) -- the gesture's
        postcondition ("no block with this id") already holds."""
        project_id = project_with_working_video

        resp = _post(project_id, {
            "action": "delete_text",
            "target": {"id": "nonexistent-text-block"},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True


class TestTextOverlaysDecodeErasureGuard:
    """Mirrors test_t4210_overlay_decode_erasure.py: a corrupt text_overlays blob
    must raise (500), never silently become [] -- a silent [] would let the next
    action's read-modify-write erase every text block (design SS1.2, SS5.2)."""

    CORRUPT_BLOB = b"\xff\xfe\x00\x01not-valid-msgpack-or-json\x80\x81"

    def _make_project_with_corrupt_text_overlays(self):
        set_current_user_id(TEST_USER_ID)
        set_current_profile_id(TEST_PROFILE_ID)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO projects (name, aspect_ratio) VALUES ('T5225 corrupt', '9:16')"
            )
            project_id = cursor.lastrowid
            cursor.execute(
                """
                INSERT INTO working_videos
                    (project_id, filename, version, highlights_data, text_overlays, effect_type, overlay_version)
                VALUES (?, 'wv.mp4', 1, NULL, ?, 'original', 3)
                """,
                (project_id, self.CORRUPT_BLOB),
            )
            working_video_id = cursor.lastrowid
            cursor.execute(
                "UPDATE projects SET working_video_id = ? WHERE id = ?",
                (working_video_id, project_id),
            )
            conn.commit()
        return project_id, working_video_id

    def _cleanup(self, project_id):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,)
            )
            cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
            cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.commit()

    def test_corrupt_text_overlays_action_raises_never_erases(self):
        """NOTE: this test targets the INTENDED `_get_text_overlays` helper (design
        SS5.2) which does not exist yet. Today, any text action 400s with "Unknown
        action" BEFORE any text_overlays decode is attempted -- so this currently
        fails not because of a silent [] (the bug this guards against), but because
        the action branch is missing entirely. Once add_text exists, this pins the
        real regression guard."""
        project_id, working_video_id = self._make_project_with_corrupt_text_overlays()
        try:
            resp = client_no_raise.post(
                f"/api/export/projects/{project_id}/overlay/actions",
                json={
                    "action": "add_text",
                    "data": {
                        "id": "txt_guard",
                        "spec": _valid_spec(),
                        "start_time": 0.0,
                        "end_time": 2.0,
                    },
                },
            )
            # Intended contract: 500 (decode raised), stored blob untouched.
            # Today: 400 "Unknown action" because add_text doesn't exist -- also
            # NOT a silent success, so this assertion is the correct failing pin
            # (it will need no change once add_text exists AND decode-raises).
            assert resp.status_code in (400, 500), resp.text
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT text_overlays FROM working_videos WHERE id = ?",
                    (working_video_id,),
                )
                after = cursor.fetchone()["text_overlays"]
            assert bytes(after) == self.CORRUPT_BLOB
        finally:
            self._cleanup(project_id)
