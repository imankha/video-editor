"""
Production database migration — full schema convergence.

Brings ALL SQLite databases (auth, sharing, user, profile) to the canonical
current-master schema, regardless of how old they are. Every table, column,
and index is ensured to exist. Safe to run multiple times (fully idempotent).

Databases handled:
  - auth.sqlite   — {env}/auth/auth.sqlite (one per environment)
  - sharing.sqlite — {env}/sharing/sharing.sqlite (one per environment)
  - user.sqlite   — {env}/users/{uid}/user.sqlite (one per user)
  - profile.sqlite — {env}/users/{uid}/profiles/{pid}/profile.sqlite (one per user+profile)

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_production.py --env staging --dry-run
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_production.py --env production

NOTE: DDL only — no data migrations. If data transformations are needed,
list them as manual steps in the summary.
"""

import argparse
import logging
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate")


# ---------------------------------------------------------------------------
# Environment / R2
# ---------------------------------------------------------------------------

def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    env_file = PROJECT_ROOT / f".env{suffix}"
    if not env_file.exists():
        log.error(f"{env_file} not found")
        sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    for k in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        if k not in config:
            log.error(f"{k} missing from {env_file}")
            sys.exit(1)
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config: dict):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=60,
        ),
        region_name="auto",
    )


# ---------------------------------------------------------------------------
# R2 helpers
# ---------------------------------------------------------------------------

def download_db(r2, bucket: str, key: str, local_path: Path) -> bool:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        r2.download_file(bucket, key, str(local_path))
        log.info(f"  Downloaded {key} ({local_path.stat().st_size} bytes)")
        return True
    except r2.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            log.info(f"  {key} not found in R2 (new database)")
            return False
        raise


def backup_db(r2, bucket: str, key: str, dry_run: bool) -> None:
    backup_key = f"{key}.pre-migration"
    if dry_run:
        log.info(f"  [DRY RUN] Would backup {key} -> {backup_key}")
        return
    r2.copy_object(
        Bucket=bucket,
        Key=backup_key,
        CopySource={"Bucket": bucket, "Key": key},
    )
    log.info(f"  Backed up {key} -> {backup_key}")


