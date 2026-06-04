"""
Reset a user for fresh new-user-flow testing.

Deletes the user record from Postgres so the next Google login
creates a fresh account. Also clears all profile data locally and in R2.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset-test-user.py imankh@gmail.com --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset-test-user.py imankh@gmail.com --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\reset-test-user.py imankh@gmail.com --env prod

What it does:
1. Loads R2 + Postgres credentials from the appropriate .env file
2. Looks up user_id by email in Postgres
3. For remote envs (staging/prod): downloads profile DBs from R2
4. Clears all profile tables EXCEPT games in every profile database
5. Uploads cleared profile databases back to R2
6. Deletes user record + sessions + refs from Postgres
7. For staging/prod: restarts Fly.io machines to clear cached per-user state
8. Next Google login with this email will link to the current guest session
"""

import argparse
import sqlite3
import subprocess
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

FLY_APPS = {
    "staging": "reel-ballers-api-staging",
    "prod": "reel-ballers-api",
}


def load_env(env_name):
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
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

    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}"); sys.exit(1)

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
    print(f"  Uploaded to R2: {r2_key}")


def download_from_r2(r2_client, bucket, r2_key, local_path):
    local_path.parent.mkdir(parents=True, exist_ok=True)
    r2_client.download_file(bucket, r2_key, str(local_path))
    print(f"  Downloaded from R2: {r2_key}")


def _fly_env(config):
    import os
    env = os.environ.copy()
    token = (
        os.environ.get("FLY_ACCESS_TOKEN")
        or os.environ.get("FLY_API_TOKEN")
        or config.get("FLY_API_TOKEN")
    )
    if not token:
        fly_config = Path.home() / ".fly" / "config.yml"
        if fly_config.exists():
            for line in fly_config.read_text().splitlines():
                if line.startswith("access_token:"):
                    token = line.split(":", 1)[1].strip()
                    break
    if token:
        env["FLY_ACCESS_TOKEN"] = token
    return env


def restart_fly_machines(env_name, config):
    app_name = FLY_APPS.get(env_name)
    if not app_name:
        return

    fly_subprocess_env = _fly_env(config)
    print(f"\n--- Restarting Fly.io machines ({app_name}) ---")
    try:
        result = subprocess.run(
            ["fly", "machines", "list", "-a", app_name, "--json"],
            capture_output=True, text=True, timeout=30,
            env=fly_subprocess_env,
        )
        if result.returncode != 0:
            print(f"  WARNING: Could not list machines: {result.stderr.strip()}")
            print(f"  To fix: add FLY_API_TOKEN=<token> to your .env.{env_name} file,")
            print(f"  or run: fly machines restart -a {app_name} --select")
            return

        import json
        machines = json.loads(result.stdout)
        started = [m for m in machines if m.get("state") == "started"]

        if not started:
            print("  No running machines to restart")
            return

        for m in started:
            mid = m["id"]
            r = subprocess.run(
                ["fly", "machines", "restart", mid, "-a", app_name],
                capture_output=True, text=True, timeout=60,
                env=fly_subprocess_env,
            )
            if r.returncode == 0:
                print(f"  Restarted {mid}")
            else:
                print(f"  WARNING: Failed to restart {mid}: {r.stderr.strip()}")

        print("  Warming up server...")
        import urllib.request
        health_url = f"https://{app_name}.fly.dev/api/health"
        try:
            urllib.request.urlopen(health_url, timeout=30)
            print("  Server is ready")
        except Exception as e:
            print(f"  WARNING: Health check failed: {e}")

    except FileNotFoundError:
        print("  WARNING: 'fly' CLI not found — skipping machine restart")
    except Exception as e:
        print(f"  WARNING: Could not restart machines: {e}")


def main():
    parser = argparse.ArgumentParser(description="Reset a user for NUF testing")
    parser.add_argument("email", help="User email (e.g., imankh@gmail.com)")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"],
                        help="Environment (determines R2 prefix and .env file)")
    parser.add_argument("--no-restart", action="store_true",
                        help="Skip Fly.io machine restart (staging/prod only)")
    args = parser.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    is_remote = args.env in ("staging", "prod")
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")

    r2_client = get_r2_client(config)
    pg_conn = get_pg_conn(config)

    cur = pg_conn.cursor()
    cur.execute("SELECT user_id FROM users WHERE email = %s", (args.email,))
    row = cur.fetchone()
    if not row:
        print(f"No user found with email '{args.email}' — nothing to reset.")
        pg_conn.close()
        sys.exit(0)

    user_id = row["user_id"]
    print(f"\n=== Resetting user '{user_id}' ({args.email}) in {args.env} ===")

    # For remote envs, download profile DBs from R2
    if is_remote:
        print(f"\n--- Downloading profile DBs from R2 ---")
        resp = r2_client.list_objects_v2(
            Bucket=bucket,
            Prefix=f"{app_env}/users/{user_id}/profiles/",
        )
        for obj in resp.get("Contents", []):
            if obj["Key"].endswith("profile.sqlite"):
                parts = obj["Key"].split("/")
                local = USER_DATA / "/".join(parts[2:])
                download_from_r2(r2_client, bucket, obj["Key"], local)

    # Clear all profile databases (per-user SQLite — unchanged)
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
                    pass
            pconn.commit()
            pconn.close()
            print(f"  Cleared: {', '.join(TABLES_TO_CLEAR)}")

            r2_key = f"{app_env}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
            checkpoint_and_upload(db_path, r2_client, bucket, r2_key)

    # Delete user from Postgres
    print("\n--- Deleting user from Postgres ---")
    # Reset recipient-side share state so share links can be re-materialized
    cur.execute(
        """UPDATE share_games SET materialized_at = NULL, recipient_profile_id = NULL
           WHERE share_id IN (SELECT id FROM shares WHERE recipient_email = %s)""",
        (args.email,),
    )
    cur.execute(
        """UPDATE pending_teammate_shares SET resolved_at = NULL
           WHERE share_id IN (SELECT id FROM shares WHERE recipient_email = %s)""",
        (args.email,),
    )
    cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
    cur.execute("DELETE FROM pending_teammate_shares WHERE sharer_user_id = %s", (user_id,))
    cur.execute("DELETE FROM shares WHERE sharer_user_id = %s", (user_id,))
    for table in ("game_storage_refs", "sessions"):
        cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
    pg_conn.commit()
    pg_conn.close()
    print(f"  Deleted: user record + sessions + refs for '{user_id}'")

    if is_remote and not args.no_restart:
        restart_fly_machines(args.env, config)

    print(f"\n=== Done. User '{args.email}' fully removed from {args.env}. ===")
    print(f"Next Google login with this email will create a fresh account.")
    print(f"IMPORTANT: Clear browser cookies or use incognito to start as a new guest.")


if __name__ == "__main__":
    main()
