"""T5195 -- v034 profile_db migration: CREATE intro_cards + add
final_videos.intro_card_id.

Exercised under the migration runner's TUPLE row factory (migrations/__init__.py
connects with a plain sqlite3.connect, no sqlite3.Row) so the PRAGMA positional
read (r[1]) is the only column probe -- the v017 landmine that crashed 4 prod
users. The QA requirement "run the migration against a real profile DB WITH
DATA" is met by test_migration_on_populated_db_preserves_rows.

NULL vs 0 on final_videos.intro_card_id are DIFFERENT values (epic decision 8):
NULL = inherit the profile default, 0 = the user opted this reel out. The
migration must land legacy rows at NULL (inherit), and the column must be able
to hold a literal 0 distinctly -- both asserted below.
"""

import sqlite3

from app.migrations.profile_db.v034_intro_card_library import V034IntroCardLibrary


def _make_pre_v034_db(tmp_path):
    """A faithful v033 profile DB: final_videos WITHOUT intro_card_id and NO
    intro_cards table. Tuple row factory (no sqlite3.Row) like the runner."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.commit()
    return conn


def test_creates_intro_cards_table_and_column(tmp_path):
    conn = _make_pre_v034_db(tmp_path)
    tables_before = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "intro_cards" not in tables_before
    cols_before = {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
    assert "intro_card_id" not in cols_before

    V034IntroCardLibrary().up(conn)

    tables_after = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "intro_cards" in tables_after
    cols_after = {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
    assert "intro_card_id" in cols_after


def test_migration_on_populated_db_preserves_rows(tmp_path):
    """Real DB WITH DATA (QA requirement): existing reels survive and land at
    NULL intro_card_id (= inherit the default), not 0."""
    conn = _make_pre_v034_db(tmp_path)
    conn.execute("INSERT INTO final_videos (filename, version) VALUES ('reel1.mp4', 1)")
    conn.execute("INSERT INTO final_videos (filename, version) VALUES ('reel2.mp4', 3)")
    conn.commit()

    V034IntroCardLibrary().up(conn)

    # Tuple row factory: index positionally.
    rows = conn.execute(
        "SELECT filename, intro_card_id FROM final_videos ORDER BY filename"
    ).fetchall()
    assert rows == [("reel1.mp4", None), ("reel2.mp4", None)]


def test_intro_card_id_holds_null_and_zero_distinctly(tmp_path):
    """The whole point of decision 8: 0 and NULL must be storable and readable
    as different values on the same column."""
    conn = _make_pre_v034_db(tmp_path)
    conn.execute("INSERT INTO final_videos (filename, version) VALUES ('inherits.mp4', 1)")
    conn.commit()

    V034IntroCardLibrary().up(conn)

    # Reel that inherits the default stays NULL; a reel opted out is set to 0.
    conn.execute("INSERT INTO final_videos (filename, version, intro_card_id) VALUES ('optout.mp4', 1, 0)")
    conn.commit()

    inherit = conn.execute(
        "SELECT intro_card_id FROM final_videos WHERE filename='inherits.mp4'"
    ).fetchone()[0]
    optout = conn.execute(
        "SELECT intro_card_id FROM final_videos WHERE filename='optout.mp4'"
    ).fetchone()[0]
    assert inherit is None       # inherit the profile default
    assert optout == 0           # explicitly no intro
    assert inherit != optout     # NULL and 0 are NOT collapsed


def test_idempotent_when_already_applied(tmp_path):
    conn = _make_pre_v034_db(tmp_path)
    V034IntroCardLibrary().up(conn)  # adds
    V034IntroCardLibrary().up(conn)  # must not raise / not duplicate

    cols = [r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()]
    assert cols.count("intro_card_id") == 1
    tables = [
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='intro_cards'"
        ).fetchall()
    ]
    assert tables.count("intro_cards") == 1


def test_noop_column_on_missing_final_videos(tmp_path):
    """intro_cards is still created even when final_videos is absent (a fresh,
    tableless DB) -- the ADD COLUMN is simply skipped, no raise."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V034IntroCardLibrary().up(conn)
    tables = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "intro_cards" in tables


def test_registry_head_is_v037():
    from app.migrations.profile_db import MIGRATIONS
    # T6570 added v035 (intro_cards.subtitle_text); T6620 added v036 (null the
    # dead intro_cards.title_text); T5215 added v037 (intro_min_duration_seconds).
    assert max(m.version for m in MIGRATIONS) == 37
    # Exactly one migration owns each version (no collision with a sibling branch).
    assert sum(1 for m in MIGRATIONS if m.version == 34) == 1
    assert sum(1 for m in MIGRATIONS if m.version == 35) == 1
    assert sum(1 for m in MIGRATIONS if m.version == 36) == 1
    assert sum(1 for m in MIGRATIONS if m.version == 37) == 1
