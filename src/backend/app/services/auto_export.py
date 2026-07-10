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
from ..storage import (
    generate_presigned_url,
    generate_presigned_url_global,
    upload_bytes_to_r2,
    upload_to_r2,
)
from ..user_context import set_current_user_id

logger = logging.getLogger(__name__)

EXPORT_TIMEOUT_SECONDS = 300

# Max times the sweep will retry a failed auto-export before giving up and
# letting the source be reclaimed. The counter lives in games.auto_export_attempts
# and is read by sweep_scheduler._find_games_for_hash.
MAX_AUTO_EXPORT_ATTEMPTS = 3

# T4140: the recap doubles as a full-quality re-edit master. Create Clip (T4130)
# and edit-reel re-export must keep working after the game video is reclaimed, so
# resolve_clip_source falls back to the recap at each clip's frozen bounds. That
# only works if the recap holds real pixels: encode at NATIVE resolution (no 480p
# downscale) at master-grade quality. crf 18 is near-visually-lossless; "fast"
# keeps the inline (still-CPU, pre-T2650) sweep encode within budget (Risk 3).
# Both are tunable here without touching the pipeline.
RECAP_CRF = 18
RECAP_PRESET = "fast"

# Signature of the legacy 480p recap encoder that T4140 replaced: the old code
# hardcoded `.filter("scale", 854, 480)`, so any recap that probes to exactly
# 854x480 is a legacy proxy the backfill should upgrade. Native game footage is
# ~never exactly 854x480, which makes this a clean, idempotent upgrade signal.
_LEGACY_RECAP_DIMENSIONS = (854, 480)


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


def _video_dimensions(probe: dict):
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


def _pick_canonical_resolution(resolutions: list[tuple]) -> tuple:
    """Choose the concat-normalization target for a mixed-resolution recap.

    Prefers the resolution shared by the MOST clips (fewest clips get rescaled ->
    fewest crop-keyframe regions shifted, per Risk 1), tie-broken toward the
    larger frame (preserve pixels for reframe/upscale). resolutions must be
    non-empty and contain no None.
    """
    from collections import Counter
    counts = Counter(resolutions)
    return max(counts, key=lambda r: (counts[r], r[0] * r[1]))


def _generate_recap(
    user_id: str, profile_id: str, game_id: int, clips: list[dict]
) -> str:
    """Generate a full-quality recap master by concatenating all annotated clips.

    T4140: the recap is the surviving re-edit source once the game video is
    reclaimed, so each clip is encoded at its NATIVE resolution at master-grade
    quality (RECAP_CRF/RECAP_PRESET) — no 480p downscale. Crop keyframes are
    stored in SOURCE pixels (see default_crop.py / keyframes-framing.md), so
    rescaling a clip would shift its crop region; native-res encoding keeps every
    single-source clip's framing valid for re-edit.

    `concat c=copy` requires uniform codec/resolution. Single-source games are
    already uniform. Mixed-resolution multi-source games (two halves / different
    cameras) are normalized to a single canonical resolution, scaling ONLY the
    non-conforming segments — the unavoidable case where those clips' crop
    keyframes shift (documented tradeoff, frozen-bounds re-edit only).

    The recap_start/recap_end mapping (recaps/{game_id}_clips.json) is written in
    the same shape as before; resolve_clip_source reads it to re-materialize a
    clip from the recap at its frozen bounds.
    """
    t0 = time.perf_counter()
    logger.info(f"[AutoExport] Recap game={game_id} starting with {len(clips)} clips")

    with tempfile.TemporaryDirectory() as temp_dir:
        clips_by_hash = defaultdict(list)
        for clip in clips:
            clips_by_hash[clip['video_hash']].append(clip)
        logger.info(f"[AutoExport] Recap game={game_id} {len(clips_by_hash)} unique video sources")

        extracted_paths = []
        clip_resolutions = []  # aligned with extracted_paths; (w,h) or None
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
                # T4140: NATIVE resolution (no scale filter) at master-grade quality.
                (
                    ffmpeg.input(
                        video_url,
                        ss=clip['start_time'],
                        to=clip['end_time'],
                    )
                    .output(
                        str(out_path),
                        vcodec="libx264",
                        preset=RECAP_PRESET,
                        crf=RECAP_CRF,
                        acodec="aac",
                        movflags="+faststart",
                    )
                    .run(quiet=True, overwrite_output=True)
                )
                extracted_paths.append(out_path)

                probe = ffmpeg.probe(str(out_path))
                duration = float(probe['format']['duration'])
                clip_resolutions.append(_video_dimensions(probe))
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

        # T4140: concat demuxer (c=copy) requires a uniform resolution. Native-res
        # encoding leaves mixed-resolution multi-source games non-uniform, so scale
        # ONLY the minority segments up/down to a shared canonical resolution.
        known_res = [r for r in clip_resolutions if r is not None]
        if len(set(known_res)) > 1:
            canonical = _pick_canonical_resolution(known_res)
            cw, ch = canonical
            logger.info(
                f"[AutoExport] Recap game={game_id} mixed resolutions "
                f"{sorted(set(known_res))} -> canonical {cw}x{ch}; normalizing "
                f"non-conforming segments (crop keyframes on those clips shift)"
            )
            for idx, res in enumerate(clip_resolutions):
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
                        preset=RECAP_PRESET,
                        crf=RECAP_CRF,
                        acodec="aac",
                        movflags="+faststart",
                    )
                    .run(quiet=True, overwrite_output=True)
                )
                extracted_paths[idx] = normalized

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


