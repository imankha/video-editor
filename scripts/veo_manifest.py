#!/usr/bin/env python3
"""T13200: write a media-free fixture manifest for a Veo highlights zip.

Reads the zip IN PLACE and records, per mp4 entry: name, crc32, size, duration_s (from mvhd,
via zlib streaming; no ffprobe needed). Never copies media.

  python scripts/veo_manifest.py "Veo highlights WCFC vs.  Rebels SC.zip" rebels
  -> src/frontend/src/utils/veoHighlights/manifests/rebels.json

Slugs the frontend test expects: rebels, sd-surf, beach-fc, scrimmage-10_4_25,
legends-1st-half, legends-2nd-half, la-breakers.
"""
import json
import struct
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src/frontend/src/utils/veoHighlights/manifests"


def mvhd_seconds(stream):
    """Walk top-level boxes of a file-like inflated stream; return mvhd duration."""
    while True:
        hdr = stream.read(8)
        if len(hdr) < 8:
            raise ValueError("no moov")
        size, kind = struct.unpack(">I4s", hdr)
        hlen = 8
        if size == 1:
            size = struct.unpack(">Q", stream.read(8))[0]
            hlen = 16
        if kind == b"moov":
            body = stream.read(size - hlen)
            p = 0
            while p + 8 <= len(body):
                s, k = struct.unpack(">I4s", body[p:p + 8])
                if k == b"mvhd":
                    q = p + 8
                    if body[q] == 1:
                        ts, dur = struct.unpack(">IQ", body[q + 20:q + 32])
                    else:
                        ts, dur = struct.unpack(">II", body[q + 12:q + 20])
                    return dur / ts
                p += s
            raise ValueError("moov without mvhd")
        remaining = size - hlen
        while remaining > 0:
            chunk = stream.read(min(remaining, 1 << 20))
            if not chunk:
                raise ValueError("truncated")
            remaining -= len(chunk)


def build(zip_path):
    entries = []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if not info.filename.lower().endswith(".mp4"):
                continue
            with z.open(info) as f:
                dur = mvhd_seconds(f)
            entries.append({"name": info.filename, "crc32": info.CRC, "size": info.file_size,
                            "duration_s": round(dur, 3)})
    return {"zip": Path(zip_path).name, "entries": entries}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    m = build(sys.argv[1])
    (OUT / f"{sys.argv[2]}.json").write_text(json.dumps(m, indent=1) + "\n")
    print(f"{sys.argv[2]}: {len(m['entries'])} mp4 entries")
