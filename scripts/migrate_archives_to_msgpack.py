"""
T2600: Migrate R2 project archives from JSON to msgpack format.

Downloads each archive/*.json, re-encodes binary columns, packs as msgpack,
uploads as archive/*.msgpack, then deletes the .json original.

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_archives_to_msgpack.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_archives_to_msgpack.py --env prod
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_archives_to_msgpack.py --env prod --dry-run
"""

import argparse
import json
import sys
from pathlib import Path

import boto3
import msgpack
from botocore.config import Config as BotoConfig

PROJECT_ROOT = Path(__file__).parent.parent

BINARY_COLUMNS = {"crop_data", "timing_data", "segments_data", "highlights_data", "input_data"}


def load_env(env_name):
    env_file = PROJECT_ROOT / ".env" if env_name == "dev" else PROJECT_ROOT / f".env.{env_name}"
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
    for key in ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]:
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)
    config.setdefault("APP_ENV", env_name)
    return config


def get_s3_client(config):
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def encode_binary_column(value):
    """Re-encode a JSON-deserialized binary column value to msgpack bytes."""
    if value is None:
        return None
    if isinstance(value, str):
        parsed = json.loads(value)
        return msgpack.packb(parsed, use_bin_type=True)
    if isinstance(value, (list, dict)):
        return msgpack.packb(value, use_bin_type=True)
    return value


def convert_archive(archive_data):
    """Convert a JSON-parsed archive dict so binary columns are msgpack bytes."""
    archive_data["version"] = 2

    for clip in archive_data.get("working_clips", []):
        for col in BINARY_COLUMNS:
            if col in clip and clip[col] is not None:
                clip[col] = encode_binary_column(clip[col])

    for video in archive_data.get("working_videos", []):
        for col in BINARY_COLUMNS:
            if col in video and video[col] is not None:
                video[col] = encode_binary_column(video[col])

    return archive_data


def migrate_archives(config, dry_run=False):
    s3 = get_s3_client(config)
    bucket = config["R2_BUCKET"]
    app_env = config["APP_ENV"]
    prefix = f"{app_env}/users/"

    paginator = s3.get_paginator("list_objects_v2")
    json_keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if "/archive/" in key and key.endswith(".json"):
                json_keys.append(key)

    print(f"Found {len(json_keys)} JSON archives to migrate")
    if not json_keys:
        return

    migrated = 0
    failed = 0
    for key in json_keys:
        msgpack_key = key[:-5] + ".msgpack"
        print(f"  {key} -> {msgpack_key}", end="")

        if dry_run:
            print(" [DRY RUN]")
            migrated += 1
            continue

        try:
            response = s3.get_object(Bucket=bucket, Key=key)
            raw = response["Body"].read()
            archive = json.loads(raw.decode("utf-8"))

            converted = convert_archive(archive)
            packed = msgpack.packb(converted, use_bin_type=True, default=str)

            s3.put_object(Bucket=bucket, Key=msgpack_key, Body=packed)

            s3.delete_object(Bucket=bucket, Key=key)

            ratio = len(packed) / len(raw) * 100 if raw else 0
            print(f" OK ({len(raw)} -> {len(packed)} bytes, {ratio:.0f}%)")
            migrated += 1

        except Exception as e:
            print(f" FAILED: {e}")
            failed += 1

    print(f"\nDone: {migrated} migrated, {failed} failed")


def main():
    parser = argparse.ArgumentParser(description="Migrate R2 archives from JSON to msgpack")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--dry-run", action="store_true", help="List archives without converting")
    args = parser.parse_args()

    config = load_env(args.env)
    migrate_archives(config, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
