"""
T86: Tests for FK cascade behavior on raw_clips table.
Verifies:
  - Deleting a game cascades to delete its raw_clips (ON DELETE CASCADE)
  - Deleting a project sets auto_project_id to NULL (ON DELETE SET NULL)
  - PRAGMA foreign_keys is enabled on connections

Run with: pytest src/backend/tests/test_fk_cascades.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_fk_cascades_{uuid.uuid4().hex[:8]}"


def setup_module():
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)


def teardown_module():
    from app.database import get_user_data_path
    from app.user_context import set_current_user_id, reset_user_id

    set_current_user_id(TEST_USER_ID)
    test_path = get_user_data_path()
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)

    reset_user_id()


from app.database import get_db_connection


def test_foreign_keys_pragma_enabled():
    """PRAGMA foreign_keys should be ON for all connections."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys")
        result = cursor.fetchone()
        assert result[0] == 1, "PRAGMA foreign_keys is not enabled"


def test_raw_clips_schema_has_cascade():
    """raw_clips table schema should include ON DELETE CASCADE on game_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='raw_clips'")
        row = cursor.fetchone()
        schema = row['sql']
        assert 'ON DELETE CASCADE' in schema, f"Missing ON DELETE CASCADE in schema: {schema}"
        assert 'ON DELETE SET NULL' in schema, f"Missing ON DELETE SET NULL in schema: {schema}"


def test_delete_game_cascades_raw_clips():
    """Deleting a game should cascade-delete its raw_clips."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a game
        cursor.execute("""
            INSERT INTO games (name, blake3_hash)
            VALUES (?, ?)
        """, ("Cascade Test Game", f"test_hash_{uuid.uuid4().hex[:32]}"))
        game_id = cursor.lastrowid

        # Create raw clips for this game
        for i in range(3):
            cursor.execute("""
                INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time)
                VALUES (?, ?, ?, ?, ?)
            """, (f"clip_{i}.mp4", 5, game_id, i * 10.0, (i + 1) * 10.0))

        conn.commit()

        # Verify clips exist
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,))
        assert cursor.fetchone()[0] == 3

        # Delete the game
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        # Verify clips were cascade-deleted
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,))
        assert cursor.fetchone()[0] == 0, "raw_clips were not cascade-deleted when game was deleted"


def test_delete_project_sets_auto_project_id_null():
    """Deleting a project should SET NULL on raw_clips.auto_project_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a game (needed for raw_clips FK)
        cursor.execute("""
            INSERT INTO games (name, blake3_hash)
            VALUES (?, ?)
        """, ("SET NULL Test Game", f"test_hash_{uuid.uuid4().hex[:32]}"))
        game_id = cursor.lastrowid

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio, is_auto_created)
            VALUES (?, ?, ?)
        """, ("Auto Project", "9:16", 1))
        project_id = cursor.lastrowid

        # Create a raw clip linked to both game and project
        cursor.execute("""
            INSERT INTO raw_clips (filename, rating, game_id, auto_project_id, start_time, end_time)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ("clip_with_project.mp4", 5, game_id, project_id, 0.0, 10.0))
        clip_id = cursor.lastrowid

        conn.commit()

        # Verify auto_project_id is set
        cursor.execute("SELECT auto_project_id FROM raw_clips WHERE id = ?", (clip_id,))
        assert cursor.fetchone()['auto_project_id'] == project_id

        # Delete the project
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()

        # Verify clip still exists but auto_project_id is NULL
        cursor.execute("SELECT id, auto_project_id, game_id FROM raw_clips WHERE id = ?", (clip_id,))
        row = cursor.fetchone()
        assert row is not None, "raw_clip was deleted when project was deleted (should only SET NULL)"
        assert row['auto_project_id'] is None, "auto_project_id was not set to NULL"
        assert row['game_id'] == game_id, "game_id was incorrectly modified"

        # Cleanup
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


def test_delete_game_via_api_cascades():
    """DELETE /api/games/{id} should cascade-delete raw_clips."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app, headers={"X-User-ID": TEST_USER_ID}) as client:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Create a game
            cursor.execute("""
                INSERT INTO games (name, blake3_hash)
                VALUES (?, ?)
            """, ("API Cascade Test", f"test_hash_{uuid.uuid4().hex[:32]}"))
            game_id = cursor.lastrowid

            # Create raw clips
            cursor.execute("""
                INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time)
                VALUES (?, ?, ?, ?, ?)
            """, ("api_clip.mp4", 4, game_id, 0.0, 5.0))

            conn.commit()

        # Delete via API
        response = client.delete(f"/api/games/{game_id}")
        assert response.status_code == 200

        # Verify cascade
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,))
            assert cursor.fetchone()[0] == 0, "raw_clips not cascade-deleted via API delete"
