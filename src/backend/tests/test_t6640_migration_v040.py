"""T6640 -- v040 profile_db migration: backfill exactly one default intro card.

T6640 enforces "exactly one default while cards exist" on create (first card wins)
and delete (deleting the default promotes another), but never touched cards that
already existed. A profile built before T6640 therefore had is_default = 0 on
every row, so the derived Default badge appeared nowhere and every card offered
"Set as default" -- the user-reported symptom this migration repairs.

Exercised under the migration runner's TUPLE row factory (plain sqlite3.connect,
no sqlite3.Row) so positional row reads are the only shape used -- the v017
landmine.
"""

import sqlite3

from app.migrations.profile_db.v040_backfill_intro_card_default import (
    V040BackfillIntroCardDefault,
)


def _make_pre_v040_db(tmp_path):
    """A profile DB with the intro_cards shape v040 reads. Tuple row factory
    (no sqlite3.Row) like the runner."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE intro_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT
        )
    """)
    conn.commit()
    return conn


def _add(conn, name, created_at, is_default=0):
    conn.execute(
        "INSERT INTO intro_cards (name, is_default, created_at) VALUES (?, ?, ?)",
        (name, is_default, created_at),
    )
    conn.commit()


def test_promotes_the_earliest_card_when_no_default_exists(tmp_path):
    """The user's case: a library where nothing is default. The FIRST card wins."""
    conn = _make_pre_v040_db(tmp_path)
    _add(conn, "Intro Card 2", "2026-08-02T10:00:00")
    _add(conn, "Intro Card 1", "2026-08-01T09:00:00")   # earliest by created_at
    _add(conn, "Intro Card 3", "2026-08-03T11:00:00")

    V040BackfillIntroCardDefault().up(conn)

    rows = conn.execute(
        "SELECT name, is_default FROM intro_cards ORDER BY created_at"
    ).fetchall()
    assert rows == [("Intro Card 1", 1), ("Intro Card 2", 0), ("Intro Card 3", 0)]


def test_leaves_an_existing_default_alone(tmp_path):
    """A profile that already has a default must not be re-pointed at the earliest
    card -- that would silently move the user's own choice."""
    conn = _make_pre_v040_db(tmp_path)
    _add(conn, "first", "2026-08-01T09:00:00")
    _add(conn, "chosen", "2026-08-05T09:00:00", is_default=1)

    V040BackfillIntroCardDefault().up(conn)

    rows = conn.execute(
        "SELECT name, is_default FROM intro_cards ORDER BY created_at"
    ).fetchall()
    assert rows == [("first", 0), ("chosen", 1)]


def test_exactly_one_default_after_backfill(tmp_path):
    """The invariant itself, stated as an assertion."""
    conn = _make_pre_v040_db(tmp_path)
    for i in range(5):
        _add(conn, f"c{i}", f"2026-08-0{i + 1}T09:00:00")

    V040BackfillIntroCardDefault().up(conn)

    count = conn.execute(
        "SELECT COUNT(*) FROM intro_cards WHERE is_default = 1"
    ).fetchone()[0]
    assert count == 1


def test_ties_on_created_at_break_by_id(tmp_path):
    """Same timestamp (bulk-created cards) still yields exactly one winner."""
    conn = _make_pre_v040_db(tmp_path)
    _add(conn, "a", "2026-08-01T09:00:00")
    _add(conn, "b", "2026-08-01T09:00:00")

    V040BackfillIntroCardDefault().up(conn)

    rows = conn.execute("SELECT name, is_default FROM intro_cards ORDER BY id").fetchall()
    assert rows == [("a", 1), ("b", 0)]


def test_idempotent_second_run_is_noop(tmp_path):
    conn = _make_pre_v040_db(tmp_path)
    _add(conn, "first", "2026-08-01T09:00:00")
    _add(conn, "second", "2026-08-02T09:00:00")

    V040BackfillIntroCardDefault().up(conn)
    V040BackfillIntroCardDefault().up(conn)  # must not raise, must not move it

    rows = conn.execute("SELECT name, is_default FROM intro_cards ORDER BY id").fetchall()
    assert rows == [("first", 1), ("second", 0)]


def test_no_cards_means_no_default(tmp_path):
    """Zero cards -> zero defaults; the invariant is 'one default WHILE cards exist'."""
    conn = _make_pre_v040_db(tmp_path)

    V040BackfillIntroCardDefault().up(conn)  # must not raise

    count = conn.execute("SELECT COUNT(*) FROM intro_cards").fetchone()[0]
    assert count == 0


def test_noop_when_no_intro_cards_table(tmp_path):
    """A below-head DB with no intro_cards table is a safe skip, no raise."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V040BackfillIntroCardDefault().up(conn)  # must not raise
    tables = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "intro_cards" not in tables
