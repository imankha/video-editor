"""Poster (cover-frame preview image) generation for final videos (T4890).

A shared reel link (`/shared/{token}`) unfurls in iMessage/WhatsApp/social. Chat
apps need an `og:image` to render a visual card; without one the unfurl is text
only. We extract a poster FRAME of the final video at overlay EXPORT time
(T5410; moved from publish, T5280 REVERSED), store it as a JPEG in R2 next to
the video, and freeze the reference on the `final_videos` row so it is never
re-derived later (per the export pipeline's "explicit names after archive"
principle).

T5410: the reel poster policy is the open-play window gate (`open_play_window`
+ `select_poster_frame`) -- NO object detection of any kind. The frame is
either the user's overlay timeline marker (honoured verbatim) or the
deterministic midpoint of the open-play slow-mo window. See
`generate_poster_at_export`.

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
    """The poster object's basename for a final video filename: `{name}.jpg`.

    This is the FULL-SIZE og:image object shares.py's `_build_poster_r2_key`
    reads for share unfurls -- NEVER resized or re-keyed (T5682). The owner-facing
    My Reels tile reads a SEPARATE card-size thumbnail derived from this one; see
    `reel_card_poster_rel_path`/`ensure_reel_card_poster`.
    """
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
    source: str, output_path: str, window: tuple[float, float] | None = None,
    resize_width: int | None = None, jpeg_quality: int = 3
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
    the plain first frame when probing/sampling fails.

    `resize_width` (pixels) scales the frame to a card-sized thumbnail (e.g. 480 for
    home tiles); aspect ratio preserved. T5682: card-size thumbnails for faster TTFB.
    `jpeg_quality` is ffmpeg's q:v (3=~70%, 2=~80%, 1=~90%; lower = smaller file).
    Returns True when output_path holds a poster; never raises.
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
            ]
            if resize_width:
                cmd.extend(["-vf", f"scale={resize_width}:-1"])
            cmd.extend(["-q:v", str(jpeg_quality), cand])
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
        return extract_first_frame_jpeg(
            source, output_path, resize_width=resize_width, jpeg_quality=jpeg_quality
        )
    Path(output_path).write_bytes(best_bytes)
    return True


def extract_first_frame_jpeg(
    source: str, output_path: str, seek: float = 0.0,
    resize_width: int | None = None, jpeg_quality: int = 3
) -> bool:
    """Grab a single frame of a video to a JPEG via ffmpeg.

    `source` may be a local path OR a presigned HTTPS URL -- ffmpeg reads remote
    URLs directly (range requests), so no full download is needed. `seek` is the
    ABSOLUTE timestamp (seconds) to grab; defaults to the first frame (0.0). For a
    faststart MP4 a remote seek is a ranged read, not a full download (T5681 game
    source poster picks the highest-rated clip's timestamp here). `resize_width`
    and `jpeg_quality` match extract_clearest_frame_jpeg (T5682: card-size thumbs).
    Returns True on success, False on any failure (never raises).
    """
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{seek:.3f}",
        "-i", source,
        "-frames:v", "1",
    ]
    if resize_width:
        cmd.extend(["-vf", f"scale={resize_width}:-1"])
    cmd.extend(["-q:v", str(jpeg_quality), output_path])
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


# ---------------------------------------------------------------------------
# T5410: open-play window gate (NO detection). The study's only strong signal
# (zone: open-play slow-mo beats the spotlight instant) is realized purely as a
# TIME-WINDOW decision on the already-frozen slow-mo section -- no pixels, no
# YOLO, no Modal call. Within the window every pixel/box feature measured
# |Spearman| <= 0.23 (noise at n~25); pick the midpoint and stop, and hand the
# aesthetic residual to the user's overlay marker (select_poster_frame).
# ---------------------------------------------------------------------------

SPOTLIGHT_SKIP_SECONDS = 2.0
END_MARGIN_SECONDS = 0.3
MIN_WINDOW_SECONDS = 0.5


def open_play_window(
    section: tuple[float, float] | None, final_duration: float,
) -> tuple[float, float]:
    """The candidate poster window on the FINAL timeline: (start, end) seconds.

    `section` is the frozen first slow-mo section (`first_slowmo_section` /
    `slowmo_section_start,_end`), or None when the reel has no slow-mo.
    `final_duration` is the final video's total duration in seconds.

    - No slow-mo section: the whole clip minus a small end margin (skips
      fade/black tail frames; no fabricated slow-mo region).
    - Slow-mo section: skip the first SPOTLIGHT_SKIP_SECONDS (the contested/
      occluded spotlight instant the study ranked WORST) and clamp the end to
      final_duration - END_MARGIN_SECONDS. If what's left is too short
      (MIN_WINDOW_SECONDS), degrade to the WHOLE section rather than a
      near-empty sliver.

    Pure arithmetic -- no I/O, no detection. This is the whole algorithm.
    """
    if section is None:
        return (0.0, max(0.0, final_duration - END_MARGIN_SECONDS))
    start, end = section
    cand_start = start + SPOTLIGHT_SKIP_SECONDS
    cand_end = min(end, final_duration - END_MARGIN_SECONDS)
    if cand_end - cand_start < MIN_WINDOW_SECONDS:
        return (start, end)
    return (cand_start, cand_end)


def select_poster_frame(
    window: tuple[float, float], user_marker_time: float | None,
    section: tuple[float, float] | None,
) -> float:
    """The poster frame's time (final-video seconds): the user's overlay marker
    when set, else the window's own start when the window's start already
    absorbed the SPOTLIGHT_SKIP_SECONDS safety margin, else 2 seconds into
    the window.

    The marker is honoured VERBATIM, never clamped into the window -- a
    deliberate spotlight-frame pick is a decision, not an error; the user is
    expected to move the marker to set it, but may not always (T6630 round
    7). Within the window every pixel/box feature the study measured was
    noise (|Spearman| <= 0.23), so absent a marker there is no ranking to
    honor.

    `section` (the SAME slow-mo section `window` was built from, or None)
    tells us whether `window.start` already IS `section.start +
    SPOTLIGHT_SKIP_SECONDS` -- i.e. already past the contested/occluded
    opening frames. T6630 round 7 added a "+2s into the window" default
    reasoning it was independent of that skip ("relative to the window's
    own start"); live round-8 user testing showed the two skips STACK to
    ~4s past the section's start (e.g. section starting at 1.5s put the
    default at 5.5s, not the expected ~2s -- confirmed via real drafts'
    `poster_slowmo_section`). Fix: when `section` is set, `window.start`
    IS the settled point already -- use it directly, no second push. Only
    the no-section window (starts at the clip's literal frame 0, never
    skip-adjusted) still gets the `+2.0` push so the default isn't the
    very first frame, clamped to `end` so a window shorter than 2s
    (windows can be as short as MIN_WINDOW_SECONDS) never returns a time
    outside it.
    """
    if user_marker_time is not None:
        return user_marker_time
    start, end = window
    if section is not None:
        return start
    return min(start + 2.0, end)


def _accumulate_clip_boundary_offsets(
    clips: list[tuple[dict | None, float | None]] | None,
) -> list[float]:
    """Interior cut-points (seconds) on the FINAL concatenated timeline where one
    working clip ends and the next begins -- for T5225 overlay-text range
    snapping.

    Reuses the SAME per-clip output-duration accumulation `_clip_slowmo_walk`
    already performs for `first_slowmo_section` (canonicalize -> walk ->
    clip_out); this does not re-walk segments a second way (design SS2.1 / O2).
    Excludes the trivial leading 0.0 and the trailing total (== full duration,
    not an interior boundary) -- the client already has `video_duration` for
    the end edge. Degrades to `[]` (never a partial/fabricated list) the moment
    any clip's output duration is non-finite -- the SAME bail
    `first_slowmo_section` uses -- so a published reel with pruned
    `working_clips` (`read_clip_segments_for_project` -> `[]`) or any other
    unresolvable-length clip never emits wrong offsets; the client falls back
    to free (unsnapped) drag.
    """
    if not clips:
        return []

    offsets: list[float] = []
    cumulative = 0.0
    for segments_data, source_duration in clips:
        canon = canonicalize_segments_data(segments_data, source_duration)
        _, clip_out = _clip_slowmo_walk(canon, source_duration)
        if not math.isfinite(clip_out):
            logger.info(
                "[Poster] clip output duration is non-finite; cannot derive "
                "clip boundaries -> []"
            )
            return []
        cumulative += clip_out
        offsets.append(cumulative)

    # Drop the trailing boundary -- it equals the total duration, not an
    # INTERIOR cut-point (a single clip therefore correctly yields []).
    return offsets[:-1]


def clip_boundary_offsets(project_id: int | None) -> list[float]:
    """Public entry point (T5225): interior clip cut-points for `project_id`'s
    LATEST working clips, in concatenation order. Opens its own connection via
    `load_project_clip_segments` (same helper `poster_slowmo_section` already
    uses in overlay.py's `/overlay-data`), so it degrades to `[]` -- never
    raises -- for a missing project_id or an unresolvable clip set (see
    `_accumulate_clip_boundary_offsets` above)."""
    return _accumulate_clip_boundary_offsets(load_project_clip_segments(project_id))


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


# ---------------------------------------------------------------------------
# T5410: pre-export poster marker (projects.poster_marker_time). Stored on the
# PROJECT row, not working_videos: upsert_working_video (export_finalize.py)
# INSERTS a new version row on every re-render, so a working_videos column
# would be silently dropped on re-export; archive_project also DELETEs
# working_videos at publish. The projects row's id never changes across
# re-render/archive/restore, so a column there survives the reel's whole
# lifecycle for free (Architect gate, T5410).
# ---------------------------------------------------------------------------

def get_project_poster_marker_time(project_id: int | None) -> float | None:
    """The user's pre-export poster marker time (final-video seconds), or None
    (no override -> select_poster_frame falls back to its window-start default).

    Column-guarded for the deploy->migrate window (v032 not yet applied) --
    mirrors the T6030 pattern (never raises "no such column" on a hot path).
    """
    if project_id is None:
        return None
    from ..database import column_exists, get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if not column_exists(cursor, "projects", "poster_marker_time"):
            return None
        cursor.execute("SELECT poster_marker_time FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        return float(row["poster_marker_time"]) if row and row["poster_marker_time"] is not None else None


def set_project_poster_marker_time(project_id: int, time: float) -> bool:
    """Surgical write of the projects.poster_marker_time override (gesture-only
    -- fired from an explicit drag-end / button click, never a useEffect).

    T6560: `time` is a concrete frame time -- the clear-to-none path was removed
    (the endpoint rejects a null/missing time). The preview image is ALWAYS a
    frame (T6510); the marker only MOVES, it never clears. (A stored NULL still
    means "no override -> window midpoint" for legacy rows and get_/select_
    fallbacks, but no write path produces one anymore.)

    T6550: column-guarded (v032), mirroring the guarded READ
    (`get_project_poster_marker_time`). T5085: since T5083 this request path is
    migrated to head before the handler runs, so the guard is no longer for
    the (retired) deploy->migrate window -- it is rolling-deploy-skew defense
    in depth (see `column_exists`'s docstring in database.py): old code on
    machine A can still serve a request against a `projects` row machine B's
    newer code hasn't migrated yet from A's perspective. A bare UPDATE there
    raises `sqlite3.OperationalError: no such column` -> 500.

    Returns True when the override was written, and False when the column is
    not present yet. It returns False rather than raising a bare
    OperationalError, and rather than silently pretending to succeed: the
    caller MUST surface the False outcome distinctly (`set_poster_time` maps
    it to a 503 "not available yet") so a user's drag is never reported saved
    when nothing was stored (CLAUDE.md: no silent fallback for internal
    data). This is a real, time-bounded condition (the rolling-deploy
    window), not an impossible state, so it deserves an honest, retryable
    outcome -- not a swallowed no-op and not a raw 500."""
    from ..database import column_exists, get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if not column_exists(cursor, "projects", "poster_marker_time"):
            return False
        conn.execute(
            "UPDATE projects SET poster_marker_time = ? WHERE id = ?",
            (time, project_id),
        )
        conn.commit()
    return True


def _resolve_final_duration(
    user_id: str, filename: str, stored_duration: float | None,
) -> float | None:
    """final_videos.duration when frozen, else probe the R2 object (legacy rows
    from before duration was frozen at finalize). None when both are
    unavailable -- caller must skip (no fabricated duration)."""
    if stored_duration:
        return float(stored_duration)
    video_url = generate_presigned_url(user_id, f"final_videos/{filename}", expires_in=3600)
    if not video_url:
        return None
    return _probe_duration(video_url)


def _grab_and_store_poster_frame(user_id: str, final_filename: str, t: float) -> str | None:
    """Single-seek frame grab + upload at an ALREADY-DECIDED time `t` (final-video
    seconds). No sampling/ranking -- the window gate + midpoint/marker decision
    already happened (open_play_window / select_poster_frame); this just extracts
    that one frame. Returns the stored basename, or None (never raises).

    T5682: this is the FULL-SIZE og:image object (shares.py's _build_poster_r2_key
    reads the SAME poster_basename/poster_rel_path) -- NEVER resized. The
    owner-facing My Reels tile gets its own separate card-size thumbnail
    (ensure_reel_card_poster, downscaled from this full-size JPEG on demand).
    """
    video_url = generate_presigned_url(user_id, f"final_videos/{final_filename}", expires_in=3600)
    if not video_url:
        logger.info(f"[Poster] no presigned URL for final_videos/{final_filename}; skipping poster")
        return None
    basename = poster_basename(final_filename)
    with tempfile.TemporaryDirectory() as tmp:
        out_path = str(Path(tmp) / basename)
        if not extract_first_frame_jpeg(video_url, out_path, seek=max(0.0, t)):
            logger.info(f"[Poster] extraction failed for {final_filename} at t={t:.3f}s")
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


def _set_poster_fields(
    final_video_id: int, basename: str, frame_time: float | None, source: str,
) -> None:
    """Set poster_filename + poster_frame_time + poster_source on a final_videos
    row in the CURRENT profile DB. Column-guarded for the deploy->migrate window
    (v032 not yet applied) -- mirrors the T6030 pattern; falls back to setting
    only poster_filename rather than crashing the export/backfill path."""
    from ..database import column_exists, get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if column_exists(cursor, "final_videos", "poster_frame_time"):
            cursor.execute(
                "UPDATE final_videos SET poster_filename = ?, poster_frame_time = ?, "
                "poster_source = ? WHERE id = ?",
                (basename, frame_time, source, final_video_id),
            )
        else:
            cursor.execute(
                "UPDATE final_videos SET poster_filename = ? WHERE id = ?",
                (basename, final_video_id),
            )
            logger.info(
                f"[Poster] fv={final_video_id} poster_frame_time/poster_source columns "
                f"absent (pre-migration window); stored filename only"
            )
        conn.commit()


async def generate_poster_at_export(
    user_id: str,
    final_video_id: int,
    final_filename: str,
    section: tuple[float, float] | None,
    final_duration: float,
    user_marker_time: float | None,
) -> str | None:
    """Capture + store the share poster at OVERLAY EXPORT (T5410, replaces the
    T5280 publish-time capture -- REVERSED, see downloads.py).

    NO detection of any kind. The study's only strong signal (open-play zone)
    is realized as a pure time-window gate on the already-frozen slow-mo
    section (open_play_window); within the window the frame is either the
    user's overlay marker (honoured verbatim, never clamped) or the
    deterministic window-start default (select_poster_frame).

    Runs AFTER _finalize_overlay_export returns (the final video + its row both
    exist) and BEFORE the sync-then-announce barrier, so poster_filename/
    poster_frame_time/poster_source ride the existing durable R2 sync. One
    ffmpeg seek + one R2 upload -- best-effort, NEVER raises (poster failure
    must never fail export, T4110 barrier).
    """
    try:
        window = open_play_window(section, final_duration)
        t = select_poster_frame(window, user_marker_time, section)
        source = "overlay" if user_marker_time is not None else "auto"
        stored = await asyncio.to_thread(_grab_and_store_poster_frame, user_id, final_filename, t)
        if not stored:
            logger.info(
                f"[Poster] fv={final_video_id} no poster stored (best effort); "
                f"share unfurl falls back to text until backfilled/re-exported"
            )
            return None
        _set_poster_fields(final_video_id, stored, t, source)
        logger.info(f"[Poster] fv={final_video_id} stored {stored} at t={t:.3f}s source={source}")
        return stored
    except Exception as e:
        # Never let poster work fail export (same invariant as the old publish capture).
        logger.info(f"[Poster] fv={final_video_id} generation error: {e}")
        return None


# T6510: `store_override_poster` (the custom-cover UPLOAD write helper, T5410)
# was DELETED with the upload endpoint. The preview image is now always a frame
# from the reel, so 'upload' is no longer a WRITABLE poster_source. The value
# still READS for grandfathered reels (see overlay.py /overlay-data), and
# `revert_to_auto_poster` below remains the one-way switch off it.


async def revert_to_auto_poster(
    user_id: str,
    project_id: int,
    final_video_id: int,
    final_filename: str,
) -> str | None:
    """Revert a custom cover (uploaded image or overlay marker) back to the
    auto/marker cover and OVERWRITE the deterministic poster key (T6380).

    This is the one-way switch off a custom cover (its upload write path was
    removed in T6510). It re-runs the SINGLE poster-selection path
    (`generate_poster_at_export`) -- there is deliberately
    no second re-derivation of the frame -- so the stored object and the
    poster_source/poster_frame_time columns return to exactly what a fresh
    export would produce: 'overlay' when the project still carries a poster
    marker, else 'auto' at the open-play window midpoint. Because the object
    key is deterministic (`poster_rel_path`), the overwrite is in place and
    every consumer (shares.py `_resolve_poster`, edge og:image, share email)
    needs zero changes.

    Section resolution mirrors `backfill_posters`: prefer the FROZEN
    slowmo_section columns (durable across the publish-time working_clips
    prune), fall back to live/archive reconstruction (`resolve_slowmo_section`).
    Duration prefers the frozen `final_videos.duration`, else probes the R2
    object. Both column reads are guarded for the deploy->migrate window.

    Returns the stored basename, or None on failure (never raises -- inherits
    `generate_poster_at_export`'s best-effort contract). The caller decides
    whether a None is a user-facing error."""
    from ..database import column_exists, get_db_connection

    section = None
    stored_duration = None
    with get_db_connection() as conn:
        cursor = conn.cursor()
        has_slowmo = column_exists(cursor, "final_videos", "slowmo_section_start")
        has_duration = column_exists(cursor, "final_videos", "duration")
        slowmo_cols = (
            "slowmo_section_start, slowmo_section_end"
            if has_slowmo
            else "NULL AS slowmo_section_start, NULL AS slowmo_section_end"
        )
        duration_col = "duration" if has_duration else "NULL AS duration"
        cursor.execute(
            f"SELECT {duration_col}, {slowmo_cols} FROM final_videos WHERE id = ?",
            (final_video_id,),
        )
        row = cursor.fetchone()
        if row is not None:
            stored_duration = row["duration"]
            section = _decode_frozen_section(
                row["slowmo_section_start"], row["slowmo_section_end"]
            )

    if section is None:
        section, src = resolve_slowmo_section(user_id, project_id)
        logger.info(
            f"[Poster] revert fv={final_video_id} section reconstructed via {src}: {section}"
        )

    final_duration = _resolve_final_duration(user_id, final_filename, stored_duration)
    if final_duration is None:
        logger.info(
            f"[Poster] revert fv={final_video_id}: duration unresolvable -> cannot regenerate"
        )
        return None

    user_marker_time = get_project_poster_marker_time(project_id)
    return await generate_poster_at_export(
        user_id, final_video_id, final_filename, section, final_duration, user_marker_time,
    )


# ---------------------------------------------------------------------------
# Reel card-size poster thumbnail (T5682): the owner-facing My Reels tile needs
# a small (~480px) image for fast TTFB, but the FULL-SIZE poster
# (poster_basename/poster_rel_path) is the og:image object shares.py reads for
# share unfurls and must stay untouched. So the card thumb is a SEPARATE R2
# object, generated on first request by downscaling the EXISTING full-size JPEG
# already in R2 (no re-seek into the source video -- cheap image resize).
# ---------------------------------------------------------------------------

def reel_card_poster_rel_path(basename: str) -> str:
    """Profile-relative R2 path for a reel's card-size poster thumbnail,
    derived from the full-size poster basename (`{basename}.card.jpg`)."""
    return f"final_videos/{POSTER_SUBDIR}/{basename}.card.jpg"


def _resize_jpeg(source_path: str, output_path: str, width: int, jpeg_quality: int) -> bool:
    """Downscale an on-disk JPEG to `width` (aspect preserved) via ffmpeg.
    Image-to-image, not a video seek -- cheap. Never raises; False on failure."""
    cmd = [
        "ffmpeg", "-y", "-i", source_path,
        "-vf", f"scale={width}:-1",
        "-q:v", str(jpeg_quality),
        output_path,
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        return Path(output_path).exists() and Path(output_path).stat().st_size > 0
    except Exception as e:
        logger.info(f"[ReelCardPoster] resize failed: {e}")
        return False


def ensure_reel_card_poster(user_id: str, filename_basename: str) -> str | None:
    """Cache-first card-size (480px) reel poster thumbnail (T5682).

    `filename_basename` is `poster_basename(final_videos.filename)` -- the SAME
    basename the full-size og:image poster uses, so the card key derives
    deterministically (`reel_card_poster_rel_path`). Steps:
      1. Card object already cached -> return its path, no work.
      2. Else the full-size poster (og:image object) must already exist -- this
         function does NOT generate the full-size poster (that happens at
         overlay export, `generate_poster_at_export`, T5410); a reel with no
         full-size poster yet (not yet exported / generation failed) yields
         None here too.
      3. Downscale the full-size JPEG (already in R2, fetched via presigned URL)
         to 480px width and upload to the card key.

    Returns the card poster's profile-relative R2 path, or None (best-effort,
    caller 404s -- never raises).
    """
    from ..storage import file_exists_in_r2, upload_bytes_to_r2

    card_rel_path = reel_card_poster_rel_path(filename_basename)
    try:
        if file_exists_in_r2(user_id, card_rel_path):
            return card_rel_path

        full_rel_path = poster_rel_path(filename_basename)
        full_url = generate_presigned_url(user_id, full_rel_path, expires_in=3600)
        if not full_url:
            logger.info(f"[ReelCardPoster] no full-size poster at {full_rel_path}; no card thumb")
            return None

        with tempfile.TemporaryDirectory() as tmp:
            out_path = str(Path(tmp) / "card.jpg")
            if not _resize_jpeg(full_url, out_path, width=480, jpeg_quality=3):
                return None
            data = Path(out_path).read_bytes()
            dims = _jpeg_dimensions(out_path)

        metadata = {"width": dims[0], "height": dims[1]} if dims else None
        if not upload_bytes_to_r2(
            user_id, card_rel_path, data,
            fast=True, content_type="image/jpeg", metadata=metadata,
        ):
            logger.info(f"[ReelCardPoster] R2 upload failed for {card_rel_path}")
            return None

        logger.info(f"[ReelCardPoster] stored {card_rel_path} ({len(data)} bytes, dims={dims or 'unknown'})")
        return card_rel_path
    except Exception as e:
        logger.info(f"[ReelCardPoster] error for {filename_basename}: {e}")
        return None


def ensure_recap_poster(
    recap_key: str, recap_poster_key: str,
    resize_width: int | None = None, jpeg_quality: int = 3,
) -> bool:
    """Generate-on-first-request poster for a game recap (T5180).

    `recap_key` / `recap_poster_key` are FULL (env-prefixed) R2 keys under the
    SHARER's profile prefix: `.../recaps/{game_id}.mp4` ->
    `.../recaps/posters/{game_id}.jpg`. Whole-clip clearest-frame heuristic
    (recaps are stitched artifacts with no per-segment slow-mo data, so the reel
    slow-mo-first policy does NOT apply -- and the selection helper is NOT
    modified here).

    `resize_width`/`jpeg_quality` (T5682): the DEFAULT (None) keeps this FULL-SIZE
    -- this is the shared og:image object read by `shares.py`'s teammate poster
    (`_recap_poster_r2_key`) and warmed by `warm_recap_poster`, so it must NOT
    shrink. The owner-facing card-tile endpoint (`games.py::get_game_poster`)
    passes `resize_width=480` against its OWN separate key
    (`ensure_recap_card_poster`) instead of calling this with a resize -- do not
    resize this shared object.

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
            if not extract_clearest_frame_jpeg(recap_url, out_path,
                                              resize_width=resize_width,
                                              jpeg_quality=jpeg_quality):
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
    """Full R2 keys for a game's recap master and its FULL-SIZE poster, under the
    sharer's profile prefix. Deterministic -- mirrors the key scheme
    `ensure_recap_poster` expects (`recaps/{game_id}.mp4` ->
    `recaps/posters/{game_id}.jpg`). This is the og:image object (shares.py teammate
    poster + warm_recap_poster) -- NEVER resized (T5682)."""
    from ..storage import profile_r2_key
    return (
        profile_r2_key(user_id, profile_id, f"recaps/{game_id}.mp4"),
        profile_r2_key(user_id, profile_id, f"recaps/posters/{game_id}.jpg"),
    )


def recap_poster_r2_keys_for_layer(
    user_id: str, profile_id: str, game_id: int, layer: str,
) -> tuple[str, str]:
    """Full R2 keys for a game's PER-LAYER recap master + its FULL-SIZE poster
    (T5710), under the sharer's profile prefix. layer='athlete' is byte-identical
    to `recap_poster_r2_keys` (same unsuffixed keys -- the athlete layer keeps
    the pre-T5710 scheme); layer='team' returns the derived `_team` siblings.
    The pre-existing unsuffixed helper stays untouched for its existing callers
    (email teammate share -- EPIC decision 6, that flow is unchanged)."""
    from ..constants import RecapLayer
    from ..storage import profile_r2_key
    suffix = "_team" if layer == RecapLayer.TEAM else ""
    return (
        profile_r2_key(user_id, profile_id, f"recaps/{game_id}{suffix}.mp4"),
        profile_r2_key(user_id, profile_id, f"recaps/posters/{game_id}{suffix}.jpg"),
    )


def recap_card_poster_r2_key(user_id: str, profile_id: str, game_id: int) -> str:
    """Full R2 key for a game's CARD-SIZE (480px) poster thumbnail (T5682), used
    ONLY by the owner-facing home/games-tab tile (`games.py::get_game_poster`) --
    a SEPARATE object from the full-size og:image poster
    (`recap_poster_r2_keys`/`_recap_poster_r2_key` in shares.py), which must stay
    untouched for share unfurls."""
    from ..storage import profile_r2_key
    return profile_r2_key(user_id, profile_id, f"recaps/posters/{game_id}.card.jpg")


async def warm_recap_poster(
    user_id: str, profile_id: str, game_id: int, layer: str = "athlete",
) -> None:
    """Warm the recap poster cache at share-CREATION time (T5270), so the R2
    object exists before the link can be pasted into a messenger -- the old
    generate-on-first-request path made the first crawler pay the ffmpeg cost,
    which is too slow for the few seconds a crawler allots og:image.

    `layer` selects which per-layer recap's poster to warm (T5720): the default
    `'athlete'` is byte-identical to the pre-T5710 behavior (unsuffixed keys) and
    keeps the existing email-teammate caller unchanged (EPIC decision 6); the
    public game link passes `'team'` to warm the `_team` poster. One warmer, one
    layer knob -- never a parallel `warm_team_recap_poster`.

    Best-effort only: `ensure_recap_poster` already never raises (missing recap,
    ffmpeg failure, R2 hiccup all return False), but this wrapper never lets an
    unexpected error escape either -- share creation must never fail or slow
    meaningfully because of poster warming. Runs off the event loop
    (`asyncio.to_thread`) since generation shells out to ffmpeg. The on-demand
    GET path (`shares.py::get_shared_teammate_poster` /
    `get_shared_game_poster`) stays as the fallback for shares created before
    this warmed, or whose cached object was evicted.
    """
    recap_key, poster_key = recap_poster_r2_keys_for_layer(
        user_id, profile_id, game_id, layer,
    )
    try:
        await asyncio.to_thread(ensure_recap_poster, recap_key, poster_key)
    except Exception as e:
        logger.info(
            f"[RecapPoster] warm-at-share-creation failed for game_id={game_id} "
            f"layer={layer}: {e}"
        )


# ---------------------------------------------------------------------------
# Game source poster (T5681): a poster for an ACTIVE game that has NO recap yet.
#
# The recap poster (above) only exists once a game has a recap master. Games that
# are still live (source video present in R2) but not yet auto-exported would 404
# and show the branded fallback tile. Here we extract ONE frame directly from the
# live game source (`games/{blake3}.mp4`, global namespace) and cache it at the
# SAME per-profile key the recap poster uses (`recaps/posters/{game_id}.jpg`), so
# the serving path in the endpoint is identical regardless of which producer wrote
# the object. Recap-derived posters always win when a recap exists (the endpoint
# only calls this when recap_video_url is NULL).
#
# Frame choice: the timestamp of the HIGHEST-RATED annotated clip (rating 5
# "Brilliant" > 4 "Good" > ...; ties -> earliest start_time). A game with no clips
# uses a fixed offset into its primary video. Reuses extract_first_frame_jpeg (a
# single ranged seek) -- no fork.
# ---------------------------------------------------------------------------

GAME_POSTER_FALLBACK_OFFSET_SEC = 60.0


def _choose_game_poster_frame(cursor, game_id: int) -> tuple[str | None, float] | None:
    """(video_hash, timestamp_sec) for a game's HIGHEST-RATED annotated clip, or
    None when the game has no clips.

    Highest rating wins (Brilliant=5 beats Good=4 beats the rest); ties break to
    the EARLIEST clip (`start_time ASC`). `video_hash` is the clip's source video
    (`game_videos.blake3_hash` for the clip's `video_sequence`, else the legacy
    `games.blake3_hash`), keyed by the same COALESCE(video_sequence,1) join the
    render path uses. May be None when the row carries no resolvable hash (caller
    then has no live source to seek)."""
    cursor.execute(
        """
        SELECT rc.start_time AS ts,
               COALESCE(gv.blake3_hash, g.blake3_hash) AS video_hash
        FROM raw_clips rc
        LEFT JOIN games g ON rc.game_id = g.id
        LEFT JOIN game_videos gv
            ON gv.game_id = rc.game_id
           AND gv.sequence = COALESCE(rc.video_sequence, 1)
        WHERE rc.game_id = ?
        ORDER BY rc.rating DESC, rc.start_time ASC
        LIMIT 1
        """,
        (game_id,),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    ts = row["ts"] if row["ts"] is not None else 0.0
    return (row["video_hash"], float(ts))


def _primary_game_video_hash(cursor, game_id: int) -> str | None:
    """The game's PRIMARY source video hash (sequence 1, else legacy
    `games.blake3_hash`), or None. Used for the no-clips fallback frame."""
    cursor.execute(
        """
        SELECT COALESCE(gv.blake3_hash, g.blake3_hash) AS video_hash
        FROM games g
        LEFT JOIN game_videos gv ON gv.game_id = g.id AND gv.sequence = 1
        WHERE g.id = ?
        """,
        (game_id,),
    )
    row = cursor.fetchone()
    return row["video_hash"] if row else None


def ensure_game_source_poster(user_id: str, profile_id: str, game_id: int) -> bool:
    """Cache-first poster for an ACTIVE game with NO recap, from its live source
    video (T5681). Generate-on-miss; caches at the CARD-SIZE recap poster key
    (`recap_card_poster_r2_key`, `.card.jpg`) so the endpoint serves it identically
    to the recap-derived card thumbnail.

    T5682: the frame is written at card size (480px, q~70) -- the same resize the
    recap-derived tile uses -- for fast TTFB. Games without a recap have no
    share/og:image consumer (a share requires a recap master), so there is no
    full-size object to preserve; the source frame goes straight to the card key.

    Returns True when the poster object exists (already cached or freshly stored),
    False when it could not be produced -- the endpoint then 404s and the frontend
    renders the branded fallback (no fabricated image, no-silent-fallback rule).
    Specifically False when the game's live source object is gone
    (expired/reclaimed) -> an expired game with no recap stays 404.

    Steps:
      1. Card poster already in R2 -> True without ffmpeg (cache hit).
      2. Pick the frame: highest-rated clip's (video_hash, start_time); no clips ->
         (primary video hash, GAME_POSTER_FALLBACK_OFFSET_SEC).
      3. HEAD-probe `games/{hash}.mp4` (global). Missing -> False (no live source).
      4. Presign + extract ONE card-size frame at the timestamp + upload to the
         card key.

    Best effort: never raises. Runs blocking ffmpeg/R2 work, so callers on the
    event loop wrap it in asyncio.to_thread.
    """
    from ..database import get_db_connection
    from ..storage import (
        generate_presigned_url_global,
        r2_head_object_global,
        upload_bytes_to_r2_global,
    )

    poster_key = recap_card_poster_r2_key(user_id, profile_id, game_id)
    try:
        # 1. Cache hit.
        if r2_head_object_global(poster_key) is not None:
            return True

        # 2. Choose the frame (highest-rated clip, else primary video @ offset).
        with get_db_connection() as conn:
            cursor = conn.cursor()
            choice = _choose_game_poster_frame(cursor, game_id)
            if choice is not None:
                video_hash, timestamp = choice
            else:
                video_hash = _primary_game_video_hash(cursor, game_id)
                timestamp = GAME_POSTER_FALLBACK_OFFSET_SEC

        if not video_hash:
            logger.info(f"[GamePoster] game {game_id} has no source video hash -> no poster")
            return False

        # 3. Live source must still exist (expired/reclaimed -> 404 -> fallback).
        game_key = f"games/{video_hash}.mp4"
        if r2_head_object_global(game_key) is None:
            logger.info(f"[GamePoster] game {game_id} source {game_key} gone -> no poster")
            return False

        source_url = generate_presigned_url_global(game_key, expires_in=3600)
        if not source_url:
            logger.info(f"[GamePoster] presign failed for {game_key}; skipping")
            return False

        # 4. Extract ONE frame at the chosen timestamp (single ranged seek).
        with tempfile.TemporaryDirectory() as tmp:
            out_path = str(Path(tmp) / f"{game_id}.jpg")
            if not extract_first_frame_jpeg(
                source_url, out_path, seek=timestamp,
                resize_width=480, jpeg_quality=3,
            ):
                logger.info(
                    f"[GamePoster] extraction failed for game {game_id} @ {timestamp:.3f}s"
                )
                return False
            data = Path(out_path).read_bytes()
            dims = _jpeg_dimensions(out_path)

        metadata = {"width": dims[0], "height": dims[1]} if dims else None
        if not upload_bytes_to_r2_global(
            poster_key, data, fast=True, content_type="image/jpeg", metadata=metadata,
        ):
            logger.info(f"[GamePoster] R2 upload failed for {poster_key}; no poster stored")
            return False

        logger.info(
            f"[GamePoster] stored {poster_key} from {game_key} @ {timestamp:.3f}s "
            f"({len(data)} bytes, dims={dims or 'unknown'})"
        )
        return True
    except Exception as e:
        logger.warning(f"[GamePoster] unexpected error for game {game_id}: {e}")
        return False


# ---------------------------------------------------------------------------
# Draft poster (T5671): a cheap, cacheable thumbnail JPEG for every reel DRAFT
# so the home-screen tile/carousel redesign (T5672/T5673) has an image per draft.
# Published reels already get a poster at publish (T5280); drafts did not.
#
# Key scheme (per-profile): posters/drafts/{project_id}.jpg -- DETERMINISTIC from
# the project id, so there is NO new DB column and NO migration (the key is
# derivable state; storing it would be redundant, per the correct-data rule).
# Generated on first request from the draft's FIRST clip's source video (clearest
# frame within the clip's region -- whole-clip heuristic, no slow-mo policy; that
# is for published finals, T5090). Reuses the clearest-frame + source-resolution
# helper families; does NOT fork them.
# ---------------------------------------------------------------------------

DRAFT_POSTER_SUBDIR = "posters/drafts"
DRAFT_POSTER_VERSION = "v2"  # T5682: card-size (480px) thumbnails; bump forces regen


def draft_poster_rel_path(project_id: int) -> str:
    """Profile-relative R2 path for a reel DRAFT's poster JPEG (T5671).

    Deterministic from the project id -- no DB column, no migration. Stored
    under the CURRENT profile prefix like every other per-user artifact
    (`{env}/users/{user_id}/profiles/{profile_id}/posters/drafts/{id}.v2.jpg`).
    No og:image/share consumer reads this key (drafts are unpublished), so it's
    safe to version freely -- T5682 bumped it to force existing full-size
    cached objects to regenerate at the new 480px card size.
    """
    return f"{DRAFT_POSTER_SUBDIR}/{project_id}.{DRAFT_POSTER_VERSION}.jpg"


def _load_first_clip_for_poster(project_id: int) -> dict | None:
    """The draft's FIRST working clip (min sort_order, latest version) with the
    columns `resolve_clip_source` needs, or None when the project has no clips.

    Mirrors the framing render's clip query (`export/framing.py`) column-for-column
    so the poster's source resolution matches the clip that would actually render.
    """
    from ..database import get_db_connection
    from ..queries import latest_working_clips_subquery

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT
                wc.id, wc.raw_clip_id, wc.uploaded_filename, wc.sort_order,
                rc.filename AS raw_filename,
                rc.game_id, rc.video_sequence,
                rc.start_time AS raw_start_time, rc.end_time AS raw_end_time,
                (rc.end_time - rc.start_time) AS raw_duration,
                COALESCE(gv.blake3_hash, g.blake3_hash) AS game_blake3_hash
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            LEFT JOIN games g ON rc.game_id = g.id
            LEFT JOIN game_videos gv
                ON rc.game_id = gv.game_id AND rc.video_sequence = gv.sequence
            WHERE wc.project_id = ?
              AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
            LIMIT 1
            """,
            (project_id, project_id),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def ensure_draft_poster(project_id: int, user_id: str) -> str | None:
    """Cache-first poster for a reel DRAFT; generate-on-miss (T5671).

    Runs in the CURRENT profile context (the R2 key embeds the ContextVar
    profile), so call it on the profile that owns the project. Returns the
    profile-relative R2 path of the poster object when one is available, or None
    when it could not be produced -- the GET endpoint 404s and the frontend
    renders its no-poster fallback (no fabricated image, no-silent-fallback rule).

    Steps:
      1. If the poster object already exists in R2 -> return its path WITHOUT
         re-running ffmpeg (this is the cache hit; a second GET does no work).
      2. Load the draft's first clip; no clips -> None.
      3. Resolve the clip's source (`resolve_clip_source`): game video, else the
         preserved extract, else the recap. A reclaimed/expired source raises
         SourceUnavailable -> None (the 404 the spec requires).
      4. Extract the clearest frame WITHIN the clip's source region (window =
         the clip's [in, out] offsets -- the whole-clip heuristic scoped to the
         clip, NOT the slow-mo reel policy) and upload it to the deterministic
         key.

    Best effort: never raises. Any failure (missing source, ffmpeg, R2) logs at
    info and returns None.
    """
    from ..storage import file_exists_in_r2, upload_bytes_to_r2
    from .export_helpers import SourceUnavailable, resolve_clip_source

    rel_path = draft_poster_rel_path(project_id)
    try:
        # 1. Cache hit: the object is already in R2 -> reuse, no ffmpeg.
        if file_exists_in_r2(user_id, rel_path):
            return rel_path

        # 2. First clip (source of the thumbnail).
        clip = _load_first_clip_for_poster(project_id)
        if clip is None:
            logger.info(f"[DraftPoster] project {project_id} has no clips -> no poster")
            return None

        # 3. Resolve the editable source. A reclaimed/expired source raises
        #    SourceUnavailable -> None -> 404 (no fabricated image).
        try:
            source_url, in_off, out_off, _flexible = resolve_clip_source(clip)
        except SourceUnavailable:
            logger.info(
                f"[DraftPoster] project {project_id} first clip source unavailable "
                f"(expired/reclaimed) -> no poster"
            )
            return None

        # 4. Clearest frame within the clip's region (whole-clip heuristic scoped
        #    to [in, out]); the helper falls back to the first frame on a bad
        #    window or ffprobe failure. T5682: resize to card-size thumbnail.
        window = (in_off, out_off) if out_off > in_off else None
        basename = f"{project_id}.jpg"
        with tempfile.TemporaryDirectory() as tmp:
            out_path = str(Path(tmp) / basename)
            if not extract_clearest_frame_jpeg(source_url, out_path, window=window,
                                              resize_width=480, jpeg_quality=3):
                logger.info(f"[DraftPoster] extraction failed for project {project_id}; no poster")
                return None
            data = Path(out_path).read_bytes()
            dims = _jpeg_dimensions(out_path)

        metadata = {"width": dims[0], "height": dims[1]} if dims else None
        if not upload_bytes_to_r2(
            user_id, rel_path, data,
            fast=True, content_type="image/jpeg", metadata=metadata,
        ):
            logger.info(f"[DraftPoster] R2 upload failed for {rel_path}; no poster")
            return None

        logger.info(f"[DraftPoster] stored {rel_path} ({len(data)} bytes, dims={dims or 'unknown'})")
        return rel_path
    except Exception as e:
        # Never raise: the poster is best-effort; a failure just yields the
        # frontend fallback tile.
        logger.info(f"[DraftPoster] project {project_id} poster error: {e}")
        return None


def invalidate_draft_poster(project_id: int) -> None:
    """Delete a draft's cached poster object so the next GET regenerates it
    (T5671). Called from the gesture-triggered backend actions that change a
    project's clip composition (add/remove/reorder) -- the draft's first clip,
    and thus its thumbnail, may have changed. NO reactive watcher.

    Runs in the CURRENT profile context. Best effort: `delete_from_r2` already
    swallows R2 errors, and this wrapper never lets an unexpected error escape,
    so poster invalidation can NEVER fail the parent clip action.
    """
    from ..storage import delete_from_r2
    from ..user_context import get_current_user_id

    try:
        delete_from_r2(get_current_user_id(), draft_poster_rel_path(project_id))
    except Exception as e:
        logger.info(f"[DraftPoster] invalidation failed for project {project_id}: {e}")


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
    used to upgrade legacy posters to the open-play window-gate selection
    (T5410). The object key is deterministic, so regeneration just overwrites
    in place. Rows with `poster_source IN ('overlay', 'upload')` are ALWAYS
    skipped (counted in `skipped_override`), even under force -- a user's
    manual cover choice is never clobbered by a backfill sweep.
    """
    from ..database import column_exists, ensure_database, get_db_connection, sync_db_to_r2_explicit
    from ..migrations import MigrationBlocked, _get_profile_ids, migrate_local_profile_db_at_seam
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
        "skipped_override": [],
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
            try:
                ensure_database()
            except MigrationBlocked as e:
                # T5085: ensure_database() is now the JIT seam (T5083) -- a
                # single blocked profile must not abort the whole backfill
                # run (the un-wrapped call would raise past this loop and
                # the T5110 "never one crash starves the sweep" invariant
                # below would never even be reached). Skip this profile only.
                result["failed"].append(
                    {"profile_id": profile_id, "error": f"migration_blocked: {e.reason}"}
                )
                logger.error(
                    f"[PosterBackfill] profile {user_id}/{profile_id} blocked at "
                    f"migration seam ({e.reason}) -- skipping"
                )
                continue

            # T5085: re-pointed off the bulk-runner primitive (_migrate_profile_db,
            # deleted alongside T5087) onto the JIT seam primitive T5083 built.
            # ensure_database() above already migrated this profile when R2 is
            # enabled; this call is the cheap at-head no-op in that case, AND
            # the thing that actually migrates a below-head profile in local/
            # no-R2 mode, where the seam inside ensure_database is inert
            # (test_t5110_poster_backfill_below_head.py pins this). The
            # backfill enumerates via unfiltered _get_profile_ids (includes
            # orphan profiles the deleted bulk runner used to registry-skip,
            # T4830) -- migrating each touched profile to head holds the
            # invariant "every profile the backfill touches is at head" and
            # heals the orphan gap as a side effect. Best-effort: a migration
            # failure is recorded and the profile is skipped, never aborting
            # the sweep.
            try:
                migrate_res = migrate_local_profile_db_at_seam(user_id, profile_id)
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

            # T5410: duration/poster_source are named unconditionally below UNLESS
            # absent -- an ancient/orphan profile predating even v007 (duration)
            # can reach here (migrated to head does NOT retroactively add a v007
            # column if the profile started life without the base schema this
            # candidate query assumes). Column-guarded the same way slowmo_cols
            # already is, so a profile missing either just gets NULL rather than
            # aborting the whole candidate query (T5110's "never one crash starves
            # the sweep" invariant).
            with get_db_connection() as _guard_conn:
                _guard_cursor = _guard_conn.cursor()
                _has_duration = column_exists(_guard_cursor, "final_videos", "duration")
                _has_poster_source = column_exists(_guard_cursor, "final_videos", "poster_source")
            duration_col = "duration" if _has_duration else "NULL AS duration"
            poster_source_col = "poster_source" if _has_poster_source else "NULL AS poster_source"
            candidate_sql = (
                f"SELECT id, filename, project_id, {duration_col}, {poster_source_col}, "
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

                # A user's manual cover choice (overlay marker or upload) is NEVER
                # clobbered by the sweep -- skip unconditionally, even under force.
                if row["poster_source"] in ("overlay", "upload"):
                    result["skipped_override"].append(fv_id)
                    continue

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
                    # the SAME open-play window-gate policy as live export. Prefer
                    # the FROZEN columns (durable across working_clips pruning); only
                    # fall back to reconstruction (live clips -> R2 archive) when
                    # unfrozen, and heal the columns so future regens skip the work.
                    # Unreconstructable -> None -> whole-clip-minus-margin midpoint
                    # (open_play_window, no fabricated slow-mo region).
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

                    final_duration = _resolve_final_duration(user_id, filename, row["duration"])
                    if final_duration is None:
                        result["failed"].append({"id": fv_id, "error": "duration_unresolvable"})
                        continue

                    window = open_play_window(section, final_duration)
                    t = select_poster_frame(window, None, section)  # backfill never has a user marker
                    stored = _grab_and_store_poster_frame(user_id, filename, t)
                    if not stored:
                        result["failed"].append({"id": fv_id, "error": "poster generation returned None"})
                        continue
                    _set_poster_fields(fv_id, stored, t, "auto")
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
