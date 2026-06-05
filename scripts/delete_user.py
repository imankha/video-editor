"""
Hard-delete user accounts. Unlike reset-test-user.py (which clears profile data
but leaves the user record + R2 prefix intact for re-login testing), this script:

  1. Deletes the user row from Postgres (+ sessions, game_storage_refs)
  2. Purges the full R2 prefix {app_env}/users/{uid}/ (profile DBs, clips, etc.)
  3. Removes the local user_data/{uid}/ directory
  4. Restarts Fly.io machines (staging/prod) to clear cached state

Games in R2 (games/<hash>.mp4) are NEVER touched -- shared across users.

Usage (from project root):
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env prod --email imankh@gmail.com
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env prod --all-except sarkarati@gmail.com
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env dev --all

Add --dry-run to list what would be deleted without touching anything.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

FLY_APPS = {
    "staging": "reel-ballers-api-staging",
    "prod": "reel-ballers-api",
}


def load_env(env_name: str) -> dict:
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found"); sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            config[k.strip()] = v.strip()
    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"ERROR: {key} missing in {env_file}"); sys.exit(1)
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


def purge_r2_prefix(s3, bucket: str, prefix: str, dry_run: bool) -> int:
    paginator = s3.get_paginator("list_objects_v2")
    total = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        contents = page.get("Contents") or []
        if not contents:
            continue
        keys = [{"Key": o["Key"]} for o in contents]
        total += len(keys)
        if dry_run:
            for k in keys:
                print(f"    would delete: {k['Key']}")
        else:
            for i in range(0, len(keys), 1000):
                s3.delete_objects(Bucket=bucket, Delete={"Objects": keys[i:i+1000]})
    return total


def restart_fly(env_name: str) -> None:
    app = FLY_APPS.get(env_name)
    if not app:
        return
    print(f"\n--- Restarting Fly machines ({app}) ---")
    try:
        r = subprocess.run(["fly", "machines", "list", "-a", app, "--json"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print(f"  WARN: list failed: {r.stderr.strip()}"); return
        import json
        for m in [x for x in json.loads(r.stdout) if x.get("state") == "started"]:
            rr = subprocess.run(["fly", "machines", "restart", m["id"], "-a", app],
                                capture_output=True, text=True, timeout=60)
            print(f"  {'restarted' if rr.returncode == 0 else 'FAILED'} {m['id']}")
        import urllib.request
        try:
            urllib.request.urlopen(f"https://{app}.fly.dev/api/health", timeout=30)
            print("  Server warmed")
        except Exception as e:
            print(f"  WARN: warmup failed: {e}")
    except FileNotFoundError:
        print("  WARN: 'fly' CLI not found")
    except Exception as e:
        print(f"  WARN: {e}")


def delete_one(user_id: str, email: str, app_env: str, bucket: str,
               s3, pg_conn, dry_run: bool) -> None:
    print(f"\n=== Deleting user_id={user_id} ({email}) in {app_env} ===")

    prefix = f"{app_env}/users/{user_id}/"
    print(f"  R2 purge: {prefix}")
    count = purge_r2_prefix(s3, bucket, prefix, dry_run)
    print(f"    {'would delete' if dry_run else 'deleted'} {count} R2 objects")

    local_dir = USER_DATA / user_id
    if local_dir.exists():
        print(f"  local purge: {local_dir}")
        if not dry_run:
            shutil.rmtree(local_dir, ignore_errors=True)

    cur = pg_conn.cursor()
    if dry_run:
        cur.execute("SELECT COUNT(*) as cnt FROM pending_teammate_shares WHERE sharer_user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from pending_teammate_shares")
        cur.execute("SELECT COUNT(*) as cnt FROM shares WHERE sharer_user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from shares (+ cascaded extensions)")
    else:
        cur.execute("DELETE FROM pending_teammate_shares WHERE sharer_user_id = %s", (user_id,))
        cur.execute("DELETE FROM shares WHERE sharer_user_id = %s", (user_id,))
    for table in ("game_storage_refs", "sessions"):
        if dry_run:
            cur.execute(f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id = %s", (user_id,))
            cnt = cur.fetchone()["cnt"]
            print(f"    would delete {cnt} rows from {table}")
        else:
            cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))

    if dry_run:
        cur.execute("SELECT COUNT(*) as cnt FROM user_actions WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from user_actions")
        cur.execute("SELECT COUNT(*) as cnt FROM user_segments WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from user_segments")
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from users")
    else:
        cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--email", help="Delete a single user by email")
    grp.add_argument("--all", action="store_true", help="Delete ALL users in this env")
    grp.add_argument("--all-except", help="Delete all users EXCEPT this email")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-restart", action="store_true")
    p.add_argument("--yes", action="store_true", help="Skip confirmation")
    args = p.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket}) dry_run={args.dry_run}")

    s3 = get_r2_client(config)
    pg_conn = get_pg_conn(config)
    cur = pg_conn.cursor()

    if args.email:
        cur.execute("SELECT user_id, email FROM users WHERE email = %s", (args.email,))
    elif args.all_except:
        cur.execute("SELECT user_id, email FROM users WHERE email != %s", (args.all_except,))
    else:
        cur.execute("SELECT user_id, email FROM users")

    rows = cur.fetchall()

    if not rows:
        print("No matching users found.")
        return

    print(f"\nTarget users ({len(rows)}):")
    for r in rows:
        print(f"  - {r['email']} ({r['user_id']})")

    if not args.yes and not args.dry_run:
        reply = input(f"\nDelete {len(rows)} user(s) from {args.env}? Type 'yes' to confirm: ")
        if reply.strip() != "yes":
            print("Aborted."); return

    for r in rows:
        delete_one(r["user_id"], r["email"], app_env, bucket, s3, pg_conn, args.dry_run)

    if not args.dry_run:
        pg_conn.commit()
    pg_conn.close()

    if args.env in ("staging", "prod") and not args.no_restart and not args.dry_run:
        restart_fly(args.env)

    print(f"\n=== Done. Deleted {len(rows)} user(s) from {args.env}. ===")


if __name__ == "__main__":
    main()
