#!/usr/bin/env python3
"""
Migration T2847: Backfill clip_teammates junction table from raw_clips.tagged_teammates.

Reads all raw_clips with tagged_teammates (msgpack BLOB) and inserts
(clip_id, tag_name) rows into clip_teammates for indexed lookups.

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrations/T2847_backfill_clip_teammates.py <email> --env <dev|staging|prod>

For dev (default): operates on the local profile.sqlite directly.
For staging/prod: downloads from R2, migrates, re-uploads.
"""

import sys
import os
import sqlite3
import argparse
from pathlib import Path

# Add backend to path
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")


def backfill_clip_teammates(db_path: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check if clip_teammates table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_teammates'")
    if not cursor.fetchone():
        print(f"  clip_teammates table does not exist in {db_path}, skipping")
        conn.close()
        return 0

    # Check current count
    cursor.execute("SELECT COUNT(*) as cnt FROM clip_teammates")
    existing = cursor.fetchone()["cnt"]
    if existing > 0:
        print(f"  clip_teammates already has {existing} rows, skipping")
        conn.close()
        return 0

    from app.utils.encoding import decode_data

    cursor.execute("SELECT id, tagged_teammates FROM raw_clips WHERE tagged_teammates IS NOT NULL")
    rows = cursor.fetchall()

    backfilled = 0
    for row in rows:
        teammates = decode_data(row["tagged_teammates"])
        if teammates:
            for tag in teammates:
                cursor.execute(
                    "INSERT OR IGNORE INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)",
                    (row["id"], tag),
                )
                backfilled += 1

    if dry_run:
        print(f"  [DRY RUN] Would backfill {backfilled} clip_teammates rows from {len(rows)} clips")
        conn.rollback()
    else:
        conn.commit()
        print(f"  Backfilled {backfilled} clip_teammates rows from {len(rows)} clips")

    conn.close()
    return backfilled


def find_local_db(email: str) -> Path:
    """Find the local profile.sqlite for a user by email."""
    from app.services.pg import get_pg
    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        if not row:
            print(f"Error: user {email} not found in Postgres")
            sys.exit(1)
        user_id = row["id"]

        cur.execute("SELECT id FROM profiles WHERE user_id = %s ORDER BY created_at LIMIT 1", (user_id,))
        profile_row = cur.fetchone()
        if not profile_row:
            print(f"Error: no profile found for user {user_id}")
            sys.exit(1)
        profile_id = profile_row["id"]

    base = Path(__file__).resolve().parent.parent.parent / "user_data"
    db_path = base / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        print(f"Error: database not found at {db_path}")
        sys.exit(1)

    return db_path


def main():
    parser = argparse.ArgumentParser(description="T2847: Backfill clip_teammates junction table")
    parser.add_argument("email", help="User email to migrate")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="dev")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    print(f"T2847 Migration: backfill clip_teammates for {args.email} ({args.env})")

    if args.env == "dev":
        db_path = find_local_db(args.email)
        print(f"  Local DB: {db_path}")
        backfill_clip_teammates(str(db_path), dry_run=args.dry_run)
    else:
        print(f"  Remote migration for {args.env} not yet implemented.")
        print(f"  Use reset-test-user.py to download DB, run this on the local copy, then re-upload.")
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
