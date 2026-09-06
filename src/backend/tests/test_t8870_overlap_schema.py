"""
T8870 — Overlap schema: game_videos.recorded_at + offset_seconds.

Covers:
  1. compute_video_offsets (games.py) — the insert-time placement helper:
     full timestamps (DJI fixture), none, mixed, garbage-clock >12h fallback,
     later-batch-earlier-than-zero -> negative offset, existing-anchor no-renumber.
  2. v051 migration — adds both columns, backfills offset_seconds by prefix-sum,
     idempotent, no-op on missing table, registered, fresh DDL has the columns,
     migration head is derived from the registry (not a literal).
  3. compute_unified_clip_start equivalence — a backfilled game's new offset
     branch produces BYTE-IDENTICAL results to the old prefix-sum math.

Written test-first (Stage 3).
"""

import shutil
import sqlite3
import uuid

import pytest

from app.migrations.profile_db import MIGRATIONS
from app.migrations.profile_db.v051_game_video_placement import V051GameVideoPlacement
from app.profile_context import set_current_profile_id
from app.routers.games import PLACEMENT_WINDOW_H, compute_video_offsets
from app.user_context import set_current_user_id

# DJI fixture: the four ECNL / DJI Action 6 segments (EPIC evidence base).
# Times 17:55:44 / 18:19:15 / 18:44:59 / 19:08:32 -> offsets 0 / 1411 / 2955 / 4368
# relative to the earliest (17:55:44). Durations 1410/1013/1411/273.
DJI = [
    {"sequence": 1, "duration": 1410, "recorded_at": "2026-07-18T17:55:44Z"},
    {"sequence": 2, "duration": 1013, "recorded_at": "2026-07-18T18:19:15Z"},
    {"sequence": 3, "duration": 1411, "recorded_at": "2026-07-18T18:44:59Z"},
    {"sequence": 4, "duration": 273, "recorded_at": "2026-07-18T19:08:32Z"},
]


# ---------------------------------------------------------------------------
# compute_video_offsets
# ---------------------------------------------------------------------------

