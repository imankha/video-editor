"""
Auto-export service: generates brilliant clip exports and recap videos
before game video deletion during the cleanup sweep.

Runs in background (no HTTP context) — must set ContextVars and sync
DB to R2 explicitly after every write.
"""

import json

from app.utils.encoding import decode_data
import logging
import tempfile
import time
import uuid
from collections import defaultdict
from pathlib import Path

import ffmpeg

from ..database import get_db_connection, sync_db_to_r2_explicit
from ..profile_context import set_current_profile_id
from .collection_metadata import compute_project_metadata, encode_game_ids, compute_unified_clip_start
from ..storage import delete_from_r2, generate_presigned_url_global, upload_to_r2, upload_bytes_to_r2
from ..user_context import set_current_user_id

logger = logging.getLogger(__name__)

EXPORT_TIMEOUT_SECONDS = 300

# Max times the sweep will retry a failed auto-export before giving up and
# letting the source be reclaimed. The counter lives in games.auto_export_attempts
# and is read by sweep_scheduler._find_games_for_hash.
MAX_AUTO_EXPORT_ATTEMPTS = 3


def auto_export_game(user_id: str, profile_id: str, game_id: int) -> str:
    """Auto-export brilliant clips and generate recap for a game.

    Returns status: 'complete', 'skipped', 'failed'.
    """
    from ..database import ensure_database

    t0 = time.perf_counter()
    logger.info(f"[AutoExport] Starting game={game_id} user={user_id[:8]}")

    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    ensure_database()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT auto_export_status, blake3_hash FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()
        if not game:
            logger.info(f"[AutoExport] game={game_id} not found, skipping")
            return 'skipped'
        if game['auto_export_status'] == 'complete':
            logger.info(f"[AutoExport] game={game_id} already complete")
            return 'complete'

        if game['auto_export_status'] == 'pending':
            logger.info(f"[AutoExport] Retrying previously pending game {game_id}")

        # Count this attempt so the sweep can cap retries of a failing game.
        cursor.execute(
            "UPDATE games SET auto_export_status = 'pending', "
            "auto_export_attempts = COALESCE(auto_export_attempts, 0) + 1 WHERE id = ?",
            (game_id,),
        )
        conn.commit()

    try:
        annotated_clips = _get_annotated_clips(game_id)
        logger.info(f"[AutoExport] game={game_id} found {len(annotated_clips)} annotated clips")

        if not annotated_clips:
            _set_game_status(game_id, 'skipped')
            sync_db_to_r2_explicit(user_id, profile_id)
            logger.info(f"[AutoExport] game={game_id} no clips, skipped in {time.perf_counter() - t0:.2f}s")
            return 'skipped'

        brilliant_clips = [c for c in annotated_clips if c['rating'] == 5]
        if not brilliant_clips:
            brilliant_clips = [c for c in annotated_clips if c['rating'] == 4]
        logger.info(f"[AutoExport] game={game_id} exporting {len(brilliant_clips)} brilliant clips")

        for clip in brilliant_clips:
            try:
                _export_brilliant_clip(user_id, profile_id, clip, game_id)
            except Exception as e:
                logger.error(f"[AutoExport] Brilliant clip {clip['id']} failed: {e}")

        recap_url = _generate_recap(user_id, profile_id, game_id, annotated_clips)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE games SET auto_export_status = 'complete', recap_video_url = ? WHERE id = ?",
                (recap_url, game_id),
            )
            conn.commit()

        sync_db_to_r2_explicit(user_id, profile_id)
        elapsed = time.perf_counter() - t0
        logger.info(f"[AutoExport] game={game_id} complete in {elapsed:.2f}s ({len(brilliant_clips)} brilliant, {len(annotated_clips)} total)")
        return 'complete'

    except Exception as e:
        logger.error(f"[AutoExport] game={game_id} failed after {time.perf_counter() - t0:.2f}s: {e}")
        _set_game_status(game_id, 'failed')
        sync_db_to_r2_explicit(user_id, profile_id)
        return 'failed'


