"""
T8070 — export-completion refreshes the reel-source window to each clip's CURRENT
boundaries. Covers the export write sites that are directly callable:

- upsert_working_video (multi-clip Focus finalize, export_finalize.py)
- _finalize_overlay_export (shared Overlay finalize, overlay.py)

Both must re-freeze raw_clips.reel_source_start_time/end_time = the clip's current
start/end, so a clip edited AFTER producing a reel becomes non-stale again once
its reel is re-exported against the new window.

The single-clip framing endpoint (export/framing.py) and the inline export_final
endpoint use the same UPDATE shape and are exercised by the QA live-drive; this
file locks the two shared/unit-callable finalizers.

Uses the test_t4010 `db` fixture (patched USER_DATA_BASE + real ensure_database,
so the fresh DDL under test includes the v049 columns).
"""

import sqlite3
import uuid
from unittest.mock import patch

import pytest

USER_ID = "t8070-refresh-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _reel_source(db_path, raw_clip_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT start_time, end_time, reel_source_start_time, reel_source_end_time "
        "FROM raw_clips WHERE id = ?",
        (raw_clip_id,),
    ).fetchone()
    conn.close()
    return row


# ------------------------------------------------- multi-clip Focus finalize -

def _seed_project_with_clip(db_path, start, end, reel_source):
    """A project + one raw_clip (with a seeded reel_source) + a latest working
    clip linking them. Returns (project_id, raw_clip_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T8070', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, "
        "reel_source_start_time, reel_source_end_time) VALUES ('raw.mp4', 4, ?, ?, ?, ?)",
        (start, end, reel_source[0], reel_source[1]),
    )
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) VALUES (?, ?, 1, 0)",
        (project_id, raw_clip_id),
    )
    conn.commit()
    conn.close()
    return project_id, raw_clip_id


def _make_job(db_path, project_id):
    from app.utils.encoding import encode_data
    export_id = f"exp-{uuid.uuid4().hex[:8]}"
    conn = _connect(db_path)
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data, stage) "
        "VALUES (?, ?, 'framing', 'processing', ?, 'rendered')",
        (export_id, project_id, encode_data({"clips": [{"clipIndex": 0, "duration": 5.0}]})),
    )
    conn.commit()
    conn.close()
    return {"id": export_id, "project_id": project_id, "input_data": None,
            "stage": "rendered", "status": "processing", "output_video_id": None}


def test_upsert_working_video_refreshes_reel_source_to_current(db):
    """Multi-clip Focus finalize re-freezes reel_source_* to the clip's CURRENT
    boundaries (which have drifted from the previous snapshot)."""
    from app.services import export_finalize as ef
    from app.utils.encoding import encode_data

    # clip was produced at [0,5]; user then edited boundaries to [1,7]; snapshot
    # still holds the OLD window until this export re-freezes it.
    project_id, raw_clip_id = _seed_project_with_clip(db, 1.0, 7.0, reel_source=(0.0, 5.0))
    before = _reel_source(db, raw_clip_id)
    assert before["reel_source_start_time"] == 0.0

    job = _make_job(db, project_id)
    ef.upsert_working_video(job, filename="wv.mp4", duration=6.0,
                            highlights_data=encode_data([]), detections_data=None)

    after = _reel_source(db, raw_clip_id)
    assert after["reel_source_start_time"] == 1.0   # refreshed to current
    assert after["reel_source_end_time"] == 7.0


# --------------------------------------------------- shared Overlay finalize -

def test_finalize_overlay_export_refreshes_reel_source_to_current(db):
    """Overlay finalize re-freezes reel_source_* to the clip's CURRENT boundaries."""
    from app.routers.export import overlay

    project_id, raw_clip_id = _seed_project_with_clip(db, 2.0, 8.0, reel_source=(0.0, 5.0))
    # give the project a working video so metadata freeze has something to read
    conn = _connect(db)
    conn.execute("INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, 'wv.mp4', 1, 6.0)",
                 (project_id,))
    wv_id = conn.execute("SELECT id FROM working_videos WHERE project_id = ?", (project_id,)).fetchone()[0]
    conn.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, project_id))
    from app.utils.encoding import encode_data
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
        "VALUES ('exp-ov-t8070', ?, 'overlay', 'processing', ?)",
        (project_id, encode_data({"clips": []})),
    )
    conn.commit()
    conn.close()

    with patch.object(overlay, "delete_from_r2", return_value=True), \
         patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
         patch("app.analytics.record_milestone"):
        overlay._finalize_overlay_export(project_id, "final.mp4", "exp-ov-t8070", USER_ID)

    after = _reel_source(db, raw_clip_id)
    assert after["reel_source_start_time"] == 2.0   # refreshed to current
    assert after["reel_source_end_time"] == 8.0
