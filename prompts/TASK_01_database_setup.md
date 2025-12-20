# Task 01: Database Setup and Initialization

## Context

**Project:** Browser-based video editor for soccer highlights with Annotate, Framing, and Overlay modes.

**Tech Stack:**
- Backend: FastAPI + Python (port 8000)
- Database: SQLite (being added in this task)

**Current State:** No persistence - videos exist only in browser memory.

**Backend Structure:**
```
src/backend/app/
├── main.py              # FastAPI app entry, router registration
├── models.py            # Pydantic models
├── routers/
│   ├── __init__.py      # Exports all routers
│   ├── health.py        # Health check endpoint
│   ├── export.py        # Video export
│   ├── annotate.py      # Clip extraction
│   └── detection.py     # YOLO detection
└── websocket.py
```

**Target File Storage:**
```
user_data/
└── a/                        # Single user folder
    ├── database.sqlite       # SQLite database
    ├── raw_clips/            # From Annotate export
    ├── uploads/              # Direct uploads to projects
    ├── working_videos/       # From Framing export
    └── final_videos/         # From Overlay export
```

---

## Objective

Create the SQLite database layer with automatic initialization on backend startup.

## Files to Create

### 1. `src/backend/app/database.py`

Create database connection management and table initialization:

```python
"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/a/database.sqlite.
Tables are created automatically on first startup.
"""

import sqlite3
import os
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


def get_user_data_path() -> Path:
    """Get the user data directory path."""
    return USER_DATA_PATH


def get_database_path() -> Path:
    """Get the database file path."""
    return DATABASE_PATH


@contextmanager
def get_db_connection():
    """
    Context manager for database connections.
    Ensures connections are properly closed after use.
    """
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    try:
        yield conn
    finally:
        conn.close()


def init_database():
    """
    Initialize the database and create all required directories.
    Called on application startup.
    """
    logger.info("Initializing database...")

    # Create directories
    for directory in [USER_DATA_PATH, RAW_CLIPS_PATH, UPLOADS_PATH,
                      WORKING_VIDEOS_PATH, FINAL_VIDEOS_PATH]:
        directory.mkdir(parents=True, exist_ok=True)
        logger.info(f"Ensured directory exists: {directory}")

    # Create tables
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Raw clips - extracted from Annotate mode (4+ star only)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw_clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                rating INTEGER NOT NULL,
                tags TEXT,
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

        conn.commit()
        logger.info("Database tables created/verified successfully")


def is_database_initialized() -> bool:
    """Check if the database file exists and has tables."""
    if not DATABASE_PATH.exists():
        return False

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = {row['name'] for row in cursor.fetchall()}
            required = {'raw_clips', 'projects', 'working_clips',
                       'working_videos', 'final_videos'}
            return required.issubset(tables)
    except Exception:
        return False
```

### 2. Update `src/backend/app/main.py`

Add database initialization on startup:

```python
# Add import at top
from app.database import init_database, is_database_initialized

# Add to startup_event function (after existing logging):
@app.on_event("startup")
async def startup_event():
    # ... existing logging code ...

    # Initialize database
    try:
        init_database()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise
```

### 3. Update `src/backend/app/routers/health.py`

Add database status to health check:

```python
# Add import
from app.database import is_database_initialized, get_database_path, get_user_data_path

# Update the health check endpoint to include db status
@router.get("")
async def health_check():
    return {
        "status": "healthy",
        "db_initialized": is_database_initialized(),
        "db_path": str(get_database_path()),
        "user_data_path": str(get_user_data_path())
    }
```

## Files to Modify

1. `src/backend/app/main.py` - Add database init on startup
2. `src/backend/app/routers/health.py` - Add db status to health check

## Testing Steps

### 1. Preparation
```bash
# Make sure no existing user_data folder
rm -rf user_data/

# Start the backend
cd src/backend
python -m uvicorn app.main:app --reload --port 8000
```

### 2. Verify Directory Creation
Check that these directories were created:
- `user_data/a/`
- `user_data/a/raw_clips/`
- `user_data/a/uploads/`
- `user_data/a/working_videos/`
- `user_data/a/final_videos/`
- `user_data/a/database.sqlite` (file)

### 3. Verify Database Tables
```bash
# Open the database
sqlite3 user_data/a/database.sqlite

# List tables
.tables

# Should show:
# final_videos  projects      raw_clips     working_clips  working_videos

# Check schema
.schema projects

# Exit
.quit
```

### 4. Verify Health Endpoint
```bash
curl http://localhost:8000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "db_initialized": true,
  "db_path": "...\\user_data\\a\\database.sqlite",
  "user_data_path": "...\\user_data\\a"
}
```

### 5. Verify Restart Idempotency
1. Stop the backend (Ctrl+C)
2. Start it again
3. Verify no errors about tables already existing
4. Health check still returns `db_initialized: true`

## Success Criteria

- [ ] Backend starts without errors
- [ ] `user_data/a/` directory structure created
- [ ] `database.sqlite` file created with all 5 tables
- [ ] Health endpoint returns `db_initialized: true`
- [ ] Restarting backend doesn't cause errors (idempotent)
