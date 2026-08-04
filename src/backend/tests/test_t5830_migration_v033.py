"""T5830 -- v033 profile_db migration: heal arshia's pre-T5810 moved reels.

The migration reconstructs game attribution for 14 single-clip reels the reporter
moved into his two kids' profiles before T5810 shipped (their game_ids were nulled
by the old move flow and the source reels deleted). It writes the exact T5810-shaped
state: a metadata-only game REFERENCE (ensure_game_reference) in the kid profile +
a single-id game_ids list pointing at it.

These tests exercise up(conn) directly under the runner's TUPLE row factory
(plain sqlite3.connect, no sqlite3.Row) against a reconstructed two-profile
fixture: the default profile (b95eb93b) holds the real games; the kid profiles
(b0a81fe1, 6ff007e6) hold the moved reels.

Covered:
  - all 14 mapped reels get game_ids == [reference_id]; EXACTLY 6 references
    across the two kid profiles (dedup: 14 reels -> 6 distinct (profile, game) pairs)
  - a reference carries source_profile_id='b95eb93b' + the right source_game_id,
    the frozen name/opponent/date, and video_filename IS NULL
  - NO-OP proof: an unrelated user's profile DB is byte-identical after up()
  - idempotency: a second up() yields the same 6 references + same game_ids
  - the 7 unmatched reels (not in the mapping) stay game_ids NULL
  - game_storage / refcount tables are never touched
"""

import hashlib
import sqlite3
from unittest.mock import patch

import pytest

from app.migrations.profile_db.v033_heal_moved_reel_attribution import (
    _ARSHIA_USER_ID,
    _DEFAULT_PROFILE_ID,
    V033HealMovedReelAttribution,
)
from app.utils.encoding import decode_data, encode_data

DEFAULT = _DEFAULT_PROFILE_ID          # b95eb93b -- owns the real games
KID_A = "b0a81fe1"                     # Maddie U13
KID_B = "6ff007e6"                     # Ella U13

# (target_profile, filename, clip_game_start_time, source_game_id) -- the signed-off
# mapping, mirrored here so the test pins the exact rows the migration applies.
MAPPING = [
    (KID_A, "final_4_707d183a.mp4", 405.96058099211723, 1),
    (KID_A, "final_6_53dca1f6.mp4", 816.0070391315425, 1),
    (KID_A, "final_1_adc050ba.mp4", 2673.5513595066045, 1),
    (KID_A, "final_3_11009f27.mp4", 3529.6165475009175, 1),
    (KID_A, "final_23_4347db65.mp4", 1507.1031153626207, 7),
    (KID_A, "final_28_37d914e1.mp4", 2159.607841594342, 8),
    (KID_B, "final_11_08ff1991.mp4", 2515.934628310104, 1),
    (KID_B, "final_41_c80c7709.mp4", 398.4112035921107, 6),
    (KID_B, "final_42_b44f531e.mp4", 490.3391471624593, 6),
    (KID_B, "final_38_202ad592.mp4", 287.63720379327475, 5),
    (KID_B, "final_34_d0b6f046.mp4", 1870.804440648296, 5),
    (KID_B, "final_39_bbc07817.mp4", 866.9105974096519, 5),
    (KID_B, "final_44_0a3e39e0.mp4", 1070.9785031104643, 6),
    (KID_B, "final_37_ac12f5f0.mp4", 195.3517237696267, 5),
]
SOURCE_GAME_IDS = {1, 5, 6, 7, 8}


@pytest.fixture()
def env(tmp_path):
    """arshia's account: default profile + two kid profiles, schema at head."""
    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod
    from app.user_context import set_current_req_id, set_current_user_id

    set_current_user_id(_ARSHIA_USER_ID)
    set_current_req_id("req-t5830")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database

        user_db_mod.create_profile(_ARSHIA_USER_ID, DEFAULT, "Default", "#000", is_default=True)
        user_db_mod.create_profile(_ARSHIA_USER_ID, KID_A, "Maddie U13", "#f00")
        user_db_mod.create_profile(_ARSHIA_USER_ID, KID_B, "Ella U13", "#00f")

        for pid in (DEFAULT, KID_A, KID_B):
            set_current_profile_id(pid)
            ensure_database()

        # Real games in the default profile (unique hashes so no accidental
        # hash-dedup in the kid profiles).
        dc = _conn(tmp_path, DEFAULT)
        for gid in sorted(SOURCE_GAME_IDS):
            dc.execute(
                "INSERT INTO games (id, name, blake3_hash, status, opponent_name, "
                "game_date, game_type, tournament_name, video_duration, video_width, "
                "video_height, video_size, video_fps) "
                "VALUES (?, ?, ?, 'ready', ?, ?, 'match', 'Cup', 3600, 1920, 1080, 99, 30)",
                (gid, f"Game {gid}", f"hashG{gid}", f"Rival {gid}", f"2026-05-0{gid}"),
            )
            dc.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, "
                "video_width, video_height, video_size, fps) "
                "VALUES (?, ?, 0, 3600, 1920, 1080, 99, 30)",
                (gid, f"hashG{gid}"),
            )
        dc.commit()
        dc.close()

        # The moved reels in each kid profile (game_ids NULL, clip_count 1).
        for target_profile, filename, cgst, _sgid in MAPPING:
            _insert_reel(tmp_path, target_profile, filename, cgst)

        set_current_profile_id(KID_A)
        yield tmp_path


