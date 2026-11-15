"""T10540: the game tile picture follows the game's top-rated play.

`ensure_game_source_poster` decides the frame first (top-rated play's start on its
own video, else the one-minute frame), then treats the stored card as a cache hit
ONLY when its R2 metadata says it was made from that same choice. A stale or
metadata-less card is remade in place; the old card stays served when a remake is
impossible (failed extraction, expired video).

These tests run the real choice query against an in-memory sqlite and a fake R2
store (dict of key -> metadata); ffmpeg is replaced by a recorder of the seek.
"""

import asyncio
import logging
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app import database, storage
from app.routers import games
from app.services import poster
from app.services.poster import (
    _choose_game_poster_frame,
    ensure_game_source_poster,
    recap_card_poster_r2_key,
)

USER_ID = "u-t10540"
PROFILE_ID = "p-t10540"
GAME_ID = 7
CARD_KEY = recap_card_poster_r2_key(USER_ID, PROFILE_ID, GAME_ID)


class World:
    """A game in sqlite plus a fake R2 bucket and an ffmpeg recorder."""

    def __init__(self, video_duration=600.0):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            "CREATE TABLE games (id INTEGER PRIMARY KEY, blake3_hash TEXT, "
            "video_duration REAL, recap_video_url TEXT)"
        )
        self.conn.execute(
            "CREATE TABLE game_videos (game_id INTEGER, blake3_hash TEXT, "
            "sequence INTEGER, duration REAL)"
        )
        self.conn.execute(
            "CREATE TABLE raw_clips (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, "
            "rating INTEGER, start_time REAL, video_sequence INTEGER)"
        )
        self.conn.execute(
            "INSERT INTO games (id, blake3_hash, video_duration) VALUES (?, 'ghash', ?)",
            (GAME_ID, video_duration),
        )
        self.conn.commit()
        self.r2 = {"games/ghash.mp4": {}}  # key -> Metadata
        self.seeks = []
        self.extract_ok = True

    # -- plays (what the save/update/delete paths write) --
    def add_play(self, rating, start, seq=None):
        cur = self.conn.execute(
            "INSERT INTO raw_clips (game_id, rating, start_time, video_sequence) "
            "VALUES (?, ?, ?, ?)", (GAME_ID, rating, start, seq),
        )
        self.conn.commit()
        return cur.lastrowid

    def update_play(self, clip_id, **fields):
        for col, val in fields.items():
            self.conn.execute(f"UPDATE raw_clips SET {col} = ? WHERE id = ?", (val, clip_id))
        self.conn.commit()

    def delete_play(self, clip_id):
        self.conn.execute("DELETE FROM raw_clips WHERE id = ?", (clip_id,))
        self.conn.commit()

    # -- fakes --
    def _db(self):
        conn = self.conn

        class _Ctx:
            def __enter__(self):
                return conn

            def __exit__(self, *a):
                return False

        return _Ctx()

    def _head(self, key):
        if key not in self.r2:
            return None
        return {"ContentLength": 1, "Metadata": dict(self.r2[key])}

    def _upload(self, key, data, fast=False, content_type=None, metadata=None):
        self.r2[key] = {k: str(v) for k, v in (metadata or {}).items()}
        return True

    def _extract(self, source, output_path, seek=0.0, resize_width=None, jpeg_quality=3):
        self.seeks.append(seek)
        if not self.extract_ok:
            return False
        Path(output_path).write_bytes(b"\xff\xd8fake")
        return True

    def ensure(self):
        """Run ensure_game_source_poster; return (result, seeks this call, presigns)."""
        before = len(self.seeks)
        presign = MagicMock(return_value="https://r2/g.mp4?sig")
        with patch.object(database, "get_db_connection", self._db), \
             patch.object(storage, "r2_head_object_global", self._head), \
             patch.object(storage, "upload_bytes_to_r2_global", self._upload), \
             patch.object(storage, "generate_presigned_url_global", presign), \
             patch.object(poster, "extract_first_frame_jpeg", self._extract), \
             patch.object(poster, "_jpeg_dimensions", return_value=(480, 270)):
            result = ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID)
        return result, self.seeks[before:], presign.call_count


@pytest.fixture
def world():
    return World()


def test_c1_fresh_upload_no_plays_uses_one_minute_frame(world):
    result, seeks, _ = world.ensure()
    assert result is True
    assert seeks == [60.0]
    assert CARD_KEY in world.r2


def test_c2_first_play_saved_remakes_at_play_start(world):
    world.ensure()  # one-minute picture
    world.add_play(3, 100.0)
    result, seeks, _ = world.ensure()
    assert result is True
    assert seeks == [100.0]


def test_c3_higher_rated_remakes_lower_or_equal_later_reads_no_video(world):
    world.add_play(3, 100.0)
    world.ensure()
    world.add_play(5, 200.0)  # higher rated -> remake
    assert world.ensure()[1] == [200.0]

    world.add_play(5, 300.0)  # equal rating, later -> no change
    world.add_play(2, 50.0)   # lower rating -> no change
    result, seeks, presigns = world.ensure()
    assert result is True
    assert seeks == []
    assert presigns == 0


def test_c4_lower_move_delete_each_remake_to_new_answer(world):
    a = world.add_play(4, 100.0)
    b = world.add_play(5, 200.0)
    world.ensure()

    world.update_play(b, rating=3)  # lowered below a
    assert world.ensure()[1] == [100.0]

    world.update_play(a, start_time=110.0)  # top play's start moved
    assert world.ensure()[1] == [110.0]

    world.delete_play(a)  # top play deleted -> next best (b @ 200)
    assert world.ensure()[1] == [200.0]

    world.delete_play(b)  # none left -> one-minute picture
    assert world.ensure()[1] == [60.0]


