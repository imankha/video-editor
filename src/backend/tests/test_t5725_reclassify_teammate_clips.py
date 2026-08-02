"""T5725: profile_db v031 reclassifies teammate-tagged My-Athlete clips to Team.

The migration MOVES every teammate-tagged clip currently on the My Athlete layer
(`my_athlete = 1 OR my_athlete IS NULL`) onto the Team layer (`my_athlete = 0`),
PRESERVING the tags. It must:
  - move a My-Athlete clip with a tagged_teammates blob,
  - move a legacy NULL-layer clip with tags (NULL == My Athlete),
  - move a My-Athlete clip that only carries a clip_teammates join row (blob desynced),
  - leave an untagged My-Athlete clip alone,
  - leave an already-Team clip alone (and keep ITS tags),
  - preserve the tag payload on every moved clip,
  - report the affected count,
  - be idempotent (a second run moves nothing).

Runs the migration's `up(conn)` against a PLAIN sqlite3 connection (default TUPLE
row factory) -- exactly what the migration runner hands it -- so the positional
row-reading path is exercised with real data (the v017 row-factory landmine).
"""

import logging
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import USER_DATA_BASE, ensure_database, get_database_path, get_db_connection
from app.migrations.profile_db.v031_reclassify_teammate_clips_to_team import (
    V031ReclassifyTeammateClipsToTeam,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id
from app.utils.encoding import decode_data, encode_data

TEST_PROFILE_ID = "testdefault"


def _cleanup(user_id: str) -> None:
    path = USER_DATA_BASE / user_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _seed(user_id: str) -> dict:
    """Seed the mixed clip population. Returns a name->clip_id map."""
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    ids = {}
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name, blake3_hash, status) VALUES ('Game', 'abc', 'ready')")
        game_id = cur.lastrowid

        def add_clip(name, my_athlete, teammates, seq):
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, game_id, video_sequence, end_time, "
                "my_athlete, tagged_teammates) VALUES (?, 5, ?, ?, ?, ?, ?)",
                (f"{name}.mp4", game_id, seq, 10.0 + seq, my_athlete, encode_data(teammates)),
            )
            ids[name] = cur.lastrowid

        # A: My Athlete + tags -> MOVE
        add_clip("A_mine_tagged", 1, ["Alex", "Sam"], 0)
        # B: legacy NULL layer + tags -> MOVE (NULL == My Athlete)
        add_clip("B_null_tagged", None, ["Kai"], 1)
        # C: My Athlete, no tags -> STAY
        add_clip("C_mine_untagged", 1, [], 2)
        # D: already Team + tags -> STAY (and keep tags)
        add_clip("D_team_tagged", 0, ["Jo"], 3)
        # E: My Athlete, empty blob but a clip_teammates join row -> MOVE (belt-and-suspenders)
        add_clip("E_mine_joinonly", 1, [], 4)

        # Populate clip_teammates for the rows that carry real tags + E's desynced join.
        for tag in ("Alex", "Sam"):
            cur.execute("INSERT INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)", (ids["A_mine_tagged"], tag))
        cur.execute("INSERT INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)", (ids["B_null_tagged"], "Kai"))
        cur.execute("INSERT INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)", (ids["D_team_tagged"], "Jo"))
        cur.execute("INSERT INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)", (ids["E_mine_joinonly"], "Robin"))

        conn.commit()
    return ids


def _read_layers() -> dict:
    """Return {clip_id: (my_athlete, decoded_tagged_teammates)} straight from disk."""
    conn = sqlite3.connect(str(get_database_path()))  # default TUPLE row factory
    rows = conn.execute("SELECT id, my_athlete, tagged_teammates FROM raw_clips").fetchall()
    conn.close()
    return {r[0]: (r[1], decode_data(r[2])) for r in rows}


def _apply_migration() -> None:
    """Run up() against a plain tuple-factory connection, like the real runner."""
    conn = sqlite3.connect(str(get_database_path()))
    V031ReclassifyTeammateClipsToTeam().up(conn)
    conn.commit()
    conn.close()


@pytest.fixture
def seeded():
    user_id = f"test_t5725_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    ensure_database()
    ids = _seed(user_id)
    yield {"user_id": user_id, "ids": ids}
    _cleanup(user_id)


def test_moves_exactly_the_right_rows_and_preserves_tags(seeded):
    ids = seeded["ids"]
    _apply_migration()
    layers = _read_layers()

    # Moved to Team, tags intact.
    assert layers[ids["A_mine_tagged"]] == (0, ["Alex", "Sam"])
    assert layers[ids["B_null_tagged"]] == (0, ["Kai"])
    assert layers[ids["E_mine_joinonly"]][0] == 0  # moved via the join row

    # Untouched.
    assert layers[ids["C_mine_untagged"]][0] == 1        # untagged My Athlete stays
    assert layers[ids["D_team_tagged"]] == (0, ["Jo"])   # already Team, tags kept


def test_reports_the_affected_count(seeded, caplog):
    with caplog.at_level(logging.INFO):
        _apply_migration()
    # A, B, E move -> 3.
    assert any("reclassified 3" in rec.getMessage() for rec in caplog.records), (
        [rec.getMessage() for rec in caplog.records]
    )


def test_is_idempotent(seeded, caplog):
    _apply_migration()
    first = _read_layers()

    caplog.clear()
    with caplog.at_level(logging.INFO):
        _apply_migration()  # second run

    assert _read_layers() == first  # nothing changed
    messages = [rec.getMessage() for rec in caplog.records]
    assert any("no teammate-tagged My-Athlete clips" in m for m in messages), messages


def test_no_raw_clips_table_is_a_noop():
    """An ancient DB without raw_clips must not crash the migration."""
    user_id = f"test_t5725_empty_{uuid.uuid4().hex[:8]}"
    try:
        base = USER_DATA_BASE / user_id / "profiles" / TEST_PROFILE_ID
        base.mkdir(parents=True, exist_ok=True)
        db_path = base / "profile.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE unrelated (id INTEGER)")
        conn.commit()
        V031ReclassifyTeammateClipsToTeam().up(conn)  # must not raise
        conn.close()
    finally:
        _cleanup(user_id)