class TestComputeVideoOffsets:
    def test_dji_fixture_offsets(self):
        offsets = compute_video_offsets(DJI)
        assert offsets == pytest.approx([0.0, 1411.0, 2955.0, 4368.0])

    def test_all_missing_recorded_at_prefix_sum(self):
        """No timestamps -> prefix-sum of durations by sequence."""
        videos = [
            {"sequence": 1, "duration": 100, "recorded_at": None},
            {"sequence": 2, "duration": 200, "recorded_at": None},
            {"sequence": 3, "duration": 50, "recorded_at": None},
        ]
        assert compute_video_offsets(videos) == pytest.approx([0.0, 100.0, 300.0])

    def test_mixed_recorded_at(self):
        """A video without recorded_at falls back to prefix-sum; timestamped
        siblings use the recorded-time axis."""
        videos = [
            {"sequence": 1, "duration": 100, "recorded_at": "2026-07-18T10:00:00Z"},
            {"sequence": 2, "duration": 200, "recorded_at": None},
            {"sequence": 3, "duration": 50, "recorded_at": "2026-07-18T10:10:00Z"},
        ]
        offsets = compute_video_offsets(videos)
        # seq1 recorded -> zero -> 0; seq2 missing -> prefix-sum (100); seq3 -> +600s.
        assert offsets == pytest.approx([0.0, 100.0, 600.0])

    def test_garbage_clock_beyond_window_falls_back(self, caplog):
        """recorded_at > PLACEMENT_WINDOW_H from zero -> prefix-sum + warning."""
        far = "2026-07-20T10:00:00Z"  # ~2 days after zero
        videos = [
            {"sequence": 1, "duration": 100, "recorded_at": "2026-07-18T10:00:00Z"},
            {"sequence": 2, "duration": 200, "recorded_at": far},
        ]
        with caplog.at_level("WARNING"):
            offsets = compute_video_offsets(videos)
        # seq2 is garbage -> prefix-sum (100), NOT the ~172800s recorded delta.
        assert offsets[0] == pytest.approx(0.0)
        assert offsets[1] == pytest.approx(100.0)
        assert any("prefix-sum" in r.message for r in caplog.records)

    def test_window_boundary_just_inside_is_kept(self):
        """Exactly under 12h is a real placement, not garbage."""
        just_under = "2026-07-18T21:59:00Z"  # 11h59m after zero
        videos = [
            {"sequence": 1, "duration": 100, "recorded_at": "2026-07-18T10:00:00Z"},
            {"sequence": 2, "duration": 200, "recorded_at": just_under},
        ]
        offsets = compute_video_offsets(videos)
        assert offsets[1] == pytest.approx(11 * 3600 + 59 * 60)
        assert PLACEMENT_WINDOW_H == 12

    def test_existing_anchor_not_renumbered_and_positive_offset(self):
        """A batch recorded AFTER the existing zero: existing row keeps offset 0,
        new row gets a positive offset relative to that same zero."""
        existing = [
            {"sequence": 1, "duration": 100, "recorded_at": "2026-07-18T10:00:00Z",
             "offset_seconds": 0.0},
        ]
        new = [{"sequence": 2, "duration": 200, "recorded_at": "2026-07-18T10:05:00Z"}]
        assert compute_video_offsets(new, existing_videos=existing) == pytest.approx([300.0])

    def test_batch_earlier_than_existing_zero_is_negative(self):
        """A new video recorded BEFORE the existing zero gets a legal negative
        offset; the existing zero is not moved."""
        existing = [
            {"sequence": 1, "duration": 100, "recorded_at": "2026-07-18T10:00:00Z",
             "offset_seconds": 0.0},
        ]
        new = [{"sequence": 2, "duration": 200, "recorded_at": "2026-07-18T09:50:00Z"}]
        assert compute_video_offsets(new, existing_videos=existing) == pytest.approx([-600.0])

    def test_existing_anchor_with_nonzero_offset(self):
        """Anchor derives zero from recorded_at - offset_seconds, so a non-zero
        existing offset still anchors the axis correctly."""
        existing = [
            {"sequence": 1, "duration": 60, "recorded_at": "2026-07-18T10:00:00Z",
             "offset_seconds": 60.0},  # zero = 09:59:00
        ]
        new = [{"sequence": 2, "duration": 30, "recorded_at": "2026-07-18T10:01:00Z"}]
        # zero = 09:59:00 -> new offset = 120s
        assert compute_video_offsets(new, existing_videos=existing) == pytest.approx([120.0])

    def test_no_recorded_at_anywhere_returns_prefix_sum_with_existing(self):
        """Attaching an untimed video to an untimed game -> prefix-sum over the
        combined sequence set (existing durations count)."""
        existing = [
            {"sequence": 1, "duration": 100, "recorded_at": None, "offset_seconds": 0.0},
            {"sequence": 2, "duration": 200, "recorded_at": None, "offset_seconds": 100.0},
        ]
        new = [{"sequence": 3, "duration": 50, "recorded_at": None}]
        assert compute_video_offsets(new, existing_videos=existing) == pytest.approx([300.0])


# ---------------------------------------------------------------------------
# v051 migration
# ---------------------------------------------------------------------------

def _make_pre_v051_db(tmp_path):
    """game_videos + games WITHOUT the new columns, tuple row factory (mirrors
    the migration runner)."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)
    """)
    conn.execute("""
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL
        )
    """)
    conn.commit()
    return conn