def _recap_is_legacy_480p(user_id: str, game_id: int) -> bool | None:
    """True if game_id's recap is a legacy 854x480 proxy that needs upgrading.

    Probes the stored recap once. Returns None when the recap is missing or the
    probe is unreadable (can't decide -> caller skips, never crashes). Hi-q
    (native-res) recaps probe to something other than 854x480, so a re-run of the
    backfill skips them -- this is the idempotency signal that makes batching work
    without a schema column.
    """
    recap_url = generate_presigned_url(user_id, f"recaps/{game_id}.mp4")
    if not recap_url:
        return None
    try:
        dims = _video_dimensions(ffmpeg.probe(recap_url))
    except Exception as e:
        logger.warning(f"[Backfill] game={game_id} recap probe failed: {e}")
        return None
    if dims is None:
        return None
    return dims == _LEGACY_RECAP_DIMENSIONS


def backfill_hiq_recaps(limit: int = 25, dry_run: bool = False) -> dict:
    """Admin-triggered: upgrade legacy 480p recaps to hi-q for games whose game
    video still exists (in-grace / not-yet-reclaimed).

    Heavy per-game re-encode, so it is throttled by `limit` (max games upgraded
    per call) and batched: call repeatedly until `partial` is False. NOT run on
    startup or deploy. Games whose source is already gone (past grace) keep their
    480p recap and are reported in `skipped_gone`, never crashed (documented
    cutoff, Risk 4 / criterion "already-gone games handled, not crashed").

    Idempotent via the 854x480 legacy signature (_recap_is_legacy_480p): recaps
    already at native resolution are counted in `already_hiq` and skipped, so
    repeated calls make forward progress without a schema marker.

    Returns a dict with the per-game outcome lists and `partial` (True when the
    `limit` budget was exhausted before scanning finished).
    """
    from ..database import ensure_database
    from ..migrations import _get_profile_ids
    from ..storage import r2_head_object_global
    from .auth_db import get_all_users_for_admin

    result = {
        "limit": limit,
        "dry_run": dry_run,
        "scanned": 0,
        "upgraded": [],
        "already_hiq": [],
        "skipped_gone": [],
        "skipped_unknown": [],
        "failed": [],
        "partial": False,
    }
    budget = limit
    t0 = time.perf_counter()

    users = get_all_users_for_admin()
    for user in users:
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
                games = [
                    dict(g) for g in conn.execute(
                        "SELECT id FROM games "
                        "WHERE auto_export_status = 'complete' "
                        "AND recap_video_url IS NOT NULL"
                    ).fetchall()
                ]

            for game in games:
                if budget <= 0:
                    result["partial"] = True
                    break
                game_id = game["id"]
                clips = _get_annotated_clips(game_id)
                if not clips:
                    continue
                result["scanned"] += 1

                # Source present iff every source hash is still in R2. A multi-
                # source game with even one reclaimed half can't be faithfully
                # regenerated -> treat as gone (past grace), keep the 480p recap.
                hashes = {c['video_hash'] for c in clips if c['video_hash']}
                if not hashes or not all(
                    r2_head_object_global(f"games/{h}.mp4") is not None for h in hashes
                ):
                    result["skipped_gone"].append(game_id)
                    logger.info(
                        f"[Backfill] game={game_id} source gone (past grace) — "
                        f"recap stays 480p"
                    )
                    continue

                is_legacy = _recap_is_legacy_480p(user_id, game_id)
                if is_legacy is None:
                    result["skipped_unknown"].append(game_id)
                    continue
                if not is_legacy:
                    result["already_hiq"].append(game_id)
                    continue

                if dry_run:
                    result["upgraded"].append(game_id)
                    budget -= 1
                    continue
                try:
                    _generate_recap(user_id, profile_id, game_id, clips)
                    result["upgraded"].append(game_id)
                    budget -= 1
                    logger.info(f"[Backfill] game={game_id} recap upgraded to hi-q")
                except Exception as e:
                    result["failed"].append({"game_id": game_id, "error": str(e)})
                    logger.error(f"[Backfill] game={game_id} recap upgrade failed: {e}")

    logger.info(
        f"[Backfill] complete in {time.perf_counter() - t0:.2f}s "
        f"upgraded={len(result['upgraded'])} already_hiq={len(result['already_hiq'])} "
        f"gone={len(result['skipped_gone'])} failed={len(result['failed'])} "
        f"partial={result['partial']} dry_run={dry_run}"
    )
    return result
