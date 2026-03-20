#!/usr/bin/env python3
"""
Reset ALL user accounts across local and R2 environments.
Leaves games data and user "a" local folder intact.

Deletes:
  1. All rows from users, sessions, credit_transactions in auth.sqlite
  2. All local user_data/{uuid}/ folders (preserves user "a" and auth.sqlite)
  3. All R2 objects under {env}/users/ for dev, staging, prod
  4. Syncs cleaned auth.sqlite to R2

Does NOT delete:
  - user_data/a/ (developer test account)
  - {env}/games/ (shared game videos)
  - auth.sqlite file itself (just empties the tables)

Usage:
    cd src/backend
    .venv/Scripts/python.exe scripts/reset_all_accounts.py --dry-run
    .venv/Scripts/python.exe scripts/reset_all_accounts.py
"""

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

from app.services.auth_db import AUTH_DB_PATH, sync_auth_db_to_r2
from app.storage import get_r2_client, R2_BUCKET, R2_ENABLED

ALL_ENVS = ["dev", "staging"]
PROTECTED_LOCAL = {"auth.sqlite"}


def clear_auth_db(dry_run: bool) -> None:
    """Delete all rows from users, sessions, credit_transactions."""
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    for table in ["credit_transactions", "sessions", "users"]:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count} rows")
        if not dry_run and count:
            conn.execute(f"DELETE FROM {table}")

    if not dry_run:
        conn.commit()
        print("  Cleared all tables")
    conn.close()


def delete_local_folders(dry_run: bool) -> None:
    """Delete all user_data/ subfolders except protected ones."""
    user_data = Path(__file__).parent.parent.parent.parent / "user_data"
    deleted = 0
    skipped = 0

    for item in sorted(user_data.iterdir()):
        if item.name in PROTECTED_LOCAL:
            skipped += 1
            continue
        if not item.is_dir():
            skipped += 1
            continue

        if not dry_run:
            shutil.rmtree(item)
        deleted += 1

    action = "would delete" if dry_run else "deleted"
    print(f"  {action} {deleted} folders, skipped {skipped} (protected)")


def delete_r2_users(dry_run: bool) -> None:
    """Delete all R2 objects under {env}/users/ for all environments."""
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
                # R2/S3 batch delete: max 1000 per request
                for i in range(0, len(keys), 1000):
                    batch = keys[i:i + 1000]
                    client.delete_objects(
                        Bucket=R2_BUCKET,
                        Delete={"Objects": batch},
                    )

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
        confirm = input("Delete ALL accounts (local + R2 dev/staging/prod)? Type 'yes': ")
        if confirm != "yes":
            print("Aborted")
            sys.exit(0)
        print()

    print("[1/4] Auth database:")
    clear_auth_db(args.dry_run)
    print()

    print("[2/4] Local user folders:")
    delete_local_folders(args.dry_run)
    print()

    print("[3/4] R2 user data (all environments):")
    delete_r2_users(args.dry_run)
    print()

    print("[4/4] Sync auth.sqlite to R2:")
    if not args.dry_run:
        if sync_auth_db_to_r2():
            print("  Synced")
        else:
            print("  Failed or R2 not enabled")
    else:
        print("  (skipped)")

    print()
    print("Done!" if not args.dry_run else "Dry run complete. Re-run without --dry-run to execute.")


if __name__ == "__main__":
    main()
