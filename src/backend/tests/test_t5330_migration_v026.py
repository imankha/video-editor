"""
T5330 — v026 profile_db migration: add games.shared_by + backfill from clips.

Exercises the row-reading path WITH DATA under the migration runner's TUPLE row
factory (migrations/__init__.py connects with plain sqlite3.connect, no
sqlite3.Row) -- PRAGMA table_info rows must be indexed positionally (row[1]), and
the backfill UPDATE derives a shared game's provenance from its own shared clips,
in-profile, with no Postgres access.
"""

import sqlite3

from app.migrations.profile_db.v026_games_shared_by import V026GamesSharedBy


def _make_pre_v026_db(tmp_path):
    """Games table WITHOUT shared_by (pre-migration schema), tuple row factory --
    mirrors exactly how migrations/__init__.py opens the connection."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory override -> tuples
    conn.execute("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            blake3_hash TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER,
            shared_by TEXT DEFAULT NULL
        )
    """)
    conn.commit()
    return conn


def test_adds_column_when_missing(tmp_path):
    conn = _make_pre_v026_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
    assert "shared_by" not in cols_before

    V026GamesSharedBy().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
    assert "shared_by" in cols_after


def test_idempotent_when_column_already_present(tmp_path):
    conn = _make_pre_v026_db(tmp_path)
    V026GamesSharedBy().up(conn)  # first run adds the column
    V026GamesSharedBy().up(conn)  # must not raise / not duplicate-add

    cols = [row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()]
    assert cols.count("shared_by") == 1


def test_backfills_shared_game_from_its_clips(tmp_path):
    """A legacy materialized game (shared_by NULL, pre-T5330) with a shared clip
    adopts that clip's provenance -- exercised WITH real row data."""
    conn = _make_pre_v026_db(tmp_path)

    conn.execute("INSERT INTO games (id, name) VALUES (1, 'Shared Game')")
    conn.execute(
        "INSERT INTO raw_clips (id, game_id, shared_by) VALUES (1, 1, 'sharer@example.com')"
    )
    conn.commit()

    V026GamesSharedBy().up(conn)

    row = conn.execute("SELECT shared_by FROM games WHERE id = 1").fetchone()
    assert row[0] == "sharer@example.com"  # positional index -- tuple row factory


def test_own_game_with_no_shared_clips_stays_null(tmp_path):
    """A game the user actually created (no shared clips) must NOT be stamped --
    that would wrongly suppress upload_game for an established user."""
    conn = _make_pre_v026_db(tmp_path)

    conn.execute("INSERT INTO games (id, name) VALUES (1, 'My Own Game')")
    conn.execute("INSERT INTO raw_clips (id, game_id, shared_by) VALUES (1, 1, NULL)")
    conn.commit()

    V026GamesSharedBy().up(conn)

    row = conn.execute("SELECT shared_by FROM games WHERE id = 1").fetchone()
    assert row[0] is None


def test_game_only_share_with_no_clips_stays_null_documented_residual(tmp_path):
    """A legacy game-only share (materialized with zero clips) has no in-profile
    signal to derive from -- stays NULL. Accepted residual (T5330 design ss4):
    quest_1 is still correctly incomplete overall because there are no shared
    clips to inflate add_clip/rate_clip/annotate_brilliant either."""
    conn = _make_pre_v026_db(tmp_path)

    conn.execute("INSERT INTO games (id, name) VALUES (1, 'Game Only Share')")
    conn.commit()  # no raw_clips rows at all for this game

    V026GamesSharedBy().up(conn)

    row = conn.execute("SELECT shared_by FROM games WHERE id = 1").fetchone()
    assert row[0] is None


def test_mixed_games_backfill_independently(tmp_path):
    """Multiple games in one profile: only the shared one is stamped."""
    conn = _make_pre_v026_db(tmp_path)

    conn.execute("INSERT INTO games (id, name) VALUES (1, 'Own Game')")
    conn.execute("INSERT INTO games (id, name) VALUES (2, 'Shared Game')")
    conn.execute("INSERT INTO raw_clips (id, game_id, shared_by) VALUES (1, 1, NULL)")
    conn.execute("INSERT INTO raw_clips (id, game_id, shared_by) VALUES (2, 2, 'lost')")
    conn.commit()

    V026GamesSharedBy().up(conn)

    rows = dict(conn.execute("SELECT id, shared_by FROM games").fetchall())
    assert rows[1] is None
    assert rows[2] == "lost"


def test_noop_on_missing_games_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V026GamesSharedBy().up(conn)  # must not raise
