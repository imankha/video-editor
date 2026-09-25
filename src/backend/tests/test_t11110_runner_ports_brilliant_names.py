"""T11110 -- runner-level red-to-green proof for v055.

test_t11110_migration_v055.py imports the v055 module and its migration class
directly, so it cannot even be collected on master (no such module there) --
that is an ImportError, not a real behavioral RED. This file imports NOTHING
T11110-specific: only `app.migrations.profile_db.RUNNER`, the SAME
MigrationRunner object `migrations.run_profile_seam` /
`migrate_local_profile_db_at_seam` calls in production
(`PROFILE_DB_RUNNER.run(conn, "sqlite")`, see app/migrations/__init__.py).

The fixture is a profile.sqlite stamped at PRAGMA user_version = 54 (pre-T11110
head) with one auto-created project + linked raw_clip (empty name, tags) whose
persisted name is the OLD derived "Brilliant <tags>" form, one brilliant_clip
final_video in the same derived form, and one protected user-typed row. Running
the real RUNNER to whatever head master/this branch registers must leave the
derived names read "Highlight <tags>" and the protected row untouched.

On master (head v054, no v055 registered) RUNNER.run is a no-op here --
the names stay "Brilliant ..." and the assertion below fails with a real
AssertionError, not an ImportError: a valid RED.
"""

import sqlite3

from app.migrations.profile_db import RUNNER
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
    conn.execute("PRAGMA user_version = 54")
    conn.commit()
    return conn


def test_runner_ports_brilliant_names_to_highlight(tmp_path):
    conn = _make_db(tmp_path)

    # auto-created project + linked raw_clip: name is the old derived form.
    conn.execute(
        "INSERT INTO projects (id, name, is_auto_created) VALUES (1, 'Brilliant Goal', 1)"
    )
    conn.execute(
        "INSERT INTO raw_clips (id, name, rating, tags, auto_project_id) VALUES "
        "(10, '', 5, ?, 1)",
        (encode_data(["Goal"]),),
    )

    # brilliant_clip final_video: name is the old derived form.
    conn.execute(
        "INSERT INTO raw_clips (id, name, rating, tags, auto_project_id) VALUES "
        "(20, '', 5, ?, NULL)",
        (encode_data(["Goal", "Assist"]),),
    )
    conn.execute(
        "INSERT INTO final_videos (id, name, source_type, source_clip_id) VALUES "
        "(100, 'Brilliant Goal and Assist', 'brilliant_clip', 20)"
    )

    # protected: user-typed name (raw_clip.name is set, not empty) must survive.
    conn.execute(
        "INSERT INTO projects (id, name, is_auto_created) VALUES (2, 'Brilliant Goal', 1)"
    )
    conn.execute(
        "INSERT INTO raw_clips (id, name, rating, tags, auto_project_id) VALUES "
        "(30, 'Brilliant Goal', 5, ?, 2)",
        (encode_data(["Goal"]),),
    )
    conn.commit()

    RUNNER.run(conn, "sqlite")

    project_name = conn.execute("SELECT name FROM projects WHERE id = 1").fetchone()[0]
    final_video_name = conn.execute(
        "SELECT name FROM final_videos WHERE id = 100"
    ).fetchone()[0]
    protected_name = conn.execute("SELECT name FROM projects WHERE id = 2").fetchone()[0]

    assert project_name == "Highlight Goal"
    assert final_video_name == "Highlight Goal and Assist"
    assert protected_name == "Brilliant Goal"