def _conn(base, pid):
    path = base / _ARSHIA_USER_ID / "profiles" / pid / "profile.sqlite"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


_fid = [9000]


def _insert_reel(base, pid, filename, cgst, *, game_ids=None, clip_count=1):
    """A published single-clip reel keyed by filename, game_ids NULL by default."""
    _fid[0] += 1
    c = _conn(base, pid)
    c.execute(
        """
        INSERT INTO final_videos
          (id, project_id, filename, version, duration, source_type, game_id,
           name, published_at, aspect_ratio, game_ids, clip_count,
           clip_start_time, clip_game_start_time)
        VALUES (?, NULL, ?, 1, 5.0, 'brilliant_clip', NULL, 'Reel',
                '2026-01-01 00:00:00', '9:16', ?, ?, 0, ?)
        """,
        (
            _fid[0], filename,
            encode_data(game_ids) if game_ids is not None else None,
            clip_count, cgst,
        ),
    )
    c.commit()
    c.close()
    return _fid[0]


def _tuple_conn(base, pid):
    """A migration-runner-style connection: TUPLE row factory (no sqlite3.Row)."""
    path = base / _ARSHIA_USER_ID / "profiles" / pid / "profile.sqlite"
    c = sqlite3.connect(str(path))
    c.execute("PRAGMA busy_timeout=30000")
    return c


def _run_up(base, pid):
    """Run the migration against one profile exactly as the runner would."""
    conn = _tuple_conn(base, pid)
    try:
        V033HealMovedReelAttribution().up(conn)
        conn.commit()
    finally:
        conn.close()


def _refs(base, pid):
    c = _conn(base, pid)
    rows = c.execute(
        "SELECT id, source_profile_id, source_game_id, name, opponent_name, "
        "game_date, video_filename FROM games WHERE source_profile_id IS NOT NULL "
        "ORDER BY id"
    ).fetchall()
    c.close()
    return rows


def _reel_game_ids(base, pid, filename):
    c = _conn(base, pid)
    row = c.execute(
        "SELECT game_ids, game_id FROM final_videos WHERE filename = ?", (filename,)
    ).fetchone()
    c.close()
    return row


# --------------------------------------------------------------------------- #


def test_heals_all_reels_and_dedups_to_six_references(env):
    with patch("app.database.USER_DATA_BASE", env), \
         patch("app.services.materialization.USER_DATA_BASE", env), \
         patch("app.services.user_db.USER_DATA_BASE", env), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _run_up(env, KID_A)
        _run_up(env, KID_B)

    # Every mapped reel now points at a reference in its own profile.
    for target_profile, filename, _cgst, source_game_id in MAPPING:
        row = _reel_game_ids(env, target_profile, filename)
        ids = decode_data(row["game_ids"])
        assert isinstance(ids, list) and len(ids) == 1, filename
        assert row["game_id"] is None, filename  # game_id stays NULL (T5810 shape)
        # The referenced game is a REFERENCE row for the right source game.
        c = _conn(env, target_profile)
        ref = c.execute(
            "SELECT source_profile_id, source_game_id FROM games WHERE id = ?", (ids[0],)
        ).fetchone()
        c.close()
        assert ref["source_profile_id"] == DEFAULT, filename
        assert ref["source_game_id"] == source_game_id, filename

    # 14 reels -> 6 distinct (profile, source_game) pairs -> EXACTLY 6 references.
    assert len(_refs(env, KID_A)) == 3   # games 1, 7, 8
    assert len(_refs(env, KID_B)) == 3   # games 1, 5, 6
    total = len(_refs(env, KID_A)) + len(_refs(env, KID_B))
    assert total == 6


def test_reference_carries_frozen_metadata_and_null_filename(env):
    with patch("app.database.USER_DATA_BASE", env), \
         patch("app.services.materialization.USER_DATA_BASE", env), \
         patch("app.services.user_db.USER_DATA_BASE", env), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _run_up(env, KID_A)

    # The game-1 reference in KID_A copies the default game's frozen snapshot.
    c = _conn(env, KID_A)
    ref = c.execute(
        "SELECT * FROM games WHERE source_profile_id = ? AND source_game_id = 1",
        (DEFAULT,),
    ).fetchone()
    c.close()
    assert ref is not None
    assert ref["name"] == "Game 1"
    assert ref["opponent_name"] == "Rival 1"
    assert ref["game_date"] == "2026-05-01"
    assert ref["video_filename"] is None       # a reference owns no media
    assert ref["blake3_hash"] == "hashG1"


