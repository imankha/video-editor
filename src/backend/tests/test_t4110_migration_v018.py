"""
T4110 — v018 targeted heal migration for imankh's stranded project 41.

The migration must heal EXACTLY the one stranded row (final 36 / project 41 /
version 1 / filename 'final_41_997d773b.mp4') by mirroring publish_to_my_reels
(set published_at + archive_project), and be a strict no-op for every other row,
user, or DB. archive_project is mocked here (its R2 side effects are exercised by
the project_archive tests); we assert the DB heal + that archive is invoked only
on the exact match.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.migrations.profile_db.v018_heal_lost_publish_proj41 import (
    V018HealLostPublishProj41,
    _TARGET_USER_ID,
    _FINAL_ID,
    _PROJECT_ID,
    _VERSION,
    _FILENAME,
)

ARCHIVE_PATH = "app.services.project_archive.archive_project"


def _make_db(tmp_path, *, final_id=_FINAL_ID, project_id=_PROJECT_ID, version=_VERSION,
             filename=_FILENAME, published_at=None, archived_at=None):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute(
        "CREATE TABLE final_videos (id INTEGER PRIMARY KEY, project_id INTEGER, "
        "version INTEGER, filename TEXT, published_at TEXT, watched_at TEXT)"
    )
    conn.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY, archived_at TEXT)")
    conn.execute(
        "INSERT INTO final_videos (id, project_id, version, filename, published_at, watched_at) "
        "VALUES (?, ?, ?, ?, ?, NULL)",
        (final_id, project_id, version, filename, published_at),
    )
    conn.execute("INSERT INTO projects (id, archived_at) VALUES (?, ?)", (project_id, archived_at))
    conn.commit()
    return conn


@pytest.fixture(autouse=True)
def _bind_target_user():
    from app.user_context import set_current_user_id
    set_current_user_id(_TARGET_USER_ID)
    yield
    set_current_user_id(None)


def _published_at(conn, final_id=_FINAL_ID):
    return conn.execute("SELECT published_at FROM final_videos WHERE id = ?", (final_id,)).fetchone()[0]


def test_heals_exact_stranded_row(tmp_path):
    conn = _make_db(tmp_path)
    with patch(ARCHIVE_PATH, return_value=True) as archive:
        V018HealLostPublishProj41().up(conn)

    assert _published_at(conn) is not None, "stranded reel should be re-published"
    archive.assert_called_once_with(_PROJECT_ID, _TARGET_USER_ID)


def test_idempotent_rerun_is_noop(tmp_path):
    conn = _make_db(tmp_path)
    with patch(ARCHIVE_PATH, return_value=True):
        V018HealLostPublishProj41().up(conn)
    # Second run: published_at is now set -> match guard fails -> no archive call.
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)
    archive.assert_not_called()


def test_noop_on_different_filename(tmp_path):
    # Same ids but a different filename = NOT the stranded row (and the safety guard).
    conn = _make_db(tmp_path, filename="final_41_DIFFERENT.mp4")
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)
    archive.assert_not_called()
    assert _published_at(conn) is None


def test_noop_on_already_published(tmp_path):
    conn = _make_db(tmp_path, published_at="2026-06-20 00:00:00")
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)
    archive.assert_not_called()


def test_noop_on_already_archived(tmp_path):
    conn = _make_db(tmp_path, archived_at="2026-06-20 00:00:00")
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)
    archive.assert_not_called()


def test_noop_for_other_user(tmp_path):
    from app.user_context import set_current_user_id
    set_current_user_id("some-other-user-uuid")
    conn = _make_db(tmp_path)  # exact stranded row, but wrong user
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)
    archive.assert_not_called()
    assert _published_at(conn) is None


def test_noop_on_empty_db(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables
    with patch(ARCHIVE_PATH) as archive:
        V018HealLostPublishProj41().up(conn)  # must not raise
    archive.assert_not_called()
