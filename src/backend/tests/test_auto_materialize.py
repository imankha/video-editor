"""
Tests for T3230: Auto-materialize pending shares on login.

Verifies that user_session_init() resolves pending teammate shares
for single-profile users, and skips materialization for multi-profile users.
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

from app.utils.encoding import encode_data
from app.session_init import user_session_init, invalidate_user_cache, _init_cache
from app.services.user_db import _USER_DB_SCHEMA
from app.user_context import set_current_user_id


SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
SHARER_PROFILE = "sharer-prof"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"


def _create_profile_db(path: Path) -> sqlite3.Connection:
    """Create a profile SQLite with tables needed for materialization."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            interesting_count INTEGER DEFAULT 0,
            mistake_count INTEGER DEFAULT 0,
            blunder_count INTEGER DEFAULT 0,
            aggregate_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            video_duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            opponent_name TEXT,
            game_date TEXT,
            game_type TEXT,
            tournament_name TEXT,
            viewed_duration REAL DEFAULT 0,
            video_fps REAL,
            status TEXT DEFAULT 'ready',
            auto_export_status TEXT,
            recap_video_url TEXT,
            shared_by TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            fps REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER,
            auto_project_id INTEGER,
            default_highlight_regions BLOB,
            video_sequence INTEGER,
            boundaries_version INTEGER DEFAULT 1,
            boundaries_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            tagged_teammates BLOB DEFAULT NULL,
            my_athlete INTEGER DEFAULT 1,
            shared_by TEXT DEFAULT NULL,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS clip_teammates (
            clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
            tag_name TEXT NOT NULL,
            UNIQUE(clip_id, tag_name)
        );
        CREATE INDEX IF NOT EXISTS idx_clip_teammates_tag ON clip_teammates(tag_name);
    """)
    conn.commit()
    return conn


def _create_user_db(tmp_path, user_id, profile_ids):
    """Create user.sqlite with the real schema and insert profile rows."""
    db_path = tmp_path / user_id / "user.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_USER_DB_SCHEMA)

    from app.migrations.user_db import RUNNER as USER_DB_RUNNER
    conn.execute(f"PRAGMA user_version = {USER_DB_RUNNER.latest_version}")

    for i, pid in enumerate(profile_ids):
        conn.execute(
            "INSERT INTO profiles (id, name, color, is_default) VALUES (?, '', '#6366f1', ?)",
            (pid, 1 if i == 0 else 0),
        )
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('selected_profile', ?)",
        (profile_ids[0],),
    )
    conn.execute(
        "INSERT OR IGNORE INTO credits (user_id, balance) VALUES (?, 0)",
        (user_id,),
    )
    conn.commit()
    conn.close()
    return profile_ids[0]


def _insert_game(conn, name="Test Game", blake3_hash="abc123"):
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO games (name, blake3_hash, video_duration, video_width,
           video_height, video_size, opponent_name, game_date, game_type, video_fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, blake3_hash, 90.0, 1920, 1080, 100000, "Opponent",
         "2026-05-01", "league", 30.0),
    )
    conn.commit()
    return cur.lastrowid


def _insert_clip(conn, game_id, start_time, end_time, name="Test Clip",
                 rating=3, tagged_teammates=None):
    tt_encoded = encode_data(tagged_teammates) if tagged_teammates else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips (filename, rating, name, start_time,
           end_time, game_id, tagged_teammates, my_athlete)
           VALUES ('', ?, ?, ?, ?, ?, ?, 1)""",
        (rating, name, start_time, end_time, game_id, tt_encoded),
    )
    clip_id = cur.lastrowid
    if tagged_teammates:
        for tag in tagged_teammates:
            cur.execute(
                "INSERT OR IGNORE INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)",
                (clip_id, tag),
            )
    conn.commit()
    return clip_id