def upload_db(r2, bucket: str, key: str, local_path: Path, dry_run: bool) -> None:
    conn = sqlite3.connect(str(local_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    if dry_run:
        log.info(f"  [DRY RUN] Would upload {local_path} -> {key}")
        return
    r2.upload_file(str(local_path), bucket, key)
    log.info(f"  Uploaded {key} ({local_path.stat().st_size} bytes)")


def list_r2_objects(r2, bucket: str, prefix: str, suffix: str = "") -> list[str]:
    keys = []
    paginator = r2.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not suffix or key.endswith(suffix):
                keys.append(key)
    return keys


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def _get_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {c[1] for c in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(conn: sqlite3.Connection, table: str, column: str, col_type: str) -> bool:
    """Add a column if it doesn't exist. Returns True if added."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        conn.commit()
        log.info(f"    + {table}.{column}")
        return True
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            return False
        raise


def _ensure_index(conn: sqlite3.Connection, ddl: str) -> None:
    """Run a CREATE INDEX IF NOT EXISTS statement."""
    conn.execute(ddl)
    conn.commit()


# ===================================================================
# AUTH.SQLITE — canonical schema from auth_db.py
# ===================================================================

def migrate_auth_db(db_path: Path) -> int:
    changes = 0
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")

    # --- Core tables (idempotent) ---
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            google_id TEXT UNIQUE,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            last_seen_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id),
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS otp_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            attempts INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
    """)
    conn.commit()

    # --- Additive columns on existing tables ---
    for table, col, col_type in [
        ("users", "credit_summary", "INTEGER DEFAULT 0"),
        ("users", "picture_url", "TEXT"),
        ("users", "last_seen_at", "TEXT"),
        ("sessions", "impersonator_user_id", "TEXT"),
        ("sessions", "impersonation_expires_at", "TEXT"),
    ]:
        if _add_column(conn, table, col, col_type):
            changes += 1

    # --- T550: admin_users ---
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS admin_users (email TEXT PRIMARY KEY);
    """)
    conn.execute(
        "INSERT OR IGNORE INTO admin_users (email) VALUES (?)",
        ("imankh@gmail.com",),
    )
    conn.commit()

    # --- T1510: impersonation_audit ---
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS impersonation_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id TEXT NOT NULL,
            target_user_id TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'expire')),
            ip TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_impersonation_audit_admin ON impersonation_audit(admin_user_id);
        CREATE INDEX IF NOT EXISTS idx_impersonation_audit_target ON impersonation_audit(target_user_id);
    """)
    conn.commit()

    # --- T1580: game_storage_refs ---
    if not _has_table(conn, "game_storage_refs"):
        changes += 1
        log.info("    + TABLE game_storage_refs")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS game_storage_refs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            blake3_hash TEXT NOT NULL,
            game_size_bytes INTEGER NOT NULL,
            storage_expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, profile_id, blake3_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_game_refs_hash ON game_storage_refs(blake3_hash);
        CREATE INDEX IF NOT EXISTS idx_game_refs_user ON game_storage_refs(user_id);
    """)
    conn.commit()

    # --- T2400: r2_grace_deletions ---
    if not _has_table(conn, "r2_grace_deletions"):
        changes += 1
        log.info("    + TABLE r2_grace_deletions")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS r2_grace_deletions (
            blake3_hash TEXT PRIMARY KEY,
            grace_expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()

    conn.close()
    return changes


_AUTH_EXPECTED_TABLES = {
    "users": ["user_id", "email", "google_id", "verified_at", "created_at",
              "last_seen_at", "credit_summary", "picture_url"],
    "sessions": ["session_id", "user_id", "expires_at", "created_at",
                 "impersonator_user_id", "impersonation_expires_at"],
    "otp_codes": ["id", "email", "code", "expires_at", "used_at", "attempts", "created_at"],
    "admin_users": ["email"],
    "impersonation_audit": ["id", "admin_user_id", "target_user_id", "action",
                            "ip", "user_agent", "created_at"],
    "game_storage_refs": ["id", "user_id", "profile_id", "blake3_hash",
                          "game_size_bytes", "storage_expires_at", "created_at"],
    "r2_grace_deletions": ["blake3_hash", "grace_expires_at", "created_at"],
}


def verify_auth_schema(db_path: Path) -> list[str]:
    issues = []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    for table, expected_cols in _AUTH_EXPECTED_TABLES.items():
        if not _has_table(conn, table):
            issues.append(f"MISSING TABLE: {table}")
            continue
        cols = _get_columns(conn, table)
        for col in expected_cols:
            if col not in cols:
                issues.append(f"MISSING COLUMN: {table}.{col}")
    conn.close()
    return issues


# ===================================================================
# SHARING.SQLITE — canonical schema from sharing_db.py
# ===================================================================

def migrate_sharing_db(db_path: Path) -> int:
    changes = 0
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")

    if not _has_table(conn, "shared_videos"):
        changes += 1
        log.info("    + TABLE shared_videos")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS shared_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            share_token TEXT UNIQUE NOT NULL,
            video_id INTEGER NOT NULL,
            sharer_user_id TEXT NOT NULL,
            sharer_profile_id TEXT NOT NULL,
            video_filename TEXT NOT NULL,
            video_name TEXT,
            video_duration REAL,
            recipient_email TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            shared_at TEXT NOT NULL,
            revoked_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_shared_videos_token
            ON shared_videos(share_token);
        CREATE INDEX IF NOT EXISTS idx_shared_videos_video
            ON shared_videos(video_id, sharer_user_id);
        CREATE INDEX IF NOT EXISTS idx_shared_videos_sharer
            ON shared_videos(sharer_user_id);
        CREATE INDEX IF NOT EXISTS idx_shared_videos_recipient
            ON shared_videos(recipient_email);
    """)
    conn.commit()
    conn.close()
    return changes


