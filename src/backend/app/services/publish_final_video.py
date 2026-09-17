"""
T4390: single shared writer for the `final_videos` table.

Collapses the two remaining publish writers (`_finalize_overlay_export` and
`export_final`'s inline INSERT, ~1,690 lines apart in the same file) into
one. The task file's original third writer (the sweep's hardcoded
`version=1, source_type='brilliant_clip'` instant-publish row) no longer
exists -- T4175 redesigned the sweep to stop writing `final_videos`
entirely; see the divergence table in
docs/plans/tasks/export-write-path/T4390-finalize-publish-single-writers.md.

Absorbed as PROPERTIES of the shared writer (verified identical between the
two prior copies, not re-derived per caller):
- T4010 atomic swap: capture prior -> INSERT new -> repoint -> DELETE prior
  row in the SAME transaction -> (caller, post-commit) delete the prior R2
  object. Never speculatively nulls final_video_id; never deletes the old
  object before the new pointer commits.
- T5215 intro_card_id carry-forward across a re-export's new version row.
- T6030 slowmo columns, now ALWAYS column-guarded (T4390 DV7 fix -- the
  inline `export_final` copy wrote them unconditionally, an un-guarded
  "no such column" risk in the deploy->migrate window that
  `_finalize_overlay_export` already avoided; no documented reason for the
  difference, so the safer of the two behaviors wins).
- T8070 raw_clips reel-source window refresh.
- T4160's aspect_ratio-from-actual-output-file rule, EXTENDED (T4390) to
  every publish caller -- previously only the now-removed sweep path
  enforced it. See `resolve_output_aspect_ratio`.

Deliberately NOT absorbed (still caller-side -- different table, or a
concern this writer doesn't own):
- `before_after_tracks` inserts (`export_final`-only feature; the caller
  does this in the SAME transaction, using the same cursor, right after
  calling in here).
- Poster generation (`generate_poster_at_export`) -- runs AFTER this
  returns, same T5410 ordering as before.
- The durable-sync-then-announce barrier -- unchanged, still the caller's.
"""

import logging

from ..database import column_exists
from ..storage import delete_from_r2
from . import export_job_repository
from .collection_metadata import (
    compute_project_game_ids,
    compute_project_metadata,
    compute_project_ranking_freeze,
    compute_unified_clip_start,
)
from .poster import first_slowmo_section, read_clip_segments_for_project
from .video_probe import ffprobe_bytes, probe_dimensions_via_url

logger = logging.getLogger(__name__)


def prior_final_is_shared(prior_filename: str | None) -> bool:
    """Whether an active share still serves the prior final video's R2 object.

    Shares snapshot the filename + resolve playback straight from R2, so deleting an
    object an active share points at would break the share. Postgres is an external
    dependency here: if the check can't run, fail SAFE (treat as shared -> keep the
    object) rather than risk deleting a still-served reel."""
    if not prior_filename:
        return False
    try:
        from .sharing_db import filename_has_active_share
        return filename_has_active_share(prior_filename)
    except Exception as e:
        logger.warning(
            f"[Publish] Active-share check failed for {prior_filename}; "
            f"keeping prior object to be safe: {e}")
        return True


def delete_prior_final_object(user_id: str, prior_filename: str | None, new_filename: str) -> None:
    """Post-commit, best-effort cleanup of a re-exported reel's PRIOR R2 object.

    Runs ONLY after the new version is committed + the pointer repointed. Never
    deletes the just-written object, and never raises -- a cleanup failure must not
    roll back the successful swap. Caller has already confirmed the object is not
    served by an active share."""
    if not prior_filename or prior_filename == new_filename:
        return
    try:
        delete_from_r2(user_id, f"final_videos/{prior_filename}")
        logger.info(f"[Publish] Deleted prior final R2 object final_videos/{prior_filename}")
    except Exception as e:
        logger.warning(f"[Publish] Failed to delete prior final final_videos/{prior_filename}: {e}")


def derive_aspect_ratio_label(width: int, height: int) -> str | None:
    """Map actual pixel dimensions to the two ratios the product supports.

    The frontend only ever offers '16:9'/'9:16' (no third option), so an
    unrecognized ratio returns None rather than inventing an 'other' bucket
    nothing downstream (e.g. rank.py's ranking-pool filter) knows how to
    handle -- callers fall back to the project's explicit setting instead."""
    if not width or not height:
        return None
    ratio = width / height
    if 1.7 <= ratio <= 1.8:
        return '16:9'
    if 0.55 <= ratio <= 0.6:
        return '9:16'
    return None


