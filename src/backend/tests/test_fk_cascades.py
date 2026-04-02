"""
T86/T900: Tests for FK cascade behavior across all tables.
Verifies:
  - Deleting a game cascades to delete its raw_clips (ON DELETE CASCADE)
  - Deleting a project sets auto_project_id to NULL (ON DELETE SET NULL)
  - Deleting a project cascades to working_clips (ON DELETE CASCADE)
  - Deleting a project cascades to working_videos (ON DELETE CASCADE)
  - Deleting a raw_clip cascades to working_clips (ON DELETE CASCADE)
  - Deleting a working_video sets projects.working_video_id to NULL (ON DELETE SET NULL)
  - Deleting a final_video sets projects.final_video_id to NULL (ON DELETE SET NULL)
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
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")


def teardown_module():
    from app.database import get_user_data_path, USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    # Clean up the entire user directory (includes profiles/)
    test_path = USER_DATA_BASE / TEST_USER_ID
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


def test_working_clips_schema_has_cascade():
    """working_clips table should have ON DELETE CASCADE on both FKs."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='working_clips'")
        row = cursor.fetchone()
        schema = row['sql']
        assert schema.count('ON DELETE CASCADE') == 2, (
            f"Expected 2 CASCADE constraints in working_clips, got: {schema}"
        )


def test_working_videos_schema_has_cascade():
    """working_videos table should have ON DELETE CASCADE on project_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='working_videos'")
        row = cursor.fetchone()
        schema = row['sql']
        assert 'ON DELETE CASCADE' in schema, f"Missing ON DELETE CASCADE in working_videos: {schema}"


def test_projects_schema_has_set_null():
    """projects table should have ON DELETE SET NULL on working_video_id and final_video_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'")
        row = cursor.fetchone()
        schema = row['sql']
        assert schema.count('ON DELETE SET NULL') == 2, (
            f"Expected 2 SET NULL constraints in projects, got: {schema}"
        )


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


def test_delete_project_cascades_working_clips():
    """Deleting a project should cascade-delete its working_clips."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("Cascade WC Test", "9:16"))
        project_id = cursor.lastrowid

        # Create working clips for this project
        for i in range(3):
            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, sort_order)
                VALUES (?, ?, ?)
            """, (project_id, f"wc_{i}.mp4", i))

        conn.commit()

        # Verify working clips exist
        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE project_id = ?", (project_id,))
        assert cursor.fetchone()[0] == 3

        # Delete the project
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()

        # Verify working clips were cascade-deleted
        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE project_id = ?", (project_id,))
        assert cursor.fetchone()[0] == 0, "working_clips not cascade-deleted on project delete"


def test_delete_project_cascades_working_videos():
    """Deleting a project should cascade-delete its working_videos."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("Cascade WV Test", "9:16"))
        project_id = cursor.lastrowid

        # Create a working video for this project
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename)
            VALUES (?, ?)
        """, (project_id, "wv_test.mp4"))
        wv_id = cursor.lastrowid

        conn.commit()

        # Verify working video exists
        cursor.execute("SELECT COUNT(*) FROM working_videos WHERE project_id = ?", (project_id,))
        assert cursor.fetchone()[0] == 1

        # Delete the project
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()

        # Verify working video was cascade-deleted
        cursor.execute("SELECT COUNT(*) FROM working_videos WHERE id = ?", (wv_id,))
        assert cursor.fetchone()[0] == 0, "working_videos not cascade-deleted on project delete"


def test_delete_raw_clip_cascades_working_clips():
    """Deleting a raw_clip should cascade-delete working_clips referencing it."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a game
        cursor.execute("""
            INSERT INTO games (name, blake3_hash)
            VALUES (?, ?)
        """, ("RC Cascade Test", f"test_hash_{uuid.uuid4().hex[:32]}"))
        game_id = cursor.lastrowid

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("RC Cascade Project", "9:16"))
        project_id = cursor.lastrowid

        # Create a raw clip
        cursor.execute("""
            INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time)
            VALUES (?, ?, ?, ?, ?)
        """, ("rc_cascade.mp4", 4, game_id, 0.0, 5.0))
        raw_clip_id = cursor.lastrowid

        # Create working clips referencing this raw clip
        for i in range(2):
            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                VALUES (?, ?, ?)
            """, (project_id, raw_clip_id, i))

        conn.commit()

        # Verify working clips exist
        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE raw_clip_id = ?", (raw_clip_id,))
        assert cursor.fetchone()[0] == 2

        # Delete the raw clip
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        conn.commit()

        # Verify working clips were cascade-deleted
        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE raw_clip_id = ?", (raw_clip_id,))
        assert cursor.fetchone()[0] == 0, "working_clips not cascade-deleted on raw_clip delete"

        # Cleanup
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