def test_c4_top_play_on_second_video_reads_that_video(world):
    world.conn.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
        "VALUES (?, 'h2', 2, 600)", (GAME_ID,),
    )
    world.conn.commit()
    world.r2["games/h2.mp4"] = {}
    world.add_play(5, 40.0, seq=2)
    world.ensure()
    assert world.r2[CARD_KEY]["source_hash"] == "h2"
    assert world.r2[CARD_KEY]["source_ts"] == "40.000"


def test_c5_unrated_ranks_below_rated_and_above_none(world):
    assert _choose_game_poster_frame(world.conn.cursor(), GAME_ID) is None
    world.add_play(None, 10.0)
    assert _choose_game_poster_frame(world.conn.cursor(), GAME_ID) == ("ghash", 10.0)
    world.add_play(1, 90.0)
    assert _choose_game_poster_frame(world.conn.cursor(), GAME_ID) == ("ghash", 90.0)


def test_c6_card_without_source_metadata_is_remade_once(world):
    world.add_play(5, 100.0)
    world.r2[CARD_KEY] = {"width": "480", "height": "270"}  # pre-T10540 object
    assert world.ensure()[1] == [100.0]
    result, seeks, presigns = world.ensure()
    assert result is True
    assert seeks == []
    assert presigns == 0


def test_c7_failed_remake_keeps_old_picture_and_warns(world, caplog):
    world.ensure()  # one-minute picture
    old = dict(world.r2[CARD_KEY])
    world.add_play(5, 100.0)
    world.extract_ok = False
    with caplog.at_level(logging.WARNING, logger=poster.logger.name):
        result, seeks, _ = world.ensure()
    assert result is True  # endpoint keeps serving the old card
    assert seeks == [100.0]
    assert world.r2[CARD_KEY] == old
    assert any(
        r.levelno == logging.WARNING and "game 7" in r.getMessage() for r in caplog.records
    )


def test_c7_failed_first_picture_is_false(world):
    world.extract_ok = False
    assert world.ensure()[0] is False


def test_c9_expired_video_keeps_existing_picture(world):
    world.ensure()
    old = dict(world.r2[CARD_KEY])
    world.add_play(5, 100.0)
    del world.r2["games/ghash.mp4"]  # game video expired
    result, seeks, _ = world.ensure()
    assert result is True
    assert seeks == []
    assert world.r2[CARD_KEY] == old


def test_c9_expired_video_never_had_picture_is_false(world):
    del world.r2["games/ghash.mp4"]
    assert world.ensure()[0] is False


# ---------------------------------------------------------------------------
# Endpoint order (rule 8) and the warmer
# ---------------------------------------------------------------------------

def _fake_db_with_row(row):
    cursor = MagicMock()
    cursor.fetchone.return_value = row
    conn = MagicMock()
    conn.cursor.return_value = cursor

    class _Ctx:
        def __enter__(self):
            return conn

        def __exit__(self, *a):
            return False

    return lambda: _Ctx()


def _poster_client():
    from unittest.mock import AsyncMock
    resp = MagicMock(status_code=200, content=b"\xff\xd8x")
    resp.headers = {"etag": '"e"'}
    client = MagicMock()
    client.get = AsyncMock(return_value=resp)
    return client


def _get_poster(row, source_result, recap_result=True):
    req = MagicMock()
    req.headers = {}
    with patch.object(games, "get_db_connection", _fake_db_with_row(row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_game_source_poster", return_value=source_result) as src, \
         patch.object(poster, "ensure_recap_poster", return_value=recap_result) as rec, \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg"), \
         patch("app.storage.get_poster_r2_client", return_value=_poster_client()):
        resp = asyncio.run(games.get_game_poster(GAME_ID, req))
    return resp, src, rec


def test_c8_recap_game_with_live_video_serves_top_play_not_recap():
    resp, src, rec = _get_poster({"id": GAME_ID, "recap_video_url": "r.mp4"}, True)
    assert resp.status_code == 200
    src.assert_called_once_with(USER_ID, PROFILE_ID, GAME_ID)
    rec.assert_not_called()


def test_c8_recap_game_without_source_picture_falls_back_to_recap():
    resp, _src, rec = _get_poster({"id": GAME_ID, "recap_video_url": "r.mp4"}, False)
    assert resp.status_code == 200
    rec.assert_called_once()


def test_warmer_runs_the_staleness_check_even_when_card_exists():
    from app.services.poster_warmer import PosterWarmer

    calls = []
    with patch("app.services.poster_warmer.ensure_game_source_poster",
               side_effect=lambda *a: calls.append(a) or True), \
         patch("app.services.poster_warmer.r2_head_object_global", create=True,
               return_value={"ContentLength": 1, "Metadata": {}}):
        assert asyncio.run(
            PosterWarmer().warm_game_source_poster_async(USER_ID, PROFILE_ID, GAME_ID)
        ) is True
    assert calls == [(USER_ID, PROFILE_ID, GAME_ID)]


# ---------------------------------------------------------------------------
# Rule 9: the tile address changes when the top play changes
# ---------------------------------------------------------------------------

def test_c10_list_poster_version_changes_with_top_play(world):
    from app.routers.games import _compute_poster_versions

    def version():
        return _compute_poster_versions(world.conn.cursor(), [GAME_ID])[GAME_ID]

    none = version()
    a = world.add_play(3, 100.0)
    first = version()
    assert first != none
    c = world.add_play(2, 50.0)  # not the top play
    assert version() == first
    b = world.add_play(5, 200.0)
    top = version()
    assert top != first
    world.update_play(b, start_time=210.0)
    assert version() != top
    world.delete_play(b)
    world.delete_play(a)
    world.delete_play(c)
    assert version() == none
