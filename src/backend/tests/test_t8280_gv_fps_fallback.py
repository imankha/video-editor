"""
T8280 Stage 3 -- fps surfacing to the client: `GET /projects/{project_id}/clips`
(`list_project_clips`, app/routers/clips.py) must fall back to `game_videos.fps`
when `working_clips.fps` is NULL (the legacy-clip cohort), mirroring the exact
fallback Tbug49p already established for the multi-clip DB-resolve path
(`multi_clip.py:2320`, `framerate = db_clip['wc_fps'] or db_clip['gv_fps']`).

Ground truth (verified against current code): the SELECT in `list_project_clips`
selects `wc.fps as wc_fps` but does NOT select `gv.fps` at all, and
`WorkingClipResponse.fps` is populated via `fps=clip['wc_fps']` with no
fallback -- so a legacy clip with NULL `working_clips.fps` returns `fps: null`
in the API response even when `game_videos.fps` has the real value. This test
proves that gap via a REAL request through `TestClient(app)` against a real
per-user sqlite DB (mirroring test_t4230_project_write_path.py's fixture
pattern), not a mocked unit test -- this is a full request-path characterization
matching the router's ACTUAL query, so it can't pass by accident from a
docstring-level assertion alone.

Expected to FAIL against the current code: `resp.json()[0]["fps"]` will be
`None` instead of the game video's fps, until the Implementor adds
`gv.fps as gv_fps` to the SELECT and changes the WorkingClipResponse
construction to `fps=clip['wc_fps'] or clip['gv_fps']`.
"""

import uuid

from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_t8280_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _set_ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def _make_project():
    _set_ctx()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T8280', '9:16')"
        )
        project_id = cursor.lastrowid
        conn.commit()
        return project_id


def _make_game_with_video(fps, video_sequence=1):
    """A game + its game_videos row (T1440 multi-video shape), carrying fps."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, video_filename) VALUES ('Game', 'game.mp4')"
        )
        game_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO game_videos (game_id, blake3_hash, sequence, fps)
            VALUES (?, 'deadbeef', ?, ?)
            """,
            (game_id, video_sequence, fps),
        )
        conn.commit()
        return game_id


def _make_clip(project_id, game_id, wc_fps, video_sequence=None):
    """A raw_clip (legacy: video_sequence NULL, per Tbug49p's COALESCE case, or
    explicit) + a working_clip with the given (possibly NULL) fps."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence)
            VALUES ('raw.mp4', 3, 0.0, 20.0, ?, ?)
            """,
            (game_id, video_sequence),
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version, fps)
            VALUES (?, ?, 'wc.mp4', 1, ?)
            """,
            (project_id, raw_clip_id, wc_fps),
        )
        working_clip_id = cursor.lastrowid
        conn.commit()
        return working_clip_id


class TestGameVideoFpsFallback:
    def test_legacy_clip_with_null_working_clips_fps_falls_back_to_game_video_fps(self):
        """The exact legacy-cohort scenario from Tbug49p's COALESCE(video_sequence,
        1) test: NULL working_clips.fps + NULL raw_clips.video_sequence, real fps
        only on game_videos (sequence=1, the legacy single-video default). The
        API response's fps field must resolve to the game video's fps, not None."""
        project_id = _make_project()
        game_id = _make_game_with_video(fps=50.0, video_sequence=1)
        _make_clip(project_id, game_id, wc_fps=None, video_sequence=None)

        resp = client.get(f"/api/clips/projects/{project_id}/clips")
        assert resp.status_code == 200
        clips = resp.json()
        assert len(clips) == 1
        assert clips[0]["fps"] == 50.0, (
            f"expected legacy clip to fall back to game_videos.fps=50.0, got {clips[0]['fps']!r}"
        )

    def test_working_clips_fps_takes_priority_over_game_video_fps(self):
        """When working_clips.fps IS set, it wins (mirrors Tbug49p's DB-resolve
        priority: `wc_fps or gv_fps`)."""
        project_id = _make_project()
        game_id = _make_game_with_video(fps=30.0, video_sequence=1)
        _make_clip(project_id, game_id, wc_fps=60.0, video_sequence=None)

        resp = client.get(f"/api/clips/projects/{project_id}/clips")
        assert resp.status_code == 200
        clips = resp.json()
        assert clips[0]["fps"] == 60.0

    def test_both_null_returns_null_not_a_crash(self):
        """No silent-fallback substitution: when neither source has fps, the
        response field stays None (client treats missing fps as < 31 / no
        prompt, per design doc Q4a) -- must not raise or fabricate a value."""
        project_id = _make_project()
        game_id = _make_game_with_video(fps=None, video_sequence=1)
        _make_clip(project_id, game_id, wc_fps=None, video_sequence=None)

        resp = client.get(f"/api/clips/projects/{project_id}/clips")
        assert resp.status_code == 200
        clips = resp.json()
        assert clips[0]["fps"] is None
