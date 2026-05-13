"""
Reset ALL accounts for fresh testing. Preserves games.

Runs against both dev and staging environments (never prod).
Deletes all user data from R2 (except games) and clears Postgres auth
records so every Google login creates a fresh account.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py --yes

What it does (per environment):
1. Loads R2 + Postgres credentials from .env (dev) and .env.staging (staging)
2. Queries Postgres for known users
3. Lists R2 user prefixes (catches orphaned users not in Postgres)
4. Deletes all R2 objects under each user prefix EXCEPT games/
5. Clears local profile tables and re-uploads clean DBs
6. Clears Postgres auth tables (users, sessions, refs, shares, grace deletions)
"""

import argparse
import sqlite3
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

TABLES_TO_CLEAR = [
    "raw_clips",
    "projects",
    "working_clips",
    "working_videos",
    "final_videos",
    "export_jobs",
    "achievements",
    "before_after_tracks",
    "pending_uploads",
]

ALLOWED_ENVS = ["dev", "staging"]


def load_env(env_name):
    if env_name not in ALLOWED_ENVS:
        print(f"REFUSED: '{env_name}' is not an allowed environment. Only {ALLOWED_ENVS}.")
        sys.exit(1)

    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"  SKIP: {env_file} not found — skipping {env_name}")
        return None

    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()

    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"  SKIP: {key} not found in {env_file} — skipping {env_name}")
            return None

    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config):
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


def get_pg_conn(config):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def checkpoint_and_upload(db_path, r2_client, bucket, r2_key):
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    r2_client.upload_file(str(db_path), bucket, r2_key)
    print(f"    Uploaded to R2: {r2_key}")


def list_r2_objects(r2_client, bucket, prefix):
    objects = []
    continuation_token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = r2_client.list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            objects.append(obj["Key"])
        if response.get("IsTruncated"):
            continuation_token = response["NextContinuationToken"]
        else:
            break
    return objects


def delete_r2_objects(r2_client, bucket, keys):
    deleted = 0
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        r2_client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in batch]},
        )
        deleted += len(batch)
    return deleted


def find_r2_user_ids(r2_client, bucket, env_prefix):
    user_ids = set()
    prefix = f"{env_prefix}/users/"
    continuation_token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = r2_client.list_objects_v2(**kwargs)
        for cp in response.get("CommonPrefixes", []):
            parts = cp["Prefix"].rstrip("/").split("/")
            if len(parts) >= 3:
                user_ids.add(parts[2])
        if response.get("IsTruncated"):
            continuation_token = response["NextContinuationToken"]
        else:
            break
    return user_ids


def delete_user_r2_data(user_id, r2_client, bucket, env_prefix):
    user_prefix = f"{env_prefix}/users/{user_id}/"
    all_keys = list_r2_objects(r2_client, bucket, user_prefix)
    keys_to_delete = [k for k in all_keys if "/games/" not in k]
    preserved = len(all_keys) - len(keys_to_delete)

    if keys_to_delete:
        deleted = delete_r2_objects(r2_client, bucket, keys_to_delete)
        msg = f"      Deleted {deleted} objects from R2: {env_prefix}"
        if preserved:
            msg += f" (preserved {preserved} game objects)"
        print(msg)
    else:
        print(f"      No non-game objects to delete in R2: {env_prefix}")


def reset_profiles(user_id, r2_configs):
    for env_name, (r2_client, config) in r2_configs.items():
        app_env = config["APP_ENV"]
        bucket = config["R2_BUCKET"]
        delete_user_r2_data(user_id, r2_client, bucket, app_env)

    profiles_dir = USER_DATA / user_id / "profiles"
    if not profiles_dir.exists():
        return

    for db_path in profiles_dir.glob("*/profile.sqlite"):
        profile_id = db_path.parent.name
        print(f"    Profile {profile_id}: clearing local tables...")

        pconn = sqlite3.connect(str(db_path))
        cleared = []
        for table in TABLES_TO_CLEAR:
            try:
                pconn.execute(f"DELETE FROM {table}")
                cleared.append(table)
            except sqlite3.OperationalError:
                pass
        pconn.commit()
        pconn.close()

        if cleared:
            print(f"      Cleared: {', '.join(cleared)}")

        for env_name, (r2_client, config) in r2_configs.items():
            app_env = config["APP_ENV"]
            bucket = config["R2_BUCKET"]
            r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
            checkpoint_and_upload(db_path, r2_client, bucket, r2_key)


def main():
    parser = argparse.ArgumentParser(
        description="Reset ALL dev/staging accounts (preserves games, never touches prod)")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    r2_configs = {}
    pg_conns = {}
    for env_name in ALLOWED_ENVS:
        print(f"Loading {env_name} config...")
        config = load_env(env_name)
        if config:
            r2_client = get_r2_client(config)
            r2_configs[env_name] = (r2_client, config)
            pg_conns[env_name] = get_pg_conn(config)
            print(f"  OK (bucket={config['R2_BUCKET']}, prefix={config['APP_ENV']})")

    if not r2_configs:
        print("ERROR: No valid environment configs found. Nothing to do.")
        sys.exit(1)

    all_user_ids = set()
    user_emails = {}

    for env_name, conn in pg_conns.items():
        cur = conn.cursor()
        cur.execute("SELECT user_id, email FROM users")
        for row in cur.fetchall():
            all_user_ids.add(row["user_id"])
            user_emails[row["user_id"]] = row["email"]

    for env_name, (r2_client, config) in r2_configs.items():
        app_env = config["APP_ENV"]
        bucket = config["R2_BUCKET"]
        r2_users = find_r2_user_ids(r2_client, bucket, app_env)
        new_users = r2_users - all_user_ids
        if new_users:
            print(f"  Found {len(new_users)} orphaned user(s) in R2 ({env_name})")
        all_user_ids.update(r2_users)

    if not all_user_ids:
        print("\nNo users found (Postgres or R2) — nothing to reset.")
        for conn in pg_conns.values():
            conn.close()
        return

    print(f"\n{'='*60}")
    print(f"  RESETTING {len(all_user_ids)} ACCOUNT(S)")
    print(f"  Environments: {', '.join(r2_configs.keys())}")
    print(f"  Games will be PRESERVED")
    print(f"  R2 user data will be DELETED (not just cleared)")
    print(f"{'='*60}")

    if not args.yes:
        answer = input("\nType 'yes' to proceed: ").strip().lower()
        if answer != "yes":
            print("Aborted.")
            for conn in pg_conns.values():
                conn.close()
            sys.exit(0)

    for user_id in sorted(all_user_ids):
        email = user_emails.get(user_id, "(orphaned — not in Postgres)")
        print(f"\n--- {user_id} ({email}) ---")
        reset_profiles(user_id, r2_configs)

    print(f"\n--- Clearing Postgres auth tables ---")
    for env_name, conn in pg_conns.items():
        cur = conn.cursor()
        for table in ("pending_teammate_shares",
                       "game_storage_refs", "r2_grace_deletions",
                       "share_games", "share_videos", "shares",
                       "sessions", "otp_codes", "users"):
            cur.execute(f"DELETE FROM {table}")
        conn.commit()
        conn.close()
        print(f"  [{env_name}] Cleared all auth tables")

    print(f"\n{'='*60}")
    print(f"  DONE. All accounts reset in: {', '.join(r2_configs.keys())}")
    print(f"  Games preserved. R2 user data deleted.")
    print(f"  Clear browser cookies to start fresh.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
