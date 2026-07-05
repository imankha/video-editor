"""
T3605: Freeze game_ids (msgpack BLOB of sorted distinct game ids) on
final_videos at export, and backfill via the v008 migration.

Covers:
- the game_ids helpers (encode_game_ids, compute_project_game_ids,
  compute_archive_game_ids)
- stamping on the overlay + brilliant_clip insert paths
- the v008 migration: column add, backfill from game_id-direct / live working
  data / R2 archive recovery, idempotency, NULL-resilience.
"""

import sqlite3
import pytest
from unittest.mock import patch, MagicMock

from app.utils.encoding import encode_data, decode_data

USER_ID = "test-user-t3605"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures + seed helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def full_schema_db(tmp_path):
    """Profile DB from the real ensure_database() (canonical schema incl.
    final_videos.game_ids)."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield {"db_path": get_database_path(), "tmp_path": tmp_path}


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_game(cur, name="G"):
    cur.execute("INSERT INTO games (name) VALUES (?)", (name,))
    return cur.lastrowid


def _seed_custom_project_with_games(db_path, game_ids, aspect="9:16",
                                    duration=42.5):
    """project + working_video + one working_clip -> raw_clip per game_id."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('My Reel', ?)",
                (aspect,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'wv.mp4', 1, ?)", (project_id, duration))
    for i, gid in enumerate(game_ids):
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, tags, start_time, end_time, "
            "game_id) VALUES ('c.mp4', 4, ?, ?, ?, ?)",
            (encode_data(["Goal"]), i * 10.0, i * 10.0 + 5.0, gid))
        rc_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
            "VALUES (?, ?, 1, ?)", (project_id, rc_id, i))
    conn.commit()
    conn.close()
    return project_id


def _get_final_video(db_path, fv_id=None):
    conn = _connect(db_path)
    if fv_id is None:
        row = conn.execute(
            "SELECT * FROM final_videos ORDER BY id DESC LIMIT 1").fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Helpers: compute_project_game_ids / compute_archive_game_ids
# ---------------------------------------------------------------------------

class TestGameIdHelpers:
    def test_single_game(self, full_schema_db):
        from app.services.collection_metadata import compute_project_game_ids
        db = full_schema_db["db_path"]
        conn = _connect(db)
        gid = _seed_game(conn.cursor()); conn.commit(); conn.close()
        project_id = _seed_custom_project_with_games(db, [gid])

        conn = _connect(db)
        blob = compute_project_game_ids(conn.cursor(), project_id)
        conn.close()
        assert decode_data(blob) == [gid]

    def test_multi_game_sorted_distinct(self, full_schema_db):
        from app.services.collection_metadata import compute_project_game_ids
        db = full_schema_db["db_path"]
        conn = _connect(db); cur = conn.cursor()
        g1 = _seed_game(cur, "A"); g2 = _seed_game(cur, "B")
        conn.commit(); conn.close()
        # clips reference g2 then g1 then g2 again -> distinct sorted [g1, g2]
        project_id = _seed_custom_project_with_games(db, [g2, g1, g2])

        conn = _connect(db)
        blob = compute_project_game_ids(conn.cursor(), project_id)
        conn.close()
        assert decode_data(blob) == sorted([g1, g2])

    def test_no_game_yields_none(self, full_schema_db):
        from app.services.collection_metadata import compute_project_game_ids
        db = full_schema_db["db_path"]
        # project whose clips have NULL game_id
        project_id = _seed_custom_project_with_games(db, [None])
        conn = _connect(db)
        blob = compute_project_game_ids(conn.cursor(), project_id)
        conn.close()
        assert blob is None

    def test_archive_game_ids_from_raw_clips(self, full_schema_db):
        from app.services.collection_metadata import compute_archive_game_ids
        db = full_schema_db["db_path"]
        conn = _connect(db); cur = conn.cursor()
        g1 = _seed_game(cur, "A"); g2 = _seed_game(cur, "B")
        # raw_clips survive archival
        cur.execute("INSERT INTO raw_clips (id, filename, rating, game_id) "
                    "VALUES (101, 'c.mp4', 4, ?)", (g1,))
        cur.execute("INSERT INTO raw_clips (id, filename, rating, game_id) "
                    "VALUES (102, 'c.mp4', 4, ?)", (g2,))
        conn.commit()
        archive = {"working_clips": [
            {"raw_clip_id": 101}, {"raw_clip_id": 102}, {"raw_clip_id": 101}]}
        blob = compute_archive_game_ids(cur, archive)
        conn.close()
        assert decode_data(blob) == sorted([g1, g2])


