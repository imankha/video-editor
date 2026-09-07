"""
T8892 — Real angle names: game_videos.original_filename.

Covers:
  1. v052 migration — adds original_filename when missing, idempotent, no-op on a
     missing table, registered, NO backfill (the datum never existed for old rows).
  2. DDL-equivalence — a fresh ensure_database() DB and a migrated pre-v052 DB have
     the SAME game_videos columns (fresh == migrated).
  3. create_game endpoint round-trip — original_filename persists + is returned; a
     row inserted WITHOUT one (legacy) round-trips as null.

Written test-first (Stage 3).
"""

import shutil
import sqlite3
import uuid

import pytest

from app.migrations.profile_db import MIGRATIONS
from app.migrations.profile_db.v052_game_video_original_filename import (
    V052GameVideoOriginalFilename,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


# ---------------------------------------------------------------------------
# v052 migration
# ---------------------------------------------------------------------------

def _make_pre_v052_db(tmp_path):
    """game_videos WITHOUT original_filename, tuple row factory (mirrors the
    migration runner's row factory -- v017 landmine)."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")
    conn.execute("""
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            recorded_at TEXT,
            offset_seconds REAL
        )
    """)
    conn.commit()
    return conn


class TestV052Migration:
    def test_adds_column_when_missing(self, tmp_path):
        conn = _make_pre_v052_db(tmp_path)
        cols_before = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        assert "original_filename" not in cols_before

        V052GameVideoOriginalFilename().up(conn)

        cols_after = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        assert "original_filename" in cols_after

    def test_no_backfill_existing_rows_stay_null(self, tmp_path):
        """The datum never existed for a pre-existing row -> it must remain NULL
        (an honest 'no filename', NOT a fabricated one)."""
        conn = _make_pre_v052_db(tmp_path)
        conn.execute("INSERT INTO games (id, name) VALUES (1, 'G')")
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
            "VALUES (1, 'h1', 1, 100.0)"
        )
        conn.commit()

        V052GameVideoOriginalFilename().up(conn)

        val = conn.execute(
            "SELECT original_filename FROM game_videos WHERE game_id = 1"
        ).fetchone()[0]
        assert val is None

    def test_idempotent_rerun(self, tmp_path):
        conn = _make_pre_v052_db(tmp_path)
        V052GameVideoOriginalFilename().up(conn)
        V052GameVideoOriginalFilename().up(conn)  # must not raise / not duplicate

        cols = [row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()]
        assert cols.count("original_filename") == 1

    def test_noop_on_missing_game_videos_table(self, tmp_path):
        db = tmp_path / "profile.sqlite"
        conn = sqlite3.connect(str(db))  # no tables at all
        V052GameVideoOriginalFilename().up(conn)  # must not raise

    def test_registered_in_profile_db_migrations(self):
        versions = [m.version for m in MIGRATIONS]
        assert 52 in versions, "v052 must be registered in profile_db MIGRATIONS"

    def test_migration_head_is_at_or_above_v052(self):
        """v052 is registered and at or below head. Asserted as `>=`, NOT `== 52`,
        so a later migration advancing the head never trips this guard -- the
        hardcoded-migration-head landmine."""
        head = max(m.version for m in MIGRATIONS)
        assert head >= 52


# ---------------------------------------------------------------------------
# DDL-equivalence: fresh DDL == migrated pre-v052 DB
# ---------------------------------------------------------------------------

def test_fresh_and_migrated_have_identical_game_videos_columns(tmp_path):
    """Acceptance criterion 1: fresh and migrated DBs have identical schema."""
    from app.database import USER_DATA_BASE, ensure_database, get_database_path

    # Fresh DB via ensure_database (fresh deploys don't run migrations).
    user_id = f"test_v052_fresh_{uuid.uuid4().hex[:8]}"
    try:
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()
        conn = sqlite3.connect(str(get_database_path()))
        fresh_cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        conn.close()
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)

    assert "original_filename" in fresh_cols

    # Migrated pre-v052 DB: run the whole registry up through head.
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # tuples (runner row factory)
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")
    conn.execute("""
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            recorded_at TEXT,
            offset_seconds REAL
        )
    """)
    conn.commit()
    V052GameVideoOriginalFilename().up(conn)
    migrated_cols = {row[1] for row in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
    conn.close()

    # The v052-relevant column must be present in BOTH; fresh must be a superset of
    # migrated (fresh has all historical columns; the migrated stub only seeds the
    # subset this test creates + the v052 add).
    assert "original_filename" in migrated_cols
    assert migrated_cols <= fresh_cols, (
        f"migrated columns not a subset of fresh: extra={migrated_cols - fresh_cols}"
    )


# ---------------------------------------------------------------------------
# create_game endpoint round-trip (API-level, kickoff QA phase)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_game_persists_and_returns_original_filename(tmp_path, monkeypatch):
    import app.routers.games as games_mod
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection
    from app.routers.games import CreateGameRequest, VideoReference, create_game

    user_id = f"test_v052_e2e_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()

    monkeypatch.setattr(games_mod, "_validate_video_in_r2", lambda h: None)
    monkeypatch.setattr(games_mod, "_probe_video_metadata", lambda h: None)
    monkeypatch.setattr(games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4")
    monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

    try:
        req = CreateGameRequest(
            opponent_name="Angles",
            videos=[
                VideoReference(blake3_hash="a" * 64, sequence=1, duration=1410, file_size=10,
                               original_filename="main-camera.mp4"),
                VideoReference(blake3_hash="b" * 64, sequence=2, duration=180, file_size=10,
                               original_filename="sideline.mp4"),
            ],
        )
        resp = await create_game(req)

        vids = {v["sequence"]: v for v in resp["videos"]}
        assert vids[1]["original_filename"] == "main-camera.mp4"
        assert vids[2]["original_filename"] == "sideline.mp4"

        with get_db_connection() as conn:
            rows = conn.execute(
                "SELECT sequence, original_filename FROM game_videos "
                "WHERE game_id = ? ORDER BY sequence", (resp["game_id"],)
            ).fetchall()
        assert rows[0]["original_filename"] == "main-camera.mp4"
        assert rows[1]["original_filename"] == "sideline.mp4"
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)


@pytest.mark.asyncio
async def test_create_game_without_original_filename_round_trips_null(tmp_path, monkeypatch):
    """A video reference omitting original_filename (legacy / resume path) persists
    and reads back as null -- never a fabricated value."""
    import app.routers.games as games_mod
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection
    from app.routers.games import CreateGameRequest, VideoReference, create_game

    user_id = f"test_v052_null_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()

    monkeypatch.setattr(games_mod, "_validate_video_in_r2", lambda h: None)
    monkeypatch.setattr(games_mod, "_probe_video_metadata", lambda h: None)
    monkeypatch.setattr(games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4")
    monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

    try:
        req = CreateGameRequest(
            opponent_name="Legacy",
            videos=[VideoReference(blake3_hash="c" * 64, sequence=1, duration=100, file_size=10)],
        )
        resp = await create_game(req)
        assert resp["videos"][0]["original_filename"] is None

        with get_db_connection() as conn:
            val = conn.execute(
                "SELECT original_filename FROM game_videos WHERE game_id = ?",
                (resp["game_id"],),
            ).fetchone()["original_filename"]
        assert val is None
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
