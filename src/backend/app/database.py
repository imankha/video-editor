"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/a/database.sqlite.
Tables are created automatically on first access or when missing.

The database and directories are auto-created on demand, so deleting
the user_data/a folder will simply reset the app to a clean state.

Test Isolation:
Set the TEST_USER_ID environment variable to use a different user namespace.
This prevents test data from polluting the manual testing database.
Example: TEST_USER_ID=test_abc123 uvicorn app.main:app --port 8000
"""

import os
import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager

from .constants import DEFAULT_USER_ID

logger = logging.getLogger(__name__)

# Base path for user data
USER_DATA_BASE = Path(__file__).parent.parent.parent.parent / "user_data"

# Use TEST_USER_ID env var if set, otherwise use default
# This allows E2E tests to use isolated user namespaces
TEST_USER_ID = os.environ.get("TEST_USER_ID")
USER_ID = TEST_USER_ID if TEST_USER_ID else DEFAULT_USER_ID

if TEST_USER_ID:
    logger.info(f"Using test user namespace: {TEST_USER_ID}")

USER_DATA_PATH = USER_DATA_BASE / USER_ID
DATABASE_PATH = USER_DATA_PATH / "database.sqlite"

# Subdirectories for video storage
RAW_CLIPS_PATH = USER_DATA_PATH / "raw_clips"
UPLOADS_PATH = USER_DATA_PATH / "uploads"
WORKING_VIDEOS_PATH = USER_DATA_PATH / "working_videos"
FINAL_VIDEOS_PATH = USER_DATA_PATH / "final_videos"
DOWNLOADS_PATH = USER_DATA_PATH / "downloads"  # Temporary export downloads
GAMES_PATH = USER_DATA_PATH / "games"  # Game source videos
CLIP_CACHE_PATH = USER_DATA_PATH / "clip_cache"  # Cached burned-in clips for reuse

# Track if we've already initialized this session
_initialized = False


def get_user_data_path() -> Path:
    """Get the user data directory path."""
    return USER_DATA_PATH


def get_database_path() -> Path:
    """Get the database file path."""
    return DATABASE_PATH


def ensure_directories():
    """
    Ensure all required directories exist.
    Called automatically before database access.
    """
    for directory in [USER_DATA_PATH, RAW_CLIPS_PATH, UPLOADS_PATH,
                      WORKING_VIDEOS_PATH, FINAL_VIDEOS_PATH, DOWNLOADS_PATH, GAMES_PATH, CLIP_CACHE_PATH]:
        directory.mkdir(parents=True, exist_ok=True)


def ensure_database():
    """
    Ensure database exists with all required tables.
    Called automatically before each database access.
    This makes the app resilient to the user_data folder being deleted.
    """
    global _initialized

    # Quick path: if already initialized and DB exists, skip
    if _initialized and DATABASE_PATH.exists():
        return

    # Ensure directories exist
    ensure_directories()

    # Create/verify tables
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Raw clips - extracted from Annotate mode (4+ star only)
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        # Annotations are stored in the annotations table (linked by game_id)
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

        # Annotations - individual marked regions in game footage
        # Replaces TSV file storage for better queryability and performance
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                name TEXT DEFAULT '',
                rating INTEGER DEFAULT 3 CHECK (rating >= 1 AND rating <= 5),
                tags TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
            )
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
            "ALTER TABLE working_clips ADD COLUMN transform_data TEXT",
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
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_working_videos_project_version
                ON working_videos(project_id, version DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_final_videos_project_version
                ON final_videos(project_id, version DESC)
            """)
            # Indexes for annotations table
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_annotations_game_id
                ON annotations(game_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_annotations_rating
                ON annotations(rating)
            """)
        except sqlite3.OperationalError:
            # Index already exists, ignore
            pass

        conn.commit()
        _initialized = True
        logger.debug("Database verified/initialized")

    finally:
        conn.close()


@contextmanager
def get_db_connection():
    """
    Context manager for database connections.
    Ensures database exists and connections are properly closed after use.

    Auto-creates the database and directories if they don't exist,
    making the app resilient to the user_data folder being deleted.
    """
    # Ensure database exists before connecting
    ensure_database()

    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    try:
        yield conn
    finally:
        conn.close()


def init_database():
    """
    Initialize the database and create all required directories.
    Called on application startup for logging purposes.
    Also called automatically by get_db_connection() if needed.
    """
    global _initialized

    logger.info("Initializing database...")

    # Ensure directories exist
    ensure_directories()
    for directory in [USER_DATA_PATH, RAW_CLIPS_PATH, UPLOADS_PATH,
                      WORKING_VIDEOS_PATH, FINAL_VIDEOS_PATH, DOWNLOADS_PATH, GAMES_PATH, CLIP_CACHE_PATH]:
        logger.info(f"Ensured directory exists: {directory}")

    # Ensure database tables exist
    ensure_database()
    logger.info("Database tables created/verified successfully")


def is_database_initialized() -> bool:
    """Check if the database file exists and has tables."""
    if not DATABASE_PATH.exists():
        return False

    try:
        conn = sqlite3.connect(str(DATABASE_PATH))
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
    Reset the initialization flag. Useful for testing or when
    the database has been manually deleted.
    """
    global _initialized
    _initialized = False
