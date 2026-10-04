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
    from app.services import publish_final_video

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

    with patch.object(publish_final_video, "delete_from_r2", return_value=True), \
         patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
         patch("app.analytics.record_milestone"):
        overlay._finalize_overlay_export(project_id, "final.mp4", "exp-ov-t8070", USER_ID)

    after = _reel_source(db, raw_clip_id)
    assert after["reel_source_start_time"] == 2.0   # refreshed to current
    assert after["reel_source_end_time"] == 8.0


# -------------------- T11430 fixround2: PER-PROJECT snapshot refresh (BLOCKING) -

def _project_reel_source(db_path, project_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT reel_source_start_time, reel_source_end_time FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()
    conn.close()
    return row


def _seed_sibling_projects(db_path, play_start, play_end):
    """ONE raw_clip (the play) with TWO highlight projects (P1 exported-target,
    P2 sibling), each with its own frozen projects.reel_source snapshot and a
    latest working clip. Returns (raw_clip_id, p1_id, p2_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, "
        "reel_source_start_time, reel_source_end_time) VALUES ('raw.mp4', 5, ?, ?, ?, ?)",
        (play_start, play_end, 10.0, 20.0),
    )
    raw_clip_id = cur.lastrowid
    ids = []
    for ordinal in (1, 2):
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created, source_raw_clip_id, "
            "highlight_ordinal, reel_source_start_time, reel_source_end_time) "
            "VALUES (?, '9:16', 1, ?, ?, 10.0, 20.0)",
            (f"P{ordinal}", raw_clip_id, ordinal),
        )
        pid = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) VALUES (?, ?, 1, 0)",
            (pid, raw_clip_id),
        )
        ids.append(pid)
    conn.commit()
    conn.close()
    return raw_clip_id, ids[0], ids[1]


def test_upsert_working_video_refreshes_only_exported_projects_snapshot(db):
    """fixround2 BLOCKING: exporting P1 refreshes P1's OWN projects.reel_source to
    the play's current boundaries, while its SIBLING P2 keeps its independent
    frozen snapshot (per-instance staleness must stay independent)."""
    from app.services import export_finalize as ef
    from app.utils.encoding import encode_data

    # Play created at [10,20] (both snapshots frozen there), then trimmed to [12,20].
    raw_clip_id, p1, p2 = _seed_sibling_projects(db, 12.0, 20.0)
    assert _project_reel_source(db, p1)["reel_source_start_time"] == 10.0
    assert _project_reel_source(db, p2)["reel_source_start_time"] == 10.0

    job = _make_job(db, p1)
    ef.upsert_working_video(job, filename="wv.mp4", duration=8.0,
                            highlights_data=encode_data([]), detections_data=None)

    p1_after = _project_reel_source(db, p1)
    p2_after = _project_reel_source(db, p2)
    # Exported project re-froze to the play's CURRENT boundaries.
    assert (p1_after["reel_source_start_time"], p1_after["reel_source_end_time"]) == (12.0, 20.0)
    # Sibling is untouched (independence holds).
    assert (p2_after["reel_source_start_time"], p2_after["reel_source_end_time"]) == (10.0, 20.0)


def test_publish_finalize_refreshes_only_exported_projects_snapshot(db):
    """fixround2 BLOCKING, publish path: the shared publish finalizer
    (publish_final_video.finalize_and_swap_final_video, used by the overlay
    finalize) re-freezes the exported project's OWN snapshot, sibling untouched."""
    from app.routers.export import overlay
    from app.services import publish_final_video

    raw_clip_id, p1, p2 = _seed_sibling_projects(db, 3.0, 9.0)  # play trimmed to [3,9]
    # give P1 a working video for the metadata freeze.
    conn = _connect(db)
    conn.execute("INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, 'wv.mp4', 1, 6.0)", (p1,))
    wv_id = conn.execute("SELECT id FROM working_videos WHERE project_id = ?", (p1,)).fetchone()[0]
    conn.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, p1))
    from app.utils.encoding import encode_data
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
        "VALUES ('exp-ov-fr2', ?, 'overlay', 'processing', ?)",
        (p1, encode_data({"clips": []})),
    )
    conn.commit()
    conn.close()

    with patch.object(publish_final_video, "delete_from_r2", return_value=True), \
         patch("app.services.sharing_db.filename_has_active_share", return_value=False), \
         patch("app.analytics.record_milestone"):
        overlay._finalize_overlay_export(p1, "final.mp4", "exp-ov-fr2", USER_ID)

    p1_after = _project_reel_source(db, p1)
    p2_after = _project_reel_source(db, p2)
    assert (p1_after["reel_source_start_time"], p1_after["reel_source_end_time"]) == (3.0, 9.0)
    assert (p2_after["reel_source_start_time"], p2_after["reel_source_end_time"]) == (10.0, 20.0)
