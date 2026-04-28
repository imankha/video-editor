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
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_msgpack.py --local path/to/profile.sqlite
"""

import argparse
import json
import sqlite3
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
    env_file = PROJECT_ROOT / ".env" if env_name == "dev" else PROJECT_ROOT / f".env.{env_name}"
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()
    for key in ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]:
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)
    config.setdefault("APP_ENV", env_name)
    return config


def get_s3_client(config):
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
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


def get_users_from_auth(auth_path):
    conn = sqlite3.connect(str(auth_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT user_id, email FROM users WHERE email IS NOT NULL").fetchall()
    conn.close()
    return [(r['user_id'], r['email']) for r in rows]


def discover_profile_dbs(s3, config, user_id):
    """List all profile.sqlite keys in R2 for a user."""
    app_env = config["APP_ENV"]
    prefix = f"{app_env}/users/{user_id}/profiles/"
    resp = s3.list_objects_v2(Bucket=config["R2_BUCKET"], Prefix=prefix)
    keys = []
    for obj in resp.get("Contents", []):
        if obj["Key"].endswith("profile.sqlite"):
            keys.append(obj["Key"])
    return keys


def migrate_r2_user(user_id, email, s3, config, dry_run=False):
    r2_keys = discover_profile_dbs(s3, config, user_id)
    if not r2_keys:
        print(f"  SKIP {email} ({user_id}): no profile DBs in R2")
        return 0

    total = 0
    for r2_key in r2_keys:
        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        tmp.close()
        tmp_path = Path(tmp.name)

        try:
            s3.download_file(config["R2_BUCKET"], r2_key, str(tmp_path))
        except Exception as e:
            print(f"  SKIP {r2_key}: {e}")
            tmp_path.unlink(missing_ok=True)
            continue

        profile_id = r2_key.split("/")[-2]
        print(f"  Profile {profile_id}:")
        before_size = tmp_path.stat().st_size
        converted = migrate_db(tmp_path, dry_run=dry_run)

        if converted > 0 and not dry_run:
            after_size = tmp_path.stat().st_size
            reduction = before_size - after_size
            pct = (reduction / before_size * 100) if before_size > 0 else 0
            print(f"    DB size: {before_size:,} -> {after_size:,} ({reduction:,} bytes saved, {pct:.1f}%)")
            s3.upload_file(str(tmp_path), config["R2_BUCKET"], r2_key)
            print(f"    Uploaded to R2")
        elif converted == 0:
            print(f"    No JSON data to convert")

        total += converted
        tmp_path.unlink(missing_ok=True)

    return total


def main():
    parser = argparse.ArgumentParser(description="Migrate JSON columns to msgpack")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--email", help="Migrate a single user by email")
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

    config = load_env(args.env)
    s3 = get_s3_client(config)
    app_env = config["APP_ENV"]
    is_remote = args.env in ("staging", "prod")

    print(f"Environment: {args.env} (APP_ENV={app_env})")
    if args.dry_run:
        print("DRY RUN — no changes will be written")

    if is_remote:
        print("\n--- Downloading auth DB from R2 ---")
        auth_r2_key = f"{app_env}/auth/auth.sqlite"
        tmp_auth = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        tmp_auth.close()
        tmp_auth_path = Path(tmp_auth.name)
        s3.download_file(config["R2_BUCKET"], auth_r2_key, str(tmp_auth_path))
        auth_path = tmp_auth_path
    else:
        auth_path = AUTH_DB

    if not auth_path.exists():
        print(f"ERROR: auth DB not found at {auth_path}")
        sys.exit(1)

    users = get_users_from_auth(auth_path)

    if args.email:
        users = [(uid, email) for uid, email in users if email == args.email]
        if not users:
            print(f"No user found with email '{args.email}'")
            sys.exit(1)

    print(f"\nMigrating {len(users)} user(s)...\n")
    grand_total = 0

    for user_id, email in users:
        print(f"=== {email} ({user_id}) ===")
        if is_remote:
            converted = migrate_r2_user(user_id, email, s3, config, dry_run=args.dry_run)
        else:
            profiles_dir = USER_DATA / user_id / "profiles"
            if not profiles_dir.exists():
                print(f"  SKIP: no profiles directory")
                continue
            converted = 0
            for db_path in profiles_dir.glob("*/profile.sqlite"):
                profile_id = db_path.parent.name
                print(f"  Profile {profile_id}:")
                before_size = db_path.stat().st_size
                c = migrate_db(db_path, dry_run=args.dry_run)
                if c > 0 and not args.dry_run:
                    after_size = db_path.stat().st_size
                    print(f"    DB size: {before_size:,} -> {after_size:,} ({before_size - after_size:,} bytes saved)")
                elif c == 0:
                    print(f"    No JSON data to convert")
                converted += c
        grand_total += converted

    if is_remote and 'tmp_auth_path' in dir():
        tmp_auth_path.unlink(missing_ok=True)

    print(f"\nDone. Total: {grand_total} values converted across {len(users)} user(s)")


if __name__ == "__main__":
    main()
