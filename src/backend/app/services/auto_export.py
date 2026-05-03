"""
Auto-export service: generates brilliant clip exports and recap videos
before game video deletion during the cleanup sweep.

Runs in background (no HTTP context) — must set ContextVars and sync
DB to R2 explicitly after every write.
"""

import json
import logging
import tempfile
import uuid
from collections import defaultdict
from pathlib import Path

import ffmpeg

from ..database import get_db_connection, sync_db_to_r2_explicit
from ..profile_context import set_current_profile_id
from ..storage import download_from_r2_global, upload_to_r2, upload_bytes_to_r2
from ..user_context import set_current_user_id

logger = logging.getLogger(__name__)

EXPORT_TIMEOUT_SECONDS = 300


def auto_export_game(user_id: str, profile_id: str, game_id: int) -> str:
    """Auto-export brilliant clips and generate recap for a game.

    Returns status: 'complete', 'skipped', 'failed'.
    """
    from ..database import ensure_database

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
            return 'skipped'
        if game['auto_export_status'] in ('complete', 'pending'):
            return game['auto_export_status']

        cursor.execute(
            "UPDATE games SET auto_export_status = 'pending' WHERE id = ?",
            (game_id,),
        )
        conn.commit()

    try:
        annotated_clips = _get_annotated_clips(game_id)

        if not annotated_clips:
            _set_game_status(game_id, 'skipped')
            sync_db_to_r2_explicit(user_id, profile_id)
            return 'skipped'

        brilliant_clips = [c for c in annotated_clips if c['rating'] == 5]
        if not brilliant_clips:
            brilliant_clips = [c for c in annotated_clips if c['rating'] == 4]

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
        return 'complete'

    except Exception as e:
        logger.error(f"[AutoExport] Failed for game {game_id}: {e}")
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
    """Export a single brilliant clip via FFmpeg center-crop to 9:16 at 1080x1920."""
    video_hash = clip['video_hash']
    start_time = clip['start_time']
    end_time = clip['end_time']
    duration = end_time - start_time

    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = Path(temp_dir) / "source.mp4"
        if not download_from_r2_global(f"games/{video_hash}.mp4", source_path):
            raise RuntimeError(f"Failed to download game video {video_hash}")

        extracted_path = Path(temp_dir) / "extracted.mp4"
        (
            ffmpeg.input(str(source_path), ss=start_time, to=end_time)
            .output(str(extracted_path), c="copy")
            .run(quiet=True, overwrite_output=True)
        )

        probe = ffmpeg.probe(str(extracted_path))
        video_stream = next(
            s for s in probe['streams'] if s['codec_type'] == 'video'
        )
        src_w = int(video_stream['width'])
        src_h = int(video_stream['height'])

        target_ratio = 9 / 16
        src_ratio = src_w / src_h
        if src_ratio > target_ratio:
            crop_h = src_h
            crop_w = int(crop_h * target_ratio)
        else:
            crop_w = src_w
            crop_h = int(crop_w / target_ratio)
        crop_x = (src_w - crop_w) // 2
        crop_y = (src_h - crop_h) // 2

        output_path = Path(temp_dir) / "output.mp4"
        (
            ffmpeg.input(str(extracted_path))
            .filter("crop", crop_w, crop_h, crop_x, crop_y)
            .filter("scale", 1080, 1920)
            .output(
                str(output_path),
                vcodec="libx264",
                preset="medium",
                crf=23,
                acodec="aac",
                movflags="+faststart",
            )
            .run(quiet=True, overwrite_output=True)
        )

        filename = f"auto_{game_id}_{clip['id']}_{uuid.uuid4().hex[:8]}.mp4"
        r2_key = f"final_videos/{filename}"
        upload_to_r2(user_id, r2_key, output_path)

    clip_name = clip['name'] or f"Clip {clip['id']}"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO final_videos
               (project_id, filename, version, source_type, game_id, name,
                published_at, duration)
               VALUES (?, ?, 1, 'brilliant_clip', ?, ?, CURRENT_TIMESTAMP, ?)""",
            (clip['auto_project_id'], filename, game_id, clip_name, duration),
        )
        conn.commit()


def _generate_recap(
    user_id: str, profile_id: str, game_id: int, clips: list[dict]
) -> str:
    """Generate a 480p recap video by concatenating all annotated clips."""
    with tempfile.TemporaryDirectory() as temp_dir:
        clips_by_hash = defaultdict(list)
        for clip in clips:
            clips_by_hash[clip['video_hash']].append(clip)

        extracted_paths = []
        clip_mapping = []
        recap_offset = 0.0
        for video_hash, hash_clips in clips_by_hash.items():
            source_path = Path(temp_dir) / f"source_{video_hash[:12]}.mp4"
            if not download_from_r2_global(
                f"games/{video_hash}.mp4", source_path
            ):
                logger.error(
                    f"[AutoExport] Failed to download {video_hash} for recap"
                )
                continue

            for clip in hash_clips:
                out_path = Path(temp_dir) / f"clip_{clip['id']}.mp4"
                (
                    ffmpeg.input(
                        str(source_path),
                        ss=clip['start_time'],
                        to=clip['end_time'],
                    )
                    .filter("scale", 854, 480)
                    .output(
                        str(out_path),
                        vcodec="libx264",
                        preset="fast",
                        crf=28,
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
                    'tags': json.loads(clip['tags']) if clip['tags'] else [],
                    'notes': clip['notes'] or '',
                    'recap_start': round(recap_offset, 3),
                    'recap_end': round(recap_offset + duration, 3),
                })
                recap_offset += duration

        if not extracted_paths:
            raise RuntimeError("No clips extracted for recap")

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

    return recap_r2_key
