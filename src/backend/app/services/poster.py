"""Poster (first-frame preview image) generation for final videos (T4890).

A shared reel link (`/shared/{token}`) unfurls in iMessage/WhatsApp/social. Chat
apps need an `og:image` to render a visual card; without one the unfurl is text
only. We extract the FIRST FRAME of the final video at publish/finalize time,
store it as a JPEG in R2 next to the video, and freeze the reference on the
`final_videos` row so it is never re-derived later (per the export pipeline's
"explicit names after archive" principle).

Key scheme (per-profile, same prefix as the video):
    final_videos/posters/{final_filename}.jpg
so the full R2 key mirrors the video's key with a `posters/` sub-prefix and a
`.jpg` suffix. The DB column `final_videos.poster_filename` stores the poster's
BASENAME (`{final_filename}.jpg`); `poster_rel_path()` rebuilds the profile-
relative path from it.

Best-effort by design: a failure here NEVER fails the export. A published reel
without a poster simply omits the `og:image` tag at share-resolution time and
logs at info -- no silent fallback that hides missing data (CLAUDE.md).
"""

import asyncio
import logging
import math
import subprocess
import tempfile
from pathlib import Path

from ..highlight_transform import (
    canonicalize_segments_data,
    get_segment_speed,
    get_trim_range,
)
from ..storage import generate_presigned_url, upload_bytes_to_r2

logger = logging.getLogger(__name__)

POSTER_SUBDIR = "posters"


def poster_basename(final_filename: str) -> str:
    """The poster object's basename for a final video filename: `{name}.jpg`."""
    return f"{final_filename}.jpg"


def poster_rel_path(basename: str) -> str:
    """Profile-relative R2 path for a poster basename.

    Mirrors the video's `final_videos/{filename}` with a `posters/` sub-prefix,
    e.g. `final_videos/posters/reel_final_ab12cd34.mp4.jpg`.
    """
    return f"final_videos/{POSTER_SUBDIR}/{basename}"


# Sampled positions for clearest-frame selection. Skips the extremes: openings
# fade in / start mid-whistle, endings fade out.
CANDIDATE_POSITIONS = (0.15, 0.3, 0.5, 0.7, 0.85)