def resolve_output_aspect_ratio(
    *,
    project_aspect_ratio: str | None,
    video_bytes: bytes | None = None,
    user_id: str | None = None,
    r2_relative_path: str | None = None,
    log_context: str = "",
) -> str | None:
    """T4160's rule ("aspect_ratio must come from the actual output file"),
    extended (T4390) to every publish caller -- previously only the
    now-removed sweep path enforced it.

    Probes the ACTUAL rendered file: in-memory bytes when the caller already
    has them (`export_final` holds the uploaded bytes), else a presigned-URL
    ffprobe for R2-resident output (`_finalize_overlay_export`'s 3 call sites
    never hold local bytes -- Modal writes straight to R2, the
    no-keyframes/test-mode paths do an R2->R2 copy).

    On any probe failure (R2 disabled -- true in every current test
    environment, so this path always falls back there and the goldens need
    no re-bless for this change; network/ffprobe failure; or a genuinely
    non-standard ratio) falls back to the project's explicit aspect_ratio
    setting, with a WARNING log. This is the CLAUDE.md-sanctioned "fallback
    for an external dependency" (ffprobe/R2 network access) -- the fallback
    value is real user-set data, not a guess, and the failure is logged, not
    silent. Behavior only changes where R2 is actually live (staging/prod),
    which is exactly where the T4160 incident class lives."""
    dims = None
    if video_bytes is not None:
        dims = ffprobe_bytes(video_bytes)
    if dims is None and user_id and r2_relative_path:
        from ..storage import generate_presigned_url
        url = generate_presigned_url(user_id, r2_relative_path, expires_in=300)
        if url:
            dims = probe_dimensions_via_url(url)
    if dims:
        label = derive_aspect_ratio_label(dims["width"], dims["height"])
        if label:
            return label
        logger.warning(
            f"[Publish] {log_context}: probed dims {dims['width']}x{dims['height']} don't "
            f"match a known aspect ratio; using project setting {project_aspect_ratio!r}"
        )
    else:
        logger.warning(
            f"[Publish] {log_context}: could not probe output file dimensions "
            f"(R2 disabled or ffprobe failed); using project setting {project_aspect_ratio!r}"
        )
    return project_aspect_ratio


