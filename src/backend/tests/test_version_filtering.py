"""
Tests for version filtering behavior.

Tests that the SQL helper functions correctly filter to the latest version
of clips and final videos. These tests verify the refactored code produces
the same results as the original inline SQL.
"""

import pytest
import sqlite3
import tempfile
import os
from pathlib import Path
from unittest.mock import patch

# We need to patch the database path before importing the app modules
@pytest.fixture
def test_db():
    """Create a temporary test database with schema and test data."""
    # Create temp file
    fd, db_path = tempfile.mkstemp(suffix='.sqlite')
    os.close(fd)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Create minimal schema needed for tests
    cursor.execute("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            end_time REAL
        )
    """)

    cursor.execute("""
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL DEFAULT '16:9'
        )
    """)

    cursor.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            uploaded_filename TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            exported_at TEXT DEFAULT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    """)

    conn.commit()

    yield conn, db_path

    conn.close()
    os.unlink(db_path)


class TestLatestWorkingClipsSubquery:
    """Test the latest_working_clips_subquery helper function."""

    def test_subquery_generates_valid_sql(self):
        """The subquery should generate syntactically valid SQL."""
        from app.queries import latest_working_clips_subquery

        sql = latest_working_clips_subquery()

        assert "ROW_NUMBER()" in sql
        assert "PARTITION BY" in sql
        assert "WHERE rn = 1" in sql
        assert "COALESCE" in sql
        assert "ORDER BY" in sql
        assert "version DESC" in sql

    def test_subquery_with_project_filter(self):
        """With project_filter=True, should include project_id = ? clause."""
        from app.queries import latest_working_clips_subquery

        sql = latest_working_clips_subquery(project_filter=True)

        assert "project_id = ?" in sql

    def test_subquery_without_project_filter(self):
        """With project_filter=False, should NOT include project_id clause."""
        from app.queries import latest_working_clips_subquery

        sql = latest_working_clips_subquery(project_filter=False)

        assert "project_id = ?" not in sql

    def test_returns_latest_version_single_clip(self, test_db):
        """Single clip with multiple versions - should return only latest."""
        from app.queries import latest_working_clips_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Test Project')")
        project_id = cursor.lastrowid

        # Create raw clip
        cursor.execute("INSERT INTO raw_clips (filename, rating, end_time) VALUES ('test.mp4', 5, 12345)")
        raw_clip_id = cursor.lastrowid

        # Create 3 versions of the same clip (same raw_clip_id = same identity)
        for version in [1, 2, 3]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
                (project_id, raw_clip_id, version)
            )

        conn.commit()

        # Query using the subquery helper
        cursor.execute(f"""
            SELECT id, version FROM working_clips
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
        """, (project_id, project_id))

        results = cursor.fetchall()

        # Should return only 1 row (the latest version)
        assert len(results) == 1
        assert results[0]['version'] == 3

    def test_returns_latest_version_multiple_clips(self, test_db):
        """Multiple clips each with multiple versions - should return latest of each."""
        from app.queries import latest_working_clips_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Test Project')")
        project_id = cursor.lastrowid

        # Create 2 raw clips (different identities)
        cursor.execute("INSERT INTO raw_clips (filename, rating, end_time) VALUES ('clip1.mp4', 5, 100)")
        raw_clip_id_1 = cursor.lastrowid
        cursor.execute("INSERT INTO raw_clips (filename, rating, end_time) VALUES ('clip2.mp4', 5, 200)")
        raw_clip_id_2 = cursor.lastrowid

        # Create versions for clip 1
        for version in [1, 2]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
                (project_id, raw_clip_id_1, version)
            )

        # Create versions for clip 2
        for version in [1, 2, 3]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
                (project_id, raw_clip_id_2, version)
            )

        conn.commit()

        # Query using the subquery helper
        cursor.execute(f"""
            SELECT id, raw_clip_id, version FROM working_clips
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
            ORDER BY raw_clip_id
        """, (project_id, project_id))

        results = cursor.fetchall()

        # Should return 2 rows (latest version of each clip)
        assert len(results) == 2
        assert results[0]['raw_clip_id'] == raw_clip_id_1
        assert results[0]['version'] == 2
        assert results[1]['raw_clip_id'] == raw_clip_id_2
        assert results[1]['version'] == 3

    def test_uploaded_clips_use_filename_for_identity(self, test_db):
        """Uploaded clips (no raw_clip_id) should use uploaded_filename for identity."""
        from app.queries import latest_working_clips_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Test Project')")
        project_id = cursor.lastrowid

        # Create uploaded clips with same filename (same identity)
        for version in [1, 2]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, uploaded_filename, version) VALUES (?, ?, ?)",
                (project_id, "uploaded.mp4", version)
            )

        conn.commit()

        # Query using the subquery helper
        cursor.execute(f"""
            SELECT id, version FROM working_clips
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
        """, (project_id, project_id))

        results = cursor.fetchall()

        # Should return only 1 row (the latest version)
        assert len(results) == 1
        assert results[0]['version'] == 2

    def test_filters_by_project(self, test_db):
        """Should only return clips from the specified project."""
        from app.queries import latest_working_clips_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create 2 projects
        cursor.execute("INSERT INTO projects (name) VALUES ('Project 1')")
        project_id_1 = cursor.lastrowid
        cursor.execute("INSERT INTO projects (name) VALUES ('Project 2')")
        project_id_2 = cursor.lastrowid

        # Create raw clips
        cursor.execute("INSERT INTO raw_clips (filename, rating, end_time) VALUES ('clip.mp4', 5, 100)")
        raw_clip_id = cursor.lastrowid

        # Add clip to project 1 with 2 versions
        for version in [1, 2]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
                (project_id_1, raw_clip_id, version)
            )

        # Add clip to project 2 with 3 versions
        for version in [1, 2, 3]:
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (?, ?, ?)",
                (project_id_2, raw_clip_id, version)
            )

        conn.commit()

        # Query project 1
        cursor.execute(f"""
            SELECT id, version FROM working_clips
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
        """, (project_id_1, project_id_1))

        results = cursor.fetchall()

        # Should return only 1 row from project 1
        assert len(results) == 1
        assert results[0]['version'] == 2


