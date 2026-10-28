"""
T13880 -- the projects list derives is_auto_created from the durable
projects.is_auto_created column, not the single raw_clips.auto_project_id pointer
(which only points at the NEWEST highlight of a clip).
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t13880-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def db_path(tmp_path):
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


def test_older_highlight_stays_auto_created(db_path):
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('older', '9:16', 1)")
    older = cur.lastrowid
    cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('newer', '16:9', 1)")
    newer = cur.lastrowid
    cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('manual', '16:9', 0)")
    manual = cur.lastrowid
    conn.commit()
    conn.close()
    # Pointer references only the newest highlight.
    conn = sqlite3.connect(str(db_path))
    cols = [r[1] for r in conn.execute("PRAGMA table_info(raw_clips)")]
    assert "auto_project_id" in cols
    conn.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, auto_project_id) "
        "VALUES ('c.mp4', 5, 0, 1, ?)", (newer,))
    conn.commit()
    conn.close()

    from app.routers.projects import _read_projects_list
    by_id = {p.id: p for p in _read_projects_list()}
    assert by_id[older].is_auto_created is True
    assert by_id[newer].is_auto_created is True
    assert by_id[manual].is_auto_created is False
