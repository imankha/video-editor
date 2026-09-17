"""ffprobe property extraction + perceptual (average-hash) frame comparison for
the T4370 render-golden layer.

Pixel-exact comparison is rejected by the task file (flakes across ffmpeg
builds/libx264 versions -- encoder output is not bit-reproducible across
environments even for identical input+filters). Average-hash (aHash) is
tolerant of small encoder-level pixel drift while still catching a real
regression (wrong crop rect, wrong scale target, rotated/mirrored output) --
those move MANY hash bits, not a handful.
"""

import json
import subprocess
from pathlib import Path

HASH_SIZE = 8  # 8x8 -> 64-bit hash

# Chosen empirically is not possible in a single-ffmpeg-build container (this
# harness only ever runs one ffmpeg version here) -- documented instead as a
# reasoned default: aHash's own literature treats <=~10% of bits (6/64) as
# "same image, different compression", and a real regression (wrong crop/scale/
# rotation) typically flips a large fraction of the 64 bits, not a handful.
# Revisit (tighten or loosen) the first time this flakes in CI across a real
# ffmpeg version bump -- do not tighten pre-emptively without evidence.
HAMMING_TOLERANCE = 6


def ffprobe_json(path: Path) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, check=True, text=True, timeout=30,
    )
    return json.loads(proc.stdout)


def video_stream(probe: dict) -> dict:
    return next(s for s in probe["streams"] if s["codec_type"] == "video")


def audio_streams(probe: dict) -> list:
    return [s for s in probe["streams"] if s["codec_type"] == "audio"]


def average_hash(path: Path, timestamp: float, hash_size: int = HASH_SIZE) -> str:
    """8x8 grayscale average-hash of the frame at `timestamp`, as a hex string."""
    cmd = [
        "ffmpeg", "-v", "error", "-ss", str(timestamp), "-i", str(path),
        "-frames:v", "1", "-vf", f"scale={hash_size}:{hash_size}",
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True, timeout=30)
    pixels = list(proc.stdout[: hash_size * hash_size])
    if len(pixels) < hash_size * hash_size:
        raise RuntimeError(f"average_hash: expected {hash_size * hash_size} bytes, got {len(pixels)} for {path}@{timestamp}s")
    mean = sum(pixels) / len(pixels)
    bits = "".join("1" if p > mean else "0" for p in pixels)
    return f"{int(bits, 2):0{hash_size * hash_size // 4}x}"


def hamming_distance(hex_a: str, hex_b: str) -> int:
    return bin(int(hex_a, 16) ^ int(hex_b, 16)).count("1")


def assert_hash_within_tolerance(actual_hex: str, golden_hex: str, *, label: str) -> None:
    distance = hamming_distance(actual_hex, golden_hex)
    assert distance <= HAMMING_TOLERANCE, (
        f"{label}: perceptual hash differs by {distance} bits (tolerance {HAMMING_TOLERANCE}) -- "
        f"golden={golden_hex} actual={actual_hex}. If this is an INTENTIONAL rendering change, "
        f"re-bless (BLESS_GOLDENS=1 python3 scripts/rebless_export_goldens.py) and review."
    )
