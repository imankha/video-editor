"""
Copy a single user's R2 data from one environment prefix to another.

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\copy_user_between_envs.py \
        --email sarkarati@gmail.com --from staging --to dev
"""

import argparse
import logging
import sqlite3
import sys
import tempfile
from pathlib import Path

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


def main():
    parser = argparse.ArgumentParser(description="Copy a user's data between R2 env prefixes")
    parser.add_argument("--email", required=True)
    parser.add_argument("--from", dest="from_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--to", dest="to_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    src_config = load_env(args.from_env)
    dst_config = load_env(args.to_env)
    r2 = get_r2_client(src_config)
    bucket = src_config["R2_BUCKET"]
    src_prefix = src_config["APP_ENV"]
    dst_prefix = dst_config["APP_ENV"]

    log.info(f"Copying {args.email} from {src_prefix}/ -> {dst_prefix}/")

    # 1. Look up user_id from source auth.sqlite
    with tempfile.TemporaryDirectory() as tmpdir:
        auth_local = Path(tmpdir) / "auth.sqlite"
        auth_key = f"{src_prefix}/auth/auth.sqlite"
        log.info(f"Downloading {auth_key}...")
        r2.download_file(bucket, auth_key, str(auth_local))

        conn = sqlite3.connect(str(auth_local))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT user_id FROM users WHERE email = ?", (args.email,)).fetchone()
        conn.close()

        if not row:
            log.error(f"User {args.email} not found in {src_prefix} auth.sqlite")
            sys.exit(1)

        user_id = row["user_id"]
        log.info(f"Found user_id: {user_id}")

    # 2. List all objects under {src_prefix}/users/{user_id}/
    user_prefix = f"{src_prefix}/users/{user_id}/"
    paginator = r2.get_paginator("list_objects_v2")
    src_keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=user_prefix):
        for obj in page.get("Contents", []) or []:
            src_keys.append(obj["Key"])

    log.info(f"Found {len(src_keys)} objects to copy")

    # 3. Copy each object
    copied = 0
    for key in src_keys:
        dst_key = key.replace(f"{src_prefix}/", f"{dst_prefix}/", 1)
        if args.dry_run:
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

    log.info(f"Done: copied {copied} objects from {src_prefix}/ to {dst_prefix}/")
    log.info(f"User ID: {user_id}")


if __name__ == "__main__":
    main()
