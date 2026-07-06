"""Tests for profile_db v022 -- re-point final_video_id pointers orphaned by v021.

v021's original null-out left a framed project's real export unreferenced: the
final_videos row survives (Done card) but final_video_id is NULL, so the preview
button never renders. v022 re-points the pointer to the latest surviving real
(non-auto) export. Never-framed drafts (no final row) are left untouched.
"""

import sqlite3

from app.migrations.profile_db.v022_repoint_orphaned_final_video import (
    V022RepointOrphanedFinalVideo,
)


def _make_db(tmp_path):
    db_path = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL,
            final_video_id INTEGER,
            archived_at TIMESTAMP
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            source_type TEXT,
            published_at TIMESTAMP,
            aspect_ratio TEXT
        );
    """)
    conn.commit()
    conn.close()
    return db_path


def _add_project(db_path, *, project_id, final_video_id=None):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO projects (id, name, aspect_ratio, final_video_id) "
        "VALUES (?, 'Reel', '9:16', ?)",
        (project_id, final_video_id),
    )
    conn.commit()
    conn.close()


def _add_final(db_path, *, project_id, filename, version=1, published=False):
    conn = sqlite3.connect(str(db_path))
    cur = conn.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, "
        "published_at, aspect_ratio) VALUES (?, ?, ?, 'brilliant_clip', ?, '9:16')",
        (project_id, filename, version, "2026-06-01 00:00:00" if published else None),
    )
    fv_id = cur.lastrowid
    conn.commit()
    conn.close()
    return fv_id


def _run_v022(db_path):
    conn = sqlite3.connect(str(db_path))  # default tuple row factory, like the runner
    try:
        V022RepointOrphanedFinalVideo().up(conn)
    finally:
        conn.close()


def test_repoints_orphaned_pointer(tmp_path):
    """The core bug: NULL pointer + a surviving real export -> re-point to it."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=48, final_video_id=None)
    fv = _add_final(db, project_id=48, filename="final_48_real.mp4")

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 48").fetchone()
    conn.close()
    assert proj["final_video_id"] == fv


def test_repoints_to_latest_version(tmp_path):
    """Multiple exports for one project -> re-point to the newest (version DESC)."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=48, final_video_id=None)
    _add_final(db, project_id=48, filename="final_48_v1.mp4", version=1)
    latest = _add_final(db, project_id=48, filename="final_48_v2.mp4", version=2)

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 48").fetchone()
    conn.close()
    assert proj[0] == latest


def test_leaves_never_framed_draft_untouched(tmp_path):
    """A draft with NO final_videos row keeps final_video_id NULL."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=29, final_video_id=None)

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 29").fetchone()
    conn.close()
    assert proj[0] is None


def test_leaves_healthy_pointer_untouched(tmp_path):
    """A project whose final_video_id already points at its export is unchanged."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=50, final_video_id=999)
    _add_final(db, project_id=50, filename="final_50_real.mp4")  # a different, newer row

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 50").fetchone()
    conn.close()
    assert proj[0] == 999  # not overwritten -- only NULL pointers are healed


def test_ignores_auto_only_final(tmp_path):
    """A project whose only surviving final is a raw auto_ reel stays NULL --
    v022 must never point a preview at a raw 16:9 sweep artifact."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=60, final_video_id=None)
    _add_final(db, project_id=60, filename="auto_6_60_dead.mp4")

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 60").fetchone()
    conn.close()
    assert proj[0] is None


def test_repoints_published_survivor_too(tmp_path):
    """A real orphan's export can itself be published (dev proj 48's fv 27 was
    published after the fact), so v022 must NOT filter on published_at -- it
    re-points to the latest surviving non-auto final regardless of published
    state. This also re-points the rarer keep_prior-share-then-delete case, which
    is intentional and harmless (the share is served by its own id)."""
    db = _make_db(tmp_path)
    _add_project(db, project_id=70, final_video_id=None)
    fv = _add_final(db, project_id=70, filename="final_70_pub.mp4", published=True)

    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 70").fetchone()
    conn.close()
    assert proj[0] == fv  # published survivor re-pointed, not skipped


def test_idempotent_second_run_is_noop(tmp_path):
    db = _make_db(tmp_path)
    _add_project(db, project_id=48, final_video_id=None)
    fv = _add_final(db, project_id=48, filename="final_48_real.mp4")

    _run_v022(db)
    _run_v022(db)

    conn = sqlite3.connect(str(db))
    proj = conn.execute("SELECT final_video_id FROM projects WHERE id = 48").fetchone()
    conn.close()
    assert proj[0] == fv
