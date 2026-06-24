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


def encode_game_ids(game_ids) -> bytes | None:
    """msgpack array of sorted distinct game ids, or None when empty.
    len==1 -> game collection; len>1 -> mixes; None -> game-less (T3605)."""
    distinct = sorted({g for g in game_ids if g is not None})
    return encode_data(distinct) if distinct else None


# T3630: the ONE canonical collection ordering. Glicko `rating` is primary (it is
# seeded from the frozen star at export, so it is sane even before any matchup);
# `quality_score` is a secondary tiebreaker, then recency. SQLite has no NULLS
# LAST, so the `(col IS NULL)` prefixes push reels with a missing value to the
# bottom (0 sorts before 1). All three collection read-paths (list_downloads,
# collections_summary, the T3620 resolver) use this; the frontend mirrors it in
# utils/reelOrder.js. Columns are `fv.`-qualified because every consumer selects
# `FROM final_videos fv`.
ORDER_BY_RANK = (
    "(fv.rating IS NULL), fv.rating DESC, "
    "(fv.quality_score IS NULL), fv.quality_score DESC, "
    "fv.created_at DESC"
)


def route_collection(game_ids_blob, clip_count) -> int | None:
    """Route a published reel to its collection bucket (T3630). Collections are
    SINGLE-CLIP reels only: a reel with clip_count != 1 (multi-clip, or unknown)
    is never collection-eligible and always falls to Mixes. A single-clip reel
    routes by its frozen game_ids: its single game id (game collection), or None
    (game-less -> Mixes). Returns the game id for a single-clip single-game reel,
    else None.

    clip_count (NOT quality_score) is the membership signal so a single-clip reel
    whose rating is unrecoverable still belongs to its collection. Shared by
    collections_summary, the /api/downloads filters, and the T3620 resolver so
    member counts stay in lockstep (count-parity)."""
    if clip_count != 1:
        return None  # multi-clip / unknown -> Mixes
    return route_game_ids(game_ids_blob)


def route_game_ids(blob) -> int | None:
    """Route a frozen final_videos.game_ids BLOB to a single game id or None
    (mixes). len==1 -> that game id (game collection); len>1 -> None (multi-game
    mix); NULL/[] -> None (game-less mix). This is the SINGLE read path shared by
    GET /api/collections/summary and the game_id/mixes filters on
    GET /api/downloads, so member counts always equal summary counts (T3610)."""
    ids = decode_data(blob) or []
    return ids[0] if len(ids) == 1 else None


def compute_project_game_ids(cursor, project_id: int) -> bytes | None:
    """Distinct game ids of a project's constituent clips: latest-version
    working_clips -> raw_clips.game_id, plus the auto-project clip link.
    Mirrors the live resolution in downloads.py (working_clips -> raw_clips).
    Returns a msgpack BLOB or None when nothing resolves."""
    cursor.execute(
        f"""
        SELECT DISTINCT rc.game_id
        FROM raw_clips rc
        WHERE (rc.auto_project_id = ?
           OR rc.id IN (
                SELECT wc.raw_clip_id FROM working_clips wc
                WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
                AND wc.id IN ({latest_working_clips_subquery()})
           ))
           AND rc.game_id IS NOT NULL
        """,
        (project_id, project_id, project_id),
    )
    return encode_game_ids(r[0] for r in cursor.fetchall())


def compute_archive_game_ids(cursor, archive: dict) -> bytes | None:
    """Distinct game ids for an archived project: archived working_clips'
    raw_clip_id -> live raw_clips.game_id (raw_clips survive archival, only
    working_clips/working_videos are deleted at publish)."""
    raw_clip_ids = sorted({
        wc["raw_clip_id"]
        for wc in archive.get("working_clips") or []
        if wc.get("raw_clip_id")
    })
    if not raw_clip_ids:
        return None
    placeholders = ",".join("?" for _ in raw_clip_ids)
    cursor.execute(
        f"SELECT DISTINCT game_id FROM raw_clips WHERE id IN ({placeholders}) "
        "AND game_id IS NOT NULL",
        raw_clip_ids,
    )
    return encode_game_ids(r[0] for r in cursor.fetchall())


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


def compute_project_clip_stats(cursor, project_id: int):
    """Frozen (clip_count, quality_score) for a project reel (T3630). clip_count =
    distinct constituent clips; quality_score = the lone clip's rating (1-5) when
    clip_count == 1, else None. clip_count is the SINGLE-CLIP membership signal
    (== 1 -> collection-eligible); quality_score is ordering only and is kept
    SEPARATE so a single-clip reel with an unrecoverable rating still counts as
    single-clip. Resolves the SAME clip set as compute_project_game_ids."""
    cursor.execute(
        f"""
        SELECT DISTINCT rc.id, rc.rating
        FROM raw_clips rc
        WHERE rc.auto_project_id = ?
           OR rc.id IN (
                SELECT wc.raw_clip_id FROM working_clips wc
                WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
                AND wc.id IN ({latest_working_clips_subquery()})
           )
        """,
        (project_id, project_id, project_id),
    )
    rows = cursor.fetchall()
    count = len(rows)
    quality = float(rows[0][1]) if count == 1 and rows[0][1] is not None else None
    return count, quality


