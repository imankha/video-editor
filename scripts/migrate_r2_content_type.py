"""
T1470: Stamp Content-Type=video/mp4 on existing R2 `games/*.mp4` objects.

Background: prior uploads (and the T1450 faststart migration, before its fix)
used s3.upload_file without ExtraArgs, so objects were written without a
Content-Type header. Browsers reject playback of those objects with
"Video format not supported".

This script HEADs every object under `games/` and, for any that is missing a
Content-Type (or has something other than video/mp4), issues a CopyObject
onto itself with MetadataDirective=REPLACE to stamp ContentType=video/mp4.
Bytes are not rewritten (R2 copy is metadata-only for same-bucket+key);
size/ETag of multipart objects is preserved.

Idempotent: already-correct objects are skipped.

Usage (from repo root):
    python scripts/migrate_r2_content_type.py --dry-run
    python scripts/migrate_r2_content_type.py               # actually migrate
    python scripts/migrate_r2_content_type.py --limit 5     # stop after N

Env: reads R2_* from .env at repo root. Point to the correct env's .env
before running (the prior faststart migration used this same convention).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

TARGET_CT = "video/mp4"


def load_env(env: str) -> None:
    """Load .env (dev), .env.staging, or .env.prod."""
    name = ".env" if env == "dev" else f".env.{env}"
    path = REPO / name
    if not path.exists():
        raise SystemExit(f"Env file not found: {path}")
    load_dotenv(path, override=True)
    print(f"Loaded env: {path.name}")


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def bucket() -> str:
    return os.environ["R2_BUCKET"]


def fmt_size(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if f < 1024:
            return f"{f:.1f}{unit}"
        f /= 1024
    return f"{f:.1f}TB"


def migrate_one(s3, key: str, size: int, dry_run: bool) -> str:
    b = bucket()
    head = s3.head_object(Bucket=b, Key=key)
    current = head.get("ContentType")
    if current == TARGET_CT:
        print(f"[ok]   {key}  size={fmt_size(size)}  ct={current}")
        return "skip"

    print(f"[stamp] {key}  size={fmt_size(size)}  ct={current!r} -> {TARGET_CT}")
    if dry_run:
        return "would-migrate"

    # CopyObject onto self with MetadataDirective=REPLACE rewrites only metadata.
    # R2 supports this for objects up to 5 GiB; our game objects are well under.
    s3.copy_object(
        Bucket=b,
        Key=key,
        CopySource={"Bucket": b, "Key": key},
        MetadataDirective="REPLACE",
        ContentType=TARGET_CT,
    )
    return "migrated"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["dev", "staging", "prod"], required=True)
    ap.add_argument("--dry-run", action="store_true", help="probe only, no changes")
    ap.add_argument("--limit", type=int, default=0, help="stop after N migrations (0=all)")
    args = ap.parse_args()

    load_env(args.env)

    if args.env == "prod" and not args.dry_run:
        ans = input("Running MIGRATE against PROD. Type 'yes' to proceed: ")
        if ans.strip().lower() != "yes":
            print("Aborted.")
            return 1

    s3 = s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    objects: list[tuple[str, int]] = []
    for page in paginator.paginate(Bucket=bucket(), Prefix="games/"):
        for o in page.get("Contents", []):
            objects.append((o["Key"], o["Size"]))

    print(f"Bucket: {bucket()}  Env: {args.env}")
    print(f"Found {len(objects)} game objects ({fmt_size(sum(s for _, s in objects))} total)")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'MIGRATE'}")
    print()

    counts = {"skip": 0, "would-migrate": 0, "migrated": 0, "error": 0}
    migrated = 0
    for key, size in objects:
        try:
            r = migrate_one(s3, key, size, args.dry_run)
            counts[r] = counts.get(r, 0) + 1
            if r == "migrated":
                migrated += 1
                if args.limit and migrated >= args.limit:
                    print(f"\nLimit reached: stopped after {migrated} migrations")
                    break
        except Exception as e:
            counts["error"] += 1
            print(f"  ERROR on {key}: {e}")

    print()
    print("Summary:", counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
