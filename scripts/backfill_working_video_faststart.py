"""
T1533: Re-order every working_video in R2 so moov is at the head (faststart).

Working videos uploaded before the +faststart fix (or via a path that didn't
apply it) have moov at EOF. The browser has to range-walk the whole file to
find it, which triggers the 15s metadata-timeout retry storm in OverlayScreen.

For each user/profile in R2:
    1. Download profile.sqlite
    2. SELECT working_videos rows
    3. For each row, check moov placement in R2 via a 256-byte HEAD fetch + box parse
    4. If moov is NOT at the head: download full object, run
       `ffmpeg -movflags +faststart -c copy` to a temp file, upload back under
       the same R2 key.
    5. Bump working_videos.version for every fixed row.
    6. Upload profile.sqlite back with incremented db-version metadata so the
       running backend restores it on next access.

Usage (from repo root):
    python scripts/backfill_working_video_faststart.py --all-users --env dev [--dry-run]
    python scripts/backfill_working_video_faststart.py --user-id X --profile-id Y --env dev
    python scripts/backfill_working_video_faststart.py --local --env dev   # local DBs only

Output is per-object: PROBE (bytes read), VERDICT (FASTSTART/MOOV-AT-END/UNKNOWN),
REPAIR (bytes in/out + elapsed), and a final per-profile summary.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import boto3
from botocore.config import Config
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

BUCKET: Optional[str] = None
APP_ENV: Optional[str] = None
USER_PREFIX: Optional[str] = None

HEAD_PROBE_BYTES = 256
FULL_DOWNLOAD_TIMEOUT = 600


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _read_box_header(buf: bytes, offset: int) -> Optional[tuple[str, int, int]]:
    """Return (type, size, header_len) for the MP4 box at offset, or None."""
    if offset + 8 > len(buf):
        return None
    size = int.from_bytes(buf[offset:offset + 4], "big")
    btype = buf[offset + 4:offset + 8].decode("ascii", errors="replace")
    header_len = 8
    if size == 1:
        if offset + 16 > len(buf):
            return None
        size = int.from_bytes(buf[offset + 8:offset + 16], "big")
        header_len = 16
    if size < 8:
        return None
    return btype, size, header_len


def probe_moov_at_head(s3, key: str) -> tuple[str, list[str]]:
    """
    Fetch the first HEAD_PROBE_BYTES of the object and parse top-level boxes.

    Returns (verdict, box_list) where verdict is one of:
        'FASTSTART'    — moov appears before any mdat/moof
        'MOOV-AT-END'  — an mdat/moof box appears before moov (or no moov seen)
        'UNKNOWN'      — couldn't parse / fetch failed
    """
    try:
        resp = s3.get_object(
            Bucket=BUCKET, Key=key,
            Range=f"bytes=0-{HEAD_PROBE_BYTES - 1}",
        )
        buf = resp["Body"].read()
    except Exception as e:
        return "UNKNOWN", [f"fetch failed: {e}"]

    boxes = []
    offset = 0
    saw_moov = False
    saw_payload = False
    while offset + 8 <= len(buf) and len(boxes) < 6:
        hdr = _read_box_header(buf, offset)
        if hdr is None:
            break
        btype, size, _ = hdr
        boxes.append(f"{btype}@{offset}")
        if btype == "moov":
            saw_moov = True
            break
        if btype in ("mdat", "moof"):
            saw_payload = True
            break
        offset += size

    if saw_moov:
        return "FASTSTART", boxes
    if saw_payload and not saw_moov:
        return "MOOV-AT-END", boxes
    return "UNKNOWN", boxes


def faststart_repair(input_path: Path, output_path: Path) -> bool:
    """Run ffmpeg with +faststart to relocate moov to the head. Returns True on success."""
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(input_path),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_path),
            ],
            capture_output=True,
            timeout=FULL_DOWNLOAD_TIMEOUT,
        )
        if result.returncode != 0:
            print(f"  ffmpeg rc={result.returncode}: {result.stderr.decode('utf-8', errors='replace')[:300]!r}", file=sys.stderr)
            return False
        return output_path.exists() and output_path.stat().st_size > 0
    except Exception as e:
        print(f"  ffmpeg threw: {e}", file=sys.stderr)
        return False


def repair_working_video(s3, key: str, dry_run: bool) -> dict:
    """Download → faststart-repair → upload back. Returns stats dict."""
    stats = {"bytes_in": 0, "bytes_out": 0, "ok": False, "elapsed_s": 0.0}
    import time
    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        src = td_path / "in.mp4"
        dst = td_path / "out.mp4"
        try:
            s3.download_file(BUCKET, key, str(src))
        except Exception as e:
            print(f"  download failed for {key}: {e}", file=sys.stderr)
            return stats
        stats["bytes_in"] = src.stat().st_size

        if dry_run:
            stats["ok"] = True
            stats["elapsed_s"] = round(time.time() - t0, 2)
            return stats

        if not faststart_repair(src, dst):
            return stats
        stats["bytes_out"] = dst.stat().st_size

        try:
            s3.upload_file(str(dst), BUCKET, key, ExtraArgs={"ContentType": "video/mp4"})
            stats["ok"] = True
        except Exception as e:
            print(f"  upload failed for {key}: {e}", file=sys.stderr)
    stats["elapsed_s"] = round(time.time() - t0, 2)
    return stats


def backfill_profile(db_path: Path, s3, user_id: str, profile_id: str, dry_run: bool) -> dict:
    """Iterate working_videos rows, repair tail-moov files, update DB."""
    stats = {"probed": 0, "faststart": 0, "tail_moov": 0, "unknown": 0,
             "repaired": 0, "failed": 0, "bytes_rewritten": 0}
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT id, project_id, filename, version FROM working_videos ORDER BY id")
    rows = cur.fetchall()
    print(f"  working_videos rows: {len(rows)}")

    for row in rows:
        filename = row["filename"]
        if not filename:
            continue
        key = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/working_videos/{filename}"
        verdict, boxes = probe_moov_at_head(s3, key)
        stats["probed"] += 1
        print(f"  wv#{row['id']} proj={row['project_id']} v={row['version']} {verdict} head=[{' '.join(boxes[:4])}] key={filename}")

        if verdict == "FASTSTART":
            stats["faststart"] += 1
            continue
        if verdict == "UNKNOWN":
            stats["unknown"] += 1
            continue

        # MOOV-AT-END: repair
        stats["tail_moov"] += 1
        repair_stats = repair_working_video(s3, key, dry_run)
        if not repair_stats["ok"]:
            stats["failed"] += 1
            print(f"    REPAIR FAILED for wv#{row['id']}")
            continue

        if dry_run:
            print(f"    would repair wv#{row['id']} ({repair_stats['bytes_in']} bytes)")
            continue

        stats["repaired"] += 1
        stats["bytes_rewritten"] += repair_stats["bytes_out"]
        new_version = (row["version"] or 1) + 1
        cur.execute(
            "UPDATE working_videos SET version = ? WHERE id = ?",
            (new_version, row["id"]),
        )
        print(f"    REPAIRED wv#{row['id']} in={repair_stats['bytes_in']} "
              f"out={repair_stats['bytes_out']} elapsed={repair_stats['elapsed_s']}s "
              f"version {row['version']}->{new_version}")

    try:
        if not dry_run and stats["repaired"]:
            conn.commit()
    finally:
        conn.close()
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", help="Specific user to backfill")
    parser.add_argument("--profile-id", help="Specific profile within user")
    parser.add_argument("--all-users", action="store_true", help="Iterate all users in R2")
    parser.add_argument("--dry-run", action="store_true", help="Probe but do not repair")
    parser.add_argument("--local", action="store_true",
                        help="Backfill local user_data/ DBs in place (no R2 download/upload)")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default="dev",
                        help="Which .env file to load (default: dev)")
    args = parser.parse_args()

    env_file = REPO / (".env" if args.env == "dev" else f".env.{args.env}")
    if not env_file.exists():
        parser.error(f"env file not found: {env_file}")
    load_dotenv(env_file, override=True)
    global BUCKET, APP_ENV, USER_PREFIX
    BUCKET = os.environ["R2_BUCKET"]
    APP_ENV = os.environ.get("APP_ENV", args.env)
    USER_PREFIX = f"{APP_ENV}/users/"
    print(f"[backfill-faststart] env={args.env} APP_ENV={APP_ENV} bucket={BUCKET} dry_run={args.dry_run}")

    if not args.all_users and not args.local and not (args.user_id and args.profile_id):
        parser.error("Specify --all-users, --local, OR both --user-id and --profile-id")

    s3 = s3_client()

    totals = {"profiles": 0, "probed": 0, "faststart": 0, "tail_moov": 0,
              "unknown": 0, "repaired": 0, "failed": 0, "bytes_rewritten": 0}

    def _accumulate(stats: dict):
        totals["profiles"] += 1
        for k in ("probed", "faststart", "tail_moov", "unknown", "repaired", "failed", "bytes_rewritten"):
            totals[k] += stats.get(k, 0)

    if args.local:
        local_root = REPO / "user_data"
        for db_path in local_root.glob("*/profiles/*/profile.sqlite"):
            parts = db_path.relative_to(local_root).parts
            # parts = (<user_id>, 'profiles', <profile_id>, 'profile.sqlite')
            if len(parts) < 4:
                continue
            user_id, profile_id = parts[0], parts[2]
            print(f"\n[local] user={user_id} profile={profile_id}")
            stats = backfill_profile(db_path, s3, user_id, profile_id, args.dry_run)
            _accumulate(stats)
            print(f"  stats: {stats}")
    else:
        def _process(user_id: str, profile_id: str):
            db_key = f"{USER_PREFIX}{user_id}/profiles/{profile_id}/profile.sqlite"
            print(f"\n[{user_id}/{profile_id}] downloading {db_key}")
            with tempfile.TemporaryDirectory() as td:
                local = Path(td) / "profile.sqlite"
                try:
                    s3.download_file(BUCKET, db_key, str(local))
                except Exception as e:
                    print(f"  download failed: {e}", file=sys.stderr)
                    return
                stats = backfill_profile(local, s3, user_id, profile_id, args.dry_run)
                _accumulate(stats)
                print(f"  stats: {stats}")
                if not args.dry_run and stats["repaired"]:
                    current_version = 0
                    try:
                        head = s3.head_object(Bucket=BUCKET, Key=db_key)
                        current_version = int(head.get("Metadata", {}).get("db-version", 0) or 0)
                    except Exception:
                        pass
                    new_version = current_version + 1
                    s3.upload_file(
                        str(local), BUCKET, db_key,
                        ExtraArgs={"Metadata": {"db-version": str(new_version)}},
                    )
                    print(f"  uploaded DB back to {db_key} (db-version {current_version}->{new_version})")

        if args.all_users:
            paginator = s3.get_paginator("list_objects_v2")
            seen = set()
            for page in paginator.paginate(Bucket=BUCKET, Prefix=USER_PREFIX):
                for obj in page.get("Contents") or []:
                    k = obj["Key"]
                    if k.endswith("/profile.sqlite"):
                        parts = k.split("/")
                        if len(parts) == 6:
                            key = (parts[2], parts[4])
                            if key not in seen:
                                seen.add(key)
                                _process(*key)
        else:
            _process(args.user_id, args.profile_id)

    print("\n=== TOTALS ===")
    for k, v in totals.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
