"""T17140: "Edit highlight" opens a finished highlight without un-finishing it.

The tile menu now opens through open-for-redo (the frontend change; red/green in
src/frontend/src/hooks/useReEditReel.keepsFinished.test.js). This pins the server half
for the case the QA pass hit: a highlight whose game video has expired stays published
and counted after it is opened, and its project is not put back in Plays.

Mocked: R2 (external). Real: the profile DB and the open/list/count endpoints.
"""

import sqlite3

import pytest

from tests.test_t4050_publish_restore_roundtrip import env  # noqa: F401  (fixture)
from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)
from tests.test_t16520_server_finish import _rows, _seed_project, _sharpen, r2  # noqa: F401  (fixture)


@pytest.mark.asyncio
async def test_t17140_c2_opening_a_highlight_on_an_expired_game_keeps_it_finished(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import get_download_count, open_for_redo, redo_info

    project_id = _seed_project(db_path)  # its raw clip is on game 7
    await _sharpen(db_path, project_id, "job-t17140")
    final_id = _rows(db_path, "SELECT final_video_id FROM projects WHERE id = ?", (project_id,))[0]["final_video_id"]
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO games (id, name, blake3_hash, status) VALUES (7, 'Game', 'abc123', 'ready')")
    conn.execute("INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
                 "VALUES ('abc123', 100, '2020-01-01T00:00:00')")
    conn.commit()
    conn.close()
    assert (await redo_info(final_id))["game_video_available"] is False, "the game video has expired"
    before = await get_download_count()

    result = await open_for_redo(final_id)

    assert result["project_id"] == project_id
    row = _rows(db_path, "SELECT published_at FROM final_videos WHERE id = ?", (final_id,))[0]
    assert row["published_at"] is not None, "still finished and shared"
    assert await get_download_count() == before, "Highlights count unchanged"
    project = _rows(db_path, "SELECT restored_at FROM projects WHERE id = ?", (project_id,))[0]
    assert project["restored_at"] is None, "not moved back to Plays"
