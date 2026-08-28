"""Tests for profile_db v048 -- delete sweep-signature orphan raw_clips/ extracts.

Packages scripts/cleanup_orphan_raw_clips.py's reviewed classification logic
(app/services/orphan_raw_clips.py) as a migration that runs through the normal
migrate endpoint. Only `auto_` (sweep-signature) unreferenced objects are ever
deleted; both raw_clips.filename and working_clips.uploaded_filename count as
live references; non-sweep unreferenced objects are left untouched.
"""

import sqlite3
from unittest.mock import patch

from app.migrations.profile_db.v048_cleanup_sweep_orphan_raw_clips import (
    V048CleanupSweepOrphanRawClips,
)

USER_ID = "v048-user"


def _make_db(tmp_path):
    db_path = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            uploaded_filename TEXT
        );
    """)
    conn.commit()
    conn.close()
    return db_path


def _run_v048(db_path, *, r2_enabled=True, objects=None, delete_ok=True, user_id=USER_ID):
    """Run v048 with R2 mocked: list_raw_clip_objects returns `objects`,
    delete_from_r2 always returns `delete_ok`, get_current_user_id returns
    `user_id`. Returns the list of (user_id, rel_path) actually "deleted"."""
    objects = objects or []
    deleted_calls = []

    def fake_delete(uid, rel_path):
        deleted_calls.append((uid, rel_path))
        return delete_ok

    conn = sqlite3.connect(str(db_path))  # default tuple row factory, like the runner
    conn.execute("PRAGMA busy_timeout=30000")
    with patch("app.storage.R2_ENABLED", r2_enabled), \
         patch("app.services.orphan_raw_clips.list_raw_clip_objects", return_value=objects), \
         patch("app.storage.delete_from_r2", side_effect=fake_delete), \
         patch("app.user_context.get_current_user_id", return_value=user_id):
        V048CleanupSweepOrphanRawClips().up(conn)
    conn.close()
    return deleted_calls


def test_deletes_sweep_signature_orphan(tmp_path):
    db = _make_db(tmp_path)
    deleted = _run_v048(
        db, objects=[("raw_clips/auto_1_2_abcd1234.mp4", 100)],
    )
    assert deleted == [(USER_ID, "raw_clips/auto_1_2_abcd1234.mp4")]


def test_does_not_delete_non_sweep_unreferenced_object(tmp_path):
    db = _make_db(tmp_path)
    deleted = _run_v048(
        db, objects=[("raw_clips/9f8e7d6c5b4a.mp4", 100)],
    )
    assert deleted == []


def test_does_not_delete_object_referenced_via_raw_clips_filename(tmp_path):
    db = _make_db(tmp_path)
    conn = sqlite3.connect(str(db))
    conn.execute("INSERT INTO raw_clips (filename) VALUES ('auto_1_2_abcd1234.mp4')")
    conn.commit()
    conn.close()

    deleted = _run_v048(
        db, objects=[("raw_clips/auto_1_2_abcd1234.mp4", 100)],
    )
    assert deleted == []


def test_does_not_delete_object_referenced_via_working_clips_uploaded_filename(tmp_path):
    """T7830's review finding: an uploaded multi-clip source (referenced only via
    working_clips.uploaded_filename, never raw_clips.filename) must never be
    misclassified as an orphan and deleted -- even if it happens to match the
    auto_ sweep-signature naming."""
    db = _make_db(tmp_path)
    conn = sqlite3.connect(str(db))
    conn.execute(
        "INSERT INTO working_clips (project_id, uploaded_filename) VALUES (1, 'auto_1_2_abcd1234.mp4')"
    )
    conn.commit()
    conn.close()

    deleted = _run_v048(
        db, objects=[("raw_clips/auto_1_2_abcd1234.mp4", 100)],
    )
    assert deleted == []


def test_noop_when_r2_disabled(tmp_path):
    db = _make_db(tmp_path)
    deleted = _run_v048(
        db, r2_enabled=False, objects=[("raw_clips/auto_1_2_abcd1234.mp4", 100)],
    )
    assert deleted == []


def test_rerun_after_cleanup_is_noop(tmp_path):
    """Idempotent: once the DB has been updated to reference the (surviving)
    object, or the object is simply gone from the listing, a re-run deletes
    nothing further."""
    db = _make_db(tmp_path)
    # First run: orphan present and gets deleted.
    first = _run_v048(db, objects=[("raw_clips/auto_1_2_abcd1234.mp4", 100)])
    assert len(first) == 1

    # Second run: the object no longer appears in the R2 listing (as it would
    # not, having been deleted) -- must be a safe no-op.
    second = _run_v048(db, objects=[])
    assert second == []