def _get_annotated_clips(game_id: int) -> list[dict]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            """SELECT rc.id, rc.name, rc.rating, rc.tags, rc.notes,
                      rc.start_time, rc.end_time, rc.auto_project_id,
                      rc.video_sequence,
                      COALESCE(gv.blake3_hash, g.blake3_hash) as video_hash
               FROM raw_clips rc
               LEFT JOIN games g ON rc.game_id = g.id
               LEFT JOIN game_videos gv ON gv.game_id = rc.game_id
                   AND gv.sequence = COALESCE(rc.video_sequence, 1)
               WHERE rc.game_id = ? AND rc.rating IS NOT NULL
               ORDER BY COALESCE(rc.video_sequence, 1), rc.start_time""",
            (game_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _set_game_status(game_id: int, status: str) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE games SET auto_export_status = ? WHERE id = ?",
            (status, game_id),
        )
        conn.commit()


def _probe_aspect_ratio(output_path) -> str | None:
    """Map the exported file's real dimensions to a ratio label.

    width >= height -> '16:9', else '9:16'. Returns None if the probe fails —
    NULL rows are excluded from ranking math by design, so we never guess a
    ratio. A stream-copy of a game video is 16:9; stamping the auto project's
    9:16 (the T4160 bug) is what routed raw wide footage into the 9:16 pool.
    """
    try:
        probe = ffmpeg.probe(str(output_path))
        stream = next(s for s in probe['streams'] if s.get('codec_type') == 'video')
        width = int(stream['width'])
        height = int(stream['height'])
    except Exception as e:
        logger.warning(
            f"[AutoExport] Failed to probe {output_path} for aspect_ratio: {e} "
            f"— aspect_ratio stays NULL"
        )
        return None
    return '16:9' if width >= height else '9:16'


