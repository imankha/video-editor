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

import logging
import subprocess
import tempfile
from pathlib import Path

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


def generate_and_store_poster(user_id: str, final_filename: str) -> str | None:
    """Extract the first frame of a final video and store it in R2.

    Runs in the CURRENT profile context (r2_key embeds the ContextVar profile),
    so it must be called on the same profile that owns the final video (every
    finalize/publish writer does). Returns the poster BASENAME to store on the
    `final_videos` row, or None when the poster could not be produced (best
    effort -- the caller stores NULL and the export still succeeds).
    """
    video_url = generate_presigned_url(user_id, f"final_videos/{final_filename}", expires_in=3600)
    if not video_url:
        # R2 disabled or presign failed -> no poster this time (info, not error:
        # the reel is fine, the unfurl just falls back to text until backfilled).
        logger.info(f"[Poster] no presigned URL for final_videos/{final_filename}; skipping poster")
        return None

    basename = poster_basename(final_filename)
    with tempfile.TemporaryDirectory() as tmp:
        out_path = str(Path(tmp) / basename)
        if not extract_first_frame_jpeg(video_url, out_path):
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


def backfill_posters(limit: int = 25, dry_run: bool = False) -> dict:
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
    """
    from ..database import ensure_database, get_db_connection, sync_db_to_r2_explicit
    from ..migrations import _get_profile_ids
    from ..profile_context import set_current_profile_id
    from ..storage import file_exists_in_r2
    from ..user_context import set_current_user_id
    from .auth_db import get_all_users_for_admin

    result = {
        "limit": limit,
        "dry_run": dry_run,
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

            with get_db_connection() as conn:
                rows = [
                    dict(r) for r in conn.execute(
                        "SELECT id, filename FROM final_videos "
                        "WHERE published_at IS NOT NULL AND poster_filename IS NULL"
                    ).fetchall()
                ]

            profile_changed = False
            for row in rows:
                if budget <= 0:
                    result["partial"] = True
                    break
                fv_id, filename = row["id"], row["filename"]
                result["scanned"] += 1
                basename = poster_basename(filename)

                # Skip-if-poster-exists: the object is already there, just heal the ref.
                if file_exists_in_r2(user_id, poster_rel_path(basename)):
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
                    stored = generate_and_store_poster(user_id, filename)
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
            if profile_changed:
                if not sync_db_to_r2_explicit(user_id, profile_id):
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
