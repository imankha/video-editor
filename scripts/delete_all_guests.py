"""
Delete all guest accounts (users with NULL email) as a one-off cleanup.

Runs BEFORE deploying T1330 code. After this script runs, every row in
auth.sqlite.users will have a non-null email, so the NOT NULL migration
in T1330 can run cleanly on next boot.

Usage (from project root):
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_all_guests.py --env staging
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_all_guests.py --env prod --confirm

What it does:
1. Loads R2 credentials for the target env
2. Downloads auth.sqlite from R2 (staging/prod) or uses local (dev)
3. Counts users with NULL email
4. Dry-run by default — prints what would be deleted; pass --confirm to execute
5. Deletes guest users (sessions cascade automatically via FK)
6. Lists the guests' user-scoped R2 prefixes (users/{uid}/) and deletes them
7. Re-uploads auth.sqlite to R2
8. Restarts Fly.io machines (staging/prod) to clear cached auth DB state

Safety:
- Dry-run by default
- Prints counts before/after
- Backs up auth.sqlite locally before modifying
- Does NOT delete rows with email set, ever
"""

import argparse
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

FLY_APPS = {
    "staging": "reel-ballers-api-staging",
    "prod": "reel-ballers-api",
}


def load_env(env_name):
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            config[k.strip()] = v.strip()
    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)
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


def download_auth_db(r2_client, bucket, app_env, dest):
    key = f"{app_env}/auth/auth.sqlite"
    print(f"Downloading {key} -> {dest}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    r2_client.download_file(bucket, key, str(dest))


def upload_auth_db(r2_client, bucket, app_env, src):
    key = f"{app_env}/auth/auth.sqlite"
    conn = sqlite3.connect(str(src))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    print(f"Uploading {src} -> {key}")
    r2_client.upload_file(str(src), bucket, key)


def list_guest_users(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT user_id, created_at, last_seen_at FROM users WHERE email IS NULL"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_sessions_for_guests(db_path):
    conn = sqlite3.connect(str(db_path))
    n = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email IS NULL)"
    ).fetchone()[0]
    conn.close()
    return n


def delete_guests(db_path):
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email IS NULL)"
        )
        conn.execute(
            "DELETE FROM credit_transactions WHERE user_id IN (SELECT user_id FROM users WHERE email IS NULL)"
        )
        cur = conn.execute("DELETE FROM users WHERE email IS NULL")
        deleted = cur.rowcount
        conn.commit()
        return deleted
    finally:
        conn.close()


def delete_r2_user_prefixes(r2_client, bucket, app_env, user_ids):
    if not user_ids:
        return 0
    deleted_count = 0
    for uid in user_ids:
        prefix = f"{app_env}/users/{uid}/"
        paginator = r2_client.get_paginator("list_objects_v2")
        to_delete = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                to_delete.append({"Key": obj["Key"]})
        # Batch delete in chunks of 1000 (R2 max)
        for i in range(0, len(to_delete), 1000):
            chunk = to_delete[i : i + 1000]
            r2_client.delete_objects(Bucket=bucket, Delete={"Objects": chunk})
            deleted_count += len(chunk)
        print(f"  {uid}: removed {len(to_delete)} R2 objects")
    return deleted_count


def restart_fly(env_name):
    app = FLY_APPS.get(env_name)
    if not app:
        return
    print(f"\n--- Restarting Fly.io machines ({app}) ---")
    try:
        import json
        r = subprocess.run(
            ["fly", "machines", "list", "-a", app, "--json"],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            print(f"  WARN: list failed: {r.stderr.strip()}")
            return
        machines = json.loads(r.stdout)
        for m in [x for x in machines if x.get("state") == "started"]:
            mid = m["id"]
            rr = subprocess.run(
                ["fly", "machines", "restart", mid, "-a", app],
                capture_output=True, text=True, timeout=60,
            )
            print(f"  restart {mid}: {'ok' if rr.returncode == 0 else rr.stderr.strip()}")
    except FileNotFoundError:
        print("  WARN: fly CLI not found")
    except Exception as e:
        print(f"  WARN: {e}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    p.add_argument("--confirm", action="store_true",
                   help="Actually delete (default is dry-run)")
    p.add_argument("--no-restart", action="store_true")
    p.add_argument("--keep-r2", action="store_true",
                   help="Don't delete guest R2 object prefixes (auth DB cleanup only)")
    args = p.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    is_remote = args.env in ("staging", "prod")
    mode = "LIVE" if args.confirm else "DRY-RUN"
    print(f"=== delete_all_guests.py [{mode}] env={args.env} bucket={bucket} ===\n")

    r2_client = get_r2_client(config)

    if is_remote:
        download_auth_db(r2_client, bucket, app_env, AUTH_DB)

    if not AUTH_DB.exists():
        print(f"ERROR: {AUTH_DB} not found")
        sys.exit(1)

    guests = list_guest_users(AUTH_DB)
    session_n = count_sessions_for_guests(AUTH_DB)
    print(f"Found {len(guests)} guest users (null email), {session_n} associated sessions")
    if guests[:5]:
        print("First 5:")
        for g in guests[:5]:
            print(f"  {g['user_id']}  created={g['created_at']}  last_seen={g['last_seen_at']}")

    if not guests:
        print("Nothing to delete.")
        return

    if not args.confirm:
        print("\nDRY-RUN — pass --confirm to actually delete.")
        return

    # Backup before mutation
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    backup = AUTH_DB.with_name(f"auth.sqlite.{args.env}.pre-guest-cleanup.{ts}.bak")
    shutil.copy2(AUTH_DB, backup)
    print(f"\nBackup: {backup}")

    uids = [g["user_id"] for g in guests]

    # Delete from auth DB
    deleted = delete_guests(AUTH_DB)
    print(f"Deleted {deleted} user rows from auth.sqlite (sessions cascade)")

    # Delete guest R2 prefixes
    if is_remote and not args.keep_r2:
        print(f"\n--- Deleting guest R2 prefixes ({len(uids)} users) ---")
        n = delete_r2_user_prefixes(r2_client, bucket, app_env, uids)
        print(f"Total R2 objects deleted: {n}")

    # Upload cleaned auth DB
    if is_remote:
        upload_auth_db(r2_client, bucket, app_env, AUTH_DB)

    # Restart fly machines
    if is_remote and not args.no_restart:
        restart_fly(args.env)

    # Post-check
    remaining = list_guest_users(AUTH_DB)
    print(f"\nPost-cleanup guest users remaining: {len(remaining)}")
    print("Done.")


if __name__ == "__main__":
    main()
