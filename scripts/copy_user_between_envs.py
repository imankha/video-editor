"""
Copy a single user's data from one environment to another.

Copies:
  1. Postgres rows (users + game_storage_refs)
  2. R2 objects (profile.sqlite, user.sqlite, media files)

Requirements:
  - Fly proxy running for BOTH source and destination Postgres:
      fly proxy 15432:5432 --app reel-ballers-db-staging
      fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env files at project root (.env, .env.staging, .env.prod)

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\copy_user_between_envs.py \
        --email imankh@gmail.com --from production --to staging
"""

import argparse
import logging
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("copy-user")


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    env_file = PROJECT_ROOT / f".env{suffix}"
    if not env_file.exists():
        log.error(f"{env_file} not found")
        sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config: dict):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=60,
        ),
        region_name="auto",
    )


def get_pg_conn(config: dict):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def copy_postgres_rows(src_config: dict, dst_config: dict, email: str, dry_run: bool) -> str:
    """Copy user + game_storage_refs from source to destination Postgres. Returns user_id."""
    src_conn = get_pg_conn(src_config)
    dst_conn = get_pg_conn(dst_config)

    try:
        src_cur = src_conn.cursor()
        src_cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        user_row = src_cur.fetchone()
        if not user_row:
            log.error(f"User {email} not found in source Postgres")
            sys.exit(1)

        user_id = user_row["user_id"]
        log.info(f"Found user_id: {user_id}")

        if dry_run:
            log.info(f"[DRY RUN] Would copy users row for {user_id}")
        else:
            dst_cur = dst_conn.cursor()

            # Upsert user row
            cols = list(user_row.keys())
            vals = [user_row[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "user_id")
            dst_cur.execute(
                f"INSERT INTO users ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT (user_id) DO UPDATE SET {update_set}",
                vals,
            )
            log.info(f"Copied users row for {user_id}")

            # Copy game_storage_refs
            src_cur.execute("SELECT * FROM game_storage_refs WHERE user_id = %s", (user_id,))
            refs = src_cur.fetchall()
            for ref in refs:
                dst_cur.execute(
                    """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, profile_id, blake3_hash) DO NOTHING""",
                    (ref["user_id"], ref["profile_id"], ref["blake3_hash"],
                     ref["game_size_bytes"], ref["storage_expires_at"], ref["created_at"]),
                )
            log.info(f"Copied {len(refs)} game_storage_refs rows")

            dst_conn.commit()

        return user_id

    finally:
        src_conn.close()
        dst_conn.close()


def copy_r2_objects(config: dict, user_id: str, src_prefix: str, dst_prefix: str, dry_run: bool):
    """Copy all R2 objects for a user from source prefix to destination prefix."""
    r2 = get_r2_client(config)
    bucket = config["R2_BUCKET"]

    user_prefix = f"{src_prefix}/users/{user_id}/"
    paginator = r2.get_paginator("list_objects_v2")
    src_keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=user_prefix):
        for obj in page.get("Contents", []) or []:
            src_keys.append(obj["Key"])

    log.info(f"Found {len(src_keys)} R2 objects to copy")

    copied = 0
    for key in src_keys:
        dst_key = key.replace(f"{src_prefix}/", f"{dst_prefix}/", 1)
        if dry_run:
            log.info(f"  [DRY RUN] {key} -> {dst_key}")
        else:
            r2.copy_object(
                Bucket=bucket,
                Key=dst_key,
                CopySource={"Bucket": bucket, "Key": key},
            )
        copied += 1
        if copied % 20 == 0:
            log.info(f"  Copied {copied}/{len(src_keys)}...")

    log.info(f"R2 copy complete: {copied} objects from {src_prefix}/ to {dst_prefix}/")


def main():
    parser = argparse.ArgumentParser(description="Copy a user between environments")
    parser.add_argument("--email", required=True)
    parser.add_argument("--from", dest="from_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--to", dest="to_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.from_env == args.to_env:
        log.error("Source and destination must be different")
        sys.exit(1)

    src_config = load_env(args.from_env)
    dst_config = load_env(args.to_env)

    log.info(f"Copying {args.email}: {args.from_env} -> {args.to_env}")

    # 1. Copy Postgres rows (users + game_storage_refs)
    user_id = copy_postgres_rows(src_config, dst_config, args.email, args.dry_run)

    # 2. Copy R2 objects
    src_prefix = src_config["APP_ENV"]
    dst_prefix = dst_config["APP_ENV"]
    copy_r2_objects(src_config, user_id, src_prefix, dst_prefix, args.dry_run)

    log.info(f"Done. User {args.email} ({user_id}) copied from {args.from_env} to {args.to_env}")


if __name__ == "__main__":
    main()
