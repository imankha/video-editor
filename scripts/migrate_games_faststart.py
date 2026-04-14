"""
T1450: Migrate moov-at-end game videos on R2 to faststart in-place.

Lists every `games/{blake3_hash}.mp4` object, probes the first ~64KB to find
moov position, and for any file with moov-at-end, runs
`ffmpeg -c copy -movflags +faststart` locally and re-uploads the object
to the same key (no DB changes — `-c copy` preserves size; blake3_hash
stays the dedup ID even though stored bytes no longer hash to it).

Usage (from repo root):
    python scripts/migrate_games_faststart.py --dry-run
    python scripts/migrate_games_faststart.py              # actually migrate

Env: reads R2_* from .env at repo root.
"""
from __future__ import annotations

import argparse
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import boto3
from botocore.config import Config
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
load_dotenv(REPO / ".env")

BUCKET = os.environ["R2_BUCKET"]
PROBE_BYTES = 256 * 1024  # first 256 KB: enough to locate moov vs mdat header


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def scan_boxes(buf: bytes, max_offset: int) -> list[tuple[str, int, int]]:
    """Return (type, offset, size) for top-level boxes found within buf."""
    boxes = []
    offset = 0
    n = len(buf)
    while offset + 8 <= n and offset < max_offset:
        size = struct.unpack(">I", buf[offset:offset + 4])[0]
        btype = buf[offset + 4:offset + 8].decode("latin-1", errors="replace")
        if size == 1:
            if offset + 16 > n:
                break
            size = struct.unpack(">Q", buf[offset + 8:offset + 16])[0]
        if size == 0:
            size = max_offset - offset
        if size < 8:
            break
        boxes.append((btype, offset, size))
        offset += size
    return boxes


def probe_layout(s3, key: str, total_size: int) -> dict:
    """Read head + possibly tail to determine moov position."""
    end = min(PROBE_BYTES - 1, total_size - 1)
    head = s3.get_object(Bucket=BUCKET, Key=key, Range=f"bytes=0-{end}")["Body"].read()
    boxes = scan_boxes(head, len(head))
    names = [b[0] for b in boxes]
    moov_off = next((o for t, o, _ in boxes if t == "moov"), None)
    mdat_off = next((o for t, o, _ in boxes if t == "mdat"), None)
    # Faststart iff moov is seen in the probe AND appears before mdat
    # (or mdat is past the probe window entirely, meaning moov is at head).
    if moov_off is None:
        is_faststart = False  # moov is past first 256KB → at-end
    elif mdat_off is None:
        is_faststart = True   # moov seen, mdat not in probe → moov at head
    else:
        is_faststart = moov_off < mdat_off
    return {
        "head_boxes": names,
        "is_faststart": is_faststart,
    }


def run_faststart(in_path: Path, out_path: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(in_path),
        "-c", "copy",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)


def fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def migrate_one(s3, key: str, size: int, dry_run: bool) -> str:
    layout = probe_layout(s3, key, size)
    status = "faststart" if layout["is_faststart"] else "moov-at-end"
    box_summary = ",".join(layout["head_boxes"])
    print(f"[{status}] {key}  size={fmt_size(size)}  head=[{box_summary}]")

    if layout["is_faststart"]:
        return "skip"
    if dry_run:
        return "would-migrate"

    with tempfile.TemporaryDirectory(prefix="faststart_") as tmp:
        tmp_path = Path(tmp)
        in_path = tmp_path / "in.mp4"
        out_path = tmp_path / "out.mp4"

        t0 = time.time()
        print(f"  downloading {fmt_size(size)}...")
        s3.download_file(BUCKET, key, str(in_path))
        dl = time.time() - t0

        t0 = time.time()
        print(f"  ffmpeg faststart (moov->head)...")
        run_faststart(in_path, out_path)
        ff = time.time() - t0

        new_size = out_path.stat().st_size
        if new_size != size:
            print(f"  WARN: size changed {size} -> {new_size} (expected equal)")

        verify = scan_boxes(in_path.read_bytes()[:PROBE_BYTES], PROBE_BYTES)
        verify_out = scan_boxes(out_path.read_bytes()[:PROBE_BYTES], PROBE_BYTES)
        print(f"  before head=[{','.join(b[0] for b in verify)}]")
        print(f"  after  head=[{','.join(b[0] for b in verify_out)}]")
        if not any(b[0] == "moov" for b in verify_out):
            raise RuntimeError(f"ffmpeg output still not faststart for {key}")

        t0 = time.time()
        print(f"  uploading {fmt_size(new_size)}...")
        s3.upload_file(str(out_path), BUCKET, key)
        up = time.time() - t0

        print(f"  done  dl={dl:.1f}s ffmpeg={ff:.1f}s up={up:.1f}s")
        return "migrated"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="probe only, no changes")
    ap.add_argument("--limit", type=int, default=0, help="stop after N migrations (0=all)")
    args = ap.parse_args()

    s3 = s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    objects: list[tuple[str, int]] = []
    for page in paginator.paginate(Bucket=BUCKET, Prefix="games/"):
        for o in page.get("Contents", []):
            objects.append((o["Key"], o["Size"]))

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
