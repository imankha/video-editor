"""T6900: the projects-list payload exposes `has_crop_keyframes` — whether real
crop keyframes have been committed on any latest clip — so the home screen can
tell "entered the Framing screen" apart from "actually framed" and keep an
un-cropped draft's tile at source aspect.

The signal is `crop_data IS NOT NULL` on the latest working_clips: crop_data is
NULL until a crop gesture, and `normalize_and_encode` collapses empty crops to
NULL at write time, so presence == real keyframes. Distinct from
clips_in_progress / clips_exported, which flip the moment clips enter Framing
regardless of whether any crop was committed (that is the exact bug this feeds).
"""
import uuid

from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.routers.clips import normalize_and_encode
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "00000000-0000-0000-0000-000000000000"


def _new_user():
    uid = f"test_t6900_{uuid.uuid4().hex[:8]}"
    _init_cache[uid] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
    return uid


def _ctx(uid):
    set_current_user_id(uid)
    set_current_profile_id(TEST_PROFILE_ID)


def _make_draft(cursor, *, name, crop=None, exported=False):
    """Seed a project + one working clip. `crop` is a crop-keyframe list (or None
    for no crop); `exported` marks the clip as exported into a working video."""
    cursor.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')", (name,)
    )
    project_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO raw_clips (filename, rating, name) VALUES ('', 5, ?)", (name,)
    )
    clip_id = cursor.lastrowid
    exported_at = "datetime('now')" if exported else "NULL"
    cursor.execute(
        f"""INSERT INTO working_clips
            (project_id, raw_clip_id, sort_order, version, crop_data, exported_at)
            VALUES (?, ?, 0, 1, ?, {exported_at})""",
        (project_id, clip_id, normalize_and_encode(crop)),
    )
    return project_id


# A representative crop-keyframe list, shaped like the client sends.
_CROP = [{"frame": 0, "crop": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8}}]


def _items_by_id(client):
    resp = client.get("/api/projects")
    assert resp.status_code == 200, resp.text
    return {p["id"]: p for p in resp.json()}


def test_has_crop_keyframes_true_only_when_crop_committed():
    """An un-cropped draft that has entered Framing reports has_crop_keyframes
    False; committing crop keyframes flips it True — even though both look
    'In Framing' by the clips counters."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        uncropped = _make_draft(cur, name="Uncropped", crop=None)
        cropped = _make_draft(cur, name="Cropped", crop=_CROP)
        conn.commit()

    items = _items_by_id(client)
    assert items[uncropped]["has_crop_keyframes"] is False
    assert items[cropped]["has_crop_keyframes"] is True


def test_exported_but_uncropped_still_reports_no_crop_keyframes():
    """The core gap: export sets exported_at WITHOUT writing crop_data, so an
    exported-but-never-cropped draft is 'In Framing' (clips_exported > 0) yet
    has NO crop keyframes — it must stay source aspect."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        pid = _make_draft(cur, name="Exported no crop", crop=None, exported=True)
        conn.commit()

    item = _items_by_id(client)[pid]
    assert item["clips_exported"] == 1
    assert item["has_crop_keyframes"] is False


def test_empty_crop_data_normalizes_to_no_keyframes():
    """An empty crop ('[]') normalizes to NULL at write time, so it must NOT
    count as framing applied."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        pid = _make_draft(cur, name="Empty crop", crop=[])
        conn.commit()

    item = _items_by_id(client)[pid]
    assert item["has_crop_keyframes"] is False