def _probe_duration(source: str) -> float | None:
    """Container duration in seconds via ffprobe, or None (never raises)."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        source,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        return float(out.stdout.strip())
    except Exception as e:
        logger.info(f"[Poster] duration probe failed: {e}")
        return None


def extract_clearest_frame_jpeg(
    source: str, output_path: str, window: tuple[float, float] | None = None
) -> bool:
    """Pick the CLEAREST frame among a handful of samples (largest JPEG wins).

    Heuristic: JPEG-encode one frame at each sampled position and keep the LARGEST
    encoding - encoded size tracks detail/sharpness (motion blur and defocus
    compress away detail), so the biggest JPEG is the crispest candidate. Cost:
    ~5 fast seeks + 5 single-frame encodes (faststart MP4s make remote seeks
    ranged reads), well under a second of CPU - no ML, no full decode.

    `window=(start, end)` restricts sampling to that ABSOLUTE time span (seconds
    on the final timeline) - used by the reel poster policy (T5090) to sample only
    within the first half of the first slow-mo section. Without a window, samples
    across the whole clip (recap posters, T5180; legacy behavior). Falls back to
    the plain first frame when probing/sampling fails. Returns True when
    output_path holds a poster; never raises.
    """
    if window is not None:
        start, end = window
        if not (end > start):
            return extract_first_frame_jpeg(source, output_path)
        span = end - start
        positions = [start + frac * span for frac in CANDIDATE_POSITIONS]
    else:
        duration = _probe_duration(source)
        if not duration or duration <= 0:
            return extract_first_frame_jpeg(source, output_path)
        positions = [duration * frac for frac in CANDIDATE_POSITIONS]

    best_bytes: bytes | None = None
    with tempfile.TemporaryDirectory() as tmp:
        for i, ts in enumerate(positions):
            cand = str(Path(tmp) / f"cand_{i}.jpg")
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{ts:.3f}",
                "-i", source,
                "-frames:v", "1",
                "-q:v", "3",
                cand,
            ]
            try:
                subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
            except Exception:
                continue
            p = Path(cand)
            if p.exists() and p.stat().st_size > 0:
                data = p.read_bytes()
                if best_bytes is None or len(data) > len(best_bytes):
                    best_bytes = data

    if best_bytes is None:
        return extract_first_frame_jpeg(source, output_path)
    Path(output_path).write_bytes(best_bytes)
    return True


def extract_first_frame_jpeg(source: str, output_path: str) -> bool:
    """Grab the first frame of a video to a JPEG via ffmpeg.

    `source` may be a local path OR a presigned HTTPS URL -- ffmpeg reads remote
    URLs directly (range requests), so no full download is needed. Returns True
    on success, False on any failure (never raises).
    """
    cmd = [
        "ffmpeg", "-y",
        "-ss", "0",
        "-i", source,
        "-frames:v", "1",
        "-q:v", "3",
        output_path,
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=60)
        return Path(output_path).exists() and Path(output_path).stat().st_size > 0
    except subprocess.CalledProcessError as e:
        logger.warning(f"[Poster] ffmpeg first-frame grab failed: {e.stderr}")
        return False
    except Exception as e:
        logger.warning(f"[Poster] first-frame grab error: {e}")
        return False


# ---------------------------------------------------------------------------
# Reel poster policy (T5090): clearest frame in the FIRST HALF of the first
# slow-mo section on the final (stretched, concatenated) timeline.
# ---------------------------------------------------------------------------

def _clip_slowmo_walk(
    segments_data: dict | None, source_duration: float | None
) -> tuple[tuple[float, float] | None, float]:
    """Walk ONE clip's segments in FINAL-output time.

    Mirrors highlight_transform.get_output_duration (trim clamp + speed stretch:
    output = source / speed), but also records the FIRST segment whose speed < 1.0.

    Returns (first_slowmo, total_output_duration): first_slowmo is
    (output_start, output_duration) of the first slow-mo segment WITHIN this clip's
    local output timeline, or None when the clip has no slow-mo segment.
    """
    if not segments_data:
        # No segments -> no slow-mo. Output length is the clip's source duration;
        # when THAT is unknown (uploaded clip with no raw_clips row), return inf so
        # first_slowmo_section's isfinite bail fires rather than accumulating a
        # bogus 0.0 offset that would mis-place a LATER clip's slow-mo (no
        # fabricated offset -- falls back to the first frame).
        return (None, source_duration if source_duration is not None else float("inf"))

    trim_start, trim_end = get_trim_range(segments_data)
    if trim_end == float("inf") and source_duration:
        trim_end = source_duration

    boundaries = segments_data.get("boundaries", [])
    if len(boundaries) < 2:
        # No speed segments -> no slow-mo; output is the simple trimmed length.
        return (None, max(0.0, trim_end - trim_start))

    output_duration = 0.0
    first: tuple[float, float] | None = None
    for i in range(len(boundaries) - 1):
        seg_start = boundaries[i]
        seg_end = boundaries[i + 1]
        # Skip fully-trimmed segments (they contribute nothing to the output).
        if seg_end <= trim_start or seg_start >= trim_end:
            continue
        effective_start = max(seg_start, trim_start)
        effective_end = min(seg_end, trim_end)
        speed = get_segment_speed(segments_data, i)
        seg_out = (effective_end - effective_start) / speed
        if first is None and speed < 1.0:
            first = (output_duration, seg_out)
        output_duration += seg_out
    return (first, output_duration)


def first_slowmo_section(
    clips: list[tuple[dict | None, float | None]] | None,
) -> tuple[float, float] | None:
    """FIRST slow-mo section's [start, end] in FINAL (concatenated, stretched)
    video time, or None if no segment has speed < 1.0 across the whole reel.

    `clips` is the ordered (segments_data, source_duration) per working clip in
    concatenation order (sort_order) -- the SAME order + latest-version the
    multi-clip export renders. Each clip's effective output duration is
    accumulated as an offset into the final concatenated timeline (so multi-clip
    reels locate the first slow-mo across the WHOLE concatenation, not just clip
    0), trimRange is respected, and the source->final mapping reuses
    highlight_transform's segment walk. The branded outro is appended AFTER all
    content, so it never shifts these offsets. Returns the FULL section; the
    caller samples its first half.
    """
    if not clips:
        return None

    clip_offset = 0.0
    for segments_data, source_duration in clips:
        # Landmine: segments_data boundaries come in two formats (full-list vs
        # splits-only). Always canonicalize before walking pairs so segmentSpeeds
        # indices line up (Bug 20p).
        canon = canonicalize_segments_data(segments_data, source_duration)
        section, clip_out = _clip_slowmo_walk(canon, source_duration)
        if section is not None:
            seg_out_start, seg_out_dur = section
            start = clip_offset + seg_out_start
            return (start, start + seg_out_dur)
        if not math.isfinite(clip_out):
            # An earlier clip's output length is unknown (no source_duration and
            # no trim end) -> we can't place a later clip's slow-mo in final time.
            # Bail to the first frame rather than fabricate an offset.
            logger.info(
                "[Poster] clip output duration is non-finite; cannot locate "
                "slow-mo offset -> first frame"
            )
            return None
        clip_offset += clip_out
    return None


def read_clip_segments_for_project(
    cursor, project_id: int | None
) -> list[tuple[dict | None, float | None]]:
    """Ordered [(segments_data|None, source_duration|None), ...] for a project's
    LATEST working clips, in concatenation order (sort_order).

    Uses the SAME latest-version subquery + ordering the multi-clip export renders
    with, so the poster's slow-mo math matches the reel that actually shipped.
    `source_duration` is the raw clip's (end_time - start_time) seconds (matches
    what the export passes to canonicalize_segments_data), or None for uploaded
    clips. Empty list when project_id is None or the project has no resolvable
    working clips (archived/deleted after publish) -> the caller uses the first
    frame (no fabrication)."""
    if project_id is None:
        return []
    from ..queries import latest_working_clips_subquery
    from ..utils.encoding import decode_data

    cursor.execute(
        f"""
        SELECT wc.segments_data AS segments_data,
               (rc.end_time - rc.start_time) AS source_duration
        FROM working_clips wc
        LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ?
          AND wc.id IN ({latest_working_clips_subquery()})
        ORDER BY wc.sort_order
        """,
        (project_id, project_id),
    )
    result: list[tuple[dict | None, float | None]] = []
    for row in cursor.fetchall():
        raw = row["segments_data"]
        segments = decode_data(raw) if raw else None
        src = row["source_duration"]
        result.append((segments, float(src) if src is not None else None))
    return result


def load_project_clip_segments(
    project_id: int | None,
) -> list[tuple[dict | None, float | None]]:
    """Open a profile-DB connection (CURRENT context) and read the project's
    ordered working-clip segment data via read_clip_segments_for_project.

    Used by the overlay finalize path and the admin backfill, where no cursor is
    already open. export_final passes its already-open cursor to
    read_clip_segments_for_project directly instead. Never raises: a read failure
    (e.g. archived project, missing table) logs at info and yields [] -> first
    frame."""
    if project_id is None:
        return []
    from ..database import get_db_connection
    try:
        with get_db_connection() as conn:
            return read_clip_segments_for_project(conn.cursor(), project_id)
    except Exception as e:
        logger.info(
            f"[Poster] could not load segment data for project {project_id}: {e} "
            f"-> first frame"
        )
        return []


def segments_from_archive(archive: dict | None) -> list[tuple[dict | None, float | None]]:
    """Ordered [(segments_data|None, source_duration|None), ...] reconstructed from
    a project's R2 msgpack archive (T5090 freeze).

    `archive` is the decoded `archive/{project_id}.msgpack` (project_archive.py):
    `working_clips` holds ALL versions (msgpack-decoded dicts; `segments_data` is
    raw bytes). We pick the LATEST version per clip identity and order by
    sort_order, mirroring `latest_working_clips_subquery` -- within ONE project the
    identity is `COALESCE(raw_clip_id, uploaded_filename)` (raw_clip_id <-> a raw
    clip's end_time is 1:1, so grouping by it matches the live partition). The
    archive carries no raw_clips, so `source_duration` is unknown (None); that only
    affects canonicalization of splits-only boundaries (full-format rows, what
    saveCurrentClipState writes, need no duration). Empty/missing -> []."""
    if not archive:
        return []
    from ..utils.encoding import decode_data

    clips = archive.get("working_clips") or []
    best: dict = {}
    for c in clips:
        rc_id = c.get("raw_clip_id")
        identity = ("rc", rc_id) if rc_id is not None else ("upl", c.get("uploaded_filename"))
        version = c.get("version") or 0
        if identity not in best or version > best[identity][0]:
            best[identity] = (version, c)
    ordered = sorted(best.values(), key=lambda pair: (pair[1].get("sort_order") or 0))
    result: list[tuple[dict | None, float | None]] = []
    for _, c in ordered:
        raw = c.get("segments_data")
        segments = decode_data(raw) if raw else None
        result.append((segments, None))
    return result


def resolve_slowmo_section(
    user_id: str, project_id: int | None
) -> tuple[tuple[float, float] | None, str]:
    """Resolve a reel's first slow-mo section in FINAL time WITHOUT the frozen
    columns -- reconstruction fallback for backfill/regen and the v025 migration.

    Order (T5090): (1) LIVE working_clips (present at finalize; pruned after
    publish); (2) the R2 project archive (`archive/{project_id}.msgpack`, written
    BEFORE publish prunes working_clips) when the live read is empty. Returns
    `(section_or_None, source)` where source is 'working_clips' | 'archive' |
    'unreconstructable'. A present-but-no-slow-mo reel yields (None,
    'working_clips'/'archive') -- a legitimate first-frame result, NOT a failure.
    Never fabricates a section; unreconstructable -> (None, 'unreconstructable')."""
    from .project_archive import load_archive

    clips = load_project_clip_segments(project_id)
    if clips:
        return (first_slowmo_section(clips), "working_clips")

    archive = load_archive(project_id, user_id) if project_id is not None else None
    archived_clips = segments_from_archive(archive)
    if archived_clips:
        return (first_slowmo_section(archived_clips), "archive")

    return (None, "unreconstructable")


def _decode_frozen_section(start, end) -> tuple[float, float] | None:
    """A frozen `(slowmo_section_start, slowmo_section_end)` pair -> a section
    tuple, or None when either is NULL (no frozen slow-mo / not yet computed)."""
    if start is None or end is None:
        return None
    return (float(start), float(end))


def _set_slowmo_section(final_video_id: int, section: tuple[float, float] | None) -> None:
    """Freeze the first slow-mo section [start, end] onto a final_videos row in the
    CURRENT profile DB (heals frozen columns during backfill/regen)."""
    from ..database import get_db_connection
    start = section[0] if section else None
    end = section[1] if section else None
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE final_videos SET slowmo_section_start = ?, slowmo_section_end = ? WHERE id = ?",
            (start, end, final_video_id),
        )
        conn.commit()


def generate_and_store_poster(
    user_id: str,
    final_filename: str,
    slowmo_section: tuple[float, float] | None = None,
) -> str | None:
    """Extract a poster frame of a final video and store it in R2.

    Runs in the CURRENT profile context (r2_key embeds the ContextVar profile),
    so it must be called on the same profile that owns the final video (every
    finalize/publish writer does). Returns the poster BASENAME to store on the
    `final_videos` row, or None when the poster could not be produced (best
    effort -- the caller stores NULL and the export still succeeds).

    Reel poster policy (T5090): `slowmo_section` is the FULL first slow-mo section
    `[start, end]` in FINAL-video time (resolved by the caller from frozen columns,
    live working clips, or the R2 archive -- see resolve_slowmo_section). When
    present, the poster is the clearest frame within the FIRST HALF of that section.
    None (no slow-mo / unreconstructable) -> the plain first frame (logged at info;
    never a fabricated slow-mo region). Recap posters do NOT go through here -- they
    call extract_clearest_frame_jpeg directly (whole-clip, T5180).
    """
    video_url = generate_presigned_url(user_id, f"final_videos/{final_filename}", expires_in=3600)
    if not video_url:
        # R2 disabled or presign failed -> no poster this time (info, not error:
        # the reel is fine, the unfurl just falls back to text until backfilled).
        logger.info(f"[Poster] no presigned URL for final_videos/{final_filename}; skipping poster")
        return None

    window: tuple[float, float] | None = None
    if slowmo_section is not None and slowmo_section[1] > slowmo_section[0]:
        start, end = slowmo_section
        window = (start, start + (end - start) / 2.0)  # first half of the section
        logger.info(
            f"[Poster] {final_filename}: first slow-mo section {slowmo_section} on "
            f"the final timeline -> sampling clearest frame in first half {window}"
        )
    else:
        logger.info(
            f"[Poster] {final_filename}: no slow-mo section -> plain first frame"
        )

    basename = poster_basename(final_filename)
    with tempfile.TemporaryDirectory() as tmp:
        out_path = str(Path(tmp) / basename)
        extracted = (
            extract_clearest_frame_jpeg(video_url, out_path, window=window)
            if window is not None
            else extract_first_frame_jpeg(video_url, out_path)
        )
        if not extracted:
            logger.info(f"[Poster] extraction failed for {final_filename}; no poster stored")
            return None
        data = Path(out_path).read_bytes()
        dims = _jpeg_dimensions(out_path)

    metadata = {"width": dims[0], "height": dims[1]} if dims else None
    if not upload_bytes_to_r2(
        user_id, poster_rel_path(basename), data,
        fast=True, content_type="image/jpeg", metadata=metadata,
    ):
        logger.info(f"[Poster] R2 upload failed for {poster_rel_path(basename)}; no poster stored")
        return None

    logger.info(
        f"[Poster] stored {poster_rel_path(basename)} ({len(data)} bytes, "
        f"dims={dims or 'unknown'})"
    )
    return basename


def generate_poster_at_publish(
    user_id: str,
    final_video_id: int,
    final_filename: str,
    project_id: int | None,
    frozen_start=None,
    frozen_end=None,
) -> str | None:
    """Capture + store the share poster at PUBLISH ("Move to My Reels"), T5280.

    The poster's ONLY consumers are share links / og:image, which cannot exist
    before publish -- so the JPEG is captured at the publish gesture, NOT at
    render. Drafts that never get published no longer pay the ~5-seek ffmpeg
    cost, and publish is the same freeze point T5260 uses for the reel name.

    Section resolution mirrors backfill_posters (single policy everywhere):
    prefer the FROZEN slow-mo columns (written at render finalize, durable
    across the publish-time working_clips prune); when unfrozen, reconstruct
    from live working_clips (still present -- publish archives AFTER this runs)
    or the R2 archive, and HEAL the frozen columns so a later regen skips the
    work. No slow-mo / unreconstructable -> plain first frame (no fabrication,
    T5090).

    Blocking (ffmpeg + R2): the publish endpoint runs this via asyncio.to_thread
    INSIDE the request, so the poster object + poster_filename both land before
    the endpoint's durable-sync barrier (T4110) -- never fire-and-forget.
    Idempotent: the R2 poster key is deterministic, so a re-publish overwrites
    in place (same policy -> same frame). Best-effort: any failure returns None
    and is logged at info; publish NEVER fails because of the poster. Returns the
    stored poster basename (also written to final_videos.poster_filename) or None.
    """
    try:
        section = _decode_frozen_section(frozen_start, frozen_end)
        if section is None:
            section, src = resolve_slowmo_section(user_id, project_id)
            if section is not None:
                _set_slowmo_section(final_video_id, section)
                logger.info(
                    f"[PublishPoster] fv={final_video_id} section reconstructed via "
                    f"{src}: {section}"
                )
        stored = generate_and_store_poster(user_id, final_filename, section)
        if stored:
            _set_poster_filename(final_video_id, stored)
            logger.info(f"[PublishPoster] fv={final_video_id} stored poster {stored}")
        else:
            logger.info(
                f"[PublishPoster] fv={final_video_id} no poster stored (best effort); "
                f"share unfurl falls back to text until backfilled"
            )
        return stored
    except Exception as e:
        # Never let poster work fail publish (same invariant as render finalize).
        logger.info(f"[PublishPoster] fv={final_video_id} poster capture error: {e}")
        return None


def ensure_recap_poster(recap_key: str, recap_poster_key: str) -> bool:
    """Generate-on-first-request poster for a game recap (T5180).

    `recap_key` / `recap_poster_key` are FULL (env-prefixed) R2 keys under the
    SHARER's profile prefix: `.../recaps/{game_id}.mp4` ->
    `.../recaps/posters/{game_id}.jpg`. Whole-clip clearest-frame heuristic
    (recaps are stitched artifacts with no per-segment slow-mo data, so the reel
    slow-mo-first policy does NOT apply -- and the selection helper is NOT
    modified here).

    Idempotent + overwrite-safe:
      - poster already cached -> True without re-encoding (cheap HEAD);
      - recap source missing (reclaimed / never generated) -> False (caller 404s,
        the edge function falls back to the branded card -- never a broken image);
      - else extract + upload to the deterministic key, then True.
    Concurrent crawler hits both write the same key (overwrite-safe). Never raises.
    """
    from ..storage import (
        generate_presigned_url_global,
        r2_head_object_global,
        upload_bytes_to_r2_global,
    )
    try:
        if r2_head_object_global(recap_poster_key) is not None:
            return True
        if r2_head_object_global(recap_key) is None:
            logger.info(f"[RecapPoster] no recap source at {recap_key}; skipping")
            return False
        recap_url = generate_presigned_url_global(recap_key, expires_in=3600)
        if not recap_url:
            logger.info(f"[RecapPoster] presign failed for {recap_key}; skipping")
            return False
        with tempfile.TemporaryDirectory() as tmp:
            out_path = str(Path(tmp) / "recap_poster.jpg")
            if not extract_clearest_frame_jpeg(recap_url, out_path):
                logger.info(f"[RecapPoster] extraction failed for {recap_key}")
                return False
            data = Path(out_path).read_bytes()
            dims = _jpeg_dimensions(out_path)
        metadata = {"width": dims[0], "height": dims[1]} if dims else None
        if not upload_bytes_to_r2_global(
            recap_poster_key, data, fast=True,
            content_type="image/jpeg", metadata=metadata,
        ):
            logger.info(f"[RecapPoster] R2 upload failed for {recap_poster_key}")
            return False
        logger.info(
            f"[RecapPoster] stored {recap_poster_key} ({len(data)} bytes, "
            f"dims={dims or 'unknown'})"
        )
        return True
    except Exception as e:
        logger.warning(f"[RecapPoster] unexpected error for {recap_key}: {e}")
        return False


def recap_poster_r2_keys(user_id: str, profile_id: str, game_id: int) -> tuple[str, str]:
    """Full R2 keys for a game's recap master and its poster, under the sharer's
    profile prefix. Deterministic -- mirrors the key scheme `ensure_recap_poster`
    expects (`recaps/{game_id}.mp4` -> `recaps/posters/{game_id}.jpg`)."""
    from ..storage import profile_r2_key
    return (
        profile_r2_key(user_id, profile_id, f"recaps/{game_id}.mp4"),
        profile_r2_key(user_id, profile_id, f"recaps/posters/{game_id}.jpg"),
    )


async def warm_recap_poster(user_id: str, profile_id: str, game_id: int) -> None:
    """Warm the recap poster cache at teammate-share-CREATION time (T5270), so
    the R2 object exists before the link can be pasted into a messenger -- the
    old generate-on-first-request path made the first crawler pay the ffmpeg
    cost, which is too slow for the few seconds a crawler allots og:image.

    Best-effort only: `ensure_recap_poster` already never raises (missing recap,
    ffmpeg failure, R2 hiccup all return False), but this wrapper never lets an
    unexpected error escape either -- share creation must never fail or slow
    meaningfully because of poster warming. Runs off the event loop
    (`asyncio.to_thread`) since generation shells out to ffmpeg. The on-demand
    GET path (`shares.py::get_shared_teammate_poster`) stays as the fallback for
    shares created before this warmed, or whose cached object was evicted.
    """
    recap_key, poster_key = recap_poster_r2_keys(user_id, profile_id, game_id)
    try:
        await asyncio.to_thread(ensure_recap_poster, recap_key, poster_key)
    except Exception as e:
        logger.info(f"[RecapPoster] warm-at-share-creation failed for game_id={game_id}: {e}")


def backfill_posters(limit: int = 25, dry_run: bool = False, force: bool = False) -> dict:
    """Admin-triggered one-off: generate posters for PUBLISHED reels that have none
    (T4890). Pre-existing reels published before this feature carry no poster, so
    their share links unfurl without an og:image until backfilled.

    Iterates every user+profile like the T4140 recap backfill. For each published
    `final_videos` row with `poster_filename IS NULL`:
      - if the poster object ALREADY exists in R2 -> just heal the column (no
        re-encode), counted in `already_present` (skip-if-poster-exists);
      - else if the video object is missing (reclaimed/never-synced) -> skip,
        counted in `skipped_gone` (HEAD-probe video exists; no fabrication);
      - else extract + store the poster and set the column, counted in `generated`.

    Throttled by `limit` (max posters produced per call) and batched: call again
    while `partial` is True. NOT run on startup/deploy. Idempotent -- once the
    column is set the row is no longer a candidate. Never raises per-row: a single
    failure is recorded in `failed` and the scan continues.

    `force=True` REGENERATES posters for ALL published reels (poster or not) --
    used to upgrade legacy first-frame posters to clearest-frame selection. The
    object key is deterministic, so regeneration just overwrites in place.
    """
    from ..database import ensure_database, get_db_connection, sync_db_to_r2_explicit
    from ..migrations import _get_profile_ids, _migrate_profile_db
    from ..profile_context import set_current_profile_id
    from ..storage import file_exists_in_r2
    from ..user_context import set_current_user_id
    from .auth_db import get_all_users_for_admin

    result = {
        "limit": limit,
        "dry_run": dry_run,
        "force": force,
        "scanned": 0,
        "generated": [],
        "already_present": [],
        "skipped_gone": [],
        "failed": [],
        "partial": False,
    }
    budget = limit

    for user in get_all_users_for_admin():
        if budget <= 0:
            result["partial"] = True
            break
        user_id = user["user_id"]
        for profile_id in _get_profile_ids(user_id):
            if budget <= 0:
                result["partial"] = True
                break
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            ensure_database()

            # Migrate this profile to head BEFORE the poster_filename query (T5110).
            # The backfill enumerates via unfiltered _get_profile_ids (includes
            # orphan profiles that run_all_migrations deliberately registry-skips,
            # T4830), while ensure_database only does CREATE TABLE IF NOT EXISTS --
            # it never runs versioned ALTERs. So an orphan/below-head profile lacks
            # the poster_filename column and the candidate query below would crash
            # the ENTIRE run. Migrating each touched profile to head holds the
            # invariant "every profile the backfill touches is at head" (and heals
            # the orphan gap as a side effect). Best-effort: a migration failure is
            # recorded and the profile is skipped, never aborting the sweep.
            try:
                migrate_res = _migrate_profile_db(user_id, profile_id)
                if migrate_res.status != "ok":
                    logger.warning(
                        f"[PosterBackfill] profile {user_id}/{profile_id} not verified "
                        f"at head (status={migrate_res.status}); attempting scan anyway"
                    )
            except Exception as e:
                result["failed"].append(
                    {"profile_id": profile_id, "error": f"migrate_failed: {e}"}
                )
                logger.error(
                    f"[PosterBackfill] migrate failed for {user_id}/{profile_id}: {e}"
                )
                continue

            candidate_sql = (
                "SELECT id, filename, project_id, "
                "slowmo_section_start, slowmo_section_end FROM final_videos "
                "WHERE published_at IS NOT NULL"
                + ("" if force else " AND poster_filename IS NULL")
            )
            # Wrap the candidate query: a profile still below head / with a missing
            # column (migration couldn't heal it, or a corrupt blob) is recorded in
            # `failed` and skipped, never a hard crash. This extends the docstring's
            # "never raises per-row" guarantee to cover the schema/query failure that
            # aborted the whole run on prod 2026-07-13 (T5110).
            try:
                with get_db_connection() as conn:
                    rows = [dict(r) for r in conn.execute(candidate_sql).fetchall()]
            except Exception as e:
                result["failed"].append(
                    {"profile_id": profile_id, "error": f"candidate_query_failed: {e}"}
                )
                logger.error(
                    f"[PosterBackfill] candidate query failed for "
                    f"{user_id}/{profile_id}: {e}"
                )
                continue

            profile_changed = False
            for row in rows:
                if budget <= 0:
                    result["partial"] = True
                    break
                fv_id, filename = row["id"], row["filename"]
                project_id = row["project_id"]
                result["scanned"] += 1
                basename = poster_basename(filename)

                # Skip-if-poster-exists: the object is already there, just heal the
                # ref. Bypassed under force: regeneration overwrites in place.
                if not force and file_exists_in_r2(user_id, poster_rel_path(basename)):
                    if not dry_run:
                        _set_poster_filename(fv_id, basename)
                        profile_changed = True
                    result["already_present"].append(fv_id)
                    continue

                # HEAD-probe the video exists before attempting extraction.
                if not file_exists_in_r2(user_id, f"final_videos/{filename}"):
                    result["skipped_gone"].append(fv_id)
                    continue

                if dry_run:
                    result["generated"].append(fv_id)
                    budget -= 1
                    continue

                try:
                    # Resolve the reel's first slow-mo section so backfill applies
                    # the SAME slow-mo-first policy as live publish. Prefer the
                    # FROZEN columns (durable across working_clips pruning); only
                    # fall back to reconstruction (live clips -> R2 archive) when
                    # unfrozen, and heal the columns so future regens skip the work.
                    # Unreconstructable -> None -> first frame (T5090, no fabrication).
                    section = _decode_frozen_section(
                        row["slowmo_section_start"], row["slowmo_section_end"]
                    )
                    if section is None:
                        section, src = resolve_slowmo_section(user_id, project_id)
                        logger.info(
                            f"[PosterBackfill] fv={fv_id} section reconstructed via "
                            f"{src}: {section}"
                        )
                        if section is not None and not dry_run:
                            _set_slowmo_section(fv_id, section)
                            profile_changed = True
                    stored = generate_and_store_poster(user_id, filename, section)
                    if not stored:
                        result["failed"].append({"id": fv_id, "error": "poster generation returned None"})
                        continue
                    _set_poster_filename(fv_id, stored)
                    profile_changed = True
                    result["generated"].append(fv_id)
                    budget -= 1
                except Exception as e:
                    result["failed"].append({"id": fv_id, "error": str(e)})
                    logger.error(f"[PosterBackfill] fv={fv_id} failed: {e}")

            # Persist the healed/generated poster_filename column to R2 (sweep
            # corollary: an explicit sync is required outside the request path).
            if profile_changed and not sync_db_to_r2_explicit(user_id, profile_id):
                logger.error(
                    f"[PosterBackfill] R2 DB sync FAILED for user={user_id} "
                    f"profile={profile_id}; poster_filename writes may be lost on cold-load"
                )

    logger.info(
        f"[PosterBackfill] done generated={len(result['generated'])} "
        f"already_present={len(result['already_present'])} "
        f"gone={len(result['skipped_gone'])} failed={len(result['failed'])} "
        f"partial={result['partial']} dry_run={dry_run}"
    )
    return result


def _set_poster_filename(final_video_id: int, basename: str) -> None:
    """Set poster_filename on a final_videos row in the CURRENT profile DB."""
    from ..database import get_db_connection
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE final_videos SET poster_filename = ? WHERE id = ?",
            (basename, final_video_id),
        )
        conn.commit()


def _jpeg_dimensions(path: str) -> tuple[int, int] | None:
    """(width, height) of a JPEG on disk, or None if it can't be read.

    Used to populate og:image:width/height (crawlers size the card correctly).
    Best-effort -- a missing size just omits those optional tags, never fails."""
    try:
        import cv2
        img = cv2.imread(path)
        if img is None:
            return None
        h, w = img.shape[:2]
        return (int(w), int(h))
    except Exception as e:
        logger.info(f"[Poster] could not read poster dimensions: {e}")
        return None
