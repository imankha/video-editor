"""
Collection metadata computation for final_videos (T3600).

duration, aspect_ratio, and tags are frozen onto final_videos at
export-finalize time (publish archives + deletes working data, so they
cannot be derived later). The v007 backfill reuses these helpers so
stamping and backfill can never drift apart.

Tags are a msgpack-encoded array of distinct tag strings (same BLOB
convention as final_videos.rating_counts) via utils/encoding.py.
"""

import logging

from app.queries import latest_working_clips_subquery
from app.utils.encoding import encode_data, decode_data

logger = logging.getLogger(__name__)


def encode_distinct_tags(tag_blobs) -> bytes | None:
    """Aggregate msgpack tag blobs into one distinct, order-preserving
    msgpack array. Returns None when no tags exist (NULL column)."""
    tags = []
    seen = set()
    for blob in tag_blobs:
        decoded = decode_data(blob)
        if not decoded:
            continue
        for tag in decoded:
            if tag not in seen:
                seen.add(tag)
                tags.append(tag)
    return encode_data(tags) if tags else None


def _duration_from_raw_clips(cursor, project_id: int):
    """Auto-projects have no working_videos; their export duration is the
    raw clip's time range (matches auto_export's stamped value)."""
    cursor.execute(
        "SELECT end_time - start_time AS duration FROM raw_clips "
        "WHERE auto_project_id = ? AND end_time IS NOT NULL "
        "AND start_time IS NOT NULL",
        (project_id,),
    )
    row = cursor.fetchone()
    return row[0] if row else None


def _tags_for_project(cursor, project_id: int) -> bytes | None:
    """Distinct tags of a project's constituent clips: latest-version
    working_clips -> raw_clips, plus the auto-project clip link."""
    cursor.execute(
        f"""
        SELECT DISTINCT rc.id, rc.tags
        FROM raw_clips rc
        WHERE rc.auto_project_id = ?
           OR rc.id IN (
                SELECT wc.raw_clip_id FROM working_clips wc
                WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
                AND wc.id IN ({latest_working_clips_subquery()})
           )
        ORDER BY rc.id
        """,
        (project_id, project_id, project_id),
    )
    return encode_distinct_tags(row[1] for row in cursor.fetchall())


def compute_project_metadata(cursor, project_id: int):
    """Compute (duration, aspect_ratio, tags_blob) for a project from live
    DB rows. Any value that cannot be resolved is None — callers stamp NULL
    and downstream features exclude NULL rows from math (no silent fallback).
    """
    cursor.execute(
        "SELECT aspect_ratio FROM projects WHERE id = ?", (project_id,)
    )
    row = cursor.fetchone()
    aspect_ratio = row[0] if row else None

    cursor.execute(
        "SELECT duration FROM working_videos "
        "WHERE project_id = ? AND duration IS NOT NULL "
        "ORDER BY version DESC LIMIT 1",
        (project_id,),
    )
    row = cursor.fetchone()
    duration = row[0] if row else _duration_from_raw_clips(cursor, project_id)

    tags_blob = _tags_for_project(cursor, project_id)

    return duration, aspect_ratio, tags_blob


def compute_annotated_game_metadata(cursor, game_id: int):
    """(duration, tags_blob) for legacy annotated_game rows (project_id is
    NULL, game_id set). Duration is the sum of rated clip durations — the
    same definition the per-request chain in downloads.py used before T3600
    removed it. aspect_ratio is not derivable for these rows and stays NULL."""
    cursor.execute(
        "SELECT SUM(end_time - start_time) FROM raw_clips "
        "WHERE game_id = ? AND rating >= 3",
        (game_id,),
    )
    row = cursor.fetchone()
    duration = row[0] if row else None

    cursor.execute(
        "SELECT id, tags FROM raw_clips "
        "WHERE game_id = ? AND rating >= 3 ORDER BY id",
        (game_id,),
    )
    tags_blob = encode_distinct_tags(r[1] for r in cursor.fetchall())

    return duration, tags_blob


def compute_archive_metadata(cursor, archive: dict):
    """Compute (duration, aspect_ratio, tags_blob) from a project archive
    (services/project_archive.py msgpack dict). Working data comes from the
    archive; tags still resolve through live raw_clips, which survive
    archival (only working_clips/working_videos are deleted at publish)."""
    project = archive.get("project") or {}
    aspect_ratio = project.get("aspect_ratio")

    duration = None
    working_videos = archive.get("working_videos") or []
    for wv in sorted(working_videos,
                     key=lambda w: w.get("version") or 0, reverse=True):
        if wv.get("duration") is not None:
            duration = wv["duration"]
            break
    if duration is None and project.get("id") is not None:
        duration = _duration_from_raw_clips(cursor, project["id"])

    raw_clip_ids = sorted({
        wc["raw_clip_id"]
        for wc in archive.get("working_clips") or []
        if wc.get("raw_clip_id")
    })
    tags_blob = None
    if raw_clip_ids:
        placeholders = ",".join("?" for _ in raw_clip_ids)
        cursor.execute(
            f"SELECT id, tags FROM raw_clips WHERE id IN ({placeholders}) "
            "ORDER BY id",
            raw_clip_ids,
        )
        tags_blob = encode_distinct_tags(row[1] for row in cursor.fetchall())

    return duration, aspect_ratio, tags_blob