def publish_final_video(
    cursor,
    *,
    project_id: int,
    output_filename: str,
    aspect_ratio: str | None,
    export_job_id: str | None = None,
    gpu_seconds: float | None = None,
    modal_function: str | None = None,
) -> dict:
    """The ONE final_videos INSERT (T4390). Caller owns the connection/commit
    (same convention as export_job_repository) so a caller that also needs
    another table write in the SAME transaction (export_final's
    before_after_tracks) can do it with the same cursor right after this
    returns, before committing.

    `aspect_ratio` is a REQUIRED, already-resolved value -- callers derive it
    via `resolve_output_aspect_ratio` (or an equivalent actual-file probe)
    BEFORE calling in. This function does not re-derive it: T4160's rule is
    about sourcing the value from the actual file, which only the caller (who
    has the bytes or the R2 key) can do.

    `export_job_id`: when given, completes that export_jobs row in the same
    transaction (the `_finalize_overlay_export` callers, which always have a
    job). `export_final` has no job for this path and passes None -- no
    completion write happens, matching that writer's existing behavior.

    Returns a dict: `final_video_id`, `filename`, `version`, `source_type`,
    `slowmo_section`, `duration`, `poster_marker_time`, `prior_filename`,
    `keep_prior`. Callers use `prior_filename`/`keep_prior` to run
    `delete_prior_final_object` AFTER commit (best-effort R2 cleanup, same as
    before), and `slowmo_section`/`duration`/`poster_marker_time` to call
    `generate_poster_at_export` AFTER commit (T5410 ordering, unchanged).
    """
    # T5215/T6030: one PRAGMA covers both deploy->migrate-window-guarded
    # columns instead of two independent column_exists() probes.
    final_videos_cols = {row[1] for row in cursor.execute("PRAGMA table_info(final_videos)").fetchall()}
    has_intro = "intro_card_id" in final_videos_cols
    has_slowmo = "slowmo_section_start" in final_videos_cols
    intro_select = ", fv.intro_card_id" if has_intro else ""

    # T4010: capture the PRIOR final the project currently points at so we can
    # atomically swap to the new version and clean up the old one after commit.
    # T5215: also capture its intro_card_id -- carries the reel's attachment
    # forward across this re-export's new version row. Read BEFORE any DELETE
    # of this prior row.
    cursor.execute(f"""
        SELECT fv.id, fv.filename{intro_select}
        FROM projects p JOIN final_videos fv ON fv.id = p.final_video_id
        WHERE p.id = ?
    """, (project_id,))
    prior = cursor.fetchone()
    prior_final_id = prior['id'] if prior else None
    prior_filename = prior['filename'] if prior else None
    prior_intro_card_id = prior['intro_card_id'] if (prior and has_intro) else None
    # An active share still serves the old object straight from R2 -> keep both
    # its row and its object; otherwise the re-export replaces it in place.
    keep_prior = prior_final_is_shared(prior_filename)

    cursor.execute("""
        SELECT COALESCE(MAX(version), 0) + 1 as next_version
        FROM final_videos WHERE project_id = ?
    """, (project_id,))
    next_version = cursor.fetchone()['next_version']

    cursor.execute("SELECT id FROM raw_clips WHERE auto_project_id = ?", (project_id,))
    is_auto_project = cursor.fetchone() is not None
    source_type = 'brilliant_clip' if is_auto_project else 'custom_project'

    cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
    project_row = cursor.fetchone()
    fv_name = project_row['name'] if project_row else f"Video {project_id}"

    # T5410: the user's pre-export overlay marker. Column-guarded for the
    # deploy->migrate window (v032 not yet applied).
    poster_marker_time = None
    if column_exists(cursor, "projects", "poster_marker_time"):
        cursor.execute("SELECT poster_marker_time FROM projects WHERE id = ?", (project_id,))
        pm_row = cursor.fetchone()
        if pm_row and pm_row["poster_marker_time"] is not None:
            poster_marker_time = float(pm_row["poster_marker_time"])

    # T3600/T3605: freeze collection metadata + game_ids while working data
    # still exists (publish archives + deletes it).
    duration, _project_aspect_ratio, tags_blob = compute_project_metadata(cursor, project_id)
    game_ids_blob = compute_project_game_ids(cursor, project_id)
    # T3630: clip_count + quality_score + the Glicko seed (rating/rd) +
    # source_clip_id/clip_start_time, all frozen in one shot.
    (clip_count, quality_score, rating, rd,
     source_clip_id, clip_start_time) = compute_project_ranking_freeze(cursor, project_id)
    # T3920: unified two-half in-match start (file-relative + prior-half durations)
    clip_game_start_time = compute_unified_clip_start(cursor, source_clip_id, clip_start_time)

    # T5090/T9410: the reel's first slow-mo section, frozen onto the row so
    # publish/backfill survive the publish-time working_clips prune.
    slowmo_section = first_slowmo_section(read_clip_segments_for_project(cursor, project_id))
    slowmo_start = slowmo_section[0] if slowmo_section else None
    slowmo_end = slowmo_section[1] if slowmo_section else None

    slowmo_cols = ", slowmo_section_start, slowmo_section_end" if has_slowmo else ""
    slowmo_placeholders = ", ?, ?" if has_slowmo else ""
    slowmo_values = (slowmo_start, slowmo_end) if has_slowmo else ()
    intro_cols = ", intro_card_id" if has_intro else ""
    intro_placeholders = ", ?" if has_intro else ""
    intro_values = (prior_intro_card_id,) if has_intro else ()

    cursor.execute(f"""
        INSERT INTO final_videos (project_id, filename, version, source_type, name,
            duration, aspect_ratio, tags, game_ids, clip_count, quality_score,
            rating, rd, match_count, source_clip_id, clip_start_time, clip_game_start_time,
            poster_filename{slowmo_cols}{intro_cols})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?{slowmo_placeholders}{intro_placeholders})
    """, (project_id, output_filename, next_version, source_type, fv_name,
          duration, aspect_ratio, tags_blob, game_ids_blob, clip_count, quality_score,
          rating, rd, source_clip_id, clip_start_time, clip_game_start_time, None,
          *slowmo_values, *intro_values))
    final_video_id = cursor.lastrowid

    cursor.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))

    # T4050: trace the atomic final-video swap.
    logger.info(
        f"[Publish] finalize project={project_id} new_final_id={final_video_id} "
        f"version={next_version} filename={output_filename!r} "
        f"prior_final_id={prior_final_id} "
        f"{'KEEP prior (active share)' if (prior_final_id and keep_prior) else ('DELETE prior id=' + str(prior_final_id)) if prior_final_id else 'no prior (first final)'}"
    )

    # T4010: drop the now-superseded prior row in the SAME transaction as the
    # swap, so DB + R2 stay consistent (the prior R2 object is deleted
    # post-commit by the caller). Skipped when an active share still serves it.
    if prior_final_id and not keep_prior:
        cursor.execute("DELETE FROM final_videos WHERE id = ?", (prior_final_id,))

    if export_job_id:
        export_job_repository.complete(
            cursor, export_job_id,
            output_video_id=final_video_id, output_filename=output_filename,
            gpu_seconds=gpu_seconds, modal_function=modal_function,
        )

    # T8070: refresh the per-clip reel-source window to each clip's CURRENT
    # boundaries. Column-guarded for the deploy->migrate window.
    if column_exists(cursor, "raw_clips", "reel_source_start_time"):
        cursor.execute("""
            UPDATE raw_clips
            SET reel_source_start_time = start_time,
                reel_source_end_time = end_time
            WHERE id IN (
                SELECT raw_clip_id FROM working_clips
                WHERE project_id = ? AND raw_clip_id IS NOT NULL
            )
        """, (project_id,))

    return {
        "final_video_id": final_video_id,
        "filename": output_filename,
        "version": next_version,
        "source_type": source_type,
        "slowmo_section": slowmo_section,
        "duration": duration,
        "poster_marker_time": poster_marker_time,
        "prior_filename": prior_filename,
        "keep_prior": keep_prior,
    }
