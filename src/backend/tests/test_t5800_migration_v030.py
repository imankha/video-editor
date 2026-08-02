"""
T5800 -- v030 profile_db migration: add games.source_profile_id (TEXT NULL) +
games.source_game_id (INTEGER NULL).

Pure additive columns (both default NULL, which IS the correct value for every
existing REAL game -- a reference is the only row with source_profile_id set, and
none can exist before v030). Exercised under the migration runner's TUPLE row
factory (migrations/__init__.py connects with plain sqlite3.connect, no
sqlite3.Row) so the PRAGMA positional read (r[1]) is the only column probe.
"""

import sqlite3

from app.migrations.profile_db.v030_games_source_reference import V030GamesSourceReference


def _make_pre_v030_db(tmp_path):
    """games WITHOUT the source_* columns, tuple row factory."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            blake3_hash TEXT,
            status TEXT DEFAULT 'ready',
            shared_by TEXT DEFAULT NULL
        )
    """)
    conn.commit()
    return conn


def test_adds_source_columns_when_missing(tmp_path):
    conn = _make_pre_v030_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
    assert "source_profile_id" not in cols_before
    assert "source_game_id" not in cols_before

    V030GamesSourceReference().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
    assert "source_profile_id" in cols_after
    assert "source_game_id" in cols_after


def test_existing_real_games_keep_null_source_columns(tmp_path):
    conn = _make_pre_v030_db(tmp_path)
    conn.execute("INSERT INTO games (name, blake3_hash) VALUES ('Real Game', 'abc')")
    conn.commit()

    V030GamesSourceReference().up(conn)

    # Tuple row factory: index positionally.
    src_profile, src_game = conn.execute(
        "SELECT source_profile_id, source_game_id FROM games WHERE name = 'Real Game'"
    ).fetchone()
    assert src_profile is None
    assert src_game is None


def test_idempotent_when_columns_already_present(tmp_path):
    conn = _make_pre_v030_db(tmp_path)
    V030GamesSourceReference().up(conn)  # adds
    V030GamesSourceReference().up(conn)  # must not raise / not duplicate

    cols = [row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()]
    assert cols.count("source_profile_id") == 1
    assert cols.count("source_game_id") == 1


def test_noop_on_missing_games_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V030GamesSourceReference().up(conn)  # must not raise
