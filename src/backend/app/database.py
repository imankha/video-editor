"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/<user_id>/profile.sqlite.
Tables are created automatically on first access or when missing.

The database and directories are auto-created on demand, so deleting
the user_data/<user_id> folder will simply reset the app to a clean state.

User Isolation:
The current user ID is determined by the session cookie (or X-User-ID header
in tests). Every visitor gets a UUID via /api/auth/init-guest. If no user
context is set, get_current_user_id() raises RuntimeError.
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
    R2VersionResult,
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

# R2 restore cooldown — avoids hammering R2 on transient failures
_r2_restore_cooldowns: dict[str, float] = {}  # cache_key -> last failure timestamp
RESTORE_COOLDOWN_SECONDS = 30

# Database size thresholds (archive system targets <400KB)
DB_SIZE_WARNING_THRESHOLD = 400 * 1024  # 400KB - archive target exceeded
DB_SIZE_CRITICAL_THRESHOLD = 768 * 1024  # 768KB - sync performance degrades


# ---------------------------------------------------------------------------
# T930: Persistent sync failure state
# ---------------------------------------------------------------------------

def _sync_pending_path(user_id: str) -> Path:
    """Path to marker file indicating unsynced writes."""
    return USER_DATA_BASE / user_id / ".sync_pending"


def mark_sync_pending(user_id: str) -> None:
    """Write marker file indicating this user has unsynced writes."""
    path = _sync_pending_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(time.time()))


def clear_sync_pending(user_id: str) -> None:
    """Remove marker file after successful sync."""
    path = _sync_pending_path(user_id)
    path.unlink(missing_ok=True)


def has_sync_pending(user_id: str) -> bool:
    """Check if this user has unsynced writes from a previous request."""
    return _sync_pending_path(user_id).exists()

# Query timing threshold for slow query warnings (in seconds)
SLOW_QUERY_THRESHOLD = 0.1  # 100ms - warn if query takes this long

# Per-request context for write tracking.
#
# IMPORTANT: We use a mutable dict instead of a plain bool because Starlette's
# BaseHTTPMiddleware runs the route handler in a copied context (separate task).
# ContextVar changes in the handler (setting bool to True) are NOT visible to
# the outer middleware. But a mutable dict IS shared across the context copy —
# mutations to the dict object are visible to both sides.
_request_context: ContextVar[Optional[dict]] = ContextVar('request_context', default=None)
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
                f"[SLOW QUERY] db={self._connection._db_type} {duration * 1000:.0f}ms - {sql_preview}"
            )
        return self

    def executemany(self, sql: str, seq_of_parameters) -> 'TrackedCursor':
        """Execute SQL for multiple parameter sets."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE')):
            self._connection._mark_write()

        start = time.perf_counter()
        self._cursor.executemany(sql, seq_of_parameters)
        duration = time.perf_counter() - start
        if duration >= SLOW_QUERY_THRESHOLD:
            sql_preview = sql[:100].replace('\n', ' ').strip()
            if len(sql) > 100:
                sql_preview += '...'
            logger.warning(
                f"[SLOW QUERY] db={self._connection._db_type} executemany {duration * 1000:.0f}ms - {sql_preview}"
            )
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

    def __init__(self, conn: sqlite3.Connection, db_type: str = 'profile'):
        self._conn = conn
        self._has_writes = False
        self._db_type = db_type

    def _mark_write(self):
        """Mark that a write operation occurred."""
        self._has_writes = True
        # Also mark in request context for middleware to detect.
        # Uses mutable dict so the change is visible across BaseHTTPMiddleware's
        # context copy boundary (see _request_context comment above).
        # `has_writes` tracks profile-DB writes only; user-DB writes set
        # `has_user_db_writes`. The middleware routes user-only writes
        # through the user-DB-only sync path, which doesn't need profile_id.
        ctx = _request_context.get()
        if ctx is not None:
            if self._db_type == 'user':
                ctx['has_user_db_writes'] = True
            else:
                ctx['has_writes'] = True

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
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
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
        db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
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

    Creates a mutable dict that is shared across Starlette's BaseHTTPMiddleware
    context boundary, so writes in the route handler are visible to the
    middleware's post-request sync logic.
    """
    _request_context.set({'has_writes': False})
    _request_user_id.set(get_current_user_id())