def _export_brilliant_clip(
    user_id: str, profile_id: str, clip: dict, game_id: int
) -> None:
    """Export a single brilliant clip via FFmpeg stream-copy extract (original resolution).

    T4160: if the clip already has a published reel (framed content) with this
    source_clip_id, skips entirely — never replaces framed content with a raw
    stream-copy. Otherwise exports, stamping the real aspect ratio probed from
    the output file and a derived name. An unpublished prior auto-export row for
    the same auto project is still swapped out atomically (T4010).
    """
    if not clip['auto_project_id']:
        logger.warning(f"[AutoExport] Skipping clip {clip['id']} — no auto_project_id")
        return

    t0 = time.perf_counter()
    video_hash = clip['video_hash']
    start_time = clip['start_time']
    end_time = clip['end_time']
    if start_time is None or end_time is None or end_time <= start_time:
        logger.warning(
            f"[AutoExport] Skipping brilliant clip {clip['id']} — invalid range "
            f"start={start_time} end={end_time} (end <= start)"
        )
        return
    duration = end_time - start_time
    logger.info(f"[AutoExport] Brilliant clip={clip['id']} hash={video_hash[:12]} range={start_time:.1f}-{end_time:.1f}s")

    # T4160: never replace an existing published reel for this clip. A published
    # final_videos row with this source_clip_id means the highlight is already
    # preserved in framed form — either the auto project's own prior export or a
    # custom-project export of the same clip. Publishing a raw stream-copy over it
    # would destroy framed content and reset its match history (the July-9 bomb).
    # Skipping counts as SUCCESS for the game's export loop (only exceptions are
    # treated as failures by the auto_export_attempts retry cap).
    with get_db_connection() as conn:
        existing = conn.execute(
            "SELECT 1 FROM final_videos "
            "WHERE source_clip_id = ? AND published_at IS NOT NULL",
            (clip['id'],),
        ).fetchone()
    if existing:
        logger.info(
            f"[AutoExport] Clip {clip['id']} already has a published reel — "
            f"skipping auto stream-copy export (framed content preserved)"
        )
        return

    video_url = generate_presigned_url_global(f"games/{video_hash}.mp4")
    if not video_url:
        raise RuntimeError(f"Failed to generate presigned URL for {video_hash}")

    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = Path(temp_dir) / "extracted.mp4"
        t_ffmpeg = time.perf_counter()
        (
            ffmpeg.input(video_url, ss=start_time, to=end_time)
            .output(str(output_path), c="copy", movflags="+faststart")
            .run(quiet=True, overwrite_output=True)
        )
        logger.info(f"[AutoExport] Brilliant clip={clip['id']} ffmpeg stream-copy in {time.perf_counter() - t_ffmpeg:.2f}s")

        # T4160: stamp the honest aspect ratio from the artifact itself, not the
        # auto project. Must probe while the temp file still exists.
        aspect_ratio = _probe_aspect_ratio(output_path)

        filename = f"auto_{game_id}_{clip['id']}_{uuid.uuid4().hex[:8]}.mp4"
        r2_key = f"final_videos/{filename}"
        upload_to_r2(user_id, r2_key, output_path)
        logger.info(f"[AutoExport] Brilliant clip={clip['id']} uploaded as {filename} in {time.perf_counter() - t0:.2f}s")

    # T4160: derive the name the same way derive_project_name does, so unnamed
    # clips publish as e.g. "Brilliant Goal" instead of "Clip 5". Falls back to
    # "Clip {id}" only when nothing is derivable (documented last resort).
    from ..queries import derive_clip_name
    clip_name = derive_clip_name(
        clip['name'], clip['rating'] or 0, decode_data(clip['tags']) or [],
        clip['notes'] or '') or f"Clip {clip['id']}"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # T3600: freeze collection metadata. duration stays the clip range
        # computed above (the exported artifact IS the raw clip extract).
        # T4160: compute_project_metadata is kept only for the tags blob; its
        # aspect_ratio return is no longer used — the real ratio is probed from
        # the output file above (a stream-copy of a game video is 16:9, not the
        # auto project's 9:16).
        _, _project_aspect, tags_blob = compute_project_metadata(
            cursor, clip['auto_project_id'])
        # T4010: capture the prior export (re-export scenario) so we can swap it
        # out atomically: INSERT the new row first, then DELETE the old row BY id
        # (a project-wide DELETE would also remove the row we just inserted), and
        # only delete the old R2 object AFTER the commit. This removes the
        # zero-row / object-deleted-before-commit window.
        cursor.execute(
            """SELECT id, filename FROM final_videos
               WHERE source_type = 'brilliant_clip' AND project_id = ?""",
            (clip['auto_project_id'],),
        )
        old_row = cursor.fetchone()
        old_id = old_row['id'] if old_row else None
        old_filename = old_row['filename'] if old_row else None

        # T3605: brilliant clip belongs to exactly one game -> [game_id]
        game_ids_blob = encode_game_ids([game_id])
        # T3630: a brilliant clip IS a single clip -> clip_count=1, quality=its
        # rating, rating seeded from the star, rd=RD_MAX, source_clip_id = the
        # clip itself (links ratio twins), clip_start_time = its in-match start.
        from .glicko import seed_rating, RD_MAX
        quality_score = float(clip['rating']) if clip['rating'] is not None else None
        rating = seed_rating(quality_score)
        # T3920: unified two-half in-match start (file-relative + prior-half durations)
        clip_game_start_time = compute_unified_clip_start(
            cursor, clip['id'], clip['start_time'])
        cursor.execute(
            """INSERT INTO final_videos
               (project_id, filename, version, source_type, game_id, name,
                published_at, duration, aspect_ratio, tags, game_ids, clip_count, quality_score,
                rating, rd, match_count, source_clip_id, clip_start_time, clip_game_start_time)
               VALUES (?, ?, 1, 'brilliant_clip', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?)""",
            (clip['auto_project_id'], filename, game_id, clip_name, duration,
             aspect_ratio, tags_blob, game_ids_blob, quality_score,
             rating, RD_MAX, clip['id'], clip['start_time'], clip_game_start_time),
        )
        if old_id is not None:
            cursor.execute("DELETE FROM final_videos WHERE id = ?", (old_id,))
        conn.commit()

    # T4010: post-commit, best-effort cleanup of the prior R2 object. Never the
    # just-written object; a cleanup failure must not undo the committed swap.
    if old_filename and old_filename != filename:
        old_r2_key = f"final_videos/{old_filename}"
        try:
            delete_from_r2(user_id, old_r2_key)
        except Exception as e:
            logger.warning(f"[AutoExport] Failed to delete old R2 file {old_r2_key}: {e}")