# ---------------------------------------------------------------------------
# Stamping
# ---------------------------------------------------------------------------

class TestStamping:
    def test_overlay_finalize_stamps_game_ids(self, full_schema_db):
        from app.routers.export.overlay import _finalize_overlay_export
        db = full_schema_db["db_path"]
        conn = _connect(db); cur = conn.cursor()
        g1 = _seed_game(cur, "A"); g2 = _seed_game(cur, "B")
        conn.commit(); conn.close()
        project_id = _seed_custom_project_with_games(db, [g1, g2])

        conn = _connect(db)
        conn.execute(
            "INSERT INTO export_jobs (id, project_id, type, input_data) "
            "VALUES ('exp1', ?, 'overlay', x'00')", (project_id,))
        conn.commit(); conn.close()

        with patch("app.analytics.record_milestone"):
            fv_id = _finalize_overlay_export(project_id, "out.mp4", "exp1", USER_ID)

        fv = _get_final_video(db, fv_id)
        assert decode_data(fv["game_ids"]) == sorted([g1, g2])

    def test_overlay_finalize_brilliant_clip_resolves_single_game(
            self, full_schema_db):
        """Overlay export of an auto-project (is_auto_project=True) is a
        brilliant_clip whose game resolves via the auto_project_id link, not
        working_clips. Must stamp [game_id], not NULL (P7)."""
        from app.routers.export.overlay import _finalize_overlay_export
        db = full_schema_db["db_path"]
        conn = _connect(db); cur = conn.cursor()
        game_id = _seed_game(cur, "G1")
        cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) "
                    "VALUES ('Auto', '16:9', 1)")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time, "
            "game_id, auto_project_id) VALUES ('c.mp4', 5, 10, 15, ?, ?)",
            (game_id, project_id))
        conn.execute(
            "INSERT INTO export_jobs (id, project_id, type, input_data) "
            "VALUES ('expA', ?, 'overlay', x'00')", (project_id,))
        conn.commit(); conn.close()

        with patch("app.analytics.record_milestone"):
            fv_id = _finalize_overlay_export(project_id, "out.mp4", "expA", USER_ID)

        fv = _get_final_video(db, fv_id)
        assert fv["source_type"] == "brilliant_clip"
        assert decode_data(fv["game_ids"]) == [game_id]

    # T4175: test_brilliant_clip_stamps_single_game removed — the sweep no longer
    # publishes a final_videos row, so game_ids is frozen only at the user's
    # frame+publish (test_overlay_finalize_brilliant_clip_resolves_single_game
    # above still covers brilliant-clip game_ids freezing on the publish path).


# ---------------------------------------------------------------------------
# v008 migration
# ---------------------------------------------------------------------------

PRE_V008_SCHEMA = """
    CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT
    );
    CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        aspect_ratio TEXT, archived_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE raw_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL,
        rating INTEGER NOT NULL, tags BLOB, start_time REAL, end_time REAL,
        game_id INTEGER, auto_project_id INTEGER
    );
    CREATE TABLE working_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
        raw_clip_id INTEGER, uploaded_filename TEXT,
        version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE working_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
        filename TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, duration REAL
    );
    CREATE TABLE final_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER,
        filename TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        duration REAL, source_type TEXT, game_id INTEGER, name TEXT,
        rating_counts TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        watched_at TIMESTAMP, published_at TIMESTAMP, aspect_ratio TEXT, tags BLOB
    );
"""


@pytest.fixture()
def pre_v008_conn(tmp_path):
    db_path = tmp_path / "pre_v008.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(PRE_V008_SCHEMA)
    conn.commit()
    yield conn
    conn.close()


def _run_v008(conn):
    from app.migrations.profile_db.v008_freeze_game_ids import V008FreezeGameIds
    V008FreezeGameIds().up(conn)
    conn.commit()