def get_request_has_writes() -> bool:
    """Check if any writes occurred during this request."""
    ctx = _request_context.get()
    if ctx is None:
        return False
    return ctx.get('has_writes', False)


def clear_request_context() -> None:
    """Clear request context. Call at end of request."""
    _request_context.set(None)
    _request_user_id.set(None)


def get_user_data_path() -> Path:
    """Get the user data directory path for the current user and profile."""
    return USER_DATA_BASE / get_current_user_id() / "profiles" / get_current_profile_id()


def get_database_path() -> Path:
    """Get the database file path for the current user."""
    return get_user_data_path() / "profile.sqlite"


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

    When R2 is enabled, only create the user_data base directory (for profile.sqlite).
    Video files are stored in R2, not locally.
    """
    # Always create base user data directory (needed for profile.sqlite)
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
            # Check cooldown — don't hammer R2 on repeated transient failures
            cache_key = f"{user_id}:{profile_id}"
            last_fail = _r2_restore_cooldowns.get(cache_key)
            if last_fail and (time.time() - last_fail) < RESTORE_COOLDOWN_SECONDS:
                logger.debug(f"[Restore] Skipping R2 check for {cache_key} — cooldown active")
            else:
                local_exists = db_path.exists()
                local_size = db_path.stat().st_size if local_exists else 0
                logger.info(
                    f"[Restore] First access for user={user_id} profile={profile_id}, "
                    f"local_db={'exists' if local_exists else 'missing'} ({local_size} bytes), checking R2..."
                )
                import time as _time
                restore_start = _time.perf_counter()
                was_synced, new_version, was_error = sync_database_from_r2_if_newer(user_id, db_path, local_version)
                restore_elapsed = _time.perf_counter() - restore_start
                if was_synced:
                    new_size = db_path.stat().st_size if db_path.exists() else 0
                    logger.info(
                        f"[Restore] Downloaded database from R2 for user={user_id} profile={profile_id}: "
                        f"version={new_version}, size={new_size} bytes, took {restore_elapsed:.2f}s"
                    )
                    set_local_db_version(user_id, profile_id, new_version)
                    # Force re-initialization since we got a new DB
                    already_initialized = False
                elif was_error:
                    # Transient R2 failure — do NOT lock version to 0
                    # Will retry on next request after cooldown
                    _r2_restore_cooldowns[cache_key] = time.time()
                    logger.warning(
                        f"[Restore] R2 unreachable for {user_id}:{profile_id}, "
                        f"will retry after {RESTORE_COOLDOWN_SECONDS}s (took {restore_elapsed:.2f}s)"
                    )
                elif new_version is not None:
                    # R2 has a version but we didn't need to download (local exists)
                    logger.info(
                        f"[Restore] Local database up-to-date for user={user_id} profile={profile_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s"
                    )
                    set_local_db_version(user_id, profile_id, new_version)
                else:
                    # R2 returned NOT_FOUND — genuinely new user, lock to 0
                    logger.info(
                        f"[Restore] No R2 database found for user={user_id} profile={profile_id}, "
                        f"starting fresh (took {restore_elapsed:.2f}s)"
                    )
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
                boundaries_version INTEGER DEFAULT 1,
                boundaries_updated_at TIMESTAMP,
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
                last_opened_at TIMESTAMP,
                current_mode TEXT DEFAULT 'framing',
                archived_at TIMESTAMP DEFAULT NULL,
                restored_at TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (working_video_id) REFERENCES working_videos(id) ON DELETE SET NULL,
                FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE SET NULL
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
                raw_clip_version INTEGER,
                width INTEGER,
                height INTEGER,
                fps REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE
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
                duration REAL,
                effect_type TEXT DEFAULT 'original',
                overlay_version INTEGER DEFAULT 0,
                highlight_color TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Final videos - output from Overlay mode
        cursor.execute("""
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
                tournament_name TEXT,
                viewed_duration REAL DEFAULT 0,
                video_fps REAL,
                status TEXT DEFAULT 'ready'
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
                game_id INTEGER,
                game_name TEXT,
                acknowledged_at TIMESTAMP,
                gpu_seconds REAL,
                modal_function TEXT,
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
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_type_status
            ON export_jobs(type, status)
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

        # T540: Achievements — non-derivable quest step completion (e.g., opened_framing_editor)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS achievements (
                key TEXT PRIMARY KEY,
                achieved_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # Indexes for efficient version queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_clips_project_version
            ON working_clips(project_id, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version
            ON working_clips(project_id, raw_clip_id, version DESC)
        """)
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
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_clips_game_id
            ON raw_clips(game_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_clips_rating
            ON raw_clips(rating)
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time_seq
            ON raw_clips(game_id, end_time, video_sequence)
        """)

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
                fps REAL,
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

        # T400: Auth tables
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                email TEXT,
                google_id TEXT,
                verified_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
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

        # T900: Add missing FK CASCADE/SET NULL constraints
        # SQLite doesn't support ALTER TABLE to modify FKs, so we recreate tables.
        # foreign_keys must be OFF during table replacement to avoid issues.
        conn.execute("PRAGMA foreign_keys=OFF")

        # --- working_clips: add CASCADE on project_id and raw_clip_id ---
        row = cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()
        if row and 'ON DELETE CASCADE' not in row[0]:
            logger.info("[Migration T900] Adding FK cascades to working_clips")
            cursor.execute("""
                CREATE TABLE _working_clips_new (
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
                    raw_clip_version INTEGER,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE
                )
            """)
            old_cols = [c['name'] for c in cursor.execute("PRAGMA table_info(working_clips)").fetchall()]
            new_cols = {c['name'] for c in cursor.execute("PRAGMA table_info(_working_clips_new)").fetchall()}
            common = [c for c in old_cols if c in new_cols]
            cols_str = ', '.join(common)
            cursor.execute(f"INSERT INTO _working_clips_new ({cols_str}) SELECT {cols_str} FROM working_clips")
            cursor.execute("DROP TABLE working_clips")
            cursor.execute("ALTER TABLE _working_clips_new RENAME TO working_clips")
            # Recreate indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_version
                ON working_clips(project_id, version DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version
                ON working_clips(project_id, raw_clip_id, version DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_clips_project_upload_version
                ON working_clips(project_id, uploaded_filename, version DESC)
            """)
            logger.info("[Migration T900] working_clips FK cascades added")

        # --- working_videos: add CASCADE on project_id ---
        row = cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if row and 'ON DELETE CASCADE' not in row[0]:
            logger.info("[Migration T900] Adding FK cascade to working_videos")
            cursor.execute("""
                CREATE TABLE _working_videos_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    filename TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    highlights_data TEXT,
                    text_overlays TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    duration REAL,
                    effect_type TEXT DEFAULT 'original',
                    overlay_version INTEGER DEFAULT 0,
                    highlight_color TEXT DEFAULT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            old_cols = [c['name'] for c in cursor.execute("PRAGMA table_info(working_videos)").fetchall()]
            new_cols = {c['name'] for c in cursor.execute("PRAGMA table_info(_working_videos_new)").fetchall()}
            common = [c for c in old_cols if c in new_cols]
            cols_str = ', '.join(common)
            cursor.execute(f"INSERT INTO _working_videos_new ({cols_str}) SELECT {cols_str} FROM working_videos")
            cursor.execute("DROP TABLE working_videos")
            cursor.execute("ALTER TABLE _working_videos_new RENAME TO working_videos")
            # Recreate index
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_videos_project_version
                ON working_videos(project_id, version DESC)
            """)
            logger.info("[Migration T900] working_videos FK cascade added")

        # --- projects: add SET NULL on working_video_id and final_video_id ---
        row = cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        if row and 'ON DELETE SET NULL' not in row[0]:
            logger.info("[Migration T900] Adding FK SET NULL to projects")
            cursor.execute("""
                CREATE TABLE _projects_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    aspect_ratio TEXT NOT NULL,
                    working_video_id INTEGER,
                    final_video_id INTEGER,
                    is_auto_created INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_opened_at TIMESTAMP,
                    current_mode TEXT DEFAULT 'framing',
                    restored_at TIMESTAMP DEFAULT NULL,
                    FOREIGN KEY (working_video_id) REFERENCES working_videos(id) ON DELETE SET NULL,
                    FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE SET NULL
                )
            """)
            old_cols = [c['name'] for c in cursor.execute("PRAGMA table_info(projects)").fetchall()]
            new_cols = {c['name'] for c in cursor.execute("PRAGMA table_info(_projects_new)").fetchall()}
            common = [c for c in old_cols if c in new_cols]
            cols_str = ', '.join(common)
            cursor.execute(f"INSERT INTO _projects_new ({cols_str}) SELECT {cols_str} FROM projects")
            cursor.execute("DROP TABLE projects")
            cursor.execute("ALTER TABLE _projects_new RENAME TO projects")
            logger.info("[Migration T900] projects FK SET NULL added")

        conn.execute("PRAGMA foreign_keys=ON")

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


def sync_db_to_cloud() -> str:
    """
    Sync the current user's database to R2 storage with version tracking.

    Returns:
        "ok" if sync succeeded (or R2 not enabled)
        "conflict" if version conflict detected (T950: re-downloaded newer version)
        "failed" if sync failed (network error, etc.)
    """
    if not R2_ENABLED:
        return "ok"

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    db_path = get_database_path()

    if not db_path.exists():
        return "ok"

    check_database_size(db_path)
    current_version = get_local_db_version(user_id, profile_id)

    success, new_version = sync_database_to_r2_with_version(
        user_id, db_path, current_version, skip_version_check=True
    )

    if success and new_version is not None:
        set_local_db_version(user_id, profile_id, new_version)
        logger.debug(f"Database synced to R2 for user: {user_id}, profile: {profile_id}, version: {new_version}")
        return "ok"
    elif not success and new_version is not None:
        # T950: Conflict detected — storage.py re-downloaded newer version
        set_local_db_version(user_id, profile_id, new_version)
        logger.warning(f"Version conflict for user: {user_id}, profile: {profile_id}, updated to v{new_version}")
        return "conflict"
    elif not success:
        logger.warning(f"Failed to sync database to R2 for user: {user_id}, profile: {profile_id}")
        return "failed"

    return "ok"


def sync_db_to_cloud_if_writes() -> str:
    """
    Sync database to R2 only if writes occurred during this request.
    Called by middleware at end of request.

    Returns: "ok", "conflict", or "failed"
    """
    if not R2_ENABLED:
        return "ok"

    if get_request_has_writes():
        return sync_db_to_cloud()
    return "ok"


# ---------------------------------------------------------------------------
# Explicit R2 sync for background workers (T940)
# ---------------------------------------------------------------------------

def get_user_data_path_explicit(user_id: str, profile_id: str) -> Path:
    """Get user data path without relying on ContextVars."""
    return USER_DATA_BASE / user_id / "profiles" / profile_id


def sync_db_to_r2_explicit(user_id: str, profile_id: str) -> bool:
    """
    Sync the profile database to R2 without relying on ContextVars.

    Designed for background workers (e.g. export_worker) that run outside
    the request-response lifecycle where ContextVars are no longer valid.

    Returns True on success (or if R2 is disabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    db_path = get_user_data_path_explicit(user_id, profile_id) / "profile.sqlite"
    if not db_path.exists():
        return True

    check_database_size(db_path)
    current_version = get_local_db_version(user_id, profile_id)

    success, new_version = sync_database_to_r2_with_version(
        user_id, db_path, current_version, skip_version_check=True,
    )

    if success and new_version is not None:
        set_local_db_version(user_id, profile_id, new_version)
        logger.debug(f"[ExportWorker] Database synced to R2: user={user_id}, profile={profile_id}, v={new_version}")
        return True
    else:
        logger.warning(f"[ExportWorker] Failed to sync database to R2: user={user_id}, profile={profile_id}")
        return False


def sync_user_db_to_r2_explicit(user_id: str) -> bool:
    """
    Sync user.sqlite to R2 without relying on ContextVars.

    Designed for background workers that may modify user.sqlite (e.g. credit refunds).

    Returns True on success (or if R2 is disabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    db_path = USER_DATA_BASE / user_id / "user.sqlite"
    if not db_path.exists():
        return True

    from .storage import sync_user_db_to_r2_with_version

    local_version = get_local_user_db_version(user_id)
    success, new_version = sync_user_db_to_r2_with_version(
        user_id, db_path, local_version, skip_version_check=True,
    )

    if success and new_version is not None:
        set_local_user_db_version(user_id, new_version)
        logger.debug(f"[ExportWorker] user.sqlite synced to R2: user={user_id}, v={new_version}")
        return True
    else:
        logger.warning(f"[ExportWorker] Failed to sync user.sqlite to R2: user={user_id}")
        return False


# ---------------------------------------------------------------------------
# User.sqlite version tracking and sync (T920)
# ---------------------------------------------------------------------------

_user_sqlite_versions: dict = {}  # user_id -> version number
_user_sqlite_version_lock = threading.Lock()


def get_local_user_db_version(user_id: str) -> Optional[int]:
    """Get locally cached version for a user's user.sqlite."""
    with _user_sqlite_version_lock:
        return _user_sqlite_versions.get(user_id)


def set_local_user_db_version(user_id: str, version: Optional[int]) -> None:
    """Set locally cached version for a user's user.sqlite."""
    with _user_sqlite_version_lock:
        if version is None:
            _user_sqlite_versions.pop(user_id, None)
        else:
            _user_sqlite_versions[user_id] = version


def get_request_has_user_db_writes() -> bool:
    """Check if any user.sqlite writes occurred during this request."""
    ctx = _request_context.get()
    if ctx is None:
        return False
    return ctx.get('has_user_db_writes', False)


def sync_user_db_to_cloud_if_writes() -> bool:
    """Sync user.sqlite to R2 if writes occurred during this request.

    Called by middleware after syncing the profile DB.
    Returns True if sync succeeded (or no writes/R2 disabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    if not get_request_has_user_db_writes():
        return True

    user_id = _request_user_id.get()
    if not user_id:
        return True

    db_path = USER_DATA_BASE / user_id / "user.sqlite"
    if not db_path.exists():
        return True

    from .storage import sync_user_db_to_r2_with_version

    local_version = get_local_user_db_version(user_id)
    success, new_version = sync_user_db_to_r2_with_version(
        user_id, db_path, local_version, skip_version_check=True
    )
    if success and new_version is not None:
        set_local_user_db_version(user_id, new_version)
        logger.debug(f"user.sqlite synced to R2 for user: {user_id}, version: {new_version}")
        return True
    elif not success:
        logger.warning(f"Failed to sync user.sqlite to R2 for user: {user_id}")
        return False

    return True


# Note: sync_db_to_r2_explicit and sync_user_db_to_r2_explicit defined above (~line 1385)