class TestLatestFinalVideosSubquery:
    """Test the latest_final_videos_subquery helper function."""

    def test_subquery_generates_valid_sql(self):
        """The subquery should generate syntactically valid SQL."""
        from app.queries import latest_final_videos_subquery

        sql = latest_final_videos_subquery()

        assert "ROW_NUMBER()" in sql
        assert "PARTITION BY project_id" in sql
        assert "WHERE rn = 1" in sql
        assert "ORDER BY version DESC" in sql

    def test_returns_latest_version_per_project(self, test_db):
        """Should return only the latest version per project."""
        from app.queries import latest_final_videos_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create 2 projects
        cursor.execute("INSERT INTO projects (name) VALUES ('Project 1')")
        project_id_1 = cursor.lastrowid
        cursor.execute("INSERT INTO projects (name) VALUES ('Project 2')")
        project_id_2 = cursor.lastrowid

        # Create final videos for project 1
        for version in [1, 2]:
            cursor.execute(
                "INSERT INTO final_videos (project_id, filename, version) VALUES (?, ?, ?)",
                (project_id_1, f"final_p1_v{version}.mp4", version)
            )

        # Create final videos for project 2
        for version in [1, 2, 3]:
            cursor.execute(
                "INSERT INTO final_videos (project_id, filename, version) VALUES (?, ?, ?)",
                (project_id_2, f"final_p2_v{version}.mp4", version)
            )

        conn.commit()

        # Query using the subquery helper
        cursor.execute(f"""
            SELECT id, project_id, version FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
            ORDER BY project_id
        """)

        results = cursor.fetchall()

        # Should return 2 rows (latest version of each project)
        assert len(results) == 2
        assert results[0]['project_id'] == project_id_1
        assert results[0]['version'] == 2
        assert results[1]['project_id'] == project_id_2
        assert results[1]['version'] == 3

    def test_single_version_is_returned(self, test_db):
        """A project with only version 1 should still be returned."""
        from app.queries import latest_final_videos_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Test Project')")
        project_id = cursor.lastrowid

        # Create single final video
        cursor.execute(
            "INSERT INTO final_videos (project_id, filename, version) VALUES (?, ?, ?)",
            (project_id, "final.mp4", 1)
        )

        conn.commit()

        # Query using the subquery helper
        cursor.execute(f"""
            SELECT id, version FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
        """)

        results = cursor.fetchall()

        assert len(results) == 1
        assert results[0]['version'] == 1

    def test_count_matches_list(self, test_db):
        """COUNT query should match number of rows returned."""
        from app.queries import latest_final_videos_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create 3 projects with various versions
        for i in range(3):
            cursor.execute("INSERT INTO projects (name) VALUES (?)", (f"Project {i}",))
            project_id = cursor.lastrowid

            # Create 1-3 versions per project
            for version in range(1, i + 2):
                cursor.execute(
                    "INSERT INTO final_videos (project_id, filename, version) VALUES (?, ?, ?)",
                    (project_id, f"final_p{i}_v{version}.mp4", version)
                )

        conn.commit()

        # Get count
        cursor.execute(f"""
            SELECT COUNT(*) as count FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
        """)
        count = cursor.fetchone()['count']

        # Get list
        cursor.execute(f"""
            SELECT id FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
        """)
        list_count = len(cursor.fetchall())

        assert count == list_count == 3


class TestEmptyTables:
    """Test edge cases with empty tables."""

    def test_empty_working_clips_returns_empty(self, test_db):
        """Query on empty working_clips should return empty result."""
        from app.queries import latest_working_clips_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        # Create project but no clips
        cursor.execute("INSERT INTO projects (name) VALUES ('Empty Project')")
        project_id = cursor.lastrowid
        conn.commit()

        cursor.execute(f"""
            SELECT id FROM working_clips
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
        """, (project_id, project_id))

        results = cursor.fetchall()
        assert len(results) == 0

    def test_empty_final_videos_returns_empty(self, test_db):
        """Query on empty final_videos should return empty result."""
        from app.queries import latest_final_videos_subquery

        conn, _ = test_db
        cursor = conn.cursor()

        cursor.execute(f"""
            SELECT id FROM final_videos
            WHERE id IN ({latest_final_videos_subquery()})
        """)

        results = cursor.fetchall()
        assert len(results) == 0
