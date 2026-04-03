"""
Reset a user for fresh new-user-flow testing.

Deletes the user record from auth.sqlite so the next Google login
creates a fresh account link (no cross-device recovery). Also clears
all profile data locally and in R2.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset-test-user.py imankh@gmail.com --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset-test-user.py imankh@gmail.com --env staging

What it does:
1. Loads R2 credentials from the appropriate .env file
2. Looks up user_id by email in auth.sqlite
3. Clears all tables in every profile database
4. Deletes the user record, sessions, and credit_transactions from auth.sqlite
5. Uploads cleared databases back to R2
6. Next Google login with this email will link to the current guest session
   (no user_id switch, no data loss, true new-user experience)
"""

import argparse
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

TABLES_TO_CLEAR = [
    "games",
    "raw_clips",
    "projects",
    "working_clips",
    "working_videos",
    "final_videos",
    "export_jobs",
    "achievements",
    "before_after_tracks",
]


def load_env(env_name):
    """Load .env or .env.staging file and return R2 config."""
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
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()

    required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
    for key in required:
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)

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
    print(f"  Uploaded to R2: {r2_key}")


def main():
    parser = argparse.ArgumentParser(description="Reset a user for NUF testing")
    parser.add_argument("email", help="User email (e.g., imankh@gmail.com)")
    parser.add_argument("--env", required=True, choices=["dev", "staging"],
                        help="Environment (determines R2 prefix and .env file)")
    args = parser.parse_args()

    # Load R2 config
    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")

    # Look up user_id by email
    if not AUTH_DB.exists():
        print(f"ERROR: auth.sqlite not found at {AUTH_DB}")
        sys.exit(1)

    conn = sqlite3.connect(str(AUTH_DB))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT user_id FROM users WHERE email = ?", (args.email,)).fetchone()
    if not row:
        print(f"No user found with email '{args.email}' — nothing to reset.")
        conn.close()
        sys.exit(0)

    user_id = row["user_id"]
    print(f"\n=== Resetting user '{user_id}' ({args.email}) in {args.env} ===")

    # Connect to R2
    r2_client = get_r2_client(config)

    # Clear all profile databases
    profiles_dir = USER_DATA / user_id / "profiles"
    if not profiles_dir.exists():
        print(f"WARNING: No profiles directory at {profiles_dir}")
    else:
        for db_path in profiles_dir.glob("*/profile.sqlite"):
            profile_id = db_path.parent.name
            print(f"\n--- Clearing profile: {profile_id} ---")

            pconn = sqlite3.connect(str(db_path))
            for table in TABLES_TO_CLEAR:
                try:
                    pconn.execute(f"DELETE FROM {table}")
                except sqlite3.OperationalError:
                    pass  # Table might not exist
            pconn.commit()
            pconn.close()
            print(f"  Cleared: {', '.join(TABLES_TO_CLEAR)}")

            # Upload cleared DB to R2
            r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
            checkpoint_and_upload(db_path, r2_client, bucket, r2_key)

    # Delete user record entirely from auth.sqlite
    # This ensures the next Google login with this email creates a fresh link
    # to whatever guest session is active (no cross-device recovery, no user switch)
    print("\n--- Deleting user from auth.sqlite ---")
    conn.execute("DELETE FROM credit_transactions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    print(f"  Deleted: user record, sessions, credit_transactions for '{user_id}'")

    # Upload cleaned auth.sqlite to R2
    auth_r2_key = f"{app_env}/auth/auth.sqlite"
    checkpoint_and_upload(AUTH_DB, r2_client, bucket, auth_r2_key)

    print(f"\n=== Done. User '{args.email}' fully removed from {args.env}. ===")
    print(f"Next Google login with this email will create a fresh account.")
    print(f"IMPORTANT: Clear browser cookies or use incognito to start as a new guest.")


if __name__ == "__main__":
    main()
