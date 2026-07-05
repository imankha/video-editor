"""
Auto-export service: generates brilliant clip exports and recap videos
before game video deletion during the cleanup sweep.

Runs in background (no HTTP context) — must set ContextVars and sync
DB to R2 explicitly after every write.
"""

import json
import logging
import tempfile
import time
import uuid
from collections import defaultdict
from pathlib import Path

import ffmpeg

from app.utils.encoding import decode_data

from ..database import get_db_connection, sync_db_to_r2_explicit
from ..profile_context import set_current_profile_id
from ..storage import generate_presigned_url_global, upload_bytes_to_r2, upload_to_r2
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


def _export_brilliant_clip(
    user_id: str, profile_id: str, clip: dict, game_id: int
) -> None:
    """Preserve a single brilliant clip as a frameable Reel Draft (T4175).

    Stream-copies the clip range out of the game video (original resolution)
    before the game source is reclaimed, uploads it to raw_clips/ as the clip's
    independent source, wires raw_clips.filename, and leaves the auto-project as
    a non-archived draft. It does NOT publish a final_videos row and does NOT
    archive the project — an unframed clip must never enter My Reels; the user
    frames it later and resolve_clip_source finds this extract once the game is
    gone.

    T4160: if the clip already has a published reel (framed content) with this
    source_clip_id, skips entirely — the highlight is already preserved in
    framed form and must not be touched.
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

        # T4175: preserve the extract as the clip's INDEPENDENT source, not as a
        # published reel. The key lands in raw_clips/ (the per-clip source
        # namespace the framing/multi-clip resolver already reads), and the
        # filename is wired onto the clip's own raw_clips row so
        # resolve_clip_source finds it once the game video is reclaimed. NO
        # aspect-ratio probe: nothing is published, so there is no ratio to
        # stamp — the label is settled when the user actually frames+publishes.
        filename = f"auto_{game_id}_{clip['id']}_{uuid.uuid4().hex[:8]}.mp4"
        r2_key = f"raw_clips/{filename}"
        upload_to_r2(user_id, r2_key, output_path)
        logger.info(f"[AutoExport] Brilliant clip={clip['id']} uploaded as {filename} in {time.perf_counter() - t0:.2f}s")

    # T4175: leave a frameable Reel Draft. An unframed clip must NEVER be
    # published or archived — it stays in Reel Drafts so the user can frame it
    # later from the preserved extract. This reverses the old sweep behavior
    # (publish raw 16:9 + archive) that put raw wide footage into My Reels.
    from ..routers.clips import _insert_working_clip_with_dims
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Wire the extract as the clip's own source.
        cursor.execute(
            "UPDATE raw_clips SET filename = ? WHERE id = ?",
            (filename, clip['id']),
        )
        # Ensure the auto-project is a frameable draft. It normally already
        # carries a working_clip from annotate-time _create_auto_project_for_clip;
        # the sweep only needs to NOT delete it (i.e. not archive). Rebuild via
        # the same blueprint only in the degenerate no-working-clip case so the
        # draft is always renderable.
        has_working_clip = cursor.execute(
            "SELECT 1 FROM working_clips WHERE project_id = ? LIMIT 1",
            (clip['auto_project_id'],),
        ).fetchone()
        if not has_working_clip:
            _insert_working_clip_with_dims(
                cursor, project_id=clip['auto_project_id'],
                raw_clip_id=clip['id'], sort_order=0,
            )
            logger.info(
                f"[AutoExport] Rebuilt working_clip for auto-project "
                f"{clip['auto_project_id']} (clip {clip['id']}) — was missing"
            )
        # NO publish (no final_videos row), NO archive (archived_at stays NULL).
        conn.commit()

    logger.info(
        f"[AutoExport] Clip {clip['id']} preserved as frameable draft "
        f"(project {clip['auto_project_id']}, source raw_clips/{filename})"
    )


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
