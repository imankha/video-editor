#!/usr/bin/env python3
"""
Migration: Add shared_clip_ids column to teammate_shares and backfill from clip_teammates.

Adds the shared_clip_ids TEXT column, then populates it for existing rows
by looking up current clip IDs from the clip_teammates junction table.

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrations/add_shared_clip_ids.py <email> --env <dev|staging|prod>
"""

import sys
import os
import json
import sqlite3
import argparse
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATIONS_DIR.parent.parent / "src" / "backend"
sys.path.insert(0, str(MIGRATIONS_DIR))
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR.parent.parent / ".env")


def migrate_shared_clip_ids(db_path: str, dry_run: bool = False) -> int:
    from T2847_backfill_clip_teammates import backfill_clip_teammates

    # Ensure clip_teammates is fully populated first
    print("  Ensuring clip_teammates is up to date...")
    backfill_clip_teammates(db_path, dry_run=dry_run)

    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Add column if missing
        cols = {c["name"] for c in cursor.execute("PRAGMA table_info(teammate_shares)").fetchall()}
        if "shared_clip_ids" not in cols:
            cursor.execute("ALTER TABLE teammate_shares ADD COLUMN shared_clip_ids TEXT DEFAULT '[]'")
            print("    Added shared_clip_ids column")

        # Backfill rows with empty shared_clip_ids
        cursor.execute("SELECT id, game_id, tag_name, shared_clip_ids FROM teammate_shares")
        rows = cursor.fetchall()
        updated = 0

        for row in rows:
            existing = json.loads(row["shared_clip_ids"] or "[]")
            if existing:
                continue

            cursor.execute(
                """SELECT ct.clip_id FROM clip_teammates ct
                   JOIN raw_clips rc ON rc.id = ct.clip_id
                   WHERE rc.game_id = ? AND ct.tag_name = ?""",
                (row["game_id"], row["tag_name"]),
            )
            clip_ids = [r["clip_id"] for r in cursor.fetchall()]

            if clip_ids:
                cursor.execute(
                    "UPDATE teammate_shares SET shared_clip_ids = ? WHERE id = ?",
                    (json.dumps(clip_ids), row["id"]),
                )
                updated += 1
                print(f"    {row['tag_name']}: {len(clip_ids)} clip IDs")

        if dry_run:
            print(f"  [DRY RUN] Would update {updated} of {len(rows)} rows")
            conn.rollback()
        else:
            conn.commit()
            print(f"  Updated {updated} of {len(rows)} rows")

        return updated
    finally:
        conn.close()


def find_local_dbs(email: str) -> list[Path]:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    pg_conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    cur = pg_conn.cursor()
    cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    pg_conn.close()
    if not row:
        print(f"Error: user {email} not found in Postgres")
        sys.exit(1)
    user_id = row["user_id"]

    base = Path(__file__).resolve().parent.parent.parent / "user_data"
    profiles_dir = base / user_id / "profiles"
    if not profiles_dir.exists():
        print(f"Error: no profiles directory at {profiles_dir}")
        sys.exit(1)

    dbs = list(profiles_dir.glob("*/profile.sqlite"))
    if not dbs:
        print(f"Error: no profile.sqlite found under {profiles_dir}")
        sys.exit(1)

    return dbs


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "prod": ".prod"}[env_name]
    env_file = BACKEND_DIR.parent.parent / f".env{suffix}"
    if not env_file.exists():
        print(f"ERROR: {env_file} not found"); sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config: dict):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto",
    )


def checkpoint_and_upload(db_path, r2_client, bucket, r2_key):
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    r2_client.upload_file(str(db_path), bucket, r2_key)
    print(f"  Uploaded to R2: {r2_key}")


def main():
    parser = argparse.ArgumentParser(description="Add shared_clip_ids to teammate_shares and backfill")
    parser.add_argument("email", help="User email to migrate")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="dev")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    print(f"Migration: add_shared_clip_ids for {args.email} ({args.env})")

    if args.env == "dev":
        dbs = find_local_dbs(args.email)
        for db_path in dbs:
            print(f"  Local DB: {db_path}")
            migrate_shared_clip_ids(str(db_path), dry_run=args.dry_run)
    else:
        config = load_env(args.env)
        app_env = config["APP_ENV"]
        bucket = config["R2_BUCKET"]
        r2 = get_r2_client(config)

        import psycopg2
        from psycopg2.extras import RealDictCursor
        pg_conn = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)
        cur = pg_conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE email = %s", (args.email,))
        row = cur.fetchone()
        if not row:
            print(f"Error: user {args.email} not found in {args.env} Postgres")
            pg_conn.close()
            sys.exit(1)
        user_id = row["user_id"]
        pg_conn.close()
        print(f"  User ID: {user_id}")

        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            prefix = f"{app_env}/users/{user_id}/profiles/"
            resp = r2.list_objects_v2(Bucket=bucket, Prefix=prefix)
            profile_dbs = [
                obj["Key"] for obj in resp.get("Contents", [])
                if obj["Key"].endswith("profile.sqlite")
            ]

            if not profile_dbs:
                print(f"  No profile.sqlite found under {prefix}")
                sys.exit(1)

            for r2_key in profile_dbs:
                parts = r2_key.split("/")
                profile_id = parts[-2]
                local_path = Path(tmpdir) / f"{profile_id}_profile.sqlite"
                print(f"  Downloading {r2_key}...")
                r2.download_file(bucket, r2_key, str(local_path))

                migrate_shared_clip_ids(str(local_path), dry_run=args.dry_run)

                if not args.dry_run:
                    checkpoint_and_upload(local_path, r2, bucket, r2_key)

    print("Done.")


if __name__ == "__main__":
    main()
