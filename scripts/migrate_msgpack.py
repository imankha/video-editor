"""
T1180: Migrate JSON text columns to MessagePack binary encoding.

Converts existing JSON text data to msgpack bytes in these columns:
  - working_clips: crop_data, timing_data, segments_data
  - working_videos: highlights_data
  - export_jobs: input_data

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_msgpack.py --env prod
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_msgpack.py --env prod --email user@example.com
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_msgpack.py --dry-run --env prod
"""

import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import msgpack
import boto3
from botocore.config import Config as BotoConfig

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

COLUMNS_TO_MIGRATE = [
    ("working_clips", "id", ["crop_data", "timing_data", "segments_data"]),
    ("working_videos", "id", ["highlights_data"]),
    ("export_jobs", "id", ["input_data"]),
]


def load_env(env_name):
    from dotenv import load_dotenv
    env_file = PROJECT_ROOT / "src" / "backend" / f".env.{env_name}"
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)
    load_dotenv(env_file)
    import os
    return {
        "bucket": os.environ["R2_BUCKET_NAME"],
        "account_id": os.environ["R2_ACCOUNT_ID"],
        "access_key": os.environ["R2_ACCESS_KEY_ID"],
        "secret_key": os.environ["R2_SECRET_ACCESS_KEY"],
    }


def get_s3_client(env):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{env['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["access_key"],
        aws_secret_access_key=env["secret_key"],
        config=BotoConfig(signature_version="s3v4"),
    )


def is_json_text(value):
    if isinstance(value, str):
        return True
    if isinstance(value, bytes) and len(value) > 0 and value[0:1] in (b'{', b'['):
        return True
    return False


def migrate_db(db_path, dry_run=False):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    total_converted = 0

    for table, pk, columns in COLUMNS_TO_MIGRATE:
        table_exists = cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not table_exists:
            continue

        for col in columns:
            col_exists = any(
                c['name'] == col for c in cursor.execute(f"PRAGMA table_info({table})").fetchall()
            )
            if not col_exists:
                continue

            rows = cursor.execute(
                f"SELECT {pk}, {col} FROM {table} WHERE {col} IS NOT NULL"
            ).fetchall()

            converted = 0
            for row in rows:
                value = row[col]
                if is_json_text(value):
                    try:
                        parsed = json.loads(value)
                        encoded = msgpack.packb(parsed, use_bin_type=True)
                        if not dry_run:
                            cursor.execute(
                                f"UPDATE {table} SET {col} = ? WHERE {pk} = ?",
                                (encoded, row[pk])
                            )
                        converted += 1
                    except (json.JSONDecodeError, TypeError):
                        pass

            if converted > 0:
                print(f"  {table}.{col}: {converted}/{len(rows)} rows converted")
                total_converted += converted

    if total_converted > 0 and not dry_run:
        conn.commit()
        cursor.execute("VACUUM")
        conn.commit()

    conn.close()
    return total_converted


def get_user_emails(env_config):
    auth_conn = sqlite3.connect(str(AUTH_DB))
    auth_conn.row_factory = sqlite3.Row
    rows = auth_conn.execute("SELECT email FROM users WHERE email IS NOT NULL").fetchall()
    auth_conn.close()
    return [r['email'] for r in rows]


def migrate_user(email, s3, env, dry_run=False):
    r2_key = f"users/{email}/profile.sqlite"
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    tmp.close()
    tmp_path = Path(tmp.name)

    try:
        s3.download_file(env["bucket"], r2_key, str(tmp_path))
    except Exception as e:
        print(f"  SKIP {email}: {e}")
        tmp_path.unlink(missing_ok=True)
        return 0

    print(f"Migrating {email}...")
    before_size = tmp_path.stat().st_size
    converted = migrate_db(tmp_path, dry_run=dry_run)

    if converted > 0 and not dry_run:
        after_size = tmp_path.stat().st_size
        reduction = before_size - after_size
        pct = (reduction / before_size * 100) if before_size > 0 else 0
        print(f"  DB size: {before_size:,} -> {after_size:,} ({reduction:,} bytes saved, {pct:.1f}%)")
        s3.upload_file(str(tmp_path), env["bucket"], r2_key)
        print(f"  Uploaded to R2")
    elif converted == 0:
        print(f"  No JSON data to convert")

    tmp_path.unlink(missing_ok=True)
    return converted


def main():
    parser = argparse.ArgumentParser(description="Migrate JSON columns to msgpack")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--email", help="Migrate a single user")
    parser.add_argument("--dry-run", action="store_true", help="Count conversions without writing")
    parser.add_argument("--local", help="Migrate a local DB file directly")
    args = parser.parse_args()

    if args.local:
        db_path = Path(args.local)
        if not db_path.exists():
            print(f"ERROR: {db_path} not found")
            sys.exit(1)
        before = db_path.stat().st_size
        converted = migrate_db(db_path, dry_run=args.dry_run)
        if converted > 0 and not args.dry_run:
            after = db_path.stat().st_size
            print(f"\nDB size: {before:,} -> {after:,} ({before - after:,} bytes saved)")
        print(f"\nTotal: {converted} values converted")
        return

    env = load_env(args.env)
    s3 = get_s3_client(env)

    if args.email:
        migrate_user(args.email, s3, env, dry_run=args.dry_run)
    else:
        emails = get_user_emails(env)
        print(f"Migrating {len(emails)} users...")
        total = 0
        for email in emails:
            total += migrate_user(email, s3, env, dry_run=args.dry_run)
        print(f"\nDone. Total: {total} values converted across {len(emails)} users")


if __name__ == "__main__":
    main()