class TestV051Migration:
    def test_adds_both_columns_when_missing(self, tmp_path):
        conn = _make_pre_v051_db(tmp_path)
        cols_before = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        assert "recorded_at" not in cols_before
        assert "offset_seconds" not in cols_before

        V051GameVideoPlacement().up(conn)

        cols_after = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        assert "recorded_at" in cols_after
        assert "offset_seconds" in cols_after

    def test_backfill_offsets_are_prefix_sums(self, tmp_path):
        """A pre-existing 2-video game -> offsets 0 / duration1 (exact prefix sum)."""
        conn = _make_pre_v051_db(tmp_path)
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'G')")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h1', 1, 2715.0)")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h2', 2, 2700.0)")
        conn.commit()

        V051GameVideoPlacement().up(conn)

        rows = conn.execute(
            "SELECT sequence, offset_seconds, recorded_at FROM game_videos WHERE game_id = 1 ORDER BY sequence"
        ).fetchall()
        assert rows[0][1] == pytest.approx(0.0)      # seq 1 -> 0
        assert rows[1][1] == pytest.approx(2715.0)   # seq 2 -> first-half duration
        # recorded_at is NOT backfilled (no historical source).
        assert rows[0][2] is None and rows[1][2] is None

    def test_backfill_null_duration_coalesces_to_zero(self, tmp_path):
        conn = _make_pre_v051_db(tmp_path)
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'G')")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h1', 1, NULL)")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h2', 2, 100.0)")
        conn.commit()

        V051GameVideoPlacement().up(conn)

        rows = conn.execute(
            "SELECT sequence, offset_seconds FROM game_videos WHERE game_id = 1 ORDER BY sequence"
        ).fetchall()
        assert rows[0][1] == pytest.approx(0.0)
        assert rows[1][1] == pytest.approx(0.0)  # NULL first-half duration -> 0

    def test_idempotent_rerun(self, tmp_path):
        conn = _make_pre_v051_db(tmp_path)
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'G')")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h1', 1, 100.0)")
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h2', 2, 50.0)")
        conn.commit()

        V051GameVideoPlacement().up(conn)
        V051GameVideoPlacement().up(conn)  # must not raise / not duplicate

        cols = [row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()]
        assert cols.count("recorded_at") == 1
        assert cols.count("offset_seconds") == 1
        rows = conn.execute(
            "SELECT offset_seconds FROM game_videos WHERE game_id = 1 ORDER BY sequence"
        ).fetchall()
        assert [r[0] for r in rows] == pytest.approx([0.0, 100.0])

    def test_rerun_does_not_clobber_existing_offset(self, tmp_path):
        """A row whose offset_seconds is already set (insert-time computed) is not
        re-derived by a re-run (backfill only touches NULL rows)."""
        conn = _make_pre_v051_db(tmp_path)
        V051GameVideoPlacement().up(conn)  # add columns
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'G')")
        # Simulate an insert-time negative offset (recorded earlier than zero).
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, offset_seconds) "
            "VALUES (1, 'h1', 1, 100.0, -600.0)"
        )
        conn.commit()

        V051GameVideoPlacement().up(conn)

        val = conn.execute("SELECT offset_seconds FROM game_videos WHERE game_id = 1").fetchone()[0]
        assert val == pytest.approx(-600.0)  # untouched, not re-derived to 0

    def test_noop_on_missing_game_videos_table(self, tmp_path):
        db = tmp_path / "profile.sqlite"
        conn = sqlite3.connect(str(db))  # no tables at all
        V051GameVideoPlacement().up(conn)  # must not raise

    def test_registered_in_profile_db_migrations(self):
        versions = [m.version for m in MIGRATIONS]
        assert 51 in versions, "v051 must be registered in profile_db MIGRATIONS"

    def test_migration_head_is_derived_not_literal(self):
        """Guard against a hardcoded head: the latest registered version must be
        v051 after this task (fragility rule from the task file's step 6)."""
        head = max(m.version for m in MIGRATIONS)
        assert head == 51

    def test_fresh_ensure_database_has_the_columns(self, tmp_path):
        """A fresh deploy's DDL must include both columns directly (fresh DBs
        don't run migrations)."""
        from app.database import USER_DATA_BASE, ensure_database, get_database_path

        user_id = f"test_v051_fresh_{uuid.uuid4().hex[:8]}"
        try:
            set_current_user_id(user_id)
            set_current_profile_id("testdefault")
            ensure_database()

            conn = sqlite3.connect(str(get_database_path()))
            cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
            conn.close()
            assert "recorded_at" in cols
            assert "offset_seconds" in cols
        finally:
            path = USER_DATA_BASE / user_id
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------------------
# compute_unified_clip_start — backfilled offsets == old prefix-sum math
# ---------------------------------------------------------------------------

