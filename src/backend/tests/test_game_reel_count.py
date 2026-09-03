"""reel_count is the count of PUBLISHED reels attributable to each game (T8260).

A reel counts for a game when its frozen game_ids decodes to exactly that one
game id (route_game_ids), regardless of clip_count -- deliberately NOT
route_collection, which would drop a multi-clip highlight reel built from one
game. Multi-game mixes, game-less reels, unpublished drafts, and teammate-only
single-clip reels count for NO game.
"""
import sqlite3

from app.routers.games import _compute_reel_counts
from app.services.collection_metadata import encode_game_ids


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE final_videos (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               project_id INTEGER, game_id INTEGER, version INTEGER DEFAULT 1,
               game_ids BLOB, published_at TEXT, clip_count INTEGER DEFAULT 1,
               source_clip_id INTEGER)"""
    )
    conn.execute(
        """CREATE TABLE raw_clips (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               my_athlete INTEGER DEFAULT 1)"""
    )
    return conn


def _add_reel(conn, *, game_ids, published=True, clip_count=1, project_id=None,
              game_id=None, version=1, source_clip_id=None):
    conn.execute(
        """INSERT INTO final_videos
               (project_id, game_id, version, game_ids, published_at,
                clip_count, source_clip_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (project_id, game_id, version,
         encode_game_ids(game_ids) if game_ids is not None else None,
         "2026-01-01T00:00:00" if published else None, clip_count, source_clip_id),
    )


def test_single_game_reel_counts():
    conn = _conn()
    _add_reel(conn, game_ids=[1], project_id=10)
    _add_reel(conn, game_ids=[1], project_id=11)
    _add_reel(conn, game_ids=[2], project_id=12)
    counts = _compute_reel_counts(conn.cursor(), [1, 2])
    assert counts == {1: 2, 2: 1}


def test_multi_clip_single_game_reel_still_counts():
    """The route_collection trap: a multi-clip reel from ONE game must count."""
    conn = _conn()
    _add_reel(conn, game_ids=[1], clip_count=5, project_id=10)
    counts = _compute_reel_counts(conn.cursor(), [1])
    assert counts == {1: 1}


def test_multi_game_mix_counts_for_no_game():
    conn = _conn()
    _add_reel(conn, game_ids=[1, 2], clip_count=4, project_id=10)
    counts = _compute_reel_counts(conn.cursor(), [1, 2])
    assert counts == {}


def test_gameless_reel_counts_for_no_game():
    conn = _conn()
    _add_reel(conn, game_ids=None, project_id=10)
    _add_reel(conn, game_ids=[], project_id=11)
    counts = _compute_reel_counts(conn.cursor(), [1])
    assert counts == {}


def test_unpublished_draft_counts_for_no_game():
    conn = _conn()
    _add_reel(conn, game_ids=[1], published=False, project_id=10)
    counts = _compute_reel_counts(conn.cursor(), [1])
    assert counts == {}


def test_teammate_only_single_clip_reel_excluded():
    conn = _conn()
    # source clip belongs to a teammate (my_athlete=0) -> excluded from the
    # user's own surfaces by exclude_teammate_reels_clause.
    conn.execute("INSERT INTO raw_clips (id, my_athlete) VALUES (7, 0)")
    _add_reel(conn, game_ids=[1], clip_count=1, project_id=10, source_clip_id=7)
    counts = _compute_reel_counts(conn.cursor(), [1])
    assert counts == {}


def test_only_latest_version_of_a_reel_counts():
    conn = _conn()
    _add_reel(conn, game_ids=[1], project_id=10, version=1)
    _add_reel(conn, game_ids=[1], project_id=10, version=2)
    counts = _compute_reel_counts(conn.cursor(), [1])
    assert counts == {1: 1}


def test_empty_game_ids_returns_empty():
    conn = _conn()
    _add_reel(conn, game_ids=[1], project_id=10)
    assert _compute_reel_counts(conn.cursor(), []) == {}


def test_reel_for_game_not_in_wanted_is_ignored():
    conn = _conn()
    _add_reel(conn, game_ids=[99], project_id=10)
    counts = _compute_reel_counts(conn.cursor(), [1, 2])
    assert counts == {}
