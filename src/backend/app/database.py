"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/a/database.sqlite.
Tables are created automatically on first access or when missing.

The database and directories are auto-created on demand, so deleting
the user_data/a folder will simply reset the app to a clean state.
"""

import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Base path for user data
USER_DATA_BASE = Path(__file__).parent.parent.parent.parent / "user_data"
USER_ID = "a"  # Single user for now
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
                progress INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                abandoned BOOLEAN DEFAULT FALSE,
                crop_data TEXT,
                timing_data TEXT,
                segments_data TEXT,
                transform_data TEXT,
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
                abandoned BOOLEAN DEFAULT FALSE,
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
                abandoned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        """)

        # Games - store annotated game footage for later project creation
        # video_filename is NULL until video is uploaded (allows instant game creation)
        # annotations_filename points to a TSV file in the games folder
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                video_filename TEXT,
                annotations_filename TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        ]

        for migration in migrations:
            try:
                cursor.execute(migration)
            except sqlite3.OperationalError:
                # Column already exists, ignore
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
