"""T11110 — v055 ports persisted "Brilliant ..." derived names to "Highlight ...".

The 5-star adjective shown in the UI became "Highlight" (owner ruling H10,
2026-09-24: "port previous brilliants to highlight"). The rating is an integer so
nothing rating-shaped migrates, but the DERIVED name was persisted at creation for
auto-projects and their published final_videos, so old rows still read "Brilliant
Goal" on disk.

v055 rewrites ONLY provably-derived names:
  - projects: is_auto_created=1, linked raw_clip name empty, name == "Brilliant "
    + tag_part(rc.tags).
  - final_videos: source_type='brilliant_clip', linked raw_clip name empty,
    name == the old derived form.

These tests seed real rows and assert the positive rewrites AND the five
protected cases the migration must NOT touch, plus idempotency.
"""

import sqlite3

from app.migrations.profile_db.v055_port_brilliant_names_to_highlight import (
    V055PortBrilliantNamesToHighlight,
)
from app.utils.encoding import encode_data


def _make_db(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute(
        """CREATE TABLE projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            is_auto_created INTEGER DEFAULT 0
        )"""
    )
    conn.execute(
        """CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY,
            name TEXT,
            rating INTEGER,
            tags BLOB,
            auto_project_id INTEGER
        )"""
    )
    conn.execute(
        """CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY,
            name TEXT,
            source_type TEXT,
            source_clip_id INTEGER
        )"""
    )
    conn.commit()
    return conn


def _add_project(conn, *, id, name, is_auto_created=1):
    conn.execute(
        "INSERT INTO projects (id, name, is_auto_created) VALUES (?, ?, ?)",
        (id, name, is_auto_created),
    )
    conn.commit()


def _add_raw_clip(conn, *, id, name, rating, tags, auto_project_id=None):
    conn.execute(
        "INSERT INTO raw_clips (id, name, rating, tags, auto_project_id) VALUES (?, ?, ?, ?, ?)",
        (id, name, rating, encode_data(tags), auto_project_id),
    )
    conn.commit()


def _add_final(conn, *, id, name, source_type, source_clip_id):
    conn.execute(
        "INSERT INTO final_videos (id, name, source_type, source_clip_id) VALUES (?, ?, ?, ?)",
        (id, name, source_type, source_clip_id),
    )
    conn.commit()


def _project_name(conn, pid):
    return conn.execute("SELECT name FROM projects WHERE id = ?", (pid,)).fetchone()[0]


def _final_name(conn, fid):
    return conn.execute("SELECT name FROM final_videos WHERE id = ?", (fid,)).fetchone()[0]


# --- positive rewrites ------------------------------------------------------

def test_ports_provably_derived_project_name(tmp_path):
    conn = _make_db(tmp_path)
    _add_project(conn, id=1, name="Brilliant Goal", is_auto_created=1)
    _add_raw_clip(conn, id=10, name="", rating=5, tags=["Goal"], auto_project_id=1)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 1) == "Highlight Goal"


def test_ports_multi_tag_project_name(tmp_path):
    conn = _make_db(tmp_path)
    _add_project(conn, id=2, name="Brilliant Goal, Assist and Dribble", is_auto_created=1)
    _add_raw_clip(conn, id=11, name=None, rating=5, tags=["Goal", "Assist", "Dribble"], auto_project_id=2)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 2) == "Highlight Goal, Assist and Dribble"


def test_ports_provably_derived_final_video_name(tmp_path):
    conn = _make_db(tmp_path)
    _add_raw_clip(conn, id=20, name="", rating=5, tags=["Goal", "Assist"])
    _add_final(conn, id=100, name="Brilliant Goal and Assist",
               source_type="brilliant_clip", source_clip_id=20)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _final_name(conn, 100) == "Highlight Goal and Assist"


# --- the five protected cases (must NOT be rewritten) ------------------------

def test_leaves_user_typed_name_when_raw_clip_name_set(tmp_path):
    """raw_clips.name set -> the name is a stored/typed name, not derived. Leave it."""
    conn = _make_db(tmp_path)
    _add_project(conn, id=3, name="Brilliant Goal", is_auto_created=1)
    _add_raw_clip(conn, id=30, name="Brilliant Goal", rating=5, tags=["Goal"], auto_project_id=3)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 3) == "Brilliant Goal"


def test_leaves_name_whose_tags_no_longer_match(tmp_path):
    """Tags changed after creation -> exact derived form no longer matches. Leave it."""
    conn = _make_db(tmp_path)
    _add_project(conn, id=4, name="Brilliant Goal", is_auto_created=1)
    _add_raw_clip(conn, id=40, name="", rating=5, tags=["Dribble"], auto_project_id=4)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 4) == "Brilliant Goal"


def test_leaves_notes_derived_name(tmp_path):
    """A notes-derived name has no adjective prefix -> never matches. Leave it."""
    conn = _make_db(tmp_path)
    _add_project(conn, id=5, name="Brilliant tackle in the box", is_auto_created=1)
    # No tags -> tag_part is empty -> the notes-style name can never be the
    # derived "Brilliant <tag_part>" form.
    _add_raw_clip(conn, id=50, name="", rating=5, tags=[], auto_project_id=5)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 5) == "Brilliant tackle in the box"


def test_leaves_non_brilliant_clip_final_video(tmp_path):
    """A final_video with a different source_type is out of scope. Leave it."""
    conn = _make_db(tmp_path)
    _add_raw_clip(conn, id=60, name="", rating=5, tags=["Goal"])
    _add_final(conn, id=101, name="Brilliant Goal",
               source_type="custom_project", source_clip_id=60)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _final_name(conn, 101) == "Brilliant Goal"


def test_leaves_non_auto_created_project(tmp_path):
    """is_auto_created=0 -> a user project, out of scope. Leave it."""
    conn = _make_db(tmp_path)
    _add_project(conn, id=6, name="Brilliant Goal", is_auto_created=0)
    _add_raw_clip(conn, id=70, name="", rating=5, tags=["Goal"], auto_project_id=6)

    V055PortBrilliantNamesToHighlight().up(conn)

    assert _project_name(conn, 6) == "Brilliant Goal"


# --- idempotency + empty DB -------------------------------------------------

def test_idempotent_rerun_is_noop(tmp_path):
    conn = _make_db(tmp_path)
    _add_project(conn, id=1, name="Brilliant Goal", is_auto_created=1)
    _add_raw_clip(conn, id=10, name="", rating=5, tags=["Goal"], auto_project_id=1)
    _add_raw_clip(conn, id=20, name="", rating=5, tags=["Goal", "Assist"])
    _add_final(conn, id=100, name="Brilliant Goal and Assist",
               source_type="brilliant_clip", source_clip_id=20)

    V055PortBrilliantNamesToHighlight().up(conn)
    after_first = (_project_name(conn, 1), _final_name(conn, 100))
    V055PortBrilliantNamesToHighlight().up(conn)
    after_second = (_project_name(conn, 1), _final_name(conn, 100))

    assert after_first == ("Highlight Goal", "Highlight Goal and Assist")
    assert after_first == after_second


def test_noop_on_empty_db(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables
    V055PortBrilliantNamesToHighlight().up(conn)  # must not raise