def test_idempotent_second_run(env):
    with patch("app.database.USER_DATA_BASE", env), \
         patch("app.services.materialization.USER_DATA_BASE", env), \
         patch("app.services.user_db.USER_DATA_BASE", env), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _run_up(env, KID_A)
        _run_up(env, KID_B)
        first = {
            (p, f): decode_data(_reel_game_ids(env, p, f)["game_ids"])[0]
            for p, f, _c, _g in MAPPING
        }
        # Second pass must be a no-op (healed reels no longer have empty game_ids).
        _run_up(env, KID_A)
        _run_up(env, KID_B)

    assert len(_refs(env, KID_A)) == 3   # still 3, not 6
    assert len(_refs(env, KID_B)) == 3
    for target_profile, filename, _cgst, _sgid in MAPPING:
        again = decode_data(_reel_game_ids(env, target_profile, filename)["game_ids"])[0]
        assert again == first[(target_profile, filename)]


def test_unmatched_reels_left_null(env):
    # An extra reel NOT in the mapping (analogue of the 7 unmatched prod reels):
    # a distinct filename + a NULL clip_game_start_time. Must stay unattributed.
    _insert_reel(env, KID_A, "final_500_unmapped.mp4", None)
    # And a filename that IS mapped but with a NON-matching start_time (must not match).
    _insert_reel(env, KID_A, "final_4_707d183a.mp4", 999.999)  # 2nd row, wrong time

    with patch("app.database.USER_DATA_BASE", env), \
         patch("app.services.materialization.USER_DATA_BASE", env), \
         patch("app.services.user_db.USER_DATA_BASE", env), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _run_up(env, KID_A)

    unmapped = _reel_game_ids(env, KID_A, "final_500_unmapped.mp4")
    assert unmapped["game_ids"] is None

    # The wrong-time duplicate stayed NULL; the correctly-timed original healed.
    c = _conn(env, KID_A)
    rows = c.execute(
        "SELECT clip_game_start_time, game_ids FROM final_videos "
        "WHERE filename = 'final_4_707d183a.mp4' ORDER BY clip_game_start_time"
    ).fetchall()
    c.close()
    by_time = {round(r["clip_game_start_time"], 3): r["game_ids"] for r in rows}
    assert by_time[999.999] is None                      # wrong time -> untouched
    assert by_time[round(405.96058099211723, 3)] is not None  # right time -> healed


def test_game_storage_and_refcounts_untouched(env):
    def _storage_count(pid):
        c = _conn(env, pid)
        try:
            has = c.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_storage'"
            ).fetchone()
            if not has:
                return 0
            return c.execute("SELECT COUNT(*) FROM game_storage").fetchone()[0]
        finally:
            c.close()

    before = {pid: _storage_count(pid) for pid in (KID_A, KID_B)}
    with patch("app.database.USER_DATA_BASE", env), \
         patch("app.services.materialization.USER_DATA_BASE", env), \
         patch("app.services.user_db.USER_DATA_BASE", env), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        _run_up(env, KID_A)
        _run_up(env, KID_B)
    after = {pid: _storage_count(pid) for pid in (KID_A, KID_B)}
    assert before == after
    # References DO exist -- proving the heal ran but never created storage rows.
    assert len(_refs(env, KID_A)) + len(_refs(env, KID_B)) == 6


def test_noop_on_unrelated_user_byte_identical(tmp_path):
    """A different user with unrelated reels: profile.sqlite is byte-identical."""
    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod
    from app.user_context import set_current_req_id, set_current_user_id

    other_user = "other-user-t5830-0000-000000000000"
    other_profile = "aaaa0001"

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database

        set_current_user_id(other_user)
        set_current_req_id("req-other")
        user_db_mod.create_profile(other_user, other_profile, "Someone", "#0f0", is_default=True)
        set_current_profile_id(other_profile)
        ensure_database()

        # Unrelated reels: different filenames, different start_times, game_ids NULL.
        path = tmp_path / other_user / "profiles" / other_profile / "profile.sqlite"
        c = sqlite3.connect(str(path))
        c.execute(
            "INSERT INTO final_videos (filename, version, source_type, game_ids, "
            "clip_count, clip_game_start_time, published_at) "
            "VALUES ('final_99_deadbeef.mp4', 1, 'brilliant_clip', NULL, 1, 123.456, "
            "'2026-01-01 00:00:00')"
        )
        c.commit()
        c.close()
        # Checkpoint so all committed data lives in the main file, not the -wal.
        c = sqlite3.connect(str(path))
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        c.close()

        before = hashlib.sha256(path.read_bytes()).hexdigest()

        conn = sqlite3.connect(str(path))  # tuple row factory (runner-style)
        try:
            V033HealMovedReelAttribution().up(conn)
            conn.commit()
        finally:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()

        after = hashlib.sha256(path.read_bytes()).hexdigest()

    assert before == after  # nothing inserted, nothing updated