_SHARING_EXPECTED = {
    "shared_videos": ["id", "share_token", "video_id", "sharer_user_id",
                      "sharer_profile_id", "video_filename", "video_name",
                      "video_duration", "recipient_email", "is_public",
                      "shared_at", "revoked_at"],
}


def verify_sharing_schema(db_path: Path) -> list[str]:
    issues = []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    for table, expected_cols in _SHARING_EXPECTED.items():
        if not _has_table(conn, table):
            issues.append(f"MISSING TABLE: {table}")
            continue
        cols = _get_columns(conn, table)
        for col in expected_cols:
            if col not in cols:
                issues.append(f"MISSING COLUMN: {table}.{col}")
    conn.close()
    return issues


# ===================================================================
# USER.SQLITE — canonical schema from user_db.py
# ===================================================================

def migrate_user_db(db_path: Path) -> int:
    changes = 0
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")

    # Full schema — all tables are CREATE IF NOT EXISTS (idempotent)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS credits (
            user_id TEXT PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS credit_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            source TEXT NOT NULL,
            reference_id TEXT,
            video_seconds REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idempotent
            ON credit_transactions(user_id, source, reference_id)
            WHERE reference_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_credit_tx_user
            ON credit_transactions(user_id);

        CREATE TABLE IF NOT EXISTS credit_reservations (
            job_id TEXT PRIMARY KEY,
            amount INTEGER NOT NULL,
            video_seconds REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS stripe_customers (
            user_id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS completed_quests (
            quest_id TEXT PRIMARY KEY,
            completed_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()
    return changes


_USER_EXPECTED = {
    "credits": ["user_id", "balance"],
    "credit_transactions": ["id", "user_id", "amount", "source",
                            "reference_id", "video_seconds", "created_at"],
    "credit_reservations": ["job_id", "amount", "video_seconds", "created_at"],
    "stripe_customers": ["user_id", "customer_id"],
    "completed_quests": ["quest_id", "completed_at"],
    "profiles": ["id", "name", "color", "is_default", "created_at"],
    "user_settings": ["key", "value"],
}


def verify_user_schema(db_path: Path) -> list[str]:
    issues = []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    for table, expected_cols in _USER_EXPECTED.items():
        if not _has_table(conn, table):
            issues.append(f"MISSING TABLE: {table}")
            continue
        cols = _get_columns(conn, table)
        for col in expected_cols:
            if col not in cols:
                issues.append(f"MISSING COLUMN: {table}.{col}")
    conn.close()
    return issues


# ===================================================================
# PROFILE.SQLITE — canonical schema from database.py ensure_database()
# ===================================================================

def migrate_profile_db(db_path: Path) -> int:
    changes = 0
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")

    # --- Ensure all tables exist (idempotent) ---
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags TEXT,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER,
            auto_project_id INTEGER,
            default_highlight_regions TEXT,
            video_sequence INTEGER,
            boundaries_version INTEGER DEFAULT 1,
            boundaries_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (auto_project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL,
            working_video_id INTEGER,
            final_video_id INTEGER,
            is_auto_created INTEGER DEFAULT 0,
            last_opened_at TIMESTAMP,
            current_mode TEXT DEFAULT 'framing',
            archived_at TIMESTAMP DEFAULT NULL,
            restored_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (working_video_id) REFERENCES working_videos(id) ON DELETE SET NULL,
            FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            uploaded_filename TEXT,
            exported_at TEXT DEFAULT NULL,
            sort_order INTEGER DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            crop_data BLOB,
            timing_data BLOB,
            segments_data BLOB,
            raw_clip_version INTEGER,
            width INTEGER,
            height INTEGER,
            fps REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS working_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            highlights_data BLOB,
            text_overlays TEXT,
            duration REAL,
            effect_type TEXT DEFAULT 'original',
            overlay_version INTEGER DEFAULT 0,
            highlight_color TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            duration REAL,
            source_type TEXT,
            game_id INTEGER,
            name TEXT,
            rating_counts TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            watched_at TIMESTAMP,
            published_at TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

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
            recap_video_url TEXT
        );

        CREATE TABLE IF NOT EXISTS export_jobs (
            id TEXT PRIMARY KEY,
            project_id INTEGER,
            type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            input_data BLOB NOT NULL,
            output_video_id INTEGER,
            output_filename TEXT,
            modal_call_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            game_id INTEGER,
            game_name TEXT,
            acknowledged_at TIMESTAMP,
            gpu_seconds REAL,
            modal_function TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS before_after_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            final_video_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            source_path TEXT NOT NULL,
            start_frame INTEGER NOT NULL,
            end_frame INTEGER NOT NULL,
            clip_index INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS achievements (
            key TEXT PRIMARY KEY,
            achieved_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS modal_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            params TEXT NOT NULL,
            result TEXT,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            raw_clip_id INTEGER,
            project_id INTEGER,
            game_id INTEGER,
            retry_count INTEGER DEFAULT 0,
            FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

        CREATE TABLE IF NOT EXISTS pending_uploads (
            id TEXT PRIMARY KEY,
            blake3_hash TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            r2_upload_id TEXT NOT NULL,
            parts_json TEXT,
            label TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS auth_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            email TEXT,
            google_id TEXT,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS db_version (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()

    # Initialize settings row
    conn.execute("INSERT OR IGNORE INTO user_settings (id, settings_json) VALUES (1, '{}')")
    conn.commit()

    # --- Additive columns on existing tables ---
    # These cover columns that were added to CREATE TABLE after the table
    # was first created, or that may have been dropped by a table rebuild
    # (e.g. T900 FK migration) that predated the column addition.
    additive_columns = [
        # games — columns added over time
        ("games", "auto_export_status", "TEXT"),
        ("games", "recap_video_url", "TEXT"),
        ("games", "video_fps", "REAL"),
        ("games", "status", "TEXT DEFAULT 'ready'"),
        ("games", "viewed_duration", "REAL DEFAULT 0"),
        ("games", "opponent_name", "TEXT"),
        ("games", "game_date", "TEXT"),
        ("games", "game_type", "TEXT"),
        ("games", "tournament_name", "TEXT"),
        ("games", "video_size", "INTEGER"),
        # working_clips — dimensions added for moov-box probe skip
        ("working_clips", "width", "INTEGER"),
        ("working_clips", "height", "INTEGER"),
        ("working_clips", "fps", "REAL"),
        # raw_clips — multi-video + boundary tracking
        ("raw_clips", "video_sequence", "INTEGER"),
        ("raw_clips", "boundaries_version", "INTEGER DEFAULT 1"),
        ("raw_clips", "boundaries_updated_at", "TIMESTAMP"),
        ("raw_clips", "default_highlight_regions", "TEXT"),
        ("raw_clips", "auto_project_id", "INTEGER"),
        # export_jobs — game-scoped exports + GPU tracking
        ("export_jobs", "game_id", "INTEGER"),
        ("export_jobs", "game_name", "TEXT"),
        ("export_jobs", "acknowledged_at", "TIMESTAMP"),
        ("export_jobs", "gpu_seconds", "REAL"),
        ("export_jobs", "modal_function", "TEXT"),
        # working_videos — highlight color
        ("working_videos", "highlight_color", "TEXT DEFAULT NULL"),
        # projects — archive/restore
        ("projects", "archived_at", "TIMESTAMP DEFAULT NULL"),
        ("projects", "restored_at", "TIMESTAMP DEFAULT NULL"),
        # final_videos — gallery publish tracking
        ("final_videos", "published_at", "TIMESTAMP"),
        ("final_videos", "source_type", "TEXT"),
        ("final_videos", "game_id", "INTEGER"),
        ("final_videos", "name", "TEXT"),
        ("final_videos", "rating_counts", "TEXT"),
        ("final_videos", "watched_at", "TIMESTAMP"),
    ]

    for table, col, col_type in additive_columns:
        if not _has_table(conn, table):
            continue
        if _add_column(conn, table, col, col_type):
            changes += 1

    # --- All indexes ---
    for ddl in [
        "CREATE INDEX IF NOT EXISTS idx_working_clips_project_version ON working_clips(project_id, version DESC)",
        "CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version ON working_clips(project_id, raw_clip_id, version DESC)",
        "CREATE INDEX IF NOT EXISTS idx_working_clips_project_upload_version ON working_clips(project_id, uploaded_filename, version DESC)",
        "CREATE INDEX IF NOT EXISTS idx_working_videos_project_version ON working_videos(project_id, version DESC)",
        "CREATE INDEX IF NOT EXISTS idx_final_videos_project_version ON final_videos(project_id, version DESC)",
        "CREATE INDEX IF NOT EXISTS idx_raw_clips_game_id ON raw_clips(game_id)",
        "CREATE INDEX IF NOT EXISTS idx_raw_clips_rating ON raw_clips(rating)",
        "CREATE INDEX IF NOT EXISTS idx_export_jobs_project ON export_jobs(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status)",
        "CREATE INDEX IF NOT EXISTS idx_export_jobs_type_status ON export_jobs(type, status)",
        "CREATE INDEX IF NOT EXISTS idx_before_after_tracks_final_video ON before_after_tracks(final_video_id)",
        "CREATE INDEX IF NOT EXISTS idx_modal_tasks_status ON modal_tasks(status)",
        "CREATE INDEX IF NOT EXISTS idx_modal_tasks_game_id ON modal_tasks(game_id)",
        "CREATE INDEX IF NOT EXISTS idx_game_videos_game ON game_videos(game_id)",
    ]:
        _ensure_index(conn, ddl)

    # Unique index — may fail if duplicate data exists, so wrap in try/except
    try:
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time_seq
            ON raw_clips(game_id, end_time, video_sequence)
        """)
        conn.commit()
    except sqlite3.OperationalError as e:
        log.warning(f"    Could not create idx_raw_clips_game_end_time_seq: {e}")

    conn.close()
    return changes


_PROFILE_EXPECTED = {
    "games": ["id", "name", "video_filename", "blake3_hash", "clip_count",
              "brilliant_count", "good_count", "interesting_count",
              "mistake_count", "blunder_count", "aggregate_score",
              "created_at", "last_accessed_at", "video_duration",
              "video_width", "video_height", "video_size",
              "opponent_name", "game_date", "game_type", "tournament_name",
              "viewed_duration", "video_fps", "status",
              "auto_export_status", "recap_video_url"],
    "raw_clips": ["id", "filename", "rating", "tags", "name", "notes",
                  "start_time", "end_time", "game_id", "auto_project_id",
                  "default_highlight_regions", "video_sequence",
                  "boundaries_version", "boundaries_updated_at", "created_at"],
    "projects": ["id", "name", "aspect_ratio", "working_video_id",
                 "final_video_id", "is_auto_created", "last_opened_at",
                 "current_mode", "archived_at", "restored_at", "created_at"],
    "working_clips": ["id", "project_id", "raw_clip_id", "uploaded_filename",
                      "exported_at", "sort_order", "version", "crop_data",
                      "timing_data", "segments_data", "raw_clip_version",
                      "width", "height", "fps", "created_at"],
    "working_videos": ["id", "project_id", "filename", "version",
                       "highlights_data", "text_overlays", "duration",
                       "effect_type", "overlay_version", "highlight_color",
                       "created_at"],
    "final_videos": ["id", "project_id", "filename", "version", "duration",
                     "source_type", "game_id", "name", "rating_counts",
                     "created_at", "watched_at", "published_at"],
    "export_jobs": ["id", "project_id", "type", "status", "error",
                    "input_data", "output_video_id", "output_filename",
                    "modal_call_id", "created_at", "started_at",
                    "completed_at", "game_id", "game_name",
                    "acknowledged_at", "gpu_seconds", "modal_function"],
    "before_after_tracks": ["id", "final_video_id", "raw_clip_id",
                            "source_path", "start_frame", "end_frame",
                            "clip_index", "created_at"],
    "achievements": ["key", "achieved_at"],
    "modal_tasks": ["id", "task_type", "status", "params", "result", "error",
                    "created_at", "started_at", "completed_at",
                    "raw_clip_id", "project_id", "game_id", "retry_count"],
    "user_settings": ["id", "settings_json", "updated_at"],
    "game_videos": ["id", "game_id", "blake3_hash", "sequence", "duration",
                    "video_width", "video_height", "video_size", "fps",
                    "created_at"],
    "pending_uploads": ["id", "blake3_hash", "file_size", "original_filename",
                        "r2_upload_id", "parts_json", "label", "created_at"],
    "db_version": ["id", "version", "updated_at"],
}


def verify_profile_schema(db_path: Path) -> list[str]:
    issues = []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    for table, expected_cols in _PROFILE_EXPECTED.items():
        if not _has_table(conn, table):
            # auth_profile, sessions, db_version may not exist on fresh DBs
            # that haven't been synced yet — not an error
            if table in ("auth_profile", "sessions", "db_version"):
                continue
            issues.append(f"MISSING TABLE: {table}")
            continue
        cols = _get_columns(conn, table)
        for col in expected_cols:
            if col not in cols:
                issues.append(f"MISSING COLUMN: {table}.{col}")
    conn.close()
    return issues


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Migrate databases to current schema (full convergence)")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "production"],
                        help="Target environment")
    parser.add_argument("--dry-run", action="store_true",
                        help="Download and migrate locally but don't upload changes back to R2")
    args = parser.parse_args()

    env_name = args.env
    dry_run = args.dry_run

    log.info(f"=== Schema Migration: {env_name} {'(DRY RUN)' if dry_run else ''} ===")

    config = load_env(env_name)
    r2 = get_r2_client(config)
    bucket = config["R2_BUCKET"]
    app_env = config["APP_ENV"]

    total_changes = 0
    total_errors = 0
    total_dbs = 0

    with tempfile.TemporaryDirectory(prefix="rb-migration-") as tmpdir:
        tmp = Path(tmpdir)

        # ---------------------------------------------------------------
        # 1. auth.sqlite
        # ---------------------------------------------------------------
        log.info("")
        log.info(f"--- auth.sqlite ({app_env}/auth/auth.sqlite) ---")
        auth_key = f"{app_env}/auth/auth.sqlite"
        auth_local = tmp / "auth.sqlite"
        if download_db(r2, bucket, auth_key, auth_local):
            backup_db(r2, bucket, auth_key, dry_run)
            changes = migrate_auth_db(auth_local)
            total_changes += changes

            issues = verify_auth_schema(auth_local)
            if issues:
                for issue in issues:
                    log.error(f"  VERIFY FAIL: {issue}")
                total_errors += len(issues)
            else:
                log.info("  Verification: PASS")

            if changes > 0:
                upload_db(r2, bucket, auth_key, auth_local, dry_run)
            else:
                log.info("  No changes needed")
            total_dbs += 1
        else:
            log.warning("  auth.sqlite not found — nothing to migrate")

        # ---------------------------------------------------------------
        # 2. sharing.sqlite
        # ---------------------------------------------------------------
        log.info("")
        log.info(f"--- sharing.sqlite ({app_env}/sharing/sharing.sqlite) ---")
        sharing_key = f"{app_env}/sharing/sharing.sqlite"
        sharing_local = tmp / "sharing.sqlite"
        existed = download_db(r2, bucket, sharing_key, sharing_local)

        if existed:
            backup_db(r2, bucket, sharing_key, dry_run)

        changes = migrate_sharing_db(sharing_local)
        total_changes += changes

        issues = verify_sharing_schema(sharing_local)
        if issues:
            for issue in issues:
                log.error(f"  VERIFY FAIL: {issue}")
            total_errors += len(issues)
        else:
            log.info("  Verification: PASS")

        if changes > 0 or not existed:
            upload_db(r2, bucket, sharing_key, sharing_local, dry_run)
        else:
            log.info("  No changes needed")
        total_dbs += 1

        # ---------------------------------------------------------------
        # 3. user.sqlite (per user)
        # ---------------------------------------------------------------
        log.info("")
        log.info("--- user.sqlite (per user) ---")
        user_db_keys = list_r2_objects(r2, bucket, f"{app_env}/users/", suffix="/user.sqlite")
        log.info(f"  Found {len(user_db_keys)} user databases")

        for i, key in enumerate(user_db_keys, 1):
            parts = key.split("/")
            user_id = parts[2] if len(parts) >= 4 else "?"
            short_id = f"{user_id[:12]}..."

            log.info(f"")
            log.info(f"  [{i}/{len(user_db_keys)}] user.sqlite {short_id}")

            local_path = tmp / f"user_{i}.sqlite"
            if not download_db(r2, bucket, key, local_path):
                log.warning(f"    Could not download — skipping")
                continue

            backup_db(r2, bucket, key, dry_run)
            changes = migrate_user_db(local_path)
            total_changes += changes

            issues = verify_user_schema(local_path)
            if issues:
                for issue in issues:
                    log.error(f"    VERIFY FAIL: {issue}")
                total_errors += len(issues)
            else:
                log.info(f"    Verification: PASS")

            if changes > 0:
                upload_db(r2, bucket, key, local_path, dry_run)
            else:
                log.info(f"    No changes needed")

            local_path.unlink(missing_ok=True)
            for wal in local_path.parent.glob(f"{local_path.name}*"):
                wal.unlink(missing_ok=True)
            total_dbs += 1

        # ---------------------------------------------------------------
        # 4. profile.sqlite (per user+profile)
        # ---------------------------------------------------------------
        log.info("")
        log.info("--- profile.sqlite (all users) ---")
        profile_keys = list_r2_objects(r2, bucket, f"{app_env}/users/", suffix="/profile.sqlite")
        log.info(f"  Found {len(profile_keys)} profile databases")

        for i, key in enumerate(profile_keys, 1):
            parts = key.split("/")
            user_id = parts[2] if len(parts) >= 6 else "?"
            profile_id = parts[4] if len(parts) >= 6 else "?"
            short_id = f"{user_id[:8]}../{profile_id[:8]}.."

            log.info(f"")
            log.info(f"  [{i}/{len(profile_keys)}] {short_id}")

            local_path = tmp / f"profile_{i}.sqlite"
            if not download_db(r2, bucket, key, local_path):
                log.warning(f"    Could not download — skipping")
                continue

            backup_db(r2, bucket, key, dry_run)
            changes = migrate_profile_db(local_path)
            total_changes += changes

            issues = verify_profile_schema(local_path)
            if issues:
                for issue in issues:
                    log.error(f"    VERIFY FAIL: {issue}")
                total_errors += len(issues)
            else:
                log.info(f"    Verification: PASS")

            if changes > 0:
                upload_db(r2, bucket, key, local_path, dry_run)
            else:
                log.info(f"    No changes needed")

            local_path.unlink(missing_ok=True)
            for wal in local_path.parent.glob(f"{local_path.name}*"):
                wal.unlink(missing_ok=True)
            total_dbs += 1

    # ---------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------
    log.info("")
    log.info("=" * 60)
    log.info(f"Migration complete {'(DRY RUN)' if dry_run else ''}")
    log.info(f"  Databases processed: {total_dbs}")
    log.info(f"  Schema changes applied: {total_changes}")
    log.info(f"  Verification errors: {total_errors}")
    if total_errors > 0:
        log.error("MIGRATION HAS ERRORS — review output above")
        sys.exit(1)
    if dry_run:
        log.info("Re-run without --dry-run to apply changes to R2")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
