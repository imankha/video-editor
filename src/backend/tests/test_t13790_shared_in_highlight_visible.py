"""
T13790: a highlight the user finishes from a SHARED-IN clip (my_athlete=0,
shared_by set) must appear in Finished: list, count, bootstrap badge,
per-game count, collections -- but stay out of Rankings (Team-layer rule, T11160).

Driven through the real publish handler (the only code that sets published_at).
"""
import sqlite3

import pytest

from app.utils.encoding import encode_data
from tests.test_t4050_publish_restore_roundtrip import env  # noqa: F401  (fixture)


def _seed_unpublished_shared_in_highlight(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("INSERT INTO games (name) VALUES ('Vs Carlsbad QA')")
    game_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, "
        "video_sequence, my_athlete, shared_by) "
        "VALUES ('raw.mp4', 5, 10.0, 20.0, ?, 0, 0, 'sharer@example.com')", (game_id,))
    clip_id = cur.lastrowid
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('QA first play', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, clip_count, rating, rd, match_count, source_clip_id, game_ids) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', 'QA first play', 10.0, '9:16', 1, "
        "1500.0, 350.0, 0, ?, ?)",
        (project_id, clip_id, encode_data([game_id])))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return game_id, project_id, fv_id


@pytest.mark.asyncio
async def test_finished_shared_in_highlight_is_visible_everywhere_but_rankings(env):  # noqa: F811
    db_path, _store = env
    game_id, project_id, fv_id = _seed_unpublished_shared_in_highlight(db_path)

    from app.database import get_db_connection
    from app.routers.bootstrap import _read_profile_misc
    from app.routers.collections import collections_summary, evaluate_collection_members
    from app.routers.downloads import get_download_count, list_downloads, publish_to_my_reels
    from app.routers.games import _compute_reel_counts
    from app.routers.rank import _rankable_pool

    await publish_to_my_reels(project_id)

    assert (await get_download_count())["count"] == 1
    assert fv_id in {d.id for d in (await list_downloads()).downloads}
    assert _read_profile_misc()["downloads"]["count"] == 1
    game = next(g for g in collections_summary().games if g.game_id == game_id)
    assert game.reel_count == 1

    with get_db_connection() as conn:
        members = evaluate_collection_members(
            conn, {"scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16"})
        assert fv_id in {m["id"] for m in members}
        assert _compute_reel_counts(conn.cursor(), [game_id]) == {game_id: 1}
        assert fv_id not in {r["id"] for r in _rankable_pool(conn.cursor(), "9:16")}
