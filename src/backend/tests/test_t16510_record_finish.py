"""T16510: finishing a highlight records `highlight_finished`, and the Journey's Finished
stage counts that event instead of guessing from a rendered spotlight.

Finish is POST /api/downloads/publish/{project_id} (the tap that puts a highlight in the
Highlights tab). The spotlight render only writes an unpublished final_videos row through
publish_final_video, so it must never count as finished.

The REAL `record_milestone` runs; what it sends to `user_actions` is read through an
in-memory Postgres stand-in (the `pg_conn` fixture truncates the shared dev Postgres).
"""

import sqlite3
from contextlib import contextmanager
from datetime import date
from unittest.mock import MagicMock

import pytest

from app import analytics
from app.services.analytics_journey import annotate_coverage
from tests.test_t4050_publish_restore_roundtrip import USER_ID, env  # noqa: F401  (fixture)

FINISH_EVENT = "highlight_finished"


@pytest.fixture
def user_actions(monkeypatch):
    """In-memory `user_actions`: (user_id, action) -> count, fed by record_milestone's SQL."""
    rows: dict[tuple[str, str], int] = {}

    def execute(sql, params=None):
        if "INSERT INTO user_actions" in sql:
            user_id, action, _platform = params
            rows[(user_id, action)] = rows.get((user_id, action), 0) + 1

    @contextmanager
    def fake_get_pg():
        conn = MagicMock()
        cursor = MagicMock()
        cursor.execute.side_effect = execute
        cursor.fetchone.return_value = None
        conn.cursor.return_value = cursor
        yield conn

    monkeypatch.setattr(analytics, "get_pg", fake_get_pg)
    return rows


def _seed_sharpened_highlight(db_path, *, with_spotlight: bool) -> int:
    """A sharpened, not yet finished highlight (unpublished final_videos row)."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Finish me', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw.mp4', 5, 1.0, ?, 7, 0)", (9.0 + project_id,))
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)", (project_id, raw_clip_id, b"\x91\x80", b"\x80"))
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration, effect_type, overlay_version) "
        "VALUES (?, 'wv.mp4', 1, 8.0, 'brightness_boost', ?)", (project_id, 1 if with_spotlight else 0))
    working_video_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, duration, "
        " aspect_ratio, clip_count, source_clip_id) "
        "VALUES (?, ?, 1, 'custom_project', 'Finish me', 8.0, '9:16', 1, ?)",
        (project_id, f"final_{project_id}.mp4", raw_clip_id))
    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, cur.lastrowid, project_id))
    conn.commit()
    conn.close()
    return project_id


@pytest.mark.asyncio
@pytest.mark.parametrize("with_spotlight", [False, True])
async def test_t16510_c1_finishing_records_one_finish_event(env, user_actions, with_spotlight):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import publish_to_my_reels

    project_id = _seed_sharpened_highlight(db_path, with_spotlight=with_spotlight)

    await publish_to_my_reels(project_id)

    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1


@pytest.mark.asyncio
async def test_t16510_c1_finish_tap_on_an_already_finished_highlight_adds_none(env, user_actions):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import publish_to_my_reels

    project_id = _seed_sharpened_highlight(db_path, with_spotlight=False)
    await publish_to_my_reels(project_id)
    await publish_to_my_reels(project_id)

    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1


def test_t16510_c2_spotlight_render_is_not_a_finish():
    """The spotlight render's event (overlay_exported) is not what the Finished stage counts."""
    finished = next(s for s in analytics.JOURNEY_LADDER if s["key"] == "finished")
    assert finished["actions"] == [FINISH_EVENT]
    assert FINISH_EVENT in analytics.FLOW_EVENTS


def test_t16510_c2_rendering_a_spotlight_adds_no_finish_event(env, user_actions):  # noqa: F811
    """publish_final_video is the spotlight render's writer; it leaves the highlight unfinished."""
    db_path, _ = env
    from app.services.publish_final_video import publish_final_video

    project_id = _seed_sharpened_highlight(db_path, with_spotlight=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    publish_final_video(conn.cursor(), project_id=project_id,
                        output_filename="spotlight_v2.mp4", aspect_ratio="9:16")
    conn.commit()
    conn.close()

    assert (USER_ID, FINISH_EVENT) not in user_actions


@pytest.mark.asyncio
async def test_t16510_c3_finish_count_equals_highlights_tab(env, user_actions):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import list_downloads, publish_to_my_reels

    finished = [_seed_sharpened_highlight(db_path, with_spotlight=s) for s in (False, True, False)]
    _seed_sharpened_highlight(db_path, with_spotlight=True)  # sharpened, never finished
    for project_id in finished:
        await publish_to_my_reels(project_id)

    highlights = (await list_downloads()).downloads
    assert len(highlights) == 3
    assert user_actions.get((USER_ID, FINISH_EVENT)) == len(highlights)


def test_t16510_c4_finished_stage_shows_the_date_its_data_starts():
    ladder = [s for s in analytics.JOURNEY_LADDER if s["key"] == "finished"]
    nodes = [{"key": "finished"}]

    annotate_coverage(nodes, ladder, date(2026, 11, 1), date(2026, 11, 30), analytics.EVENT_INSTRUMENTED_AT)

    assert nodes[0]["partial_from"] == analytics.EVENT_INSTRUMENTED_AT[FINISH_EVENT] == "2026-11-16"
