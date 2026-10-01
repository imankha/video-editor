"""
Hard-delete bug_reports rows older than N days (by created_at), regardless of
status, including their R2 screenshot/log assets.

Differs from the admin API's DELETE /bugs/purge, which only purges status='done'
bugs by resolved_at. This script purges ALL statuses by created_at (report date).

Requires:
  - Fly proxy for prod Postgres: fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env.prod at project root

Usage (dry-run is the default -- lists what would be deleted, deletes nothing):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\purge_old_bug_reports.py \\
        --env prod --days 7

    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\purge_old_bug_reports.py \\
        --env prod --days 7 --execute
"""

import argparse
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent


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
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()

    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)
    return config


def r2_client(config):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=["dev", "staging", "prod"], required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--execute", action="store_true", help="Actually delete. Default is dry-run.")
    args = parser.parse_args()

    config = load_env(args.env)
    conn = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, reporter_email, created_at, resolved_at,
                       screenshot_r2_key, logs_r2_key
                FROM bug_reports
                WHERE created_at < NOW() - INTERVAL '%s days'
                ORDER BY created_at ASC
                """,
                (args.days,),
            )
            rows = cur.fetchall()

        if not rows:
            print(f"No bug_reports older than {args.days} days. Nothing to do.")
            return

        by_status = {}
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1

        print(f"Found {len(rows)} bug_reports older than {args.days} days ({args.env}):")
        for status, count in sorted(by_status.items()):
            print(f"  {status}: {count}")
        print()
        for r in rows:
            print(f"  id={r['id']:<6} status={r['status']:<10} created_at={r['created_at']} "
                  f"reporter={r['reporter_email']}")

        if not args.execute:
            print("\nDRY RUN -- no changes made. Re-run with --execute to delete.")
            return

        r2 = r2_client(config)
        bucket = config["R2_BUCKET"]
        deleted_keys = 0
        for r in rows:
            for key in (r["screenshot_r2_key"], r["logs_r2_key"]):
                if key:
                    r2.delete_object(Bucket=bucket, Key=key)
                    deleted_keys += 1

        ids = [r["id"] for r in rows]
        with conn.cursor() as cur:
            cur.execute("DELETE FROM bug_reports WHERE id = ANY(%s)", (ids,))
        conn.commit()

        print(f"\nDeleted {len(ids)} bug_reports rows and {deleted_keys} R2 objects.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
