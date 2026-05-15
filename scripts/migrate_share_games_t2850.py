"""
Migration: share_games schema for T2850 (Share Game).

Adds missing columns (game_name, game_blake3, first_clip_start, clip_names)
and drops NOT NULL constraint on tag_name in share_games and
pending_teammate_shares (game-only shares use tag_name=NULL).

Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS and checks
constraint before dropping).

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_share_games_t2850.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_share_games_t2850.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_share_games_t2850.py --env prod --dry-run
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
log = logging.getLogger("migrate_share_games_t2850")


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


def is_nullable(conn, table: str, column: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        """SELECT is_nullable FROM information_schema.columns
           WHERE table_name = %s AND column_name = %s""",
        (table, column),
    )
    row = cur.fetchone()
    return row and row["is_nullable"] == "YES"


def migrate(conn, dry_run: bool):
    cur = conn.cursor()

    add_columns = [
        ("share_games", "game_name", "TEXT"),
        ("share_games", "game_blake3", "TEXT"),
        ("share_games", "first_clip_start", "REAL"),
        ("share_games", "clip_names", "JSONB"),
    ]
    for table, col, col_type in add_columns:
        sql = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_type}"
        log.info(f"{'[DRY] ' if dry_run else ''}{sql}")
        if not dry_run:
            cur.execute(sql)

    drop_not_null = [
        ("share_games", "tag_name"),
        ("pending_teammate_shares", "tag_name"),
    ]
    for table, col in drop_not_null:
        if is_nullable(conn, table, col):
            log.info(f"SKIP: {table}.{col} already nullable")
        else:
            sql = f"ALTER TABLE {table} ALTER COLUMN {col} DROP NOT NULL"
            log.info(f"{'[DRY] ' if dry_run else ''}{sql}")
            if not dry_run:
                cur.execute(sql)

    if not dry_run:
        conn.commit()
        log.info("Migration committed")
    else:
        conn.rollback()
        log.info("Dry run complete (no changes)")


def main():
    parser = argparse.ArgumentParser(description="T2850 share_games schema migration")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dsn = load_env(args.env)
    log.info(f"Connecting to {args.env} Postgres...")

    conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    try:
        migrate(conn, args.dry_run)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
