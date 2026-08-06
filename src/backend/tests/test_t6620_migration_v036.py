"""T6620 -- v036 profile_db migration: NULL the now-dead intro_cards.title_text.

The title is the profile's Full Name always (T6620); title_text is no longer
read. This migration makes the stored data match that decision by nulling every
populated title_text, so nothing looks like a live override to a future reader.

Exercised under the migration runner's TUPLE row factory (plain sqlite3.connect,
no sqlite3.Row) so the PRAGMA positional read (r[1]) is the only column probe --
the v017 landmine. QA "run against a real profile DB WITH DATA" is met by
test_nulls_populated_title_text_preserves_other_columns.
"""

import sqlite3

from app.migrations.profile_db.v036_null_dead_intro_card_title_text import (
    V036NullDeadIntroCardTitleText,
)


def _make_pre_v036_db(tmp_path):
    """A v035 profile DB: intro_cards WITH a populated title_text. Tuple row
    factory (no sqlite3.Row) like the runner."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE intro_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            shown_fields TEXT NOT NULL,
            treatment TEXT NOT NULL,
            title_text TEXT,
            subtitle_text TEXT
        )
    """)
    conn.commit()
    return conn


def test_nulls_populated_title_text_preserves_other_columns(tmp_path):
    """Real DB WITH DATA: every title_text becomes NULL; nothing else moves."""
    conn = _make_pre_v036_db(tmp_path)
    conn.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, title_text, subtitle_text)"
        " VALUES ('New card 1', '[]', 'gold', 'New card 1', 'State Cup')"
    )
    conn.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, title_text, subtitle_text)"
        " VALUES ('c2', '[\"position\"]', 'dark', 'Legacy Name', NULL)"
    )
    conn.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, title_text, subtitle_text)"
        " VALUES ('c3', '[]', 'gold', NULL, NULL)"
    )
    conn.commit()

    V036NullDeadIntroCardTitleText().up(conn)

    rows = conn.execute(
        "SELECT name, title_text, subtitle_text, treatment FROM intro_cards ORDER BY name"
    ).fetchall()
    # title_text is NULL everywhere; name/subtitle/treatment untouched.
    assert rows == [
        ("New card 1", None, "State Cup", "gold"),
        ("c2", None, None, "dark"),
        ("c3", None, None, "gold"),
    ]


def test_idempotent_second_run_is_noop(tmp_path):
    conn = _make_pre_v036_db(tmp_path)
    conn.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, title_text)"
        " VALUES ('c', '[]', 'gold', 'X')"
    )
    conn.commit()

    V036NullDeadIntroCardTitleText().up(conn)  # nulls it
    V036NullDeadIntroCardTitleText().up(conn)  # must not raise

    got = conn.execute("SELECT title_text FROM intro_cards").fetchone()[0]
    assert got is None


def test_noop_when_no_intro_cards_table(tmp_path):
    """A below-head DB with no intro_cards table is a safe skip, no raise."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V036NullDeadIntroCardTitleText().up(conn)  # must not raise
    tables = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "intro_cards" not in tables


def test_noop_when_column_absent(tmp_path):
    """intro_cards without a title_text column (defensive) is a safe skip."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE intro_cards (id INTEGER PRIMARY KEY, name TEXT)")
    conn.commit()
    V036NullDeadIntroCardTitleText().up(conn)  # must not raise
    cols = {r[1] for r in conn.execute("PRAGMA table_info(intro_cards)").fetchall()}
    assert "title_text" not in cols