class TestUnifiedStartEquivalence:
    def _fresh_db(self, tmp_path):
        from app.database import USER_DATA_BASE, ensure_database, get_database_path

        user_id = f"test_v051_unified_{uuid.uuid4().hex[:8]}"
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()
        return user_id, get_database_path(), USER_DATA_BASE / user_id

    def test_backfilled_offset_equals_prefix_sum_result(self, tmp_path):
        """Seed a two-half game, backfill offset_seconds via the migration rule,
        and assert compute_unified_clip_start's offset branch returns the SAME
        value the prefix-sum branch would (byte-identical for migrated data)."""
        from app.services.collection_metadata import compute_unified_clip_start

        _user_id, db_path, user_dir = self._fresh_db(tmp_path)
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("INSERT INTO games (name) VALUES ('TwoHalf')")
            game_id = cur.lastrowid
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
                "VALUES (?, 'h1', 1, 2715.0)", (game_id,))
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
                "VALUES (?, 'h2', 2, 2700.0)", (game_id,))
            # 2nd-half clip, 5 min in.
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
                "VALUES ('c.mp4', 5, 300.0, 305.0, ?, 2)", (game_id,))
            rc_id = cur.lastrowid
            conn.commit()

            # Old math (offset_seconds still NULL) -> prefix-sum branch.
            old = compute_unified_clip_start(conn.cursor(), rc_id, 300.0)
            assert old == pytest.approx(3015.0)

            # Backfill offset_seconds exactly as v051 does.
            conn.execute(
                "UPDATE game_videos SET offset_seconds = ("
                "  SELECT COALESCE(SUM(g2.duration), 0) FROM game_videos g2 "
                "  WHERE g2.game_id = game_videos.game_id AND g2.sequence < game_videos.sequence) "
                "WHERE offset_seconds IS NULL"
            )
            conn.commit()

            # New math (offset branch) -> identical.
            new = compute_unified_clip_start(conn.cursor(), rc_id, 300.0)
            assert new == pytest.approx(old)
            conn.close()
        finally:
            if user_dir.exists():
                shutil.rmtree(user_dir, ignore_errors=True)

    def test_recorded_at_offset_overrides_sequence_order(self, tmp_path):
        """When offset_seconds is set from recorded_at, the unified start uses it
        directly (offset + clip.start_time) rather than sequence prefix-sum."""
        from app.services.collection_metadata import compute_unified_clip_start

        _user_id, db_path, user_dir = self._fresh_db(tmp_path)
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("INSERT INTO games (name) VALUES ('Overlap')")
            game_id = cur.lastrowid
            # sequence-2 video placed at offset 1000 by recorded_at (not the
            # prefix-sum of 2715 it would otherwise get).
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, offset_seconds) "
                "VALUES (?, 'h1', 1, 2715.0, 0.0)", (game_id,))
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, offset_seconds) "
                "VALUES (?, 'h2', 2, 2700.0, 1000.0)", (game_id,))
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
                "VALUES ('c.mp4', 5, 30.0, 35.0, ?, 2)", (game_id,))
            rc_id = cur.lastrowid
            conn.commit()

            result = compute_unified_clip_start(conn.cursor(), rc_id, 30.0)
            assert result == pytest.approx(1030.0)  # 1000 offset + 30 clip start
            conn.close()
        finally:
            if user_dir.exists():
                shutil.rmtree(user_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# End-to-end: the real create_game endpoint round-trips recorded_at +
# offset_seconds through the DB and the response (API-level live-drive, since a
# browser multi-video upload isn't practical in-container -- kickoff QA phase).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_game_endpoint_persists_and_returns_placement(tmp_path, monkeypatch):
    import app.routers.games as games_mod
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection
    from app.routers.games import CreateGameRequest, VideoReference, create_game

    user_id = f"test_v051_e2e_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()

    # Stub the R2 / analytics boundaries; we are exercising placement + persistence.
    monkeypatch.setattr(games_mod, "_validate_video_in_r2", lambda h: None)
    monkeypatch.setattr(games_mod, "_probe_video_metadata", lambda h: None)
    monkeypatch.setattr(games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4")
    monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

    try:
        h1, h2 = "a" * 64, "b" * 64
        req = CreateGameRequest(
            opponent_name="DJI",
            videos=[
                VideoReference(blake3_hash=h1, sequence=1, duration=1410, file_size=10,
                               recorded_at="2026-07-18T17:55:44Z"),
                VideoReference(blake3_hash=h2, sequence=2, duration=1013, file_size=10,
                               recorded_at="2026-07-18T18:19:15Z"),
            ],
        )
        resp = await create_game(req)

        # Response carries placement per video (normalized recorded_at + offset).
        vids = {v["sequence"]: v for v in resp["videos"]}
        assert vids[1]["recorded_at"] == "2026-07-18T17:55:44Z"
        assert vids[1]["offset_seconds"] == pytest.approx(0.0)
        assert vids[2]["recorded_at"] == "2026-07-18T18:19:15Z"
        assert vids[2]["offset_seconds"] == pytest.approx(1411.0)

        # And the DB rows persisted them.
        with get_db_connection() as conn:
            rows = conn.execute(
                "SELECT sequence, recorded_at, offset_seconds FROM game_videos "
                "WHERE game_id = ? ORDER BY sequence", (resp["game_id"],)
            ).fetchall()
        assert rows[0]["recorded_at"] == "2026-07-18T17:55:44Z"
        assert rows[0]["offset_seconds"] == pytest.approx(0.0)
        assert rows[1]["offset_seconds"] == pytest.approx(1411.0)
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)


@pytest.mark.asyncio
async def test_create_game_rejects_unparseable_recorded_at():
    """The VideoReference validator rejects a non-ISO recorded_at with a
    ValidationError (surfaces as HTTP 422 at the API boundary)."""
    from pydantic import ValidationError

    from app.routers.games import VideoReference

    with pytest.raises(ValidationError):
        VideoReference(blake3_hash="a" * 64, sequence=1, recorded_at="not-a-timestamp")
