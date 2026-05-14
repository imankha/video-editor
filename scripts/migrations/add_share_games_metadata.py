#!/usr/bin/env python3
"""
Migration: Add and backfill share metadata columns in Postgres share_games.

Step 1 (DDL): Adds game_name, game_blake3, first_clip_start, clip_names columns.
Step 2 (Backfill): For rows with NULL game_name, downloads the sharer's SQLite
from R2, reads the game/clip metadata, and UPDATEs the share_games row.

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrations/add_share_games_metadata.py --env <dev|staging|prod>

Requires fly proxy running for staging/prod:
    fly proxy 15432:5432 --app reel-ballers-db-staging
    fly proxy 15433:5432 --app reel-ballers-db
"""

import sys
import os
import json
import sqlite3
import argparse
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv


def get_env_file(env: str) -> Path:
    root = BACKEND_DIR.parent.parent
    if env == "dev":
        return root / ".env"
    return root / f".env.{env}"


def add_columns(cur):
    """DDL: add metadata columns if they don't exist."""
    for col, col_type in [
        ("game_name", "TEXT"),
        ("game_blake3", "TEXT"),
        ("first_clip_start", "REAL"),
        ("clip_names", "JSONB"),
    ]:
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'share_games' AND column_name = %s",
            (col,),
        )
        if not cur.fetchone():
            cur.execute(f"ALTER TABLE share_games ADD COLUMN {col} {col_type}")
            print(f"  Added share_games.{col}")
        else:
            print(f"  share_games.{col} already exists")


def download_sharer_db(r2_client, bucket, app_env, user_id, profile_id) -> Path | None:
    """Download a sharer's profile.sqlite from R2 to a temp file."""
    r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
    tmp = Path(tempfile.mkdtemp()) / "profile.sqlite"
    try:
        r2_client.download_file(bucket, r2_key, str(tmp))
        return tmp
    except Exception as e:
        print(f"  WARNING: Could not download {r2_key}: {e}")
        return None


def read_metadata_from_sqlite(db_path: Path, game_id: int, tag_name: str) -> dict:
    """Read game name, blake3, first_clip_start, clip_names from a sharer's SQLite."""
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    result = {
        "game_name": None,
        "game_blake3": None,
        "first_clip_start": None,
        "clip_names": None,
    }
    try:
        cur = conn.cursor()

        cur.execute("SELECT name, blake3_hash FROM games WHERE id = ?", (game_id,))
        game_row = cur.fetchone()
        if game_row:
            result["game_name"] = game_row["name"]
            result["game_blake3"] = game_row["blake3_hash"]

        if not result["game_blake3"]:
            cur.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv = cur.fetchone()
            if gv:
                result["game_blake3"] = gv["blake3_hash"]

        # Check if clip_teammates table exists (T2847 migration may not have run)
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_teammates'")
        if cur.fetchone():
            cur.execute(
                """SELECT rc.name, rc.start_time
                   FROM raw_clips rc
                   JOIN clip_teammates ct ON ct.clip_id = rc.id
                   WHERE rc.game_id = ? AND ct.tag_name = ?
                   ORDER BY rc.start_time""",
                (game_id, tag_name),
            )
            clips = cur.fetchall()
            if clips:
                result["first_clip_start"] = clips[0]["start_time"]
                result["clip_names"] = [c["name"] or "Untitled Clip" for c in clips]
        else:
            print(f"    clip_teammates table missing, skipping clip metadata")

    finally:
        conn.close()
    return result


def backfill(cur, r2_client, bucket, app_env):
    """Backfill NULL metadata rows by reading sharer SQLite from R2."""
    cur.execute(
        """SELECT sg.share_id, sg.game_id, sg.tag_name,
                  s.sharer_user_id, s.sharer_profile_id
           FROM share_games sg
           JOIN shares s ON s.id = sg.share_id
           WHERE sg.game_name IS NULL"""
    )
    rows = cur.fetchall()
    if not rows:
        print("  No rows need backfill")
        return

    print(f"  {len(rows)} rows need backfill")

    # Cache downloaded DBs by (user_id, profile_id) to avoid re-downloading
    db_cache: dict[tuple[str, str], Path | None] = {}

    for row in rows:
        key = (row["sharer_user_id"], row["sharer_profile_id"])
        if key not in db_cache:
            db_cache[key] = download_sharer_db(
                r2_client, bucket, app_env,
                row["sharer_user_id"], row["sharer_profile_id"],
            )

        db_path = db_cache[key]
        if not db_path:
            print(f"  SKIP share_id={row['share_id']}: sharer DB not available")
            continue

        meta = read_metadata_from_sqlite(db_path, row["game_id"], row["tag_name"])
        cur.execute(
            """UPDATE share_games
               SET game_name = %s, game_blake3 = %s,
                   first_clip_start = %s, clip_names = %s
               WHERE share_id = %s""",
            (
                meta["game_name"],
                meta["game_blake3"],
                meta["first_clip_start"],
                json.dumps(meta["clip_names"]) if meta["clip_names"] else None,
                row["share_id"],
            ),
        )
        print(
            f"  Backfilled share_id={row['share_id']}: "
            f"game={meta['game_name']}, blake3={meta['game_blake3'][:8] + '...' if meta['game_blake3'] else None}, "
            f"first_clip={meta['first_clip_start']}, clips={len(meta['clip_names'] or [])}"
        )

    # Clean up temp files
    for path in db_cache.values():
        if path and path.exists():
            path.unlink()
            path.parent.rmdir()


def main():
    parser = argparse.ArgumentParser(description="Add and backfill share_games metadata columns")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="dev")
    parser.add_argument("--ddl-only", action="store_true", help="Only add columns, skip backfill")
    args = parser.parse_args()

    env_file = get_env_file(args.env)
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)
    load_dotenv(env_file, override=True)

    import psycopg2
    from psycopg2.extras import RealDictCursor

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    print(f"Connecting to {args.env} Postgres...")
    conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    cur = conn.cursor()

    print("Step 1: DDL -- adding columns")
    add_columns(cur)
    conn.commit()

    if args.ddl_only:
        print("DDL-only mode, skipping backfill")
        conn.close()
        return

    print("Step 2: Backfill -- reading sharer SQLite from R2")
    from app.storage import get_r2_client, R2_BUCKET
    r2_client = get_r2_client()
    if not r2_client:
        print("WARNING: R2 client not available, skipping backfill")
        conn.close()
        return

    app_env = os.environ.get("APP_ENV", "dev")
    backfill(cur, r2_client, R2_BUCKET, app_env)
    conn.commit()

    print("\nVerify: recent share_games rows")
    cur.execute(
        "SELECT share_id, game_name, game_blake3, first_clip_start, clip_names "
        "FROM share_games ORDER BY share_id DESC LIMIT 5"
    )
    for row in cur.fetchall():
        print(f"  {dict(row)}")

    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
