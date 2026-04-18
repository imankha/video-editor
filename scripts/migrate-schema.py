"""
Migrate existing profile databases to the current schema.

Adds missing columns to tables that were created before those columns
existed. Safe to run multiple times — uses ALTER TABLE which is a no-op
if the column already exists (caught by try/except).

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env prod
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate-schema.py --env prod --email sarkarati@gmail.com
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

# All columns that may be missing from older databases.
# Format: (table_name, column_definition)
MIGRATIONS = [
    # raw_clips
    ("raw_clips", "name TEXT"),
    ("raw_clips", "notes TEXT"),
    ("raw_clips", "start_time REAL"),
    ("raw_clips", "end_time REAL"),
    ("raw_clips", "game_id INTEGER"),
    ("raw_clips", "auto_project_id INTEGER"),
    ("raw_clips", "default_highlight_regions TEXT"),
    ("raw_clips", "video_sequence INTEGER"),
    ("raw_clips", "boundaries_version INTEGER DEFAULT 1"),
    ("raw_clips", "boundaries_updated_at TIMESTAMP"),
    # working_clips
    ("working_clips", "crop_data TEXT"),
    ("working_clips", "timing_data TEXT"),
    ("working_clips", "segments_data TEXT"),
    ("working_clips", "version INTEGER NOT NULL DEFAULT 1"),
    ("working_clips", "exported_at TEXT DEFAULT NULL"),
    ("working_clips", "raw_clip_version INTEGER"),
    ("working_clips", "width INTEGER"),
    ("working_clips", "height INTEGER"),
    ("working_clips", "fps REAL"),
    # working_videos
    ("working_videos", "highlights_data TEXT"),
    ("working_videos", "text_overlays TEXT"),
    ("working_videos", "duration REAL"),
    ("working_videos", "effect_type TEXT DEFAULT 'original'"),
    ("working_videos", "version INTEGER NOT NULL DEFAULT 1"),
    ("working_videos", "overlay_version INTEGER DEFAULT 0"),
    ("working_videos", "highlight_color TEXT DEFAULT NULL"),
    # final_videos
    ("final_videos", "version INTEGER NOT NULL DEFAULT 1"),
    ("final_videos", "duration REAL"),
    ("final_videos", "source_type TEXT"),
    ("final_videos", "game_id INTEGER"),
    ("final_videos", "name TEXT"),
    ("final_videos", "rating_counts TEXT"),
    # games
    ("games", "video_duration REAL"),
    ("games", "video_width INTEGER"),
    ("games", "video_height INTEGER"),
    ("games", "video_size INTEGER"),
    ("games", "clip_count INTEGER DEFAULT 0"),
    ("games", "brilliant_count INTEGER DEFAULT 0"),
    ("games", "good_count INTEGER DEFAULT 0"),
    ("games", "interesting_count INTEGER DEFAULT 0"),
    ("games", "mistake_count INTEGER DEFAULT 0"),
    ("games", "blunder_count INTEGER DEFAULT 0"),
    ("games", "aggregate_score INTEGER DEFAULT 0"),
    ("games", "opponent_name TEXT"),
    ("games", "game_date TEXT"),
    ("games", "game_type TEXT"),
    ("games", "tournament_name TEXT"),
    ("games", "blake3_hash TEXT"),
    ("games", "last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ("games", "viewed_duration REAL DEFAULT 0"),
    ("games", "video_fps REAL"),
    ("games", "status TEXT DEFAULT 'ready'"),
    # projects
    ("projects", "is_auto_created INTEGER DEFAULT 0"),
    ("projects", "last_opened_at TIMESTAMP"),
    ("projects", "current_mode TEXT DEFAULT 'framing'"),
    ("projects", "archived_at TIMESTAMP DEFAULT NULL"),
    ("projects", "restored_at TIMESTAMP DEFAULT NULL"),
    # export_jobs
    ("export_jobs", "modal_call_id TEXT"),
    ("export_jobs", "game_id INTEGER"),
    ("export_jobs", "game_name TEXT"),
    ("export_jobs", "acknowledged_at TIMESTAMP"),
    ("export_jobs", "gpu_seconds REAL"),
    ("export_jobs", "modal_function TEXT"),
    # modal_tasks
    ("modal_tasks", "retry_count INTEGER DEFAULT 0"),
    # game_videos
    ("game_videos", "fps REAL"),
]

# Indexes to create (IF NOT EXISTS, safe to re-run)
INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_working_clips_project_version ON working_clips(project_id, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version ON working_clips(project_id, raw_clip_id, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_working_clips_project_upload_version ON working_clips(project_id, uploaded_filename, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_working_videos_project_version ON working_videos(project_id, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_final_videos_project_version ON final_videos(project_id, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_raw_clips_game_id ON raw_clips(game_id)",
    "CREATE INDEX IF NOT EXISTS idx_raw_clips_rating ON raw_clips(rating)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time_seq ON raw_clips(game_id, end_time, video_sequence)",
]


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


def main():
    parser = argparse.ArgumentParser(description="Migrate profile databases to current schema")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--email", help="Migrate only this user (by email)")
    args = parser.parse_args()

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