def test_delete_working_video_sets_project_null():
    """Deleting a working_video should SET NULL on projects.working_video_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("WV SetNull Test", "9:16"))
        project_id = cursor.lastrowid

        # Create a working video
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename)
            VALUES (?, ?)
        """, (project_id, "wv_setnull.mp4"))
        wv_id = cursor.lastrowid

        # Link working video to project
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (wv_id, project_id))

        conn.commit()

        # Verify link exists
        cursor.execute("SELECT working_video_id FROM projects WHERE id = ?", (project_id,))
        assert cursor.fetchone()['working_video_id'] == wv_id

        # Delete the working video
        cursor.execute("DELETE FROM working_videos WHERE id = ?", (wv_id,))
        conn.commit()

        # Verify project still exists but working_video_id is NULL
        cursor.execute("SELECT id, working_video_id FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        assert row is not None, "Project was deleted when working_video was deleted"
        assert row['working_video_id'] is None, "working_video_id was not set to NULL"

        # Cleanup
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def test_delete_final_video_sets_project_null():
    """Deleting a final_video should SET NULL on projects.final_video_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create a project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("FV SetNull Test", "9:16"))
        project_id = cursor.lastrowid

        # Create a final video
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename)
            VALUES (?, ?)
        """, (project_id, "fv_setnull.mp4"))
        fv_id = cursor.lastrowid

        # Link final video to project
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (fv_id, project_id))

        conn.commit()

        # Verify link exists
        cursor.execute("SELECT final_video_id FROM projects WHERE id = ?", (project_id,))
        assert cursor.fetchone()['final_video_id'] == fv_id

        # Delete the final video
        cursor.execute("DELETE FROM final_videos WHERE id = ?", (fv_id,))
        conn.commit()

        # Verify project still exists but final_video_id is NULL
        cursor.execute("SELECT id, final_video_id FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        assert row is not None, "Project was deleted when final_video was deleted"
        assert row['final_video_id'] is None, "final_video_id was not set to NULL"

        # Cleanup
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def test_delete_game_cascades_full_chain():
    """Deleting a game should cascade through raw_clips to working_clips."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create game -> raw_clip -> working_clip chain
        cursor.execute("""
            INSERT INTO games (name, blake3_hash)
            VALUES (?, ?)
        """, ("Full Chain Test", f"test_hash_{uuid.uuid4().hex[:32]}"))
        game_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES (?, ?)
        """, ("Chain Project", "9:16"))
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time)
            VALUES (?, ?, ?, ?, ?)
        """, ("chain_clip.mp4", 5, game_id, 0.0, 10.0))
        raw_clip_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
            VALUES (?, ?, ?)
        """, (project_id, raw_clip_id, 0))

        conn.commit()

        # Verify chain exists
        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE raw_clip_id = ?", (raw_clip_id,))
        assert cursor.fetchone()[0] == 1

        # Delete the game — should cascade: game -> raw_clips -> working_clips
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        # Verify full cascade
        cursor.execute("SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,))
        assert cursor.fetchone()[0] == 0, "raw_clips not cascade-deleted"

        cursor.execute("SELECT COUNT(*) FROM working_clips WHERE raw_clip_id = ?", (raw_clip_id,))
        assert cursor.fetchone()[0] == 0, "working_clips not cascade-deleted through raw_clips"

        # Cleanup (project has no cascade from game)
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def test_delete_game_via_api_cascades():
    """DELETE /api/games/{id} should cascade-delete raw_clips."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": "testdefault"}) as client:
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