def compute_archive_clip_stats(cursor, archive: dict):
    """compute_project_clip_stats for an archived project: distinct archived
    working_clip raw_clip_ids -> count; the lone one's live rating when count==1."""
    raw_clip_ids = sorted({
        wc["raw_clip_id"]
        for wc in archive.get("working_clips") or []
        if wc.get("raw_clip_id")
    })
    count = len(raw_clip_ids)
    if count != 1:
        return count, None
    cursor.execute("SELECT rating FROM raw_clips WHERE id = ?", (raw_clip_ids[0],))
    row = cursor.fetchone()
    quality = float(row[0]) if row and row[0] is not None else None
    return count, quality


def compute_project_ranking_freeze(cursor, project_id: int):
    """All T3630 ranking columns frozen at a live project export:
    (clip_count, quality_score, rating, rd, source_clip_id, clip_start_time).

    rating/rd/source_clip_id/clip_start_time are set ONLY for single-clip reels
    (clip_count == 1, the ranking pool); a multi-clip reel gets its count + NULLs
    (it routes to Mixes and never ranks). rating is seeded from the frozen star
    (quality_score) so ordering is sane before any matchup. Shared by all three
    export-finalize sites so the freeze can never drift between them."""
    from app.services.glicko import seed_rating, RD_MAX
    count, quality = compute_project_clip_stats(cursor, project_id)
    if count == 1:
        source_clip_id, clip_start_time = compute_project_clip_identity(
            cursor, project_id)
        return count, quality, seed_rating(quality), RD_MAX, source_clip_id, clip_start_time
    return count, quality, None, None, None, None


def compute_project_clip_identity(cursor, project_id: int):
    """Frozen (source_clip_id, clip_start_time) for a SINGLE-clip project reel
    (T3630). source_clip_id is the lone constituent raw_clip id -- it keys the
    Glicko rating so Portrait/Landscape ratio twins (which share one source clip)
    share one rating (spec §4.4). clip_start_time is that clip's in-match start in
    seconds, frozen for the `33'` soccer-notation card timestamp. Returns
    (None, None) when the reel is multi-clip (only meaningful when
    compute_project_clip_stats returns count==1). Resolves the SAME clip set."""
    cursor.execute(
        f"""
        SELECT DISTINCT rc.id, rc.start_time
        FROM raw_clips rc
        WHERE rc.auto_project_id = ?
           OR rc.id IN (
                SELECT wc.raw_clip_id FROM working_clips wc
                WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
                AND wc.id IN ({latest_working_clips_subquery()})
           )
        """,
        (project_id, project_id, project_id),
    )
    rows = cursor.fetchall()
    if len(rows) != 1:
        return None, None
    return rows[0][0], rows[0][1]


def compute_unified_clip_start(cursor, source_clip_id, clip_start_time):
    """Unified in-match start (seconds) for a single-clip reel: the clip's
    file-relative start_time plus the total duration of every game-video half
    that precedes the clip's own half (T3920).

    A clip 5 min into the 2nd half is stored as start_time=300, video_sequence=2;
    its game minute must read ~50' (45'+5'), not 6'. The first-half duration lives
    in game_videos, which persists with the game even after the reel's project is
    archived (raw_clips survive too), so this resolves for old reels at backfill.

    - clip_start_time is None (multi-clip reels): returns None.
    - first/single video (video_sequence None or <= 1): returns clip_start_time.
    - source clip or its prior-half duration unresolvable: returns clip_start_time
      (best-effort file-relative; never invents an offset). Callers that backfill
      in bulk log how many rows fell back so the gap stays visible.
    """
    if clip_start_time is None or source_clip_id is None:
        return clip_start_time
    row = cursor.execute(
        "SELECT video_sequence, game_id FROM raw_clips WHERE id = ?",
        (source_clip_id,),
    ).fetchone()
    if row is None:
        return clip_start_time
    video_sequence, game_id = row[0], row[1]
    if not video_sequence or video_sequence <= 1 or game_id is None:
        return clip_start_time
    offset = cursor.execute(
        "SELECT COALESCE(SUM(duration), 0) FROM game_videos "
        "WHERE game_id = ? AND sequence < ?",
        (game_id, video_sequence),
    ).fetchone()[0] or 0.0
    return float(clip_start_time) + float(offset)


def compute_archive_clip_identity(cursor, archive: dict):
    """compute_project_clip_identity for an archived project: the lone archived
    working_clip raw_clip_id (its start_time read from the live raw_clips row,
    which survives archival). (None, None) when not single-clip."""
    raw_clip_ids = sorted({
        wc["raw_clip_id"]
        for wc in archive.get("working_clips") or []
        if wc.get("raw_clip_id")
    })
    if len(raw_clip_ids) != 1:
        return None, None
    cursor.execute(
        "SELECT start_time FROM raw_clips WHERE id = ?", (raw_clip_ids[0],)
    )
    row = cursor.fetchone()
    start_time = row[0] if row else None
    return raw_clip_ids[0], start_time


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
