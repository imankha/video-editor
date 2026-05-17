#!/usr/bin/env python3
"""
Reset a user account so they experience a fresh new-user flow.

Deletes:
  1. User row from Postgres (+ sessions)
  2. Local user_data/{user_id}/ folder
  3. R2 objects under {env}/users/{user_id}/ for ALL environments

After running, the next Google sign-in with that email creates a brand new account.

Usage:
    cd src/backend
    .venv/Scripts/python.exe scripts/reset_account.py --email imankh@gmail.com
    .venv/Scripts/python.exe scripts/reset_account.py --email imankh@gmail.com --dry-run
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
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

from app.storage import get_r2_client, R2_BUCKET, R2_ENABLED

ALL_ENVS = ["dev", "staging"]


def get_pg_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)


def find_user(email: str) -> dict | None:
    conn = get_pg_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT user_id, email, google_id, created_at FROM users WHERE email = %s",
        (email,),
    )
    row = cur.fetchone()
    conn.close()
    return row


def delete_from_postgres(user_id: str, dry_run: bool) -> None:
    conn = get_pg_conn()
    cur = conn.cursor()
    for table in ["sessions", "users"]:
        cur.execute(f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id = %s", (user_id,))
        count = cur.fetchone()["cnt"]
        print(f"  {table}: {count} rows to delete")
        if not dry_run and count:
            cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))

    if not dry_run:
        conn.commit()
        print("  Postgres updated")
    conn.close()


def delete_local_data(user_id: str, dry_run: bool) -> None:
    user_path = Path(__file__).parent.parent.parent.parent / "user_data" / user_id
    if user_path.exists():
        print(f"  Local folder: {user_path}")
        if not dry_run:
            shutil.rmtree(user_path)
            print("  Deleted")
    else:
        print("  No local folder found")


def delete_r2_data(user_id: str, dry_run: bool) -> None:
    if not R2_ENABLED:
        print("  R2 not enabled, skipping")
        return

    client = get_r2_client()
    if not client:
        print("  R2 client not available, skipping")
        return

    for env in ALL_ENVS:
        prefix = f"{env}/users/{user_id}/"
        total_deleted = 0

        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
            objects = page.get("Contents", [])
            if not objects:
                continue

            keys = [{"Key": obj["Key"]} for obj in objects]
            total_deleted += len(keys)

            if not dry_run:
                client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": keys})

        if total_deleted:
            action = "would delete" if dry_run else "deleted"
            print(f"  R2 [{env}]: {action} {total_deleted} objects")
        else:
            print(f"  R2 [{env}]: no objects found")


def main():
    parser = argparse.ArgumentParser(description="Reset a user account for fresh new-user testing")
    parser.add_argument("--email", required=True, help="Email to reset (e.g. imankh@gmail.com)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without making changes")
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN (no changes will be made) ===\n")

    user = find_user(args.email)
    if not user:
        print(f"No user found with email: {args.email}")
        sys.exit(1)

    user_id = user["user_id"]

    print(f"User found:")
    print(f"  user_id:    {user_id}")
    print(f"  email:      {user['email']}")
    print(f"  created_at: {user['created_at']}")
    print()

    if not args.dry_run:
        confirm = input(f"Delete ALL data for {args.email}? Type 'yes' to confirm: ")
        if confirm != "yes":
            print("Aborted")
            sys.exit(0)
        print()

    print("[1/3] Postgres database:")
    delete_from_postgres(user_id, args.dry_run)
    print()

    print("[2/3] Local data:")
    delete_local_data(user_id, args.dry_run)
    print()

    print("[3/3] R2 data (all environments):")
    delete_r2_data(user_id, args.dry_run)
    print()

    print("Done!" if not args.dry_run else "Dry run complete. Re-run without --dry-run to execute.")


if __name__ == "__main__":
    main()
