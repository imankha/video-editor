"""
T1500: Backfill width/height/fps on working_clips via ffprobe over R2 byte-ranges.

For each game_videos row missing fps (or width/height), fetches the first 1 MB
of the R2 object, runs ffprobe-from-stdin, and UPDATEs game_videos. Then
UPDATEs working_clips rows that reference it (via raw_clips.video_sequence)
to copy the dims over.

For MP4s with moov-at-end (rare after T1450), falls back to a tail byte-range.

Per-user DB flow:
    1. Download profile DB from R2 to temp dir
    2. Enumerate game_videos with NULL fps
    3. Byte-range fetch + ffprobe each unique blake3
    4. UPDATE game_videos SET fps/width/height
    5. UPDATE working_clips copies from game_videos via raw_clips.video_sequence
    6. Upload DB back to R2

Usage (from repo root):
    python scripts/backfill_clip_dimensions.py --user-id <id> --profile-id <id> [--dry-run]
    python scripts/backfill_clip_dimensions.py --all-users [--dry-run]

Working_clips rows that remain NULL (failed ffprobe, corrupt R2 object) fall
through to the frontend metadata probe — probe path is deliberately retained
as the fallback per the T1500 design.
"""
from __future__ import annotations

import argparse
import json
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
load_dotenv(REPO / ".env")

BUCKET = os.environ["R2_BUCKET"]
APP_ENV = os.environ.get("APP_ENV", "dev")  # dev/staging/prod — nests DB keys under this prefix
USER_PREFIX = f"{APP_ENV}/users/"
HEAD_BYTES = 1024 * 1024       # 1 MB head fetch (covers moov for faststart MP4s)
TAIL_BYTES = 512 * 1024        # 512 KB tail fetch (fallback for moov-at-end)


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _ffprobe_bytes(data: bytes) -> Optional[dict]:
    """Run ffprobe on a raw byte stream via stdin. Returns width/height/fps dict or None."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,width,height",
                "-of", "json",
                "-",  # stdin
            ],
            input=data,
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            return None
        parsed = json.loads(result.stdout)
        stream = (parsed.get("streams") or [{}])[0]
        if not stream.get("width") or not stream.get("height"):
            return None
        fps_str = stream.get("r_frame_rate", "30/1")
        num, _, den = fps_str.partition("/")
        fps = float(num) / float(den) if den else float(num)
        return {
            "width": int(stream["width"]),
            "height": int(stream["height"]),
            "fps": fps,
        }
    except Exception:
        return None


def probe_r2_object(s3, key: str) -> Optional[dict]:
    """Probe via presigned URL — ffprobe does native HTTP byte-range fetching."""
    try:
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": key},
            ExpiresIn=300,
        )
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-analyzeduration", "500000",
                "-probesize", "5000000",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,width,height",
                "-of", "json",
                url,
            ],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            print(f"  ffprobe rc={result.returncode} for {key}: {result.stderr[:200]!r}", file=sys.stderr)
            return None
        parsed = json.loads(result.stdout)
        stream = (parsed.get("streams") or [{}])[0]
        if not stream.get("width") or not stream.get("height"):
            return None
        fps_str = stream.get("r_frame_rate", "30/1")
        num, _, den = fps_str.partition("/")
        fps = float(num) / float(den) if den else float(num)
        return {
            "width": int(stream["width"]),
            "height": int(stream["height"]),
            "fps": fps,
        }
    except Exception as e:
        print(f"  probe failed for {key}: {e}", file=sys.stderr)
        return None


def _ensure_t1500_columns(cur) -> None:
    """Apply T1500 ALTER TABLE migrations to a downloaded DB. Idempotent."""
    for ddl in (
        "ALTER TABLE game_videos ADD COLUMN fps REAL",
        "ALTER TABLE working_clips ADD COLUMN width INTEGER",
        "ALTER TABLE working_clips ADD COLUMN height INTEGER",
        "ALTER TABLE working_clips ADD COLUMN fps REAL",
        "ALTER TABLE games ADD COLUMN video_fps REAL",
    ):
        try:
            cur.execute(ddl)
        except sqlite3.OperationalError:
            pass  # column exists


def backfill_profile(db_path: Path, s3, dry_run: bool) -> dict:
    """Returns stats: {probed, updated_game_videos, updated_working_clips, failed}."""
    stats = {"probed": 0, "updated_gv": 0, "updated_wc": 0, "failed": 0}
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    _ensure_t1500_columns(cur)
    conn.commit()

    cur.execute("""
        SELECT id, game_id, sequence, blake3_hash, video_width, video_height, fps
        FROM game_videos
        WHERE fps IS NULL OR video_width IS NULL OR video_height IS NULL
    """)
    rows = cur.fetchall()
    print(f"  game_videos needing backfill: {len(rows)}")

    for row in rows:
        r2_key = f"games/{row['blake3_hash']}.mp4"
        meta = probe_r2_object(s3, r2_key)
        stats["probed"] += 1
        if not meta:
            stats["failed"] += 1
            print(f"  FAILED {r2_key}")
            continue

        if dry_run:
            print(f"  would update game_videos#{row['id']}: {meta}")
            continue

        cur.execute(
            "UPDATE game_videos SET video_width = ?, video_height = ?, fps = ? WHERE id = ?",
            (meta["width"], meta["height"], meta["fps"], row["id"]),
        )
        stats["updated_gv"] += 1

        # Cascade to working_clips via raw_clips.video_sequence
        cur.execute("""
            UPDATE working_clips
            SET width = ?, height = ?, fps = ?
            WHERE id IN (
                SELECT wc.id FROM working_clips wc
                JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                WHERE rc.game_id = ?
                  AND COALESCE(rc.video_sequence, 1) = ?
                  AND (wc.width IS NULL OR wc.height IS NULL OR wc.fps IS NULL)
            )
        """, (meta["width"], meta["height"], meta["fps"], row["game_id"], row["sequence"]))
        stats["updated_wc"] += cur.rowcount

    try:
        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", help="Specific user to backfill")
    parser.add_argument("--profile-id", help="Specific profile within user")
    parser.add_argument("--all-users", action="store_true", help="Iterate all users in R2")
    parser.add_argument("--dry-run", action="store_true", help="Probe but do not write")
    args = parser.parse_args()

    if not args.all_users and not (args.user_id and args.profile_id):
        parser.error("Specify --all-users OR both --user-id and --profile-id")

    s3 = s3_client()

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
            stats = backfill_profile(local, s3, args.dry_run)
            print(f"  stats: {stats}")
            if not args.dry_run and (stats["updated_gv"] or stats["updated_wc"]):
                s3.upload_file(str(local), BUCKET, db_key)
                print(f"  uploaded DB back to {db_key}")

    if args.all_users:
        paginator = s3.get_paginator("list_objects_v2")
        seen = set()
        for page in paginator.paginate(Bucket=BUCKET, Prefix=USER_PREFIX):
            for obj in page.get("Contents") or []:
                k = obj["Key"]
                if k.endswith("/profile.sqlite"):
                    # {env}/users/<uid>/profiles/<pid>/profile.sqlite
                    parts = k.split("/")
                    if len(parts) == 6:
                        key = (parts[2], parts[4])
                        if key not in seen:
                            seen.add(key)
                            _process(*key)
    else:
        _process(args.user_id, args.profile_id)


if __name__ == "__main__":
    main()