def _generate_recap(
    user_id: str, profile_id: str, game_id: int, clips: list[dict]
) -> str:
    """Generate a 480p recap video by concatenating all annotated clips."""
    t0 = time.perf_counter()
    logger.info(f"[AutoExport] Recap game={game_id} starting with {len(clips)} clips")

    with tempfile.TemporaryDirectory() as temp_dir:
        clips_by_hash = defaultdict(list)
        for clip in clips:
            clips_by_hash[clip['video_hash']].append(clip)
        logger.info(f"[AutoExport] Recap game={game_id} {len(clips_by_hash)} unique video sources")

        extracted_paths = []
        clip_mapping = []
        recap_offset = 0.0
        for video_hash, hash_clips in clips_by_hash.items():
            video_url = generate_presigned_url_global(f"games/{video_hash}.mp4")
            if not video_url:
                logger.error(
                    f"[AutoExport] Recap game={game_id} failed to get URL for hash={video_hash[:12]}"
                )
                continue

            for clip in hash_clips:
                # Skip clips with an invalid range (missing or inverted, i.e.
                # end <= start). ffmpeg's -ss/-to extracts nothing for these and
                # raises, which would otherwise fail the whole game's recap (bug 23p).
                if (clip['start_time'] is None or clip['end_time'] is None
                        or clip['end_time'] <= clip['start_time']):
                    logger.warning(
                        f"[AutoExport] Recap game={game_id} skipping clip {clip['id']}: "
                        f"invalid range start={clip['start_time']} end={clip['end_time']} "
                        f"(end <= start) — excluded from recap"
                    )
                    continue
                out_path = Path(temp_dir) / f"clip_{clip['id']}.mp4"
                (
                    ffmpeg.input(
                        video_url,
                        ss=clip['start_time'],
                        to=clip['end_time'],
                    )
                    .filter("scale", 854, 480)
                    .output(
                        str(out_path),
                        vcodec="libx264",
                        preset="ultrafast",
                        crf=32,
                        acodec="aac",
                        movflags="+faststart",
                    )
                    .run(quiet=True, overwrite_output=True)
                )
                extracted_paths.append(out_path)

                probe = ffmpeg.probe(str(out_path))
                duration = float(probe['format']['duration'])
                clip_mapping.append({
                    'id': clip['id'],
                    'name': clip['name'],
                    'rating': clip['rating'],
                    'tags': decode_data(clip['tags']) or [],
                    'notes': clip['notes'] or '',
                    'recap_start': round(recap_offset, 3),
                    'recap_end': round(recap_offset + duration, 3),
                })
                recap_offset += duration

        if not extracted_paths:
            logger.error(f"[AutoExport] Recap game={game_id} no clips extracted after {time.perf_counter() - t0:.2f}s")
            raise RuntimeError("No clips extracted for recap")

        logger.info(f"[AutoExport] Recap game={game_id} extracted {len(extracted_paths)} clips in {time.perf_counter() - t0:.2f}s, concatenating")
        concat_list = Path(temp_dir) / "concat.txt"
        with open(concat_list, "w") as f:
            for path in extracted_paths:
                f.write(f"file '{path}'\n")

        recap_path = Path(temp_dir) / "recap.mp4"
        (
            ffmpeg.input(str(concat_list), f="concat", safe=0)
            .output(str(recap_path), c="copy", movflags="+faststart")
            .run(quiet=True, overwrite_output=True)
        )

        recap_r2_key = f"recaps/{game_id}.mp4"
        upload_to_r2(user_id, recap_r2_key, recap_path)

        upload_bytes_to_r2(
            user_id,
            f"recaps/{game_id}_clips.json",
            json.dumps(clip_mapping).encode(),
        )

    elapsed = time.perf_counter() - t0
    logger.info(f"[AutoExport] Recap game={game_id} complete in {elapsed:.2f}s ({len(extracted_paths)} clips, {recap_offset:.1f}s duration)")
    return recap_r2_key
