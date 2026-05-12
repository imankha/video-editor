#!/usr/bin/env python3
"""
Reset ALL user accounts across local and R2 environments.
Leaves games data intact.

Deletes:
  1. All rows from users, sessions in Postgres
  2. All local user_data/ folders
  3. All R2 objects under {env}/users/ for dev, staging

Does NOT delete:
  - {env}/games/ (shared game videos)
  - Postgres tables themselves (just empties them)

Usage:
    cd src/backend
    .venv/Scripts/python.exe scripts/reset_all_accounts.py --dry-run
    .venv/Scripts/python.exe scripts/reset_all_accounts.py
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

from app.storage import get_r2_client, R2_BUCKET, R2_ENABLED

ALL_ENVS = ["dev", "staging"]


def get_pg_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)


def clear_postgres(dry_run: bool) -> None:
    conn = get_pg_conn()
    cur = conn.cursor()
    for table in ["sessions", "game_storage_refs", "r2_grace_deletions", "shared_videos", "users"]:
        cur.execute(f"SELECT COUNT(*) as cnt FROM {table}")
        count = cur.fetchone()["cnt"]
        print(f"  {table}: {count} rows")
        if not dry_run and count:
            cur.execute(f"DELETE FROM {table}")

    if not dry_run:
        conn.commit()
        print("  Cleared all tables")
    conn.close()


def delete_local_folders(dry_run: bool) -> None:
    user_data = Path(__file__).parent.parent.parent.parent / "user_data"
    if not user_data.exists():
        print("  No user_data directory found")
        return

    deleted = 0
    skipped = 0

    for item in sorted(user_data.iterdir()):
        if not item.is_dir():
            skipped += 1
            continue
        if not dry_run:
            shutil.rmtree(item)
        deleted += 1

    action = "would delete" if dry_run else "deleted"
    print(f"  {action} {deleted} folders, skipped {skipped}")


def delete_r2_users(dry_run: bool) -> None:
    if not R2_ENABLED:
        print("  R2 not enabled, skipping")
        return

    client = get_r2_client()
    if not client:
        print("  R2 client not available, skipping")
        return

    for env in ALL_ENVS:
        prefix = f"{env}/users/"
        total_deleted = 0

        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
            objects = page.get("Contents", [])
            if not objects:
                continue

            keys = [{"Key": obj["Key"]} for obj in objects]
            total_deleted += len(keys)

            if not dry_run:
                for i in range(0, len(keys), 1000):
                    batch = keys[i:i + 1000]
                    client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": batch})

        action = "would delete" if dry_run else "deleted"
        if total_deleted:
            print(f"  [{env}]: {action} {total_deleted} objects")
        else:
            print(f"  [{env}]: no objects")


def main():
    parser = argparse.ArgumentParser(description="Reset ALL user accounts (keeps games)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making changes")
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN ===\n")

    if not args.dry_run:
        confirm = input("Delete ALL accounts (local + R2 dev/staging)? Type 'yes': ")
        if confirm != "yes":
            print("Aborted")
            sys.exit(0)
        print()

    print("[1/3] Postgres database:")
    clear_postgres(args.dry_run)
    print()

    print("[2/3] Local user folders:")
    delete_local_folders(args.dry_run)
    print()

    print("[3/3] R2 user data (all environments):")
    delete_r2_users(args.dry_run)
    print()

    print("Done!" if not args.dry_run else "Dry run complete. Re-run without --dry-run to execute.")


if __name__ == "__main__":
    main()
