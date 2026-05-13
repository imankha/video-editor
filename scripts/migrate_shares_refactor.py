"""
Production migration: shared_videos -> shares + share_videos + share_games.

Normalizes the single shared_videos table into a base table (shares) with
type-specific extension tables (share_videos, share_games). Migrates all
existing data. Safe to run multiple times (skips if shares table exists).

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_shares_refactor.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_shares_refactor.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_shares_refactor.py --env prod --dry-run
"""

import argparse
import logging
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate_shares")


def load_env(env_name: str) -> str:
    from dotenv import load_dotenv
    import os

    suffix = {"dev": "", "staging": ".staging", "prod": ".prod"}[env_name]
    env_file = PROJECT_ROOT / (f".env{suffix}" if suffix else ".env")
    if not env_file.exists():
        log.error(f"{env_file} not found")
        sys.exit(1)
    load_dotenv(env_file, override=True)
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        log.error("DATABASE_URL not set")
        sys.exit(1)
    return dsn


def has_table(conn, table_name: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
        (table_name,),
    )
    return cur.fetchone()["exists"]


def migrate(conn, dry_run: bool):
    cur = conn.cursor()

    if has_table(conn, "shares"):
        log.info("shares table already exists -- skipping migration")
        return

    if not has_table(conn, "shared_videos"):
        log.error("shared_videos table not found -- nothing to migrate")
        return

    cur.execute("SELECT COUNT(*) as cnt FROM shared_videos")
    row_count = cur.fetchone()["cnt"]
    log.info(f"Found {row_count} rows in shared_videos to migrate")

    if dry_run:
        log.info("[DRY RUN] Would create shares, share_videos, share_games tables")
        log.info(f"[DRY RUN] Would migrate {row_count} rows")
        log.info("[DRY RUN] Would drop shared_videos")
        return

    log.info("Creating shares table...")
    cur.execute("""
        CREATE TABLE shares (
            id SERIAL PRIMARY KEY,
            share_token TEXT UNIQUE NOT NULL,
            share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game')),
            sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
            sharer_profile_id TEXT NOT NULL,
            recipient_email TEXT NOT NULL,
            shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            revoked_at TIMESTAMPTZ,
            watched_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX idx_shares_token ON shares(share_token)")
    cur.execute("CREATE INDEX idx_shares_sharer ON shares(sharer_user_id)")
    cur.execute("CREATE INDEX idx_shares_recipient ON shares(recipient_email)")

    log.info("Creating share_videos table...")
    cur.execute("""
        CREATE TABLE share_videos (
            share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
            video_id INTEGER NOT NULL,
            video_filename TEXT NOT NULL,
            video_name TEXT,
            video_duration REAL,
            is_public BOOLEAN NOT NULL DEFAULT false
        )
    """)
    cur.execute("CREATE INDEX idx_share_videos_video ON share_videos(video_id)")

    log.info("Creating share_games table...")
    cur.execute("""
        CREATE TABLE share_games (
            share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
            game_id INTEGER NOT NULL,
            tag_name TEXT NOT NULL,
            recipient_profile_id TEXT,
            materialized_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX idx_share_games_game ON share_games(game_id)")
    cur.execute("CREATE INDEX idx_share_games_recipient_profile ON share_games(recipient_profile_id)")

    log.info(f"Migrating {row_count} rows from shared_videos...")
    cur.execute("""
        INSERT INTO shares (id, share_token, share_type, sharer_user_id, sharer_profile_id,
                            recipient_email, shared_at, revoked_at, watched_at)
        SELECT id, share_token, 'video', sharer_user_id, sharer_profile_id,
               recipient_email, shared_at, revoked_at, watched_at
        FROM shared_videos
    """)
    log.info(f"  Inserted {cur.rowcount} rows into shares")

    cur.execute("""
        INSERT INTO share_videos (share_id, video_id, video_filename, video_name, video_duration, is_public)
        SELECT id, video_id, video_filename, video_name, video_duration, is_public
        FROM shared_videos
    """)
    log.info(f"  Inserted {cur.rowcount} rows into share_videos")

    cur.execute("SELECT setval('shares_id_seq', (SELECT COALESCE(MAX(id), 0) FROM shares))")
    log.info("  Synced shares_id_seq")

    cur.execute("DROP TABLE shared_videos")
    log.info("  Dropped shared_videos")

    conn.commit()
    log.info("Migration complete")


def main():
    p = argparse.ArgumentParser(description="Migrate shared_videos to normalized shares tables")
    p.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    dsn = load_env(args.env)
    log.info(f"Connecting to {args.env} Postgres...")
    conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    conn.autocommit = False

    try:
        migrate(conn, args.dry_run)
    except Exception:
        conn.rollback()
        log.exception("Migration failed -- rolled back")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
