"""
Reset ALL accounts for fresh testing. Preserves games.

Runs against both dev and staging environments (never prod).
Clears all profile data (except games) and deletes all auth records
so every Google login creates a fresh account.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset_all_accounts.py --yes

What it does (per environment):
1. Loads R2 credentials from .env (dev) and .env.staging (staging)
2. Finds ALL users in auth.sqlite
3. Clears all profile tables EXCEPT games in every profile database
4. Deletes all user records, sessions, and credit_transactions from auth.sqlite
5. Uploads cleared databases to R2 for each environment
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


def reset_profiles(user_id, r2_configs):
    """Clear all profile tables (except games) for a user, upload to each env's R2."""
    profiles_dir = USER_DATA / user_id / "profiles"
    if not profiles_dir.exists():
        print(f"    No profiles directory — skipping")
        return

    for db_path in profiles_dir.glob("*/profile.sqlite"):
        profile_id = db_path.parent.name
        print(f"    Profile {profile_id}: clearing tables...")

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

        # Upload to R2 for each environment
        for env_name, (r2_client, config) in r2_configs.items():
            app_env = config["APP_ENV"]
            bucket = config["R2_BUCKET"]
            r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
            checkpoint_and_upload(db_path, r2_client, bucket, r2_key)


def main():
    parser = argparse.ArgumentParser(description="Reset ALL dev/staging accounts (preserves games, never touches prod)")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    if not AUTH_DB.exists():
        print(f"ERROR: auth.sqlite not found at {AUTH_DB}")
        sys.exit(1)

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

    # Get all users
    conn = sqlite3.connect(str(AUTH_DB))
    conn.row_factory = sqlite3.Row
    users = conn.execute("SELECT user_id, email FROM users").fetchall()

    if not users:
        print("\nNo users found in auth.sqlite — nothing to reset.")
        conn.close()
        return

    print(f"\n{'='*60}")
    print(f"  RESETTING {len(users)} ACCOUNT(S)")
    print(f"  Environments: {', '.join(r2_configs.keys())}")
    print(f"  Games will be PRESERVED")
    print(f"{'='*60}")

    # Confirm
    if not args.yes:
        answer = input("\nType 'yes' to proceed: ").strip().lower()
        if answer != "yes":
            print("Aborted.")
            sys.exit(0)

    # Reset each user's profile data
    for user in users:
        user_id = user["user_id"]
        email = user["email"] or "(no email)"
        print(f"\n--- {user_id} ({email}) ---")
        reset_profiles(user_id, r2_configs)

    # Delete all auth records
    print(f"\n--- Clearing auth.sqlite ---")
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
    print(f"  Games preserved. Clear browser cookies to start fresh.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
