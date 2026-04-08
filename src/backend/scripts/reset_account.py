#!/usr/bin/env python3
"""
Reset a user account so they experience a fresh new-user flow.

Deletes:
  1. User row from auth.sqlite (+ sessions, credit transactions)
  2. Local user_data/{user_id}/ folder
  3. R2 objects under {env}/users/{user_id}/ for ALL environments
  4. Syncs updated auth.sqlite to R2

After running, the next Google sign-in with that email creates a brand new account.

Usage:
    cd src/backend
    .venv/Scripts/python.exe scripts/reset_account.py --email imankh@gmail.com
    .venv/Scripts/python.exe scripts/reset_account.py --email imankh@gmail.com --dry-run
"""

import argparse
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file from project root
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

from app.services.auth_db import AUTH_DB_PATH, sync_auth_db_to_r2
from app.storage import get_r2_client, R2_BUCKET, R2_ENABLED

ALL_ENVS = ["dev", "staging"]


def find_user(email: str) -> dict | None:
    """Look up user by email in auth.sqlite."""
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT user_id, email, google_id, credits, created_at FROM users WHERE email = ?",
        (email,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_from_auth_db(user_id: str, dry_run: bool) -> None:
    """Remove user, sessions, and credit transactions from auth.sqlite."""
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    tables = [
        ("credit_transactions", "user_id"),
        ("sessions", "user_id"),
        ("users", "user_id"),
    ]
    for table, col in tables:
        count = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (user_id,)
        ).fetchone()[0]
        print(f"  {table}: {count} rows to delete")
        if not dry_run and count:
            conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (user_id,))

    if not dry_run:
        conn.commit()
        print("  auth.sqlite updated")
    conn.close()


def delete_local_data(user_id: str, dry_run: bool) -> None:
    """Remove local user_data/{user_id}/ folder."""
    user_path = Path(__file__).parent.parent.parent.parent / "user_data" / user_id
    if user_path.exists():
        print(f"  Local folder: {user_path}")
        if not dry_run:
            shutil.rmtree(user_path)
            print("  Deleted")
    else:
        print("  No local folder found")


def delete_r2_data(user_id: str, dry_run: bool) -> None:
    """Delete all R2 objects under {env}/users/{user_id}/ for all environments."""
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

        # Paginate through all objects
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
            objects = page.get("Contents", [])
            if not objects:
                continue

            keys = [{"Key": obj["Key"]} for obj in objects]
            total_deleted += len(keys)

            if not dry_run:
                client.delete_objects(
                    Bucket=R2_BUCKET,
                    Delete={"Objects": keys},
                )

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
    print(f"  credits:    {user['credits']}")
    print(f"  created_at: {user['created_at']}")
    print()

    if not args.dry_run:
        confirm = input(f"Delete ALL data for {args.email}? Type 'yes' to confirm: ")
        if confirm != "yes":
            print("Aborted")
            sys.exit(0)
        print()

    print("[1/4] Auth database:")
    delete_from_auth_db(user_id, args.dry_run)
    print()

    print("[2/4] Local data:")
    delete_local_data(user_id, args.dry_run)
    print()

    print("[3/4] R2 data (all environments):")
    delete_r2_data(user_id, args.dry_run)
    print()

    print("[4/5] Sync auth.sqlite to R2:")
    if not args.dry_run:
        if sync_auth_db_to_r2():
            print("  Synced")
        else:
            print("  Sync failed or R2 not enabled")
    else:
        print("  (skipped in dry run)")

    print()
    print("[5/5] Restart staging server (so it re-reads from R2):")
    if not args.dry_run:
        try:
            result = subprocess.run(
                ["fly", "machines", "restart", "-a", "reel-ballers-api-staging", "--force"],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                print("  Staging server restarted")
            else:
                # Machine may be suspended — that's fine, it'll restore from R2 on next wake
                stderr = result.stderr.strip()
                if "suspended" in stderr.lower() or "stopped" in stderr.lower():
                    print("  Machine is suspended — will restore from R2 on next request")
                else:
                    print(f"  Restart failed: {stderr or result.stdout.strip()}")
        except FileNotFoundError:
            print("  fly CLI not found — manually restart staging or wait for auto-suspend")
        except subprocess.TimeoutExpired:
            print("  Restart timed out — server may still be restarting")
    else:
        print("  (skipped in dry run)")

    print()
    print("Done!" if not args.dry_run else "Dry run complete. Re-run without --dry-run to execute.")


if __name__ == "__main__":
    main()
