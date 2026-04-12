#!/usr/bin/env python3
"""
Flip one byte in an MP4 file to change its BLAKE3 hash without breaking playback.

The frontend's hashFile() samples 5 positions: 0%, 25%, 50%, 75%, end-1MB.
To evict from global dedup, we need a byte change in at least one of those
1MB-wide sample windows. We target 25% (well inside mdat, safe for playback).

Usage:
    python corrupt-one-byte.py input.mp4 [output.mp4]
"""
import sys
import shutil
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python corrupt-one-byte.py <input.mp4> [output.mp4]")
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"Error: {src} not found")
        sys.exit(1)

    dst = Path(sys.argv[2]) if len(sys.argv) >= 3 else src.with_name(f"{src.stem}-modified{src.suffix}")

    size = src.stat().st_size
    # Target offset: 25% of file, inside the 1MB sample window.
    # Nudge 100KB into the window to ensure we're well inside it.
    target_offset = int(size * 0.25) + 100_000

    print(f"Source:      {src} ({size:,} bytes)")
    print(f"Destination: {dst}")
    print(f"Flip offset: {target_offset:,} ({target_offset / size * 100:.2f}% of file)")

    print("Copying file...")
    shutil.copy2(src, dst)

    print("Flipping one byte...")
    with open(dst, "r+b") as f:
        f.seek(target_offset)
        original = f.read(1)
        # XOR with 0xFF to guarantee a different byte
        modified = bytes([original[0] ^ 0xFF])
        f.seek(target_offset)
        f.write(modified)

    print(f"Done: byte at {target_offset} changed from 0x{original.hex()} to 0x{modified.hex()}")
    print(f"\nThis file will hash differently than the original and bypass global dedup.")
    print(f"Upload via the app to exercise the faststart path.")

if __name__ == "__main__":
    main()
