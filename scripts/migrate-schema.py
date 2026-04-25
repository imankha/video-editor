"""
Migrate existing profile databases to the current schema.

PENDING migrations live in the MIGRATIONS and INDEXES lists below. When you
add a new column to database.py CREATE TABLE, also add it here so existing
accounts get the column on next deploy.

deploy_production.sh runs this automatically before deploying, then calls
--reset to clear the pending list. The merge reviewer checks that schema
changes come with a corresponding entry here.

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env prod
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env prod --email user@example.com
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --check   # exit 0 if pending, 1 if none
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --reset   # clear lists after deploy
"""

import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

# Pending migrations: columns to add before next deploy.
# Cleared automatically by deploy_production.sh after running.
# When adding schema changes, append entries here AND in database.py CREATE TABLE.
# Format: (table_name, column_definition)
# PENDING_MIGRATIONS_START
MIGRATIONS = [
    ("final_videos", "watched_at TIMESTAMP"),
]
# PENDING_MIGRATIONS_END

# Pending indexes: created IF NOT EXISTS, safe to re-run.
# PENDING_INDEXES_START
INDEXES = [
]
# PENDING_INDEXES_END


def load_env(env_name):
    if env_name == "dev":
        env_file = PROJECT_ROOT / ".env"
    else:
        env_file = PROJECT_ROOT / f".env.{env_name}"
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
                k, _, v = line.partition("=")
                config[k.strip()] = v.strip()
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config):
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto",
    )


def checkpoint_and_upload(db_path, r2_client, bucket, r2_key):
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    r2_client.upload_file(str(db_path), bucket, r2_key)
    print(f"  Uploaded to R2: {r2_key}")


def migrate_db(db_path, label=""):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    added = 0
    for table, col_def in MIGRATIONS:
        col_name = col_def.split()[0]
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            added += 1
            print(f"    + {table}.{col_name}")
        except sqlite3.OperationalError:
            pass  # already exists

    for idx_sql in INDEXES:
        try:
            conn.execute(idx_sql)
        except sqlite3.OperationalError:
            pass

    conn.commit()
    conn.close()
    if added:
        print(f"  {label}Added {added} columns")
    else:
        print(f"  {label}Schema already up to date")
    return added > 0


def reset_pending():
    """Clear MIGRATIONS and INDEXES lists in this file (called after successful deploy)."""
    script_path = Path(__file__)
    content = script_path.read_text()
    import re
    content = re.sub(
        r"(# PENDING_MIGRATIONS_START\n)MIGRATIONS = \[.*?\]\n(# PENDING_MIGRATIONS_END)",
        r"\1MIGRATIONS = [\n]\n\2",
        content,
        flags=re.DOTALL,
    )
    content = re.sub(
        r"(# PENDING_INDEXES_START\n)INDEXES = \[.*?\]\n(# PENDING_INDEXES_END)",
        r"\1INDEXES = [\n]\n\2",
        content,
        flags=re.DOTALL,
    )
    script_path.write_text(content)
    print("Cleared pending migrations and indexes.")


def main():
    parser = argparse.ArgumentParser(description="Migrate profile databases to current schema")
    parser.add_argument("--env", choices=["dev", "staging", "prod"])
    parser.add_argument("--email", help="Migrate only this user (by email)")
    parser.add_argument("--check", action="store_true", help="Exit 0 if pending migrations exist, 1 if none")
    parser.add_argument("--reset", action="store_true", help="Clear pending migrations list (run after deploy)")
    args = parser.parse_args()

    if args.check:
        sys.exit(0 if MIGRATIONS or INDEXES else 1)

    if args.reset:
        reset_pending()
        return

    if not args.env:
        parser.error("--env is required (unless using --check or --reset)")

    if not MIGRATIONS and not INDEXES:
        print("No pending migrations.")
        return

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    is_remote = args.env in ("staging", "prod")

    print(f"Environment: {args.env} (APP_ENV={app_env})")

    if is_remote:
        r2 = get_r2_client(config)

        # Download auth DB to find users
        auth_r2_key = f"{app_env}/auth/auth.sqlite"
        tmp_auth = Path(tempfile.mktemp(suffix=".sqlite"))
        r2.download_file(bucket, auth_r2_key, str(tmp_auth))
        auth_conn = sqlite3.connect(str(tmp_auth))
        auth_conn.row_factory = sqlite3.Row

        if args.email:
            rows = auth_conn.execute("SELECT user_id, email FROM users WHERE email = ?", (args.email,)).fetchall()
        else:
            rows = auth_conn.execute("SELECT user_id, email FROM users").fetchall()
        auth_conn.close()
        tmp_auth.unlink()

        if not rows:
            print(f"No users found{' for ' + args.email if args.email else ''}")
            return

        print(f"Migrating {len(rows)} user(s)...\n")

        for row in rows:
            user_id, email = row["user_id"], row["email"]
            print(f"--- {email} ({user_id}) ---")

            # List profiles in R2
            prefix = f"{app_env}/users/{user_id}/profiles/"
            resp = r2.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter="/")
            profile_prefixes = [p["Prefix"] for p in resp.get("CommonPrefixes", [])]

            if not profile_prefixes:
                print("  No profiles found in R2")
                continue

            for profile_prefix in profile_prefixes:
                profile_id = profile_prefix.rstrip("/").split("/")[-1]
                r2_key = f"{profile_prefix}profile.sqlite"
                tmp_db = Path(tempfile.mktemp(suffix=".sqlite"))

                try:
                    r2.download_file(bucket, r2_key, str(tmp_db))
                except Exception as e:
                    print(f"  Profile {profile_id}: download failed ({e})")
                    continue

                changed = migrate_db(str(tmp_db), f"Profile {profile_id}: ")

                if changed:
                    checkpoint_and_upload(tmp_db, r2, bucket, r2_key)

                tmp_db.unlink(missing_ok=True)

    else:
        # Dev: migrate local DBs
        if args.email:
            # Find user_id from local auth.sqlite
            if not AUTH_DB.exists():
                print("No local auth.sqlite found")
                return
            auth_conn = sqlite3.connect(str(AUTH_DB))
            auth_conn.row_factory = sqlite3.Row
            row = auth_conn.execute("SELECT user_id FROM users WHERE email = ?", (args.email,)).fetchone()
            auth_conn.close()
            if not row:
                print(f"No user found for {args.email}")
                return
            user_dirs = [USER_DATA / row["user_id"]]
        else:
            user_dirs = [d for d in USER_DATA.iterdir() if d.is_dir() and (d / "profiles").exists()]

        for user_dir in user_dirs:
            profiles_dir = user_dir / "profiles"
            if not profiles_dir.exists():
                continue
            print(f"\n--- {user_dir.name} ---")
            for db_path in profiles_dir.glob("*/profile.sqlite"):
                profile_id = db_path.parent.name
                migrate_db(str(db_path), f"Profile {profile_id}: ")


if __name__ == "__main__":
    main()
