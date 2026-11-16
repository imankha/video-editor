"""Recap encode: cut each marked play out of its source, normalize mixed
resolutions, and concat into one MP4 (T2650).

Pure ffmpeg-python + stdlib so the CPU Modal function `encode_recap_modal`
(`compose_image` mounts the whole `app/` tree but installs no DB deps) runs the
SAME pipeline as the Modal-off local path in `auto_export`. Never import
`app.database`/storage/FastAPI here -- `test_t2650_recap_encode_off_server`
pins the import surface.
"""

import logging
import tempfile
from collections import Counter
from pathlib import Path

import ffmpeg

logger = logging.getLogger(__name__)


def video_dimensions(probe: dict):
    """(width, height) of the first video stream in an ffprobe result, or None.

    None when the probe carries no video stream dimensions (e.g. a mocked probe);
    callers treat that as "resolution unknown" and skip concat normalization.
    """
    for stream in probe.get('streams', []) or []:
        if stream.get('codec_type') == 'video':
            width, height = stream.get('width'), stream.get('height')
            if width and height:
                return (int(width), int(height))
    return None


def pick_canonical_resolution(resolutions: list[tuple]) -> tuple:
    """Choose the concat-normalization target for a mixed-resolution recap.

    Prefers the resolution shared by the MOST clips (fewest clips get rescaled ->
    fewest crop-keyframe regions shifted, per Risk 1), tie-broken toward the
    larger frame (preserve pixels for reframe/upscale). resolutions must be
    non-empty and contain no None.
    """
    counts = Counter(resolutions)
    return max(counts, key=lambda r: (counts[r], r[0] * r[1]))


def encode_recap(segments: list[dict], out_path, *, crf: int, preset: str) -> list[dict]:
    """Encode `segments` ([{id, url, start, end}], in recap order) into `out_path`.

    Each segment is re-encoded at its NATIVE resolution (T4140: crop keyframes
    are in source pixels) at `crf`/`preset`. Segments with a missing or inverted
    range are skipped (bug 23p: ffmpeg extracts nothing and raises). `concat
    c=copy` needs a uniform resolution, so in a mixed-resolution game only the
    minority segments are scaled to the canonical resolution.

    Returns [{id, duration}] for the segments that made it into the recap, in
    order (duration probed from the encoded segment). Raises RuntimeError when no
    segment could be encoded.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        extracted_paths = []
        resolutions = []  # aligned with extracted_paths; (w,h) or None
        encoded = []
        for seg in segments:
            start, end = seg['start'], seg['end']
            if start is None or end is None or end <= start:
                logger.warning(
                    f"[RecapEncode] skipping segment {seg['id']}: invalid range "
                    f"start={start} end={end} (end <= start) — excluded from recap"
                )
                continue
            out = Path(temp_dir) / f"clip_{seg['id']}.mp4"
            (
                ffmpeg.input(seg['url'], ss=start, to=end)
                .output(
                    str(out),
                    vcodec="libx264",
                    preset=preset,
                    crf=crf,
                    acodec="aac",
                    movflags="+faststart",
                )
                .run(quiet=True, overwrite_output=True)
            )
            extracted_paths.append(out)
            probe = ffmpeg.probe(str(out))
            resolutions.append(video_dimensions(probe))
            encoded.append({'id': seg['id'], 'duration': float(probe['format']['duration'])})

        if not extracted_paths:
            raise RuntimeError("No clips extracted for recap")

        known_res = [r for r in resolutions if r is not None]
        if len(set(known_res)) > 1:
            canonical = pick_canonical_resolution(known_res)
            cw, ch = canonical
            logger.info(
                f"[RecapEncode] mixed resolutions {sorted(set(known_res))} -> canonical "
                f"{cw}x{ch}; normalizing non-conforming segments (crop keyframes on "
                f"those clips shift)"
            )
            for idx, res in enumerate(resolutions):
                if res is None or res == canonical:
                    continue
                src = extracted_paths[idx]
                normalized = src.with_name(f"norm_{src.name}")
                (
                    ffmpeg.input(str(src))
                    .filter("scale", cw, ch)
                    .filter("setsar", "1")
                    .output(
                        str(normalized),
                        vcodec="libx264",
                        preset=preset,
                        crf=crf,
                        acodec="aac",
                        movflags="+faststart",
                    )
                    .run(quiet=True, overwrite_output=True)
                )
                extracted_paths[idx] = normalized

        concat_list = Path(temp_dir) / "concat.txt"
        with open(concat_list, "w") as f:
            for path in extracted_paths:
                f.write(f"file '{path}'\n")
        (
            ffmpeg.input(str(concat_list), f="concat", safe=0)
            .output(str(out_path), c="copy", movflags="+faststart")
            .run(quiet=True, overwrite_output=True)
        )
    return encoded
