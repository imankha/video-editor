"""T5225 base + T6630 round 4 reframe: Overlay text -- backend action handlers.

T6630 round 4: a text REGION is a time span containing N ELEMENTS that render
simultaneously during it (design: "adding a text element is not adding a text
region"). `add_text` creates EITHER a region (+ its first element, when
data.region_id is absent/unknown) OR appends an element to an EXISTING region
(when data.region_id names one) -- ONE action, no second add path.
move_text_edge targets a REGION; update_text_spec/toggle_text/delete_text
target an ELEMENT (searched across every region); delete_text_region deletes
a region and every element inside it in one write.

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


def _add_region(project_id, region_id, start=0.0, end=2.0, **spec_overrides):
    """Helper: create a region (no data.region_id -> region-creation branch)."""
    resp = _post(project_id, {
        "action": "add_text",
        "data": {
            "id": region_id,
            "spec": _valid_spec(**spec_overrides),
            "start_time": start,
            "end_time": end,
        },
    })
    assert resp.status_code == 200, resp.text
    return resp


class TestAddTextCreatesRegion:
    def test_add_text_with_no_region_id_creates_a_region_with_one_element(self, project_with_working_video):
        """add_text (no region_id): {id, spec, start_time, end_time} -> a REGION
        `{id, startTime, endTime, elements:[{id, spec, enabled:true}]}`."""
        project_id = project_with_working_video
        resp = _add_region(project_id, "txt_abc123", start=3.2, end=7.85)
        data = resp.json()
        assert data["success"] is True
        assert data["version"] == 1

        regions = _stored_text_overlays(project_id)
        assert len(regions) == 1
        region = regions[0]
        assert region["id"] == "txt_abc123"
        assert region["startTime"] == 3.2
        assert region["endTime"] == 7.85
        assert len(region["elements"]) == 1
        element = region["elements"][0]
        assert element["id"] == "txt_abc123_el0"  # derived id, mirrors v039's convention
        assert element["enabled"] is True
        assert element["spec"]["text"] == "GOAL!"

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

    def test_add_text_missing_start_time_when_creating_region_returns_400(self, project_with_working_video):
        project_id = project_with_working_video
        resp = _post(project_id, {
            "action": "add_text",
            "data": {"id": "txt_no_start", "spec": _valid_spec()},
        })
        assert resp.status_code == 400, resp.text


class TestAddTextAppendsElementToExistingRegion:
    def test_add_text_with_region_id_appends_an_element_not_a_new_region(self, project_with_working_video):
        """The bug this guards: two 'add text' gestures used to create two
        SEPARATE time spans that could never render together ('only the second
        one showed up'). With data.region_id set to an existing region, the
        SAME region gains a second element -- ONE region, TWO elements."""
        project_id = project_with_working_video
        _add_region(project_id, "region_1", start=0.0, end=4.0, text="First")

        resp = _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "el_second",
                "spec": _valid_spec(text="Second"),
                "region_id": "region_1",
            },
        })
        assert resp.status_code == 200, resp.text

        regions = _stored_text_overlays(project_id)
        assert len(regions) == 1  # still ONE region, not two
        region = regions[0]
        assert region["startTime"] == 0.0 and region["endTime"] == 4.0  # timing unchanged
        assert len(region["elements"]) == 2
        texts = {el["spec"]["text"] for el in region["elements"]}
        assert texts == {"First", "Second"}

    def test_add_text_never_touches_a_sibling_elements_enabled_state(self, project_with_working_video):
        """Round-4 investigation: adding an element must NEVER flip another
        element's enabled flag."""
        project_id = project_with_working_video
        _add_region(project_id, "region_1", text="First")
        first_element_id = _stored_text_overlays(project_id)[0]["elements"][0]["id"]

        _post(project_id, {
            "action": "add_text",
            "data": {"id": "el_second", "spec": _valid_spec(text="Second"), "region_id": "region_1"},
        })

        regions = _stored_text_overlays(project_id)
        first = next(el for el in regions[0]["elements"] if el["id"] == first_element_id)
        assert first["enabled"] is True  # untouched by the second add

    def test_add_text_with_unknown_region_id_falls_back_to_creating_a_region(self, project_with_working_video):
        """A region_id that doesn't (yet) exist is NOT an error -- it creates a
        new region, same as omitting region_id entirely."""
        project_id = project_with_working_video
        resp = _post(project_id, {
            "action": "add_text",
            "data": {
                "id": "txt_new",
                "spec": _valid_spec(),
                "start_time": 1.0,
                "end_time": 3.0,
                "region_id": "does-not-exist",
            },
        })
        assert resp.status_code == 200, resp.text
        regions = _stored_text_overlays(project_id)
        assert len(regions) == 1
        assert regions[0]["id"] == "txt_new"


class TestMoveTextEdge:
    def test_move_text_edge_targets_the_region_not_an_element(self, project_with_working_video):
        """move_text_edge: target:{id=region_id}, data:{start_time?, end_time?}
        -> partial update of the REGION's timing; elements untouched."""
        project_id = project_with_working_video
        _add_region(project_id, "txt_move", start=1.0, end=3.0)

        resp = _post(project_id, {
            "action": "move_text_edge",
            "target": {"id": "txt_move"},
            "data": {"end_time": 5.5},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

        regions = _stored_text_overlays(project_id)
        assert regions[0]["startTime"] == 1.0  # untouched
        assert regions[0]["endTime"] == 5.5  # moved
        assert len(regions[0]["elements"]) == 1  # elements unaffected


class TestUpdateTextSpec:
    def test_update_text_spec_targets_an_element_across_regions(self, project_with_working_video):
        """update_text_spec: target:{id=element_id}, data:{spec} -> re-validate +
        replace that ONE element's whole spec, found by searching every region."""
        project_id = project_with_working_video
        _add_region(project_id, "txt_edit")
        element_id = _stored_text_overlays(project_id)[0]["elements"][0]["id"]

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": element_id},
            "data": {"spec": _valid_spec(text="NEW TEXT", color="#00FF00")},
        })
        assert resp.status_code == 200, resp.text

        regions = _stored_text_overlays(project_id)
        element = regions[0]["elements"][0]
        assert element["spec"]["text"] == "NEW TEXT"
        assert element["spec"]["color"] == "#00FF00"

    def test_update_text_spec_on_a_freshly_created_regions_own_seed_element(
        self, project_with_working_video
    ):
        """T6630 round 5 regression: a brand-new region's FIRST edit (type
        text / move preset) before any second element exists must not 404.

        This must NOT read the element id back from stored state (that was
        already covered by test_update_text_spec_targets_an_element_across_
        regions above, and passed even while the real bug shipped -- the bug
        was client-side: useTextOverlays.js's addRegion minted its OWN
        random id for the seed element instead of the derived id the backend
        actually stores, so the id the frontend held in selectedElementId
        never matched anything server-side). Compute the id the FIXED
        frontend now computes independently (`${region_id}_el0`, matching
        overlay.py's own derivation) and use THAT directly, mirroring the
        real wire sequence with no extra round trip.
        """
        project_id = project_with_working_video
        region_id = "txt_seed_edit"
        _add_region(project_id, region_id)
        frontend_derived_element_id = f"{region_id}_el0"

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": frontend_derived_element_id},
            "data": {"spec": _valid_spec(text="EDITED SEED")},
        })
        assert resp.status_code == 200, resp.text  # NOT a 404 "Text element ... not found"

        regions = _stored_text_overlays(project_id)
        assert regions[0]["elements"][0]["id"] == frontend_derived_element_id
        assert regions[0]["elements"][0]["spec"]["text"] == "EDITED SEED"

    def test_update_text_spec_invalid_spec_returns_400(self, project_with_working_video):
        project_id = project_with_working_video
        _add_region(project_id, "txt_edit2")
        element_id = _stored_text_overlays(project_id)[0]["elements"][0]["id"]

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": element_id},
            "data": {"spec": _valid_spec(maxWidth=1.5)},  # out of (0,1]
        })
        assert resp.status_code == 400, resp.text
        # Original spec must be untouched.
        regions = _stored_text_overlays(project_id)
        assert regions[0]["elements"][0]["spec"]["maxWidth"] == 0.8

    def test_update_text_spec_edits_the_right_element_when_region_has_two(self, project_with_working_video):
        """Editing one element in a multi-element region must NOT touch the
        other element's spec -- proves _find_text_element locates the exact
        element, not just the first one in the region."""
        project_id = project_with_working_video
        _add_region(project_id, "region_1", text="First")
        _post(project_id, {
            "action": "add_text",
            "data": {"id": "el_second", "spec": _valid_spec(text="Second"), "region_id": "region_1"},
        })

        resp = _post(project_id, {
            "action": "update_text_spec",
            "target": {"id": "el_second"},
            "data": {"spec": _valid_spec(text="Second Edited")},
        })
        assert resp.status_code == 200, resp.text

        regions = _stored_text_overlays(project_id)
        texts = {el["id"]: el["spec"]["text"] for el in regions[0]["elements"]}
        assert texts["el_second"] == "Second Edited"
        first_element_id = next(eid for eid in texts if eid != "el_second")
        assert texts[first_element_id] == "First"  # sibling untouched


