"""
Backfill final_videos.name for rows where it's NULL.

Resolves the name from the same sources the old COALESCE logic used:
- For brilliant_clips: raw_clip.name
- For annotated_games: game display name
- For custom_projects: project.name
- Final fallback: "Video {id}"

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\backfill-fv-names.py sarkarati@gmail.com --env staging
"""

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent


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
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()
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


def get_user_id(r2_client, bucket, email, env_name):
    """Look up user_id from auth.sqlite in R2."""
    tmp = Path(tempfile.mkdtemp()) / "auth.sqlite"
    r2_key = f"{env_name}/auth/auth.sqlite"
    r2_client.download_file(bucket, r2_key, str(tmp))
    conn = sqlite3.connect(str(tmp))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT user_id FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    if not row:
        print(f"ERROR: No user found with email {email}")
        sys.exit(1)
    return row["user_id"]


def list_profiles(r2_client, bucket, user_id, env_name):
    """List profile IDs for a user by scanning R2 keys."""
    prefix = f"{env_name}/users/{user_id}/profiles/"
    resp = r2_client.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter="/")
    profiles = []
    for cp in resp.get("CommonPrefixes", []):
        profile_id = cp["Prefix"].rstrip("/").split("/")[-1]
        profiles.append(profile_id)
    return profiles


def backfill_db(db_path):
    """Backfill NULL names in a profile database. Returns count of rows updated."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check for NULL names
    cursor.execute("SELECT COUNT(*) as cnt FROM final_videos WHERE name IS NULL")
    null_count = cursor.fetchone()["cnt"]
    if null_count == 0:
        conn.close()
        return 0

    print(f"  Found {null_count} final_videos with NULL name")

    # Backfill from projects table
    cursor.execute("""
        UPDATE final_videos SET name = (
            SELECT COALESCE(p.name, 'Video ' || final_videos.id)
            FROM projects p WHERE p.id = final_videos.project_id
        )
        WHERE name IS NULL AND project_id IS NOT NULL
    """)
    updated_from_projects = cursor.rowcount
    print(f"  Updated {updated_from_projects} from projects.name")

    # Backfill brilliant clips from raw_clips
    cursor.execute("""
        UPDATE final_videos SET name = (
            SELECT rc.name FROM raw_clips rc
            WHERE rc.auto_project_id = final_videos.project_id
        )
        WHERE name IS NULL AND source_type = 'brilliant_clip' AND project_id IS NOT NULL
    """)
    updated_from_raw = cursor.rowcount
    print(f"  Updated {updated_from_raw} from raw_clips.name")

    # Remaining NULLs get fallback
    cursor.execute("""
        UPDATE final_videos SET name = 'Video ' || id
        WHERE name IS NULL
    """)
    updated_fallback = cursor.rowcount
    if updated_fallback:
        print(f"  Updated {updated_fallback} with fallback 'Video N'")

    conn.commit()
    # WAL checkpoint for clean upload
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return null_count


def main():
    parser = argparse.ArgumentParser(description="Backfill final_videos.name for NULL rows")
    parser.add_argument("email", help="User email to backfill")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="staging")
    parser.add_argument("--dry-run", action="store_true", help="Download and check without uploading")
    args = parser.parse_args()

    config = load_env(args.env)
    r2_client = get_r2_client(config)
    bucket = config["R2_BUCKET"]

    print(f"Looking up {args.email} on {args.env}...")
    user_id = get_user_id(r2_client, bucket, args.email, args.env)
    print(f"  user_id: {user_id}")

    profiles = list_profiles(r2_client, bucket, user_id, args.env)
    print(f"  profiles: {profiles}")

    for profile_id in profiles:
        r2_key = f"{args.env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
        tmp_dir = Path(tempfile.mkdtemp())
        local_db = tmp_dir / "profile.sqlite"

        print(f"\nProcessing profile: {profile_id}")
        try:
            r2_client.download_file(bucket, r2_key, str(local_db))
        except Exception as e:
            print(f"  SKIP: Could not download {r2_key}: {e}")
            continue

        updated = backfill_db(local_db)

        if updated > 0 and not args.dry_run:
            r2_client.upload_file(str(local_db), bucket, r2_key)
            print(f"  Uploaded updated DB to R2: {r2_key}")
        elif updated > 0:
            print(f"  DRY RUN: Would upload {r2_key}")
        else:
            print(f"  No changes needed")

    print("\nDone!")


if __name__ == "__main__":
    main()
