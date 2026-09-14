"""clip_count is derived live from raw_clips, not a stored column.

Regression: a shared game showed "0 clips" because the list query read a stale
denormalized games.clip_count. It now derives via _compute_athlete_stats, which
must count ALL clips (shared clips have my_athlete=0) while keeping the rating
badges my_athlete-filtered.
"""
import sqlite3

from app.routers.games import _compute_athlete_stats


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE raw_clips (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               game_id INTEGER, rating INTEGER, tags BLOB,
               my_athlete INTEGER DEFAULT 1)"""
    )
    return conn


def _add(conn, game_id, rating, my_athlete):
    conn.execute(
        "INSERT INTO raw_clips (game_id, rating, tags, my_athlete) VALUES (?, ?, NULL, ?)",
        (game_id, rating, my_athlete),
    )


def test_clip_count_includes_shared_clips():
    conn = _conn()
    # 3 shared clips (my_athlete=0) -- the case that showed "0 clips"
    _add(conn, 1, 5, 0)
    _add(conn, 1, 4, 0)
    _add(conn, 1, 3, 0)
    stats = _compute_athlete_stats(conn.cursor(), [1])
    assert stats[1]["clip_count"] == 3
    # rating badges stay my_athlete-filtered -> none of the shared clips count
    assert stats[1]["brilliant_count"] == 0
    assert stats[1]["good_count"] == 0


def test_clip_count_counts_total_but_badges_filter():
    conn = _conn()
    _add(conn, 1, 5, 1)   # own athlete, brilliant
    _add(conn, 1, 4, 0)   # shared, good (filtered out of badges)
    stats = _compute_athlete_stats(conn.cursor(), [1])
    assert stats[1]["clip_count"] == 2       # total
    assert stats[1]["brilliant_count"] == 1  # only the my_athlete clip
    assert stats[1]["good_count"] == 0       # shared clip excluded from badges


# T10120: per-layer clip counts let the Games tile tell a fully-annotated team-only
# game (recap_video_url is athlete-layer-only, so NULL) apart from an empty one, and
# open its recap on the tab that has content.
def test_per_layer_clip_counts_mixed_game():
    conn = _conn()
    _add(conn, 1, 5, 1)   # athlete
    _add(conn, 1, 4, 1)   # athlete
    _add(conn, 1, 3, 0)   # team (shared)
    stats = _compute_athlete_stats(conn.cursor(), [1])
    assert stats[1]["clip_count"] == 3
    assert stats[1]["athlete_clip_count"] == 2
    assert stats[1]["team_clip_count"] == 1


def test_per_layer_clip_counts_team_only_game():
    # The bug-52 shape: every clip is team-layer (my_athlete=0), so there is no
    # athlete recap -> the tile must still know annotations exist (clip_count > 0)
    # and open on the team tab (athlete_clip_count == 0).
    conn = _conn()
    _add(conn, 1, 5, 0)
    _add(conn, 1, 4, 0)
    stats = _compute_athlete_stats(conn.cursor(), [1])
    assert stats[1]["clip_count"] == 2
    assert stats[1]["athlete_clip_count"] == 0
    assert stats[1]["team_clip_count"] == 2


def test_per_layer_clip_counts_null_my_athlete_is_athlete():
    # A NULL my_athlete counts as athlete, matching the rating-badge filter.
    conn = _conn()
    conn.execute(
        "INSERT INTO raw_clips (game_id, rating, tags, my_athlete) VALUES (1, 5, NULL, NULL)"
    )
    stats = _compute_athlete_stats(conn.cursor(), [1])
    assert stats[1]["athlete_clip_count"] == 1
    assert stats[1]["team_clip_count"] == 0
