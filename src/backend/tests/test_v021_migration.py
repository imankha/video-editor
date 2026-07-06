"""Tests for profile_db v021 — un-publish unframed sweep reels back to drafts.

Reverses the old sweep publish + v020 archive: copies the preserved artifact to
raw_clips/, restores the auto-project to a frameable draft, and deletes the
published reel (dropping its seeded Glicko). Idempotent, tuple-row-factory safe.
"""

import sqlite3
from unittest.mock import patch

from app.migrations.profile_db.v021_unpublish_unframed_sweep_reels import (
    V021UnpublishUnframedSweepReels,
)

USER_ID = "v021-user"
PROFILE_ID = "testdefault"

# Modules to force R2-disabled so the migration runs DB-only (copy is a no-op,
# is_project_archived returns False -> the in-place rebuild path).
_R2_OFF = [
    patch("app.storage.R2_ENABLED", False),
    patch("app.services.project_archive.R2_ENABLED", False),
]


def _make_db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    db_path = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL DEFAULT '',
            rating INTEGER,
            game_id INTEGER,
            video_sequence INTEGER,
            start_time REAL,
            end_time REAL,
            auto_project_id INTEGER
        );
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL,
            is_auto_created INTEGER DEFAULT 0,
            working_video_id INTEGER,
            final_video_id INTEGER,
            archived_at TIMESTAMP,
            restored_at TIMESTAMP
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            raw_clip_version INTEGER,
            width INTEGER,
            height INTEGER,
            fps REAL
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            source_type TEXT,
            game_id INTEGER,
            published_at TIMESTAMP,
            aspect_ratio TEXT,
            rating REAL,
            rd REAL,
            match_count INTEGER DEFAULT 0,
            source_clip_id INTEGER
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER,
            sequence INTEGER,
            video_width INTEGER,
            video_height INTEGER,
            fps REAL
        );
        CREATE TABLE before_after_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            final_video_id INTEGER NOT NULL
        );
    """)
    conn.commit()
    conn.close()
    return db_path


def _seed_sweep_reel(db_path, *, project_id, raw_clip_id, fv_filename,
                     archived=True, with_working_clip=False, rc_filename=""):
    """Seed the state the OLD sweep left: a published auto_ brilliant_clip reel
    + an archived auto-project + its raw_clip (empty filename)."""
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO raw_clips (id, filename, rating, game_id, start_time, end_time, auto_project_id) "
        "VALUES (?, ?, 5, 6, 10.0, 15.0, ?)",
        (raw_clip_id, rc_filename, project_id),
    )
    conn.execute(
        "INSERT INTO projects (id, name, aspect_ratio, is_auto_created, archived_at) "
        "VALUES (?, 'Brilliant Goal', '9:16', 1, ?)",
        (project_id, "2026-06-28T00:00:00Z" if archived else None),
    )
    cur = conn.execute(
        "INSERT INTO final_videos (project_id, filename, source_type, game_id, "
        "published_at, aspect_ratio, rating, rd, match_count, source_clip_id) "
        "VALUES (?, ?, 'brilliant_clip', 6, CURRENT_TIMESTAMP, '16:9', 1500.0, 350.0, 3, ?)",
        (project_id, fv_filename, raw_clip_id),
    )
    fv_id = cur.lastrowid
    conn.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    if with_working_clip:
        conn.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, 0, 1)",
            (project_id, raw_clip_id),
        )
    conn.commit()
    conn.close()
    return fv_id


def _run_v021(db_path):
    conn = sqlite3.connect(str(db_path))  # default tuple row factory, like the runner
    conn.execute("PRAGMA busy_timeout=30000")
    for p in _R2_OFF:
        p.start()
    try:
        V021UnpublishUnframedSweepReels().up(conn)
    finally:
        for p in _R2_OFF:
            p.stop()
        conn.close()


def test_unpublishes_and_restores_draft(tmp_path):
    db = _make_db(tmp_path)
    fv_id = _seed_sweep_reel(db, project_id=100, raw_clip_id=50,
                             fv_filename="auto_6_50_abcd.mp4")

    _run_v021(db)

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    # (c) reel un-published -> leaves My Reels
    assert conn.execute("SELECT COUNT(*) FROM final_videos").fetchone()[0] == 0
    # (b) draft restored: un-archived, final_video_id cleared, working_clip rebuilt
    proj = conn.execute("SELECT archived_at, final_video_id FROM projects WHERE id = 100").fetchone()
    assert proj["archived_at"] is None
    assert proj["final_video_id"] is None
    wc = conn.execute("SELECT raw_clip_id FROM working_clips WHERE project_id = 100").fetchall()
    assert len(wc) == 1 and wc[0]["raw_clip_id"] == 50
    # (a) preserved artifact wired as the clip's source
    rc = conn.execute("SELECT filename FROM raw_clips WHERE id = 50").fetchone()
    assert rc["filename"] == "auto_6_50_abcd.mp4"
    conn.close()
    assert fv_id  # sanity


def test_repoints_to_surviving_real_export(tmp_path):
    """A project framed BEFORE the sweep detonation still has a real 9:16 export
    (a non-auto final_videos row) even though the sweep's auto_ reel overwrote
    its final_video_id. v021 must re-point the pointer to that surviving export
    rather than orphaning it -- the proj-48 "Done card, no preview button" bug."""
    db = _make_db(tmp_path)
    # The sweep's auto_ reel currently owns the project's final_video_id.
    auto_fv = _seed_sweep_reel(db, project_id=100, raw_clip_id=50,
                               fv_filename="auto_6_50_abcd.mp4",
                               archived=False, with_working_clip=True)
    # The user's real framed 9:16 export that predates the sweep (non-auto,
    # unpublished draft -> published_at NULL, like dev fv 27).
    conn = sqlite3.connect(str(db))
    cur = conn.execute(
        "INSERT INTO final_videos (project_id, filename, source_type, game_id, "
        "published_at, aspect_ratio, source_clip_id) "
        "VALUES (?, 'final_100_real.mp4', 'brilliant_clip', 6, NULL, '9:16', 50)",
        (100,),
    )
    real_fv = cur.lastrowid
    conn.commit()
    conn.close()

    _run_v021(db)

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    # auto_ reel un-published; the real export survives.
    survivors = [r["filename"] for r in conn.execute(
        "SELECT filename FROM final_videos").fetchall()]
    assert survivors == ["final_100_real.mp4"]
    # Pointer re-pointed to the real export -> preview button returns.
    proj = conn.execute(
        "SELECT final_video_id FROM projects WHERE id = 100").fetchone()
    assert proj["final_video_id"] == real_fv
    conn.close()
    assert auto_fv  # sanity


def test_idempotent_second_run_is_noop(tmp_path):
    db = _make_db(tmp_path)
    _seed_sweep_reel(db, project_id=100, raw_clip_id=50, fv_filename="auto_6_50_abcd.mp4")

    _run_v021(db)
    _run_v021(db)  # must not raise, must not resurrect anything

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    assert conn.execute("SELECT COUNT(*) FROM final_videos").fetchone()[0] == 0
    assert conn.execute(
        "SELECT COUNT(*) FROM working_clips WHERE project_id = 100"
    ).fetchone()[0] == 1  # not duplicated
    rc = conn.execute("SELECT filename FROM raw_clips WHERE id = 50").fetchone()
    assert rc["filename"] == "auto_6_50_abcd.mp4"  # not clobbered
    conn.close()


def test_does_not_clobber_existing_raw_filename(tmp_path):
    """If the raw_clip already has a source filename, it is not overwritten."""
    db = _make_db(tmp_path)
    _seed_sweep_reel(db, project_id=100, raw_clip_id=50,
                     fv_filename="auto_6_50_abcd.mp4", rc_filename="user_upload.mp4")

    _run_v021(db)

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    rc = conn.execute("SELECT filename FROM raw_clips WHERE id = 50").fetchone()
    assert rc["filename"] == "user_upload.mp4"
    conn.close()


def test_sweeps_dangling_before_after_tracks(tmp_path):
    """A before_after_tracks row referencing the deleted reel is swept (FK
    enforcement is off during migration)."""
    db = _make_db(tmp_path)
    fv_id = _seed_sweep_reel(db, project_id=100, raw_clip_id=50,
                             fv_filename="auto_6_50_abcd.mp4")
    conn = sqlite3.connect(str(db))
    conn.execute("INSERT INTO before_after_tracks (final_video_id) VALUES (?)", (fv_id,))
    conn.commit()
    conn.close()

    _run_v021(db)

    conn = sqlite3.connect(str(db))
    assert conn.execute("SELECT COUNT(*) FROM before_after_tracks").fetchone()[0] == 0
    conn.close()


def test_leaves_non_auto_published_reels_untouched(tmp_path):
    """Only auto_ brilliant_clip reels are swept; a normal published reel stays."""
    db = _make_db(tmp_path)
    conn = sqlite3.connect(str(db))
    conn.execute(
        "INSERT INTO final_videos (project_id, filename, source_type, game_id, "
        "published_at, aspect_ratio) VALUES (?, ?, 'multi_clip', 6, CURRENT_TIMESTAMP, '9:16')",
        (200, "user_reel.mp4"),
    )
    conn.commit()
    conn.close()

    _run_v021(db)

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT filename FROM final_videos").fetchall()
    conn.close()
    assert len(rows) == 1 and rows[0]["filename"] == "user_reel.mp4"
