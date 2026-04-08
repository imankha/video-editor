"""
Reset ALL accounts for fresh testing. Preserves games.

Runs against both dev and staging environments (never prod).
Deletes all user data from R2 (except games) and clears auth records
so every Google login creates a fresh account.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py --yes

What it does (per environment):
1. Loads R2 credentials from .env (dev) and .env.staging (staging)
2. Lists ALL user prefixes in R2 (doesn't depend on local auth.sqlite)
3. Deletes all R2 objects under each user prefix EXCEPT games/
4. Clears local profile tables and re-uploads clean DBs
5. Clears auth.sqlite (local + R2) so Google login creates fresh accounts
"""

import argparse
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

# Never clear games — they are expensive to re-upload
TABLES_TO_CLEAR = [
    "raw_clips",
    "projects",
    "working_clips",
    "working_videos",
    "final_videos",
    "export_jobs",
    "achievements",
    "before_after_tracks",
]

# Safety: only these environments are allowed. Prod is never touched.
ALLOWED_ENVS = ["dev", "staging"]


def load_env(env_name):
    """Load .env or .env.staging file and return R2 config."""
    if env_name not in ALLOWED_ENVS:
        print(f"REFUSED: '{env_name}' is not an allowed environment. Only {ALLOWED_ENVS}.")
        sys.exit(1)

    if env_name == "dev":
        env_file = PROJECT_ROOT / ".env"
    else:
        env_file = PROJECT_ROOT / f".env.{env_name}"

    if not env_file.exists():
        print(f"  SKIP: {env_file} not found — skipping {env_name}")
        return None

    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()

    required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
    for key in required:
        if key not in config:
            print(f"  SKIP: {key} not found in {env_file} — skipping {env_name}")
            return None

    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config):
    """Create a boto3 S3 client for R2."""
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
    """WAL checkpoint a SQLite DB, then upload to R2."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    r2_client.upload_file(str(db_path), bucket, r2_key)
    print(f"    Uploaded to R2: {r2_key}")


def list_r2_objects(r2_client, bucket, prefix):
    """List all objects under a prefix in R2."""
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
    """Delete objects from R2 in batches of 1000."""
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
    """Discover all user IDs from R2 by listing the users/ prefix."""
    user_ids = set()
    prefix = f"{env_prefix}/users/"
    continuation_token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = r2_client.list_objects_v2(**kwargs)
        for cp in response.get("CommonPrefixes", []):
            # cp["Prefix"] = "dev/users/abc-123/"
            parts = cp["Prefix"].rstrip("/").split("/")
            if len(parts) >= 3:
                user_ids.add(parts[2])
        if response.get("IsTruncated"):
            continuation_token = response["NextContinuationToken"]
        else:
            break
    return user_ids


def delete_user_r2_data(user_id, r2_client, bucket, env_prefix):
    """Delete all R2 objects for a user EXCEPT games/."""
    user_prefix = f"{env_prefix}/users/{user_id}/"
    all_keys = list_r2_objects(r2_client, bucket, user_prefix)

    # Filter out games — they're stored globally, not under user prefix,
    # but also check for any user-scoped game references
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
    """Delete user data from R2 and clear local profile tables."""
    # 1. Delete from R2 for each environment
    for env_name, (r2_client, config) in r2_configs.items():
        app_env = config["APP_ENV"]
        bucket = config["R2_BUCKET"]
        delete_user_r2_data(user_id, r2_client, bucket, app_env)

    # 2. Clear local profile tables and re-upload clean DB
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
                pass  # Table might not exist
        pconn.commit()
        pconn.close()

        if cleared:
            print(f"      Cleared: {', '.join(cleared)}")

        # Upload clean DB to R2
        for env_name, (r2_client, config) in r2_configs.items():
            app_env = config["APP_ENV"]
            bucket = config["R2_BUCKET"]
            r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
            checkpoint_and_upload(db_path, r2_client, bucket, r2_key)


def main():
    parser = argparse.ArgumentParser(description="Reset ALL dev/staging accounts (preserves games, never touches prod)")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    # Load R2 configs for each allowed environment
    r2_configs = {}
    for env_name in ALLOWED_ENVS:
        print(f"Loading {env_name} config...")
        config = load_env(env_name)
        if config:
            r2_client = get_r2_client(config)
            r2_configs[env_name] = (r2_client, config)
            print(f"  OK (bucket={config['R2_BUCKET']}, prefix={config['APP_ENV']})")

    if not r2_configs:
        print("ERROR: No valid environment configs found. Nothing to do.")
        sys.exit(1)

    # Discover users from BOTH local auth.sqlite AND R2
    # This ensures we clean up even if auth was already cleared
    all_user_ids = set()
    user_emails = {}

    # From local auth.sqlite
    if AUTH_DB.exists():
        conn = sqlite3.connect(str(AUTH_DB))
        conn.row_factory = sqlite3.Row
        for row in conn.execute("SELECT user_id, email FROM users").fetchall():
            all_user_ids.add(row["user_id"])
            user_emails[row["user_id"]] = row["email"]
        conn.close()

    # From R2 (catches orphaned users not in local auth)
    for env_name, (r2_client, config) in r2_configs.items():
        app_env = config["APP_ENV"]
        bucket = config["R2_BUCKET"]
        r2_users = find_r2_user_ids(r2_client, bucket, app_env)
        new_users = r2_users - all_user_ids
        if new_users:
            print(f"  Found {len(new_users)} orphaned user(s) in R2 ({env_name})")
        all_user_ids.update(r2_users)

    if not all_user_ids:
        print("\nNo users found (local or R2) — nothing to reset.")
        return

    print(f"\n{'='*60}")
    print(f"  RESETTING {len(all_user_ids)} ACCOUNT(S)")
    print(f"  Environments: {', '.join(r2_configs.keys())}")
    print(f"  Games will be PRESERVED")
    print(f"  R2 user data will be DELETED (not just cleared)")
    print(f"{'='*60}")

    # Confirm
    if not args.yes:
        answer = input("\nType 'yes' to proceed: ").strip().lower()
        if answer != "yes":
            print("Aborted.")
            sys.exit(0)

    # Reset each user's data
    for user_id in sorted(all_user_ids):
        email = user_emails.get(user_id, "(orphaned — not in auth)")
        print(f"\n--- {user_id} ({email}) ---")
        reset_profiles(user_id, r2_configs)

    # Clear auth.sqlite
    if AUTH_DB.exists():
        print(f"\n--- Clearing auth.sqlite ---")
        conn = sqlite3.connect(str(AUTH_DB))
        conn.execute("DELETE FROM credit_transactions")
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM users")
        conn.commit()
        conn.close()
        print(f"  Deleted: all users, sessions, credit_transactions")

        # Upload cleaned auth.sqlite to R2 for each environment
        for env_name, (r2_client, config) in r2_configs.items():
            app_env = config["APP_ENV"]
            bucket = config["R2_BUCKET"]
            auth_r2_key = f"{app_env}/auth/auth.sqlite"
            checkpoint_and_upload(AUTH_DB, r2_client, bucket, auth_r2_key)

    print(f"\n{'='*60}")
    print(f"  DONE. All accounts reset in: {', '.join(r2_configs.keys())}")
    print(f"  Games preserved. R2 user data deleted.")
    print(f"  Clear browser cookies to start fresh.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