def _seed_postgres_share(pg_conn_str, game_id, tag_name, clip_data_list):
    """Create share + share_games + pending_teammate_share in Postgres."""
    conn = psycopg2.connect(pg_conn_str)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute(
        """INSERT INTO shares (share_token, share_type, sharer_user_id,
           sharer_profile_id, recipient_email)
           VALUES (%s, %s, %s, %s, %s) RETURNING id""",
        ("test-token-auto", "game", SHARER_ID, SHARER_PROFILE, RECIPIENT_EMAIL),
    )
    share_id = cur.fetchone()["id"]

    cur.execute(
        """INSERT INTO share_games (share_id, game_id, tag_name)
           VALUES (%s, %s, %s)""",
        (share_id, game_id, tag_name),
    )

    clip_data_bytes = encode_data(clip_data_list)
    cur.execute(
        """INSERT INTO pending_teammate_shares
           (share_id, sharer_user_id, sharer_profile_id, recipient_email,
            game_id, tag_name, clip_data)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (share_id, SHARER_ID, SHARER_PROFILE, RECIPIENT_EMAIL,
         game_id, tag_name, psycopg2.Binary(clip_data_bytes)),
    )
    pending_id = cur.fetchone()["id"]

    conn.close()
    return share_id, pending_id


def _common_patches(tmp_path):
    """Return a stack of patches common to all tests."""
    from contextlib import ExitStack
    stack = ExitStack()
    stack.enter_context(patch("app.services.user_db.USER_DATA_BASE", tmp_path))
    stack.enter_context(patch("app.services.user_db._initialized_user_dbs", set()))
    stack.enter_context(patch("app.services.materialization.USER_DATA_BASE", tmp_path))
    stack.enter_context(patch("app.database.USER_DATA_BASE", tmp_path))
    stack.enter_context(patch("app.storage.R2_ENABLED", False))
    stack.enter_context(patch("app.services.materialization.insert_game_storage_ref"))
    stack.enter_context(patch("app.services.materialization.get_game_storage_ref", return_value=None))
    stack.enter_context(patch("app.services.project_archive.archive_completed_projects", return_value=0))
    stack.enter_context(patch("app.services.project_archive.cleanup_database_bloat"))
    stack.enter_context(patch("app.session_init._schedule_startup_recovery"))
    return stack


class TestAutoMaterialize:
    """Test T3230: auto-materialization of pending shares in user_session_init."""

    def test_auto_materializes_single_profile_user(self, pg_conn, tmp_path):
        """Single-profile user with pending shares gets them auto-materialized."""
        from app.services.auth_db import create_user

        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)

        # Set up sharer's profile DB with a game + clip
        sharer_db_path = tmp_path / SHARER_ID / "profiles" / SHARER_PROFILE / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db_path)
        game_id = _insert_game(s_conn, name="Vs LA Breakers")
        _insert_clip(s_conn, game_id, 10.0, 15.0, name="Great Goal",
                     tagged_teammates=["Nico"])
        s_conn.close()

        clip_data = [
            {"name": "Great Goal", "start_time": 10.0, "end_time": 15.0,
             "rating": 3, "video_sequence": None, "tagged_teammates": ["Nico"]},
        ]
        share_id, pending_id = _seed_postgres_share(pg_conn, game_id, "Nico", clip_data)

        # Set up recipient: 1 profile in user.sqlite + empty profile DB
        recipient_profile_id = "recip-prof"
        _create_user_db(tmp_path, RECIPIENT_ID, [recipient_profile_id])
        recipient_db_path = tmp_path / RECIPIENT_ID / "profiles" / recipient_profile_id / "profile.sqlite"
        _create_profile_db(recipient_db_path)

        invalidate_user_cache(RECIPIENT_ID)
        set_current_user_id(RECIPIENT_ID)

        with _common_patches(tmp_path):
            result = user_session_init(RECIPIENT_ID)

        assert result["profile_id"] == recipient_profile_id

        # Verify pending share was resolved
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT resolved_at, resolved_profile_id FROM pending_teammate_shares WHERE id = %s",
                (pending_id,),
            )
            row = cur.fetchone()
            assert row["resolved_at"] is not None
            assert row["resolved_profile_id"] == recipient_profile_id

            cur.execute(
                "SELECT materialized_at, recipient_profile_id FROM share_games WHERE share_id = %s",
                (share_id,),
            )
            sg = cur.fetchone()
            assert sg["materialized_at"] is not None
            assert sg["recipient_profile_id"] == recipient_profile_id

        # Verify game exists in recipient's profile SQLite
        r_conn = sqlite3.connect(str(recipient_db_path))
        r_conn.row_factory = sqlite3.Row
        games = r_conn.execute("SELECT * FROM games").fetchall()
        assert len(games) >= 1
        assert games[0]["name"] == "Vs LA Breakers"
        r_conn.close()

    def test_multi_profile_user_skips_auto_materialize(self, pg_conn, tmp_path):
        """Multi-profile user does NOT get auto-materialization."""
        from app.services.auth_db import create_user

        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)

        sharer_db_path = tmp_path / SHARER_ID / "profiles" / SHARER_PROFILE / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db_path)
        game_id = _insert_game(s_conn, name="Vs LA Breakers")
        s_conn.close()

        clip_data = [
            {"name": "Clip", "start_time": 0.0, "end_time": 5.0,
             "rating": 3, "video_sequence": None, "tagged_teammates": ["Nico"]},
        ]
        share_id, pending_id = _seed_postgres_share(pg_conn, game_id, "Nico", clip_data)

        # Set up recipient: 2 profiles in user.sqlite
        recipient_profile_id = "recip-prof"
        _create_user_db(tmp_path, RECIPIENT_ID, [recipient_profile_id, "second-prof"])
        for pid in [recipient_profile_id, "second-prof"]:
            db_path = tmp_path / RECIPIENT_ID / "profiles" / pid / "profile.sqlite"
            _create_profile_db(db_path)

        invalidate_user_cache(RECIPIENT_ID)
        set_current_user_id(RECIPIENT_ID)

        with _common_patches(tmp_path):
            user_session_init(RECIPIENT_ID)

        # Verify pending share was NOT resolved
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT resolved_at FROM pending_teammate_shares WHERE id = %s",
                (pending_id,),
            )
            row = cur.fetchone()
            assert row["resolved_at"] is None


def _quest1_steps(db_path):
    """Compute quest-step booleans against a recipient's materialized profile DB."""
    from app.routers.quests import _check_all_steps
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        return _check_all_steps("recipient-user", conn)
    finally:
        conn.close()


class TestShareIsNufBlind:
    """T5330: content shared into a profile must be invisible to NUF quest progress.

    A recipient's quest_1 steps derive from THEIR OWN content only — a materialized
    share (game + clips + the 5-star auto-draft-reel) must not pre-complete any step.
    """

    def test_share_recipient_still_sees_quest1(self, pg_conn, tmp_path):
        """A never-started recipient lands on quest_1 with all DB-derived steps
        incomplete, even though a shared game (with a 5-star clip → auto-reel) was
        just materialized into their fresh profile."""
        from app.services.auth_db import create_user

        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)

        # Sharer has a game with a 5-star clip (→ auto-draft-reel on materialize).
        sharer_db_path = tmp_path / SHARER_ID / "profiles" / SHARER_PROFILE / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db_path)
        game_id = _insert_game(s_conn, name="Vs LA Breakers")
        _insert_clip(s_conn, game_id, 10.0, 15.0, name="Golazo", rating=5,
                     tagged_teammates=["Nico"])
        s_conn.close()

        clip_data = [
            {"name": "Golazo", "start_time": 10.0, "end_time": 15.0,
             "rating": 5, "video_sequence": None, "tagged_teammates": ["Nico"]},
        ]
        _seed_postgres_share(pg_conn, game_id, "Nico", clip_data)

        # Recipient: single profile in user.sqlite, NO pre-created profile DB —
        # session_init's ensure_database creates it fresh (with games.shared_by).
        recipient_profile_id = "recip-prof"
        _create_user_db(tmp_path, RECIPIENT_ID, [recipient_profile_id])
        recipient_db_path = (
            tmp_path / RECIPIENT_ID / "profiles" / recipient_profile_id / "profile.sqlite"
        )

        invalidate_user_cache(RECIPIENT_ID)
        set_current_user_id(RECIPIENT_ID)
        with _common_patches(tmp_path):
            user_session_init(RECIPIENT_ID)

        # Data is present + usable (T3230 unchanged) and carries provenance.
        r_conn = sqlite3.connect(str(recipient_db_path))
        r_conn.row_factory = sqlite3.Row
        g = r_conn.execute("SELECT id, shared_by FROM games").fetchall()
        assert len(g) == 1
        assert g[0]["shared_by"] == SHARER_EMAIL   # never NULL for a share
        c = r_conn.execute("SELECT shared_by, auto_project_id FROM raw_clips").fetchall()
        assert len(c) == 1
        assert c[0]["shared_by"] == SHARER_EMAIL
        assert c[0]["auto_project_id"] is not None  # 5-star auto-reel was created
        r_conn.close()

        # ...but NONE of quest_1's DB-derived steps are pre-completed.
        steps = _quest1_steps(recipient_db_path)
        assert steps["upload_game"] is False
        assert steps["add_clip"] is False
        assert steps["rate_clip"] is False
        assert steps["annotate_brilliant"] is False

    def test_mid_nuf_recipient_keeps_own_progress(self, pg_conn, tmp_path):
        """A recipient who earned upload_game via their OWN game keeps exactly that —
        a materialized share neither rolls it back nor advances the clip/reel steps."""
        from app.services.auth_db import create_user

        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)

        # Sharer game with a 5-star clip.
        sharer_db_path = tmp_path / SHARER_ID / "profiles" / SHARER_PROFILE / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db_path)
        game_id = _insert_game(s_conn, name="Vs LA Breakers", blake3_hash="sharerhash")
        _insert_clip(s_conn, game_id, 10.0, 15.0, name="Golazo", rating=5,
                     tagged_teammates=["Nico"])
        s_conn.close()

        clip_data = [
            {"name": "Golazo", "start_time": 10.0, "end_time": 15.0,
             "rating": 5, "video_sequence": None, "tagged_teammates": ["Nico"]},
        ]
        _seed_postgres_share(pg_conn, game_id, "Nico", clip_data)

        # Recipient: single profile, NO pre-created profile DB — session_init's
        # ensure_database() creates the real (full) schema fresh, same as the
        # first test. The recipient's OWN game is inserted afterward, directly
        # against that real schema, to simulate earned pre-share progress.
        recipient_profile_id = "recip-prof"
        _create_user_db(tmp_path, RECIPIENT_ID, [recipient_profile_id])
        recipient_db_path = (
            tmp_path / RECIPIENT_ID / "profiles" / recipient_profile_id / "profile.sqlite"
        )

        invalidate_user_cache(RECIPIENT_ID)
        set_current_user_id(RECIPIENT_ID)
        with _common_patches(tmp_path):
            user_session_init(RECIPIENT_ID)

        r_conn = sqlite3.connect(str(recipient_db_path))
        r_conn.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("My Own Game", "ownhash"),  # shared_by NULL (default) — own content
        )
        r_conn.commit()
        r_conn.close()

        steps = _quest1_steps(recipient_db_path)
        # Own game still counts (earned progress preserved, not rolled back).
        assert steps["upload_game"] is True
        # Shared game/clip/auto-reel do NOT advance the remaining steps.
        assert steps["add_clip"] is False
        assert steps["rate_clip"] is False
        assert steps["annotate_brilliant"] is False
