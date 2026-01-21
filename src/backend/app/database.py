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
from pathlib import Path
from contextlib import contextmanager
from typing import Optional, Any

from .user_context import get_current_user_id
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

# Track database versions per user (for R2 sync)
_user_db_versions: dict = {}  # user_id -> version number
_db_version_lock = threading.Lock()

# Database size thresholds for Durable Objects migration
DB_SIZE_WARNING_THRESHOLD = 512 * 1024  # 512KB - start warning
DB_SIZE_MIGRATION_THRESHOLD = 1024 * 1024  # 1MB - recommend migration

# Thread-local storage for request context (write tracking)
_request_context = threading.local()


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

        if parameters is None:
            self._cursor.execute(sql)
        else:
            self._cursor.execute(sql, parameters)
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
        if hasattr(_request_context, 'has_writes'):
            _request_context.has_writes = True

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
    Log warning if database is approaching migration threshold.

    Call this periodically (e.g., after sync) to monitor database growth.
    When the database exceeds 1MB, a warning recommends migrating to
    Durable Objects for archived data.
    """
    if not db_path.exists():
        return

    try:
        size = db_path.stat().st_size

        if size > DB_SIZE_MIGRATION_THRESHOLD:
            logger.warning(
                f"DATABASE MIGRATION RECOMMENDED: Database size ({size / 1024:.1f}KB) exceeds 1MB. "
                f"Consider migrating archived data to Durable Objects for better performance. "
                f"Path: {db_path}"
            )
        elif size > DB_SIZE_WARNING_THRESHOLD:
            logger.info(
                f"Database size notice: {size / 1024:.1f}KB - approaching 1MB migration threshold"
            )
    except Exception as e:
        logger.debug(f"Could not check database size: {e}")


def get_local_db_version(user_id: str) -> Optional[int]:
    """Get the locally cached database version for a user."""
    with _db_version_lock:
        return _user_db_versions.get(user_id)


def set_local_db_version(user_id: str, version: Optional[int]) -> None:
    """Set the locally cached database version for a user."""
    with _db_version_lock:
        if version is None:
            _user_db_versions.pop(user_id, None)
        else:
            _user_db_versions[user_id] = version


def init_request_context() -> None:
    """Initialize request context for write tracking. Call at start of request."""
    _request_context.has_writes = False
    _request_context.user_id = get_current_user_id()


def get_request_has_writes() -> bool:
    """Check if any writes occurred during this request."""
    return getattr(_request_context, 'has_writes', False)


def clear_request_context() -> None:
    """Clear request context. Call at end of request."""
    if hasattr(_request_context, 'has_writes'):
        del _request_context.has_writes
    if hasattr(_request_context, 'user_id'):
        del _request_context.user_id


def get_user_data_path() -> Path:
    """Get the user data directory path for the current user."""
    return USER_DATA_BASE / get_current_user_id()


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
    """
    directories = [
        get_user_data_path(),
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

    # If R2 is enabled, check for newer version and sync if needed
    if R2_ENABLED:
        local_version = get_local_db_version(user_id)
        was_synced, new_version = sync_database_from_r2_if_newer(user_id, db_path, local_version)
        if was_synced:
            logger.info(f"Database synced from R2 for user: {user_id}, version: {new_version}")
            set_local_db_version(user_id, new_version)
            # Force re-initialization since we got a new DB
            already_initialized = False
        elif new_version is not None and local_version is None:
            # First time seeing this version, record it
            set_local_db_version(user_id, new_version)

    # If already initialized, skip table creation
    if already_initialized:
        return

    # Create/verify tables
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Raw clips - extracted from Annotate mode (all clips saved in real-time)
        # game_id links to source game, auto_project_id tracks 5-star auto-projects
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(id),
                FOREIGN KEY (auto_project_id) REFERENCES projects(id)
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
                project_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        """)

        # Games - store annotated game footage for later project creation
        # video_filename is NULL until video is uploaded (allows instant game creation)
        # Aggregate columns cache annotation counts for fast listing without parsing
        # Clip annotations are stored in raw_clips table (linked by game_id)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                video_filename TEXT,
                clip_count INTEGER DEFAULT 0,
                brilliant_count INTEGER DEFAULT 0,
                good_count INTEGER DEFAULT 0,
                interesting_count INTEGER DEFAULT 0,
                mistake_count INTEGER DEFAULT 0,
                blunder_count INTEGER DEFAULT 0,
                aggregate_score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


        # Export jobs - track background export tasks for durability
        # Progress is NOT stored here (ephemeral, WebSocket only)
        # Only state transitions: pending -> processing -> complete/error
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS export_jobs (
                id TEXT PRIMARY KEY,
                project_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                input_data TEXT NOT NULL,
                output_video_id INTEGER,
                output_filename TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

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
        ]

        for migration in migrations:
            try:
                cursor.execute(migration)
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass

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
            # Composite index for natural key lookup (game_id + end_time)
            cursor.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time
                ON raw_clips(game_id, end_time)
            """)
        except sqlite3.OperationalError:
            # Index already exists, ignore
            pass

        conn.commit()
        _initialized_users.add(user_id)
        logger.debug(f"Database verified/initialized for user: {user_id}")

    finally:
        conn.close()


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

    raw_conn = sqlite3.connect(str(get_database_path()))
    raw_conn.row_factory = sqlite3.Row  # Return rows as dictionaries
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
    directories = [
        get_user_data_path(),
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

    # Ensure database tables exist
    ensure_database()
    logger.info("Database tables created/verified successfully")


def is_database_initialized() -> bool:
    """Check if the database file exists and has tables for the current user."""
    db_path = get_database_path()
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(str(db_path))
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


def sync_db_to_cloud():
    """
    Sync the current user's database to R2 storage with version tracking.
    Call this after database modifications to persist changes to the cloud.

    Uses version-based sync with optimistic locking:
    - Checks current version to detect conflicts
    - Increments version on successful upload
    - Logs conflicts but uses last-write-wins for MVP

    Also checks database size and logs migration recommendations.

    This is a no-op if R2 is not enabled.
    """
    if not R2_ENABLED:
        return

    user_id = get_current_user_id()
    db_path = get_database_path()

    if not db_path.exists():
        return

    # Check database size and log warnings if approaching threshold
    check_database_size(db_path)

    # Get current local version for conflict detection
    current_version = get_local_db_version(user_id)

    # Sync with version tracking
    success, new_version = sync_database_to_r2_with_version(user_id, db_path, current_version)

    if success and new_version is not None:
        set_local_db_version(user_id, new_version)
        logger.debug(f"Database synced to R2 for user: {user_id}, version: {new_version}")
    elif not success:
        logger.warning(f"Failed to sync database to R2 for user: {user_id}")


def sync_db_to_cloud_if_writes():
    """
    Sync database to R2 only if writes occurred during this request.
    Called by middleware at end of request.

    This enables batched syncing - multiple writes in a single request
    result in only one R2 upload.
    """
    if not R2_ENABLED:
        return

    if get_request_has_writes():
        sync_db_to_cloud()