class TestToggleText:
    def test_toggle_text_targets_an_element(self, project_with_working_video):
        """toggle_text: target:{id=element_id}, data:{enabled} -> set that
        element's enabled."""
        project_id = project_with_working_video
        _add_region(project_id, "txt_toggle")
        element_id = _stored_text_overlays(project_id)[0]["elements"][0]["id"]

        resp = _post(project_id, {
            "action": "toggle_text",
            "target": {"id": element_id},
            "data": {"enabled": False},
        })
        assert resp.status_code == 200, resp.text
        regions = _stored_text_overlays(project_id)
        assert regions[0]["elements"][0]["enabled"] is False


class TestDeleteText:
    def test_delete_text_removes_the_element_and_the_now_empty_region(self, project_with_working_video):
        """delete_text: target:{id=element_id} -> removes the element; since a
        region always has >=1 element in the UI's model, deleting the LAST
        element of a region deletes the region record too."""
        project_id = project_with_working_video
        _add_region(project_id, "txt_del")
        element_id = _stored_text_overlays(project_id)[0]["elements"][0]["id"]

        resp = _post(project_id, {
            "action": "delete_text",
            "target": {"id": element_id},
        })
        assert resp.status_code == 200, resp.text
        assert _stored_text_overlays(project_id) == []  # region gone too

    def test_delete_text_removes_only_that_element_when_region_has_more(self, project_with_working_video):
        project_id = project_with_working_video
        _add_region(project_id, "region_1", text="First")
        _post(project_id, {
            "action": "add_text",
            "data": {"id": "el_second", "spec": _valid_spec(text="Second"), "region_id": "region_1"},
        })

        resp = _post(project_id, {"action": "delete_text", "target": {"id": "el_second"}})
        assert resp.status_code == 200, resp.text

        regions = _stored_text_overlays(project_id)
        assert len(regions) == 1  # region survives
        assert len(regions[0]["elements"]) == 1
        assert regions[0]["elements"][0]["spec"]["text"] == "First"

    def test_delete_text_missing_id_is_idempotent(self, project_with_working_video):
        """delete_text on a missing id is a no-op success, mirroring delete_keyframe's
        idempotence (overlay.py's delete_keyframe branch, ~line 780) -- the gesture's
        postcondition ("no element with this id") already holds."""
        project_id = project_with_working_video

        resp = _post(project_id, {
            "action": "delete_text",
            "target": {"id": "nonexistent-text-element"},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True


class TestDeleteTextRegion:
    def test_delete_text_region_removes_region_and_all_elements_in_one_write(self, project_with_working_video):
        project_id = project_with_working_video
        _add_region(project_id, "region_1", text="First")
        _post(project_id, {
            "action": "add_text",
            "data": {"id": "el_second", "spec": _valid_spec(text="Second"), "region_id": "region_1"},
        })
        assert len(_stored_text_overlays(project_id)[0]["elements"]) == 2

        resp = _post(project_id, {"action": "delete_text_region", "target": {"id": "region_1"}})
        assert resp.status_code == 200, resp.text
        assert _stored_text_overlays(project_id) == []

    def test_delete_text_region_missing_id_is_idempotent(self, project_with_working_video):
        project_id = project_with_working_video
        resp = _post(project_id, {"action": "delete_text_region", "target": {"id": "nonexistent-region"}})
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

    def test_delete_text_region_does_not_touch_other_regions(self, project_with_working_video):
        project_id = project_with_working_video
        _add_region(project_id, "region_1", text="Keep me")
        _add_region(project_id, "region_2", text="Delete me")

        resp = _post(project_id, {"action": "delete_text_region", "target": {"id": "region_2"}})
        assert resp.status_code == 200, resp.text

        regions = _stored_text_overlays(project_id)
        assert len(regions) == 1
        assert regions[0]["id"] == "region_1"


class TestTextOverlaysDecodeErasureGuard:
    """Mirrors test_t4210_overlay_decode_erasure.py: a corrupt text_overlays blob
    must raise (500), never silently become [] -- a silent [] would let the next
    action's read-modify-write erase every text region (design SS1.2, SS5.2)."""

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
            # _get_text_overlays raises on decode failure (never returns []);
            # the router's outer handler maps msgpack's ExtraData (a ValueError
            # subclass) to 400, not 500 -- pre-existing, unrelated to the
            # region/element reframe. The assertion that matters is the second
            # one: the stored blob is untouched, proving the raise happened
            # BEFORE any read-modify-write could erase it.
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
