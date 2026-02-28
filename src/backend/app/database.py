"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/<user_id>/database.sqlite.
Tables are created automatically on first access or when missing.

The database and directories are auto-created on demand, so deleting
the user_data/<user_id> folder will simply reset the app to a clean state.

User Isolation:
The current user ID is determined by the X-User-ID header on each request.
This enables E2E tests to use isolated user namespaces without polluting
the development database. If no header is provided, the default user 'a' is used.
"""

import sqlite3
import logging
import threading
import time
from contextvars import ContextVar
from pathlib import Path
from contextlib import contextmanager
from typing import Optional, Any

from .user_context import get_current_user_id
from .profile_context import get_current_profile_id
from .storage import (
    R2_ENABLED,
    sync_database_from_r2,
    sync_database_to_r2,
    sync_database_from_r2_if_newer,
    sync_database_to_r2_with_version,
    get_db_version_from_r2,
)

logger = logging.getLogger(__name__)

# Base path for user data
USER_DATA_BASE = Path(__file__).parent.parent.parent.parent / "user_data"

# Track initialized user namespaces (per user_id)
_initialized_users: set = set()

# Track database versions per (user_id, profile_id) (for R2 sync)
_user_db_versions: dict = {}  # (user_id, profile_id) -> version number
_db_version_lock = threading.Lock()

# Database size thresholds (archive system targets <400KB)
DB_SIZE_WARNING_THRESHOLD = 400 * 1024  # 400KB - archive target exceeded
DB_SIZE_CRITICAL_THRESHOLD = 768 * 1024  # 768KB - sync performance degrades

# Query timing threshold for slow query warnings (in seconds)
SLOW_QUERY_THRESHOLD = 0.1  # 100ms - warn if query takes this long

# Per-request context for write tracking (ContextVar is async-safe, unlike threading.local)
# threading.local is shared across all async coroutines on the same event loop thread,
# which causes concurrent requests to clobber each other's write flags.
_request_has_writes: ContextVar[bool] = ContextVar('request_has_writes', default=False)
_request_user_id: ContextVar[Optional[str]] = ContextVar('request_user_id', default=None)


class TrackedCursor:
    """
    SQLite cursor wrapper that tracks if write operations occurred.

    Wraps a sqlite3.Cursor to detect INSERT, UPDATE, DELETE, etc.
    and marks the connection as having writes.
    """

    def __init__(self, cursor: sqlite3.Cursor, connection: 'TrackedConnection'):
        self._cursor = cursor
        self._connection = connection

    def execute(self, sql: str, parameters: Any = None) -> 'TrackedCursor':
        """Execute SQL and track if it's a write operation."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE')):
            self._connection._mark_write()

        start = time.perf_counter()
        if parameters is None:
            self._cursor.execute(sql)
        else:
            self._cursor.execute(sql, parameters)
        duration = time.perf_counter() - start

        if duration >= SLOW_QUERY_THRESHOLD:
            # Extract first 100 chars of SQL for logging (avoid huge queries in logs)
            sql_preview = sql[:100].replace('\n', ' ').strip()
            if len(sql) > 100:
                sql_preview += '...'
            logger.warning(
                f"[SLOW QUERY] {duration:.3f}s - {sql_preview}"
            )
        return self

    def executemany(self, sql: str, seq_of_parameters) -> 'TrackedCursor':
        """Execute SQL for multiple parameter sets."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE')):
            self._connection._mark_write()

        self._cursor.executemany(sql, seq_of_parameters)
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def fetchmany(self, size=None):
        if size is None:
            return self._cursor.fetchmany()
        return self._cursor.fetchmany(size)

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def close(self):
        self._cursor.close()

    def __iter__(self):
        return iter(self._cursor)


class TrackedConnection:
    """
    SQLite connection wrapper that tracks if write operations occurred.

    This enables batched syncing - we only sync to R2 if writes happened
    during the request, and we sync once at the end, not after every write.
    """

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        self._has_writes = False

    def _mark_write(self):
        """Mark that a write operation occurred."""
        self._has_writes = True
        # Also mark in request context for middleware to detect
        _request_has_writes.set(True)

    @property
    def has_writes(self) -> bool:
        """Check if any write operations occurred."""
        return self._has_writes

    def cursor(self) -> TrackedCursor:
        """Return a tracked cursor."""
        return TrackedCursor(self._conn.cursor(), self)

    def commit(self):
        """Commit the transaction."""
        self._conn.commit()

    def rollback(self):
        """Rollback the transaction."""
        self._conn.rollback()

    def close(self):
        """Close the connection."""
        self._conn.close()

    def execute(self, sql: str, parameters: Any = None) -> TrackedCursor:
        """Execute SQL directly on connection."""
        cursor = self.cursor()
        return cursor.execute(sql, parameters)

    @property
    def row_factory(self):
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, value):
        self._conn.row_factory = value


def check_database_size(db_path: Path) -> None:
    """
    Log warning if database size exceeds archive target.

    Call this periodically (e.g., after sync) to monitor database growth.
    The archive system (T66) targets keeping the DB under 400KB.
    """
    if not db_path.exists():
        return

    try:
        size = db_path.stat().st_size

        if size > DB_SIZE_CRITICAL_THRESHOLD:
            logger.warning(
                f"Database size critical: {size / 1024:.1f}KB exceeds {DB_SIZE_CRITICAL_THRESHOLD // 1024}KB. "
                f"Sync performance may degrade. Check if cleanup_database_bloat is running."
            )
        elif size > DB_SIZE_WARNING_THRESHOLD:
            logger.info(
                f"Database size: {size / 1024:.1f}KB (target: <{DB_SIZE_WARNING_THRESHOLD // 1024}KB)"
            )
    except Exception as e:
        logger.debug(f"Could not check database size: {e}")


def get_local_db_version(user_id: str, profile_id: str) -> Optional[int]:
    """
    Get the locally cached database version for a user+profile.

    First checks in-memory cache, then falls back to reading from the
    database file itself. This ensures version survives process restarts.
    """
    cache_key = (user_id, profile_id)
    with _db_version_lock:
        cached = _user_db_versions.get(cache_key)
        if cached is not None:
            return cached

    # Not in cache - try to read from database file
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "database.sqlite"
    if not db_path.exists():
        return None

    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        cursor = conn.cursor()
        # Check if db_version table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='db_version'")
        if not cursor.fetchone():
            conn.close()
            return None
        cursor.execute("SELECT version FROM db_version WHERE id = 1")
        row = cursor.fetchone()
        conn.close()
        if row:
            version = row[0]
            # Cache it for future lookups
            with _db_version_lock:
                _user_db_versions[cache_key] = version
            return version
    except Exception as e:
        logger.debug(f"Could not read db_version from {db_path}: {e}")

    return None


def set_local_db_version(user_id: str, profile_id: str, version: Optional[int]) -> None:
    """
    Set the locally cached database version for a user+profile.

    Persists to both in-memory cache AND database file, so version
    survives process restarts.
    """
    cache_key = (user_id, profile_id)
    with _db_version_lock:
        if version is None:
            _user_db_versions.pop(cache_key, None)
        else:
            _user_db_versions[cache_key] = version

    # Also persist to database file
    if version is not None:
        db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "database.sqlite"
        if db_path.exists():
            try:
                conn = sqlite3.connect(str(db_path), timeout=5)
                cursor = conn.cursor()
                # Create table if not exists
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS db_version (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        version INTEGER NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                # Upsert version
                cursor.execute("""
                    INSERT OR REPLACE INTO db_version (id, version, updated_at)
                    VALUES (1, ?, CURRENT_TIMESTAMP)
                """, (version,))
                conn.commit()
                conn.close()
                logger.debug(f"Persisted db_version {version} to {db_path}")
            except Exception as e:
                logger.warning(f"Could not persist db_version to {db_path}: {e}")


def init_request_context() -> None:
    """Initialize request context for write tracking. Call at start of request.

    Uses ContextVar (async-safe) instead of threading.local, so concurrent
    async requests on the same event loop thread don't clobber each other.
    """
    _request_has_writes.set(False)
    _request_user_id.set(get_current_user_id())


def get_request_has_writes() -> bool:
    """Check if any writes occurred during this request."""
    return _request_has_writes.get()


def clear_request_context() -> None:
    """Clear request context. Call at end of request.

    ContextVar values are automatically scoped to each async task,
    but we reset explicitly for clarity and to free references.
    """
    _request_has_writes.set(False)
    _request_user_id.set(None)


def get_user_data_path() -> Path:
    """Get the user data directory path for the current user and profile."""
    return USER_DATA_BASE / get_current_user_id() / "profiles" / get_current_profile_id()


def get_database_path() -> Path:
    """Get the database file path for the current user."""
    return get_user_data_path() / "database.sqlite"


# Dynamic path getters for video storage subdirectories
def get_raw_clips_path() -> Path:
    """Get the raw clips directory path for the current user."""
    return get_user_data_path() / "raw_clips"


def get_uploads_path() -> Path:
    """Get the uploads directory path for the current user."""
    return get_user_data_path() / "uploads"


def get_working_videos_path() -> Path:
    """Get the working videos directory path for the current user."""
    return get_user_data_path() / "working_videos"


def get_final_videos_path() -> Path:
    """Get the final videos directory path for the current user."""
    return get_user_data_path() / "final_videos"


def get_downloads_path() -> Path:
    """Get the downloads directory path for the current user."""
    return get_user_data_path() / "downloads"


def get_games_path() -> Path:
    """Get the games directory path for the current user."""
    return get_user_data_path() / "games"


def get_clip_cache_path() -> Path:
    """Get the clip cache directory path for the current user."""
    return get_user_data_path() / "clip_cache"


def get_highlights_path() -> Path:
    """Get the highlights directory path for player images (cross-project reuse)."""
    return get_user_data_path() / "highlights"



def ensure_directories():
    """
    Ensure all required directories exist for the current user.
    Called automatically before database access.

    When R2 is enabled, only create the user_data base directory (for database.sqlite).
    Video files are stored in R2, not locally.
    """
    # Always create base user data directory (needed for database.sqlite)
    get_user_data_path().mkdir(parents=True, exist_ok=True)

    # When R2 is enabled, don't create local video directories - all files go to R2
    if R2_ENABLED:
        logger.debug("R2 enabled: skipping local video directory creation")
        return

    # Local mode only: create all video directories
    directories = [
        get_raw_clips_path(),
        get_uploads_path(),
        get_working_videos_path(),
        get_final_videos_path(),
        get_downloads_path(),
        get_games_path(),
        get_clip_cache_path(),
        get_highlights_path(),
    ]
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)


def ensure_database():
    """
    Ensure database exists with all required tables for the current user.
    Called automatically before each database access.
    This makes the app resilient to the user_data folder being deleted.

    If R2 is enabled, uses version-based sync to check if R2 has a newer version.
    """
    global _initialized_users
    user_id = get_current_user_id()
    db_path = get_database_path()

    # Quick path: if already initialized and DB exists, skip table creation
    # but still check R2 for newer version
    already_initialized = user_id in _initialized_users and db_path.exists()

    # Ensure directories exist
    ensure_directories()

    # If R2 is enabled, download from R2 only on first access (no local DB yet)
    # We do NOT check R2 version on every request - that HEAD request is slow (20s+ when cold)
    # Multi-device sync will be handled by user management (T200) with session invalidation
    if R2_ENABLED:
        profile_id = get_current_profile_id()
        local_version = get_local_db_version(user_id, profile_id)

        # Only download from R2 if we've never synced for this user+profile (first access)
        if local_version is None:
            was_synced, new_version = sync_database_from_r2_if_newer(user_id, db_path, local_version)
            if was_synced:
                logger.info(f"Database downloaded from R2 for user: {user_id}, profile: {profile_id}, version: {new_version}")
                set_local_db_version(user_id, profile_id, new_version)
                # Force re-initialization since we got a new DB
                already_initialized = False
            elif new_version is not None:
                # R2 has a version but we didn't need to download (local exists)
                set_local_db_version(user_id, profile_id, new_version)
            else:
                # R2 has no DB for this user+profile (fresh or R2 HEAD failed).
                # Set version to 0 so we don't retry the R2 HEAD on every request.
                # Without this, every get_db_connection() call for fresh users
                # makes a slow R2 HEAD request (~3s), and if a sync eventually
                # succeeds (uploading stale data), a later request with
                # local_version=None would download and overwrite local changes.
                set_local_db_version(user_id, profile_id, 0)

    # If already initialized, skip table creation
    if already_initialized:
        return

    # Create/verify tables
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Raw clips - extracted from Annotate mode (all clips saved in real-time)
        # game_id links to source game, auto_project_id tracks 5-star auto-projects
        # filename is empty string for pending clips (video not yet uploaded)
        cursor.execute("""
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
                FOREIGN KEY (auto_project_id) REFERENCES projects(id) ON DELETE SET NULL
            )
        """)

        # Projects - organize clips for editing
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                aspect_ratio TEXT NOT NULL,
                working_video_id INTEGER,
                final_video_id INTEGER,
                is_auto_created INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (working_video_id) REFERENCES working_videos(id),
                FOREIGN KEY (final_video_id) REFERENCES final_videos(id)
            )
        """)

        # Working clips - clips assigned to projects
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS working_clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                raw_clip_id INTEGER,
                uploaded_filename TEXT,
                exported_at TEXT DEFAULT NULL,
                sort_order INTEGER DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                crop_data TEXT,
                timing_data TEXT,
                segments_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id)
            )
        """)

        # Working videos - output from Framing mode
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS working_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                highlights_data TEXT,
                text_overlays TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        """)

        # Final videos - output from Overlay mode
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS final_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                filename TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        """)

        # Games - store annotated game footage
        # Videos stored globally in R2 at games/{blake3_hash}.mp4
        # Aggregate columns cache annotation counts for fast listing
        # Clip annotations are stored in raw_clips table (linked by game_id)
        cursor.execute("""
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
                tournament_name TEXT
            )
        """)


        # Export jobs - track background export tasks for durability
        # Progress is NOT stored here (ephemeral, WebSocket only)
        # Only state transitions: pending -> processing -> complete/error
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS export_jobs (
                id TEXT PRIMARY KEY,
                project_id INTEGER,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                input_data TEXT NOT NULL,
                output_video_id INTEGER,
                output_filename TEXT,
                modal_call_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Migration: Add modal_call_id column if missing (for existing databases)
        try:
            cursor.execute("SELECT modal_call_id FROM export_jobs LIMIT 1")
        except Exception:
            cursor.execute("ALTER TABLE export_jobs ADD COLUMN modal_call_id TEXT")

        # Indexes for export_jobs
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_project
            ON export_jobs(project_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_status
            ON export_jobs(status)
        """)

        # Before/After tracking - links final videos to their source footage
        # Used to generate before/after comparison videos
        cursor.execute("""
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
            )
        """)

        # Index for before_after_tracks
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_before_after_tracks_final_video
            ON before_after_tracks(final_video_id)
        """)

        # Migration: Add new columns to existing tables (silently ignore if already exists)
        migrations = [
            # raw_clips new columns
            "ALTER TABLE raw_clips ADD COLUMN name TEXT",
            "ALTER TABLE raw_clips ADD COLUMN notes TEXT",
            "ALTER TABLE raw_clips ADD COLUMN start_time REAL",
            "ALTER TABLE raw_clips ADD COLUMN end_time REAL",
            # working_clips framing edit storage
            "ALTER TABLE working_clips ADD COLUMN crop_data TEXT",
            "ALTER TABLE working_clips ADD COLUMN timing_data TEXT",
            "ALTER TABLE working_clips ADD COLUMN segments_data TEXT",
            # working_videos overlay edit storage
            "ALTER TABLE working_videos ADD COLUMN highlights_data TEXT",
            "ALTER TABLE working_videos ADD COLUMN text_overlays TEXT",
            # games video metadata (for faster loading without re-extracting)
            "ALTER TABLE games ADD COLUMN video_duration REAL",
            "ALTER TABLE games ADD COLUMN video_width INTEGER",
            "ALTER TABLE games ADD COLUMN video_height INTEGER",
            "ALTER TABLE games ADD COLUMN video_size INTEGER",
            # Downloads & overlay persistence (added for downloads navigation feature)
            "ALTER TABLE final_videos ADD COLUMN duration REAL",
            "ALTER TABLE working_videos ADD COLUMN duration REAL",
            "ALTER TABLE working_videos ADD COLUMN effect_type TEXT DEFAULT 'original'",
            "ALTER TABLE projects ADD COLUMN last_opened_at TIMESTAMP",
            # Project state persistence (current mode for resume)
            "ALTER TABLE projects ADD COLUMN current_mode TEXT DEFAULT 'framing'",
            # Version-based tracking (replaces abandoned flag approach)
            "ALTER TABLE working_clips ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE working_videos ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE final_videos ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            # Replace progress flag with exported_at timestamp
            "ALTER TABLE working_clips ADD COLUMN exported_at TEXT DEFAULT NULL",
            # Annotations refactor: aggregate columns on games table
            "ALTER TABLE games ADD COLUMN clip_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN brilliant_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN good_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN interesting_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN mistake_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN blunder_count INTEGER DEFAULT 0",
            "ALTER TABLE games ADD COLUMN aggregate_score INTEGER DEFAULT 0",
            # Default highlight data for raw clips (cross-project reuse)
            "ALTER TABLE raw_clips ADD COLUMN default_highlight_regions TEXT",
            # Raw clips source tracking (for real-time save from annotation)
            "ALTER TABLE raw_clips ADD COLUMN game_id INTEGER",
            "ALTER TABLE raw_clips ADD COLUMN auto_project_id INTEGER",
            # Gallery source type tracking (brilliant_clip, custom_project, annotated_game)
            "ALTER TABLE final_videos ADD COLUMN source_type TEXT",
            # Source game ID for annotated exports (to navigate back to annotate mode)
            "ALTER TABLE final_videos ADD COLUMN game_id INTEGER",
            # Name for annotated exports (when no project is associated)
            "ALTER TABLE final_videos ADD COLUMN name TEXT",
            # Rating counts snapshot for annotated exports (frozen at export time, JSON)
            "ALTER TABLE final_videos ADD COLUMN rating_counts TEXT",
            # Game details for display name generation
            "ALTER TABLE games ADD COLUMN opponent_name TEXT",
            "ALTER TABLE games ADD COLUMN game_date TEXT",
            "ALTER TABLE games ADD COLUMN game_type TEXT",  # 'home', 'away', 'tournament'
            "ALTER TABLE games ADD COLUMN tournament_name TEXT",
            # Auto-created projects (from 5-star clips)
            "ALTER TABLE projects ADD COLUMN is_auto_created INTEGER DEFAULT 0",
            # Track when raw clip boundaries (start_time/end_time) were last changed
            "ALTER TABLE raw_clips ADD COLUMN boundaries_version INTEGER DEFAULT 1",
            "ALTER TABLE raw_clips ADD COLUMN boundaries_updated_at TIMESTAMP",
            # Track which version of raw clip boundaries was used when framing was done
            "ALTER TABLE working_clips ADD COLUMN raw_clip_version INTEGER",
            # Version tracking for gesture-based overlay sync (Task 19)
            "ALTER TABLE working_videos ADD COLUMN overlay_version INTEGER DEFAULT 0",
            # Export jobs: game_id for annotate exports (T12: Progress Recovery)
            "ALTER TABLE export_jobs ADD COLUMN game_id INTEGER",
            # Export jobs: game_name for display in progress UI (T12)
            "ALTER TABLE export_jobs ADD COLUMN game_name TEXT",
            # Export jobs: acknowledged_at for preventing duplicate notifications (T12)
            "ALTER TABLE export_jobs ADD COLUMN acknowledged_at TIMESTAMP",
            # Highlight color preference for overlay mode (T67)
            "ALTER TABLE working_videos ADD COLUMN highlight_color TEXT DEFAULT NULL",
            # T66: Track when project was restored from archive (for stale cleanup)
            "ALTER TABLE projects ADD COLUMN restored_at TIMESTAMP DEFAULT NULL",
            # T80: Global game deduplication - store BLAKE3 hash for global storage
            "ALTER TABLE games ADD COLUMN blake3_hash TEXT",
            # T80: Track last access time for future cleanup of unused games
            "ALTER TABLE games ADD COLUMN last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            # T82: Track which video a clip belongs to in multi-video games (1-based sequence)
            "ALTER TABLE raw_clips ADD COLUMN video_sequence INTEGER",
            # T82: Replace unique index to include video_sequence (allows same end_time on different videos)
            "DROP INDEX IF EXISTS idx_raw_clips_game_end_time",
            # T249: Extraction recovery — track retry attempts
            "ALTER TABLE modal_tasks ADD COLUMN retry_count INTEGER DEFAULT 0",
            # T251: Track how much video the user has watched/scrubbed in annotate mode
            "ALTER TABLE games ADD COLUMN viewed_duration REAL DEFAULT 0",
        ]

        for migration in migrations:
            try:
                cursor.execute(migration)
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass

        # T85a: Make project_id nullable in export_jobs and final_videos
        # Annotate exports have no project, so project_id must be NULL-able.
        # SQLite doesn't support ALTER COLUMN, so we recreate the table if needed.
        # Uses the "create new, copy, drop old, rename new" pattern to avoid
        # ALTER TABLE RENAME corrupting FK references in other tables.
        _new_schemas = {
            'export_jobs': """
                CREATE TABLE _export_jobs_new (
                    id TEXT PRIMARY KEY,
                    project_id INTEGER,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT,
                    input_data TEXT NOT NULL,
                    output_video_id INTEGER,
                    output_filename TEXT,
                    modal_call_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    game_id INTEGER,
                    game_name TEXT,
                    acknowledged_at TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """,
            'final_videos': """
                CREATE TABLE _final_videos_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER,
                    filename TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    duration REAL,
                    source_type TEXT,
                    game_id INTEGER,
                    name TEXT,
                    rating_counts TEXT,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                )
            """,
        }
        for table_name, new_ddl in _new_schemas.items():
            try:
                col_info = cursor.execute(f"PRAGMA table_info({table_name})").fetchall()
                needs_migration = any(c['name'] == 'project_id' and c['notnull'] for c in col_info)
                if not needs_migration:
                    continue
                logger.info(f"[Migration] Recreating {table_name}: project_id NOT NULL -> nullable")
                old_cols = [c['name'] for c in col_info]
                # Create new table with temp name (avoids ALTER TABLE RENAME corruption)
                cursor.execute(new_ddl)
                new_col_info = cursor.execute(f"PRAGMA table_info(_{table_name}_new)").fetchall()
                new_cols = {c['name'] for c in new_col_info}
                common_cols = [c for c in old_cols if c in new_cols]
                cols_str = ', '.join(common_cols)
                select_cols = ', '.join(
                    'NULLIF(project_id, 0)' if c == 'project_id' else c
                    for c in common_cols
                )
                cursor.execute(f"INSERT INTO _{table_name}_new ({cols_str}) SELECT {select_cols} FROM {table_name}")
                cursor.execute(f"DROP TABLE {table_name}")
                cursor.execute(f"ALTER TABLE _{table_name}_new RENAME TO {table_name}")
                logger.info(f"[Migration] {table_name} recreated successfully")
            except Exception as e:
                logger.warning(f"[Migration] Failed to migrate {table_name}: {e}")

        # Migrate progress flag to exported_at timestamp
        # Set exported_at to current timestamp for clips that were previously exported (progress >= 1)
        try:
            cursor.execute("""
                UPDATE working_clips
                SET exported_at = datetime('now')
                WHERE exported_at IS NULL AND progress >= 1
            """)
        except sqlite3.OperationalError:
            # progress column doesn't exist (fresh install), ignore
            pass

        # Initialize version numbers for existing records (if version is NULL or 0)
        # Assign versions based on created_at order per project
        try:
            # Working clips: Assign version numbers
            cursor.execute("""
                UPDATE working_clips
                SET version = (
                    SELECT COUNT(*)
                    FROM working_clips wc2
                    WHERE wc2.project_id = working_clips.project_id
                    AND wc2.created_at <= working_clips.created_at
                )
                WHERE version IS NULL OR version = 0
            """)

            # Working videos: Assign version numbers
            cursor.execute("""
                UPDATE working_videos
                SET version = (
                    SELECT COUNT(*)
                    FROM working_videos w2
                    WHERE w2.project_id = working_videos.project_id
                    AND w2.created_at <= working_videos.created_at
                )
                WHERE version IS NULL OR version = 0
            """)

            # Final videos: Assign version numbers
            cursor.execute("""
                UPDATE final_videos
                SET version = (
                    SELECT COUNT(*)
                    FROM final_videos f2
                    WHERE f2.project_id = final_videos.project_id
                    AND f2.created_at <= final_videos.created_at
                )
                WHERE version IS NULL OR version = 0
            """)
        except sqlite3.OperationalError:
            # Migration already done, ignore
            pass

        # Create indexes for efficient version queries
        try:
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_version
                ON working_clips(project_id, version DESC)
            """)
            # Index for version lookup by raw_clip_id (for the NOT EXISTS anti-join)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version
                ON working_clips(project_id, raw_clip_id, version DESC)
            """)
            # Index for version lookup by uploaded_filename
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_upload_version
                ON working_clips(project_id, uploaded_filename, version DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_videos_project_version
                ON working_videos(project_id, version DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_final_videos_project_version
                ON final_videos(project_id, version DESC)
            """)
            # Index for raw_clips game filtering
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_raw_clips_game_id
                ON raw_clips(game_id)
            """)
            # Composite index for natural key lookup (game_id + end_time + video_sequence)
            cursor.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time_seq
                ON raw_clips(game_id, end_time, video_sequence)
            """)
        except sqlite3.OperationalError:
            # Index already exists, ignore
            pass

        # Modal tasks table - tracks background GPU tasks for resumability
        cursor.execute("""
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
            )
        """)

        # Index for finding pending/running tasks
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_modal_tasks_status
            ON modal_tasks(status)
        """)

        # Index for finding tasks by game (for finish-annotation)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_modal_tasks_game_id
            ON modal_tasks(game_id)
        """)

        # User settings - persisted preferences (synced to R2)
        # Uses JSON for flexible settings storage without schema changes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                settings_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # T82: Multi-video games - track individual video files per game
        # Single-video games use games.blake3_hash directly (no game_videos rows)
        # Multi-video games set games.blake3_hash = NULL and use game_videos rows
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS game_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                blake3_hash TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                duration REAL,
                video_width INTEGER,
                video_height INTEGER,
                video_size INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, sequence)
            )
        """)

        # Index for game_videos lookup by game
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_game_videos_game
            ON game_videos(game_id)
        """)

        # T80: Track in-progress multipart uploads
        # Allows resuming interrupted uploads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pending_uploads (
                id TEXT PRIMARY KEY,
                blake3_hash TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                r2_upload_id TEXT NOT NULL,
                parts_json TEXT,
                label TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # T80: Database version tracking for R2 sync
        # Stored in DB so version survives process restarts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS db_version (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Initialize settings row if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO user_settings (id, settings_json)
            VALUES (1, '{}')
        """)

        conn.commit()
        _initialized_users.add(user_id)
        logger.debug(f"Database verified/initialized for user: {user_id}")

    finally:
        conn.close()

    # T85a: Cleanup tasks (T66, T243) moved to session_init.py user_session_init()
    # They now run explicitly during /api/auth/init instead of implicitly here.


@contextmanager
def get_db_connection() -> TrackedConnection:
    """
    Context manager for database connections.
    Ensures database exists and connections are properly closed after use.

    Returns a TrackedConnection that automatically detects write operations,
    enabling batched syncing to R2 (sync once per request, not per write).

    Auto-creates the database and directories if they don't exist,
    making the app resilient to the user_data folder being deleted.
    """
    # Ensure database exists before connecting
    ensure_database()

    # timeout=30 means wait up to 30 seconds for lock at connection level
    raw_conn = sqlite3.connect(str(get_database_path()), timeout=30)
    raw_conn.row_factory = sqlite3.Row  # Return rows as dictionaries

    # Enable WAL mode for better concurrent access (allows reads while writing)
    raw_conn.execute("PRAGMA journal_mode=WAL")
    # Wait up to 30 seconds for lock instead of failing immediately
    raw_conn.execute("PRAGMA busy_timeout=30000")
    # T86: Enable foreign key enforcement (required for ON DELETE CASCADE/SET NULL)
    raw_conn.execute("PRAGMA foreign_keys=ON")

    conn = TrackedConnection(raw_conn)
    try:
        yield conn
    finally:
        conn.close()


def init_database():
    """
    Initialize the database and create all required directories for the current user.
    Called on application startup for logging purposes.
    Also called automatically by get_db_connection() if needed.
    """
    user_id = get_current_user_id()
    logger.info(f"Initializing database for user: {user_id}...")

    # Ensure directories exist
    ensure_directories()
    logger.info(f"Ensured directory exists: {get_user_data_path()}")
    if not R2_ENABLED:
        # Only log local directories when R2 is disabled (local mode)
        directories = [
            get_raw_clips_path(),
            get_uploads_path(),
            get_working_videos_path(),
            get_final_videos_path(),
            get_downloads_path(),
            get_games_path(),
            get_clip_cache_path(),
        ]
        for directory in directories:
            logger.info(f"Ensured directory exists: {directory}")
    else:
        logger.info("R2 storage enabled - video files stored in cloud, not locally")

    # Ensure database tables exist
    ensure_database()
    logger.info("Database tables created/verified successfully")


def is_database_initialized() -> bool:
    """Check if the database file exists and has tables for the current user."""
    db_path = get_database_path()
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(str(db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row['name'] for row in cursor.fetchall()}
        conn.close()
        required = {'raw_clips', 'projects', 'working_clips',
                   'working_videos', 'final_videos', 'games'}
        return required.issubset(tables)
    except Exception:
        return False


def reset_initialized_flag():
    """
    Reset the initialization flag for the current user. Useful for testing or when
    the database has been manually deleted.
    """
    global _initialized_users
    user_id = get_current_user_id()
    _initialized_users.discard(user_id)


def sync_db_to_cloud() -> bool:
    """
    Sync the current user's database to R2 storage with version tracking.
    Call this after database modifications to persist changes to the cloud.

    Uses version-based sync with optimistic locking:
    - Checks current version to detect conflicts
    - Increments version on successful upload
    - Logs conflicts but uses last-write-wins for MVP

    Also checks database size and logs migration recommendations.

    Returns True if sync succeeded (or R2 not enabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    db_path = get_database_path()

    if not db_path.exists():
        return True

    # Check database size and log warnings if approaching threshold
    check_database_size(db_path)

    # Get current local version for conflict detection
    current_version = get_local_db_version(user_id, profile_id)

    # Sync with version tracking
    success, new_version = sync_database_to_r2_with_version(user_id, db_path, current_version)

    if success and new_version is not None:
        set_local_db_version(user_id, profile_id, new_version)
        logger.debug(f"Database synced to R2 for user: {user_id}, profile: {profile_id}, version: {new_version}")
        return True
    elif not success:
        logger.warning(f"Failed to sync database to R2 for user: {user_id}, profile: {profile_id}")
        return False

    return True


def sync_db_to_cloud_if_writes() -> bool:
    """
    Sync database to R2 only if writes occurred during this request.
    Called by middleware at end of request.

    This enables batched syncing - multiple writes in a single request
    result in only one R2 upload.

    Returns True if sync succeeded (or no writes/R2 disabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    if get_request_has_writes():
        return sync_db_to_cloud()
    return True