class TestV008Migration:
    def test_adds_column_idempotently(self, pre_v008_conn):
        _run_v008(pre_v008_conn)
        _run_v008(pre_v008_conn)  # second run must not raise
        cols = {r["name"] for r in
                pre_v008_conn.execute("PRAGMA table_info(final_videos)")}
        assert "game_ids" in cols

    def test_game_id_direct(self, pre_v008_conn):
        conn = pre_v008_conn
        conn.execute("INSERT INTO games (id, name) VALUES (7, 'G')")
        conn.execute("INSERT INTO final_videos (id, game_id, filename, source_type) "
                     "VALUES (50, 7, 'f.mp4', 'brilliant_clip')")
        conn.commit()
        with patch("app.services.project_archive.load_archive") as mock_load:
            _run_v008(conn)
            mock_load.assert_not_called()  # game_id direct, no archive/work read
        row = conn.execute("SELECT game_ids FROM final_videos WHERE id=50").fetchone()
        assert decode_data(row["game_ids"]) == [7]

    def test_backfill_from_live_working_data(self, pre_v008_conn):
        conn = pre_v008_conn
        conn.execute("INSERT INTO games (id, name) VALUES (3, 'G')")
        conn.execute("INSERT INTO projects (id, name, aspect_ratio) "
                     "VALUES (1, 'P', '9:16')")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, game_id) "
                     "VALUES (10, 'c.mp4', 4, 3)")
        conn.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) "
                     "VALUES (1, 10, 1)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, source_type) "
                     "VALUES (51, 1, 'f.mp4', 'custom_project')")
        conn.commit()
        with patch("app.services.project_archive.load_archive") as mock_load:
            _run_v008(conn)
            mock_load.assert_not_called()  # live data resolves, no archive read
        row = conn.execute("SELECT game_ids FROM final_videos WHERE id=51").fetchone()
        assert decode_data(row["game_ids"]) == [3]

    def test_backfill_from_archive_recovery(self, pre_v008_conn):
        """Load-bearing case: published custom reel, working_clips deleted,
        recovered via the R2 archive's raw_clip_id -> live raw_clips.game_id."""
        conn = pre_v008_conn
        conn.execute("INSERT INTO games (id, name) VALUES (4, 'G'), (5, 'H')")
        conn.execute("INSERT INTO projects (id, name, aspect_ratio, archived_at) "
                     "VALUES (2, 'P', '9:16', CURRENT_TIMESTAMP)")
        # raw_clips survive archival; working_clips are gone
        conn.execute("INSERT INTO raw_clips (id, filename, rating, game_id) "
                     "VALUES (20, 'c.mp4', 4, 4), (21, 'c.mp4', 4, 5)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "source_type, published_at) "
                     "VALUES (60, 2, 'f.mp4', 'custom_project', CURRENT_TIMESTAMP)")
        conn.commit()
        archive = {"project": {"id": 2}, "working_clips": [
            {"raw_clip_id": 20}, {"raw_clip_id": 21}]}
        with patch("app.services.project_archive.load_archive",
                   return_value=archive) as mock_load:
            _run_v008(conn)
            mock_load.assert_called_once()
        row = conn.execute("SELECT game_ids FROM final_videos WHERE id=60").fetchone()
        assert decode_data(row["game_ids"]) == [4, 5]

    def test_unresolvable_stays_null_and_logs(self, pre_v008_conn, caplog):
        conn = pre_v008_conn
        conn.execute("INSERT INTO final_videos (id, project_id, filename) "
                     "VALUES (70, 999, 'gone.mp4')")
        conn.commit()
        with patch("app.services.project_archive.load_archive", return_value=None):
            with caplog.at_level("WARNING"):
                _run_v008(conn)
        row = conn.execute("SELECT game_ids FROM final_videos WHERE id=70").fetchone()
        assert row["game_ids"] is None
        assert "[T3605] final_video 70 has no resolvable game" in caplog.text

    def test_idempotent_skips_already_set(self, pre_v008_conn):
        conn = pre_v008_conn
        conn.execute("INSERT INTO games (id, name) VALUES (8, 'G')")
        conn.execute("INSERT INTO final_videos (id, game_id, filename, source_type) "
                     "VALUES (80, 8, 'f.mp4', 'brilliant_clip')")
        conn.commit()
        _run_v008(conn)
        first = conn.execute(
            "SELECT game_ids FROM final_videos WHERE id=80").fetchone()["game_ids"]
        # Second run only scans game_ids IS NULL -> row 80 untouched
        _run_v008(conn)
        second = conn.execute(
            "SELECT game_ids FROM final_videos WHERE id=80").fetchone()["game_ids"]
        assert decode_data(first) == decode_data(second) == [8]
