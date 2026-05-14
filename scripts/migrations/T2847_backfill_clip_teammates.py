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


def apply_prerequisite_migrations(cursor, conn):
    """Apply schema migrations needed before T2847 backfill (columns + msgpack conversion)."""
    import json as _json
    from app.utils.encoding import encode_data as _encode

    # T2800: Add tagged_teammates, my_athlete columns if missing
    clip_cols = {c["name"] for c in cursor.execute("PRAGMA table_info(raw_clips)").fetchall()}
    if "tagged_teammates" not in clip_cols:
        cursor.execute("ALTER TABLE raw_clips ADD COLUMN tagged_teammates BLOB DEFAULT NULL")
        print("    Added tagged_teammates column")
    if "my_athlete" not in clip_cols:
        cursor.execute("ALTER TABLE raw_clips ADD COLUMN my_athlete INTEGER DEFAULT 1")
        print("    Added my_athlete column")
    if "shared_by" not in clip_cols:
        cursor.execute("ALTER TABLE raw_clips ADD COLUMN shared_by TEXT DEFAULT NULL")
        print("    Added shared_by column")
    if "boundaries_version" not in clip_cols:
        cursor.execute("ALTER TABLE raw_clips ADD COLUMN boundaries_version INTEGER DEFAULT 1")
        print("    Added boundaries_version column")
    if "boundaries_updated_at" not in clip_cols:
        cursor.execute("ALTER TABLE raw_clips ADD COLUMN boundaries_updated_at TIMESTAMP")
        print("    Added boundaries_updated_at column")

    # T2870: Convert JSON TEXT columns to msgpack BLOB (idempotent -- skips already-converted)
    json_columns = [
        ("raw_clips", "id", ["tags", "tagged_teammates", "default_highlight_regions"]),
        ("pending_uploads", "id", ["parts_json"]),
        ("final_videos", "id", ["rating_counts"]),
        ("working_videos", "id", ["text_overlays"]),
    ]
    for tbl, pk, cols in json_columns:
        for col in cols:
            col_exists = any(
                c["name"] == col
                for c in cursor.execute(f"PRAGMA table_info({tbl})").fetchall()
            )
            if not col_exists:
                continue
            rows = cursor.execute(
                f"SELECT {pk}, {col} FROM {tbl} WHERE {col} IS NOT NULL"
            ).fetchall()
            converted = 0
            for row in rows:
                val = row[col]
                if isinstance(val, str) or (isinstance(val, bytes) and len(val) > 0 and val[0:1] in (b"[", b"{")):
                    try:
                        parsed = _json.loads(val)
                        if parsed in ([], {}, None):
                            cursor.execute(f"UPDATE {tbl} SET {col} = NULL WHERE {pk} = ?", (row[pk],))
                        else:
                            cursor.execute(f"UPDATE {tbl} SET {col} = ? WHERE {pk} = ?", (_encode(parsed), row[pk]))
                        converted += 1
                    except (_json.JSONDecodeError, TypeError):
                        pass
            if converted > 0:
                print(f"    {tbl}.{col}: {converted} rows converted from JSON to msgpack")

    conn.commit()


def backfill_clip_teammates(db_path: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Apply prerequisite schema changes (columns + msgpack conversion)
        apply_prerequisite_migrations(cursor, conn)

        # Create clip_teammates table if it doesn't exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clip_teammates (
                clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
                tag_name TEXT NOT NULL,
                UNIQUE(clip_id, tag_name)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_clip_teammates_tag
            ON clip_teammates(tag_name)
        """)
        conn.commit()

        # Check current count
        cursor.execute("SELECT COUNT(*) as cnt FROM clip_teammates")
        existing = cursor.fetchone()["cnt"]
        if existing > 0:
            print(f"  clip_teammates already has {existing} rows, skipping backfill")
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

        return backfilled
    finally:
        conn.close()


def find_local_dbs(email: str) -> list[Path]:
    """Find all local profile.sqlite files for a user by email."""
    from app.services.pg import get_pg
    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
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
    parser = argparse.ArgumentParser(description="T2847: Backfill clip_teammates junction table")
    parser.add_argument("email", help="User email to migrate")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="dev")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    print(f"T2847 Migration: backfill clip_teammates for {args.email} ({args.env})")

    if args.env == "dev":
        dbs = find_local_dbs(args.email)
        for db_path in dbs:
            print(f"  Local DB: {db_path}")
            backfill_clip_teammates(str(db_path), dry_run=args.dry_run)
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

                backfill_clip_teammates(str(local_path), dry_run=args.dry_run)

                if not args.dry_run:
                    checkpoint_and_upload(local_path, r2, bucket, r2_key)

    print("Done.")


if __name__ == "__main__":
    main()
