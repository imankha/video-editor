"""
Overlay mode export endpoints.

This module handles exports related to the Overlay editing mode:
- /overlay - Apply highlight overlays to video
- /final - Save final video to project
- /projects/{id}/final-video - Stream final video
- /projects/{id}/overlay-data - Save/get overlay editing state

These endpoints handle highlight regions, effect types, and final output.
"""

import asyncio
import json
import logging
import math
import os
import re
import sqlite3
import subprocess
import tempfile
import threading
import time as time_module
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, field_validator
from starlette.background import BackgroundTask

from ...constants import DEFAULT_HIGHLIGHT_EFFECT, ExportStatus, normalize_effect_type
from ...database import (
    column_exists,
    get_db_connection,
    get_raw_clips_path,
    get_uploads_path,
)
from ...highlight_transform import (
    transform_all_regions_to_working,
)
from ...middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync
from ...profile_context import get_current_profile_id
from ...schemas import TextSpec
from ...services.collection_metadata import (
    compute_project_game_ids,
    compute_project_metadata,
    compute_project_ranking_freeze,
    compute_unified_clip_start,
)
from ...services.ffmpeg_service import get_encoding_command_parts
from ...services.image_extractor import (
    list_highlight_images,
)
from ...services.modal_client import call_modal_overlay_auto, modal_enabled
from ...services.poster import (
    clip_boundary_offsets,
    first_slowmo_section,
    generate_poster_at_export,
    get_project_poster_marker_time,
    load_project_clip_segments,
    read_clip_segments_for_project,
    revert_to_auto_poster,
    set_project_poster_marker_time,
)
from ...services.spotlight_reveal import compute_spotlight_reveal
from ...services.video_detections import hoist_video_detections, slice_detections
from ...storage import (
    delete_from_r2,
    generate_presigned_url,
    upload_bytes_to_r2,
)
from ...user_context import get_current_user_id
from ...utils.encoding import decode_data, encode_data
from ...websocket import export_progress, manager

# Thread pool for CPU-intensive frame processing (prevents blocking event loop)
_frame_processor_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="overlay_")

logger = logging.getLogger(__name__)

router = APIRouter()


def _prior_final_is_shared(prior_filename: str) -> bool:
    """Whether an active share still serves the prior final video's R2 object.

    Shares snapshot the filename + resolve playback straight from R2, so deleting an
    object an active share points at would break the share. Postgres is an external
    dependency here: if the check can't run, fail SAFE (treat as shared -> keep the
    object) rather than risk deleting a still-served reel."""
    if not prior_filename:
        return False
    try:
        from app.services.sharing_db import filename_has_active_share
        return filename_has_active_share(prior_filename)
    except Exception as e:
        logger.warning(
            f"[ReExport] Active-share check failed for {prior_filename}; "
            f"keeping prior object to be safe: {e}")
        return True


def _delete_prior_final_object(user_id: str, prior_filename: str, new_filename: str) -> None:
    """Post-commit, best-effort cleanup of a re-exported reel's PRIOR R2 object.

    Runs ONLY after the new version is committed + the pointer repointed. Never
    deletes the just-written object, and never raises -- a cleanup failure must not
    roll back the successful swap. Caller has already confirmed the object is not
    served by an active share."""
    if not prior_filename or prior_filename == new_filename:
        return
    try:
        delete_from_r2(user_id, f"final_videos/{prior_filename}")
        logger.info(f"[ReExport] Deleted prior final R2 object final_videos/{prior_filename}")
    except Exception as e:
        logger.warning(f"[ReExport] Failed to delete prior final final_videos/{prior_filename}: {e}")


def _finalize_overlay_export(
    project_id: int,
    output_filename: str,
    export_id: str,
    user_id: str,
    gpu_seconds: float | None = None,
    modal_function: str | None = None,
) -> tuple[int, tuple[float, float] | None, float, float | None]:
    """Save final_videos record, update project, update export_jobs, archive.

    Shared by all overlay export completion paths (no-keyframes copy, local,
    Modal GPU, test mode). Returns
    `(final_video_id, slowmo_section, duration, poster_marker_time)` -- the
    caller awaits `generate_poster_at_export(...)` with these AFTER this
    returns and BEFORE the sync-then-announce barrier (T5410; poster capture
    moved here from publish, T5280 REVERSED).
    """
    # T5410: still compute the reel's first slow-mo section from the project's
    # ordered working clips and FREEZE it onto the final_videos row -- this is
    # cheap (no ffmpeg) and is the durable source of truth publish/backfill read
    # after the publish-time working_clips prune. poster_filename/_frame_time/
    # _source are left NULL in the INSERT below; the caller's
    # generate_poster_at_export call (after this returns) fills them.
    slowmo_section = first_slowmo_section(load_project_clip_segments(project_id))
    slowmo_start = slowmo_section[0] if slowmo_section else None
    slowmo_end = slowmo_section[1] if slowmo_section else None

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T5215/T6030: intro_card_id (v034) and slowmo_section_start (v025)
        # both live on final_videos and are guarded for the deploy->migrate
        # window -- one PRAGMA table_info fetch covers both flags instead of
        # two independent column_exists() probes (each runs its own PRAGMA;
        # a per-call probe here is a real perf concern -- see
        # test_finalize_guard_is_one_probe_not_per_row). intro_card_id is
        # needed BEFORE the prior-row read below (it's part of that SELECT).
        _final_videos_cols = {row[1] for row in cursor.execute("PRAGMA table_info(final_videos)").fetchall()}
        _has_intro = "intro_card_id" in _final_videos_cols
        intro_select = ", fv.intro_card_id" if _has_intro else ""

        # T4010: capture the PRIOR final the project currently points at so we can
        # atomically swap to the new version and clean up the old one after commit.
        # T5215: also capture its intro_card_id -- this is what CARRIES the reel's
        # attachment forward across the re-export's new version row (the top
        # regression risk this task exists to prevent: a re-export must not
        # silently drop the attachment). Read BEFORE any DELETE of this prior row.
        cursor.execute(f"""
            SELECT fv.id, fv.filename{intro_select}
            FROM projects p JOIN final_videos fv ON fv.id = p.final_video_id
            WHERE p.id = ?
        """, (project_id,))
        prior = cursor.fetchone()
        prior_final_id = prior['id'] if prior else None
        prior_filename = prior['filename'] if prior else None
        prior_intro_card_id = prior['intro_card_id'] if (prior and _has_intro) else None
        # An active share still serves the old object straight from R2 -> keep both
        # its row and its object; otherwise the re-export replaces it in place.
        keep_prior = _prior_final_is_shared(prior_filename)

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

        # T5410: the user's pre-export overlay marker, read here (same cursor,
        # same project read) so the caller can pass it straight into
        # generate_poster_at_export. Column-guarded for the deploy->migrate
        # window (v032 not yet applied) -- mirrors the _has_slowmo pattern below.
        poster_marker_time = None
        if column_exists(cursor, "projects", "poster_marker_time"):
            cursor.execute("SELECT poster_marker_time FROM projects WHERE id = ?", (project_id,))
            pm_row = cursor.fetchone()
            if pm_row and pm_row["poster_marker_time"] is not None:
                poster_marker_time = float(pm_row["poster_marker_time"])

        # T3600: freeze collection metadata while working data still exists
        # (publish archives + deletes it). T3605: freeze game_ids too.
        duration, aspect_ratio, tags_blob = compute_project_metadata(cursor, project_id)
        game_ids_blob = compute_project_game_ids(cursor, project_id)
        # T3630: clip_count + quality_score + the Glicko seed (rating/rd) +
        # source_clip_id/clip_start_time, all frozen in one shot.
        (clip_count, quality_score, rating, rd,
         source_clip_id, clip_start_time) = compute_project_ranking_freeze(cursor, project_id)
        # T3920: unified two-half in-match start (file-relative + prior-half durations)
        clip_game_start_time = compute_unified_clip_start(cursor, source_clip_id, clip_start_time)

        # T6030: slowmo_section_start/end arrive with profile_db v025, which runs
        # manually (not on deploy/startup). During the deploy->migrate window a
        # below-v025 final_videos table has neither column; naming them here 500s
        # ("no such column"), and this INSERT is on EVERY export's finalize path, so
        # the window blocks all exports from completing. Omit both columns from the
        # column list AND the positional VALUES tuple when absent -- never insert into
        # a nonexistent column. NULL is the v025 default and the backfill is what
        # populates them, so a window-era row is simply left unfrozen until the migrate
        # runs (poster capture then reconstructs the section from live clips at publish).
        _has_slowmo = "slowmo_section_start" in _final_videos_cols
        slowmo_cols = ", slowmo_section_start, slowmo_section_end" if _has_slowmo else ""
        slowmo_placeholders = ", ?, ?" if _has_slowmo else ""
        slowmo_values = (slowmo_start, slowmo_end) if _has_slowmo else ()
        # T5215: carry the reel's attachment (captured above from the prior row,
        # or NULL/inherit-default on a first-ever export) into the new version.
        intro_cols = ", intro_card_id" if _has_intro else ""
        intro_placeholders = ", ?" if _has_intro else ""
        intro_values = (prior_intro_card_id,) if _has_intro else ()
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

        # T4050: trace the atomic final-video swap. This is the ONLY place a
        # re-framed reel becomes a materialized final; if a re-export never
        # reaches here (prod max final_video.id stuck), the failure is upstream
        # in the render/source path -- this log marks the successful boundary.
        logger.info(
            f"[ReExport] finalize project={project_id} new_final_id={final_video_id} "
            f"version={next_version} filename={output_filename!r} "
            f"prior_final_id={prior_final_id} "
            f"{'KEEP prior (active share)' if (prior_final_id and keep_prior) else ('DELETE prior id=' + str(prior_final_id)) if prior_final_id else 'no prior (first final)'}"
        )

        # T4010: drop the now-superseded prior row in the SAME transaction as the
        # swap, so DB + R2 stay consistent (the prior R2 object is deleted post-commit
        # below). Skipped when an active share still serves it.
        if prior_final_id and not keep_prior:
            cursor.execute("DELETE FROM final_videos WHERE id = ?", (prior_final_id,))

        cursor.execute("""
            UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?,
                completed_at = CURRENT_TIMESTAMP, gpu_seconds = ?, modal_function = ?
            WHERE id = ?
        """, (final_video_id, output_filename, gpu_seconds, modal_function, export_id))

        # T8070: refresh the per-clip reel-source window to each clip's CURRENT
        # boundaries for every clip of this project (via working_clips.raw_clip_id,
        # so multi-clip and user-created reels are covered too). A final (Overlay)
        # export is a successful export against the current window, so it re-freezes
        # the snapshot the annotate Reel control compares against. Column-guarded
        # for the deploy->migrate window (v049 not applied).
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

        conn.commit()

    # T4010: only after the swap is committed, best-effort delete the prior object.
    if not keep_prior:
        _delete_prior_final_object(user_id, prior_filename, output_filename)

    from app.analytics import record_milestone
    record_milestone(user_id, "export_completed", {"export_id": export_id, "type": "overlay"})
    record_milestone(user_id, "overlay_exported", {"export_id": export_id, "project_id": project_id})

    return final_video_id, slowmo_section, duration, poster_marker_time


# T4200: the sync_failed payload builder now lives in export_helpers so framing and
# multi-clip share the exact same event shape (no router→router imports). Kept as a
# thin module-local alias so existing overlay call sites read unchanged.
from ...services.export_helpers import export_sync_failed_data as _export_sync_failed_data  # noqa: E402, I001 (deliberately mid-file -- see comment above)

# =============================================================================
# Gesture-Based Overlay Actions API
# =============================================================================
# Instead of sending full JSON blobs, the frontend sends atomic actions
# that describe user gestures. This prevents overwrites and enables
# future conflict detection.

class OverlayActionTarget(BaseModel):
    """Target specifier for actions that modify existing items."""
    region_id: str | None = None
    keyframe_time: float | None = None  # Time in seconds
    id: str | None = None  # T5225: text block id (add_text/move_text_edge/update_text_spec/toggle_text/delete_text)


class OverlayKeyframePayload(BaseModel):
    """One keyframe sent with ``create_region``.

    Mirrors the keyframe shape the editor holds in memory, keyed by ``time``
    (the overlay's backend key) rather than the frontend's ``frame``.
    """
    time: float
    x: float
    y: float
    radiusX: float
    radiusY: float
    strokeOpacity: float
    fillOpacity: float
    color: str


class OverlayActionData(BaseModel):
    """Data payload for overlay actions. Fields used depend on action type."""
    # Region fields
    region_id: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    enabled: bool | None = None
    # Seed keyframes for create_region. The editor materializes two boundary
    # keyframes the moment a region is added (useHighlightRegions.addRegion), so
    # the region ALREADY shows a spotlight before any drag. Persisting them here
    # is what keeps the stored region equal to what the user sees -- see the
    # create_region branch for why an empty list is a correctness bug.
    keyframes: list[OverlayKeyframePayload] | None = None

    # Keyframe fields
    time: float | None = None
    x: float | None = None
    y: float | None = None
    radiusX: float | None = None
    radiusY: float | None = None
    strokeOpacity: float | None = None
    fillOpacity: float | None = None
    color: str | None = None

    # Detection data (for auto-created keyframes)
    fromDetection: bool | None = None

    # Effect type
    effect_type: str | None = None

    # Highlight color
    highlight_color: str | None = None

    # Overlay tuning settings
    highlight_shape: str | None = None
    stroke_width: float | None = None
    fill_enabled: bool | None = None
    fill_opacity: float | None = None

    # T5225: overlay text block fields (add_text/update_text_spec). `id` here is
    # the CLIENT-MINTED id for add_text (mirrors region_id's optimistic-create
    # role); start_time/end_time/enabled above are reused verbatim (same names,
    # same half-open-range semantics apply -- see the add_text/move_text_edge
    # branches). `spec` is the raw TextSpec dict, re-validated via TextSpec(**spec)
    # in the branch so it never gets stored malformed.
    id: str | None = None
    spec: dict | None = None
    dim_strength: float | None = None


class OverlayAction(BaseModel):
    """
    A single overlay action representing a user gesture.

    Actions:
    - create_region: Create a new highlight region
    - delete_region: Delete a region by ID
    - update_region: Update region start/end time
    - toggle_region: Enable/disable a region
    - add_keyframe: Add a keyframe to a region
    - update_keyframe: Update keyframe properties
    - delete_keyframe: Delete a keyframe
    - set_effect_type: Change the highlight effect type
    - set_highlight_color: Change the highlight color for new highlights
    - add_text: Create a text REGION (+ its first ELEMENT) when data.region_id
      is absent/unknown; append a new ELEMENT to an EXISTING region when
      data.region_id names one (T6630 round 4 -- see the branch for the full
      region/element split)
    - move_text_edge: Update a text REGION's start/end time
    - update_text_spec: Replace one text ELEMENT's whole TextSpec
    - toggle_text: Enable/disable one text ELEMENT
    - delete_text: Delete one text ELEMENT (deletes its region too if that was
      the region's last element)
    - delete_text_region: Delete a text REGION and all of its elements
    """
    action: str
    target: OverlayActionTarget | None = None
    data: OverlayActionData | None = None
    expected_version: int | None = None  # For conflict detection (future)


class OverlayActionResponse(BaseModel):
    """Response from an overlay action."""
    success: bool
    version: int
    region_id: str | None = None  # Returned for create_region
    error: str | None = None


def _get_overlay_data(cursor, project_id: int) -> tuple:
    """
    Get current overlay data for a project.
    Returns (highlights_data list, effect_type str, highlight_color str, working_video_id int, version int).
    """
    cursor.execute("""
        SELECT wv.id, wv.highlights_data, wv.effect_type, wv.highlight_color, wv.overlay_version
        FROM working_videos wv
        JOIN projects p ON p.working_video_id = wv.id
        WHERE p.id = ?
    """, (project_id,))
    row = cursor.fetchone()

    if not row:
        return None, None, None, None, None

    highlights = []
    if row['highlights_data']:
        try:
            highlights = decode_data(row['highlights_data'])
        except Exception as e:
            # NEVER fall back to []. Every overlay action does read-modify-write of
            # the whole blob, so returning [] here would make the user's next gesture
            # persist an empty list and permanently erase every highlight. Fail
            # visibly instead (endpoint returns 500) and leave the stored blob intact
            # for recovery. See T4210 / CLAUDE.md "No Silent Fallbacks for Internal Data".
            logger.error(
                f"[Overlay] Failed to decode highlights_data for working_video_id={row['id']} "
                f"(project_id={project_id}): {e}. Refusing to overwrite with empty list.",
                exc_info=True,
            )
            raise

    effect_type = normalize_effect_type(row['effect_type'])
    highlight_color = row['highlight_color']  # Can be None
    version = row['overlay_version'] or 0

    return highlights, effect_type, highlight_color, row['id'], version


def _save_overlay_data(cursor, working_video_id: int, highlights: list, effect_type: str, highlight_color: str, new_version: int):
    """Save overlay data back to the working_videos table."""
    cursor.execute("""
        UPDATE working_videos
        SET highlights_data = ?, effect_type = ?, highlight_color = ?, overlay_version = ?
        WHERE id = ?
    """, (encode_data(highlights), effect_type, highlight_color, new_version, working_video_id))


def _get_text_overlays(cursor, working_video_id: int) -> list:
    """Read the current `text_overlays` blob for a working video (T5225).

    T6630 round 4: each item is now a REGION -- `{id, startTime, endTime,
    elements: [{id, spec, enabled}, ...]}` -- not a standalone block (migrated
    by profile_db v042; every write path in this file has produced the region
    shape since that migration).

    Separate read/save pair from highlights -- `_get_overlay_data`/`_save_overlay_data`
    never touch `text_overlays` (design SS1.2/SS5.2), so text and highlight actions
    don't have to share a decode/encode path. NEVER falls back to [] on a decode
    error: every text action does read-modify-write of the whole blob, so a
    swallowed decode failure here would let the next gesture persist an empty
    list and silently erase every text region (same rule as _get_overlay_data's
    highlights read, T4210 / CLAUDE.md "No Silent Fallbacks for Internal Data").
    """
    cursor.execute("SELECT text_overlays FROM working_videos WHERE id = ?", (working_video_id,))
    row = cursor.fetchone()
    if not row or not row['text_overlays']:
        return []
    try:
        return decode_data(row['text_overlays']) or []
    except Exception as e:
        logger.error(
            f"[Overlay Action] Failed to decode text_overlays for working_video_id={working_video_id}: "
            f"{e}. Refusing to overwrite with empty list.",
            exc_info=True,
        )
        raise


def _save_text_overlays(cursor, working_video_id: int, text_overlays: list, new_version: int):
    """Save text_overlays back to working_videos, bumping the SAME shared
    overlay_version counter highlight actions use (design SS5.2)."""
    cursor.execute("""
        UPDATE working_videos
        SET text_overlays = ?, overlay_version = ?
        WHERE id = ?
    """, (encode_data(text_overlays), new_version, working_video_id))


def _find_text_index(text_overlays: list, region_id: str) -> int:
    """Find index of a text REGION by id. Returns -1 if not found."""
    for i, region in enumerate(text_overlays):
        if region.get('id') == region_id:
            return i
    return -1


def _find_text_element(text_overlays: list, element_id: str) -> tuple:
    """Find (region_idx, element_idx) of a text ELEMENT by id, searching
    across every region's `elements` list (T6630 round 4). Returns (-1, -1)
    if not found in any region."""
    for ri, region in enumerate(text_overlays):
        for ei, element in enumerate(region.get('elements', [])):
            if element.get('id') == element_id:
                return ri, ei
    return -1, -1


def _find_region_index(highlights: list, region_id: str) -> int:
    """Find index of region by ID. Returns -1 if not found."""
    for i, region in enumerate(highlights):
        if region.get('id') == region_id:
            return i
    return -1


def _find_keyframe_index(keyframes: list, time: float, tolerance: float = 0.02) -> int:
    """Find index of keyframe by time (with tolerance). Returns -1 if not found."""
    for i, kf in enumerate(keyframes):
        if abs(kf.get('time', 0) - time) < tolerance:
            return i
    return -1


def _normalize_region_keys(region: dict) -> dict:
    """Normalize region + keyframe keys in place at the single DB-read boundary.

    Two normalizations happen here so every downstream consumer (Modal spline,
    local ``KeyframeInterpolator`` spline, request-body parse) receives canonical
    keyframes and never KeyErrors:

    1. **Region time keys** (T4900, write side fixed T7180): surgical overlay
       actions (create_region, update_region) and the framing->overlay
       transform now BOTH persist canonical ``start_time``/``end_time``. This
       normalizer stays as READ-side back-compat for rows written before
       T7180 (or any blob that slipped in camelCase-only some other way) --
       the Modal renderer (video_processing.py) uses direct bracket access
       ``region["start_time"]``, so a camelCase-only blob still KeyErrors in
       prod without this. Normalize to snake_case.
    2. **Keyframe opacity keys** (T5120 / prod bug 32p): keyframes that went
       through the framing->overlay transform/restore (highlight_transform.py)
       carry only a single ``opacity`` field and DROP ``strokeOpacity``/
       ``fillOpacity``. The spline helpers read those keys with bare bracket
       access (``sp('strokeOpacity')``), so opacity-only keyframes KeyError
       mid-render. Derive them from the legacy ``opacity`` fallback, mirroring
       the sanctioned legacy branch (overlay.py:998-999) exactly.

    Normalizing at this one boundary (render_overlay) heals the blob for
    rendering without touching the stored data or the action writer, and keeps
    the spline helpers free of scattered defensive ``.get()`` reads.
    """
    if 'startTime' in region and 'start_time' not in region:
        region['start_time'] = region['startTime']
    if 'endTime' in region and 'end_time' not in region:
        region['end_time'] = region['endTime']
    for kf in region.get('keyframes', []):
        if 'strokeOpacity' not in kf:
            kf['strokeOpacity'] = kf.get('opacity', 0.85)
        if 'fillOpacity' not in kf:
            kf['fillOpacity'] = kf.get('opacity', 0.05)
    return region


def _region_bounds(region: dict) -> tuple[float, float]:
    """Read a region's [start, end] time bounds tolerant of BOTH key formats.

    Both ``startTime``/``endTime`` (camelCase) and ``start_time``/``end_time``
    (snake_case, canonical since T7180 -- every current writer produces this)
    are handled; the camelCase path is READ-side back-compat for rows written
    before T7180. Callers that go through ``render_overlay`` will have already
    been normalized by ``_normalize_region_keys``, so both keys exist; the
    local renderer keeps this helper as defence-in-depth for any caller that
    bypasses normalization. The ``0`` default only applies when BOTH keys are
    absent (corrupt blob); a present-but-None bound surfaces as a TypeError in
    arithmetic (visible bug).
    """
    start = region.get('start_time', region.get('startTime', 0))
    end = region.get('end_time', region.get('endTime', 0))
    return start, end


def _keyframes_within_bounds(region: dict, eps: float = 0.04) -> list:
    """Keyframes that fall inside the region's CURRENT [start, end] bounds.

    Keyframes outside the window don't influence rendering (user may have shrunk
    the region). T4900 failure mode 3: because bounds are read from the current
    (possibly EXTENDED) region via _region_bounds, manual keyframes the user
    added past the original auto-segment boundary are retained here — they are
    NOT clipped, as long as the extend-segment action landed. The regression test
    pins exactly this.
    """
    r_start, r_end = _region_bounds(region)
    return [
        kf for kf in region.get('keyframes', [])
        if r_start - eps <= kf.get('time', 0) <= r_end + eps
    ]


@router.post("/projects/{project_id}/overlay/actions")
async def overlay_action(project_id: int, action: OverlayAction):
    """
    Apply an atomic overlay action.

    This endpoint processes a single user gesture and updates the overlay data
    atomically. It is the only write path for overlay data -- the full-blob
    PUT /overlay-data endpoint (which could cause overwrites) was removed in T4210.

    Actions:
    - create_region: data.start_time, data.end_time
    - delete_region: target.region_id
    - update_region: target.region_id, data.start_time?, data.end_time?
    - toggle_region: target.region_id, data.enabled
    - add_keyframe: target.region_id, data.time, data.x, data.y, data.radiusX, data.radiusY, data.opacity, data.color
    - update_keyframe: target.region_id, target.keyframe_time, data.*
    - delete_keyframe: target.region_id, target.keyframe_time
    - set_effect_type: data.effect_type
    - set_highlight_color: data.highlight_color

    Response:
    - success: boolean
    - version: new version number
    - region_id: (for create_region) the new region's ID
    - error: error message if failed
    """
    logger.info(f"[Overlay Action] project={project_id}, action={action.action}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T4360: BEGIN IMMEDIATE takes SQLite's RESERVED lock before the read, so this
        # read-modify-write is atomic at the DB level -- a concurrent writer blocks (up to
        # busy_timeout) instead of silently losing an update. Do NOT rely on the no-await
        # accident (persistence-sync.md invariant #6); this guarantee is lock-based.
        try:
            conn.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e):
                logger.warning(f"[Overlay Action] BEGIN IMMEDIATE timed out (lock contention): {e}")
                return JSONResponse(status_code=503, content={
                    "success": False,
                    "error": "database_locked",
                    "message": "This item is being edited by another request. Please try again.",
                })
            raise

        # Get current overlay data
        highlights, effect_type, highlight_color, working_video_id, version = _get_overlay_data(cursor, project_id)

        if working_video_id is None:
            raise HTTPException(status_code=404, detail="Project not found or has no working video")

        # T4330: conflict detection -- a mismatched expected_version means
        # another writer committed since this caller last read. Pure
        # comparison against the already-read `version`, no I/O -- must stay
        # before any mutation and add no `await` before the commit below
        # (persistence-sync.md invariant 6, RMW atomicity).
        if action.expected_version is not None and action.expected_version != version:
            return JSONResponse(status_code=409, content={
                "success": False,
                "error": "version_conflict",
                "current_version": version,
                "message": "This project was edited elsewhere. Refresh to see the latest.",
            })

        new_version = version + 1
        region_id = None
        error = None

        try:
            if action.action == "create_region":
                # Create a new highlight region
                if not action.data or action.data.start_time is None:
                    raise ValueError("create_region requires data.start_time")

                # Use client-provided ID for optimistic updates, or generate one
                region_id = action.data.region_id or f"region-{uuid.uuid4().hex[:12]}"
                # Persist the editor's seed keyframes. This used to write `[]`
                # unconditionally, which diverged the stored region from the one
                # on screen and caused two bugs:
                #   1. Export: `has_keyframes` (render endpoint) is False for a
                #      keyframe-less region, so a spotlight the user added but
                #      never dragged skipped GPU rendering entirely -- the
                #      exported video had no spotlight at all.
                #   2. Editing: dragging the circle near a region boundary makes
                #      the editor MOVE the seeded boundary keyframe, and the move
                #      is mirrored to the backend as delete(old)+add(new). The
                #      delete targeted a keyframe that only ever existed in
                #      memory -> 400 "Keyframe at Ns not found".
                # Sorted by time so the stored array holds the same invariant
                # add_keyframe maintains.
                seed_keyframes = sorted(
                    (kf.model_dump() for kf in (action.data.keyframes or [])),
                    key=lambda k: k['time'],
                )
                new_region = {
                    "id": region_id,
                    # Canonical snake_case (T7180) -- see the comment on
                    # update_region below for why this MUST match the key the
                    # auto-generator (multi_clip.py generate_default_highlight_regions)
                    # and every reader (_region_bounds, restoreRegions) use.
                    "start_time": action.data.start_time,
                    "end_time": action.data.end_time or (action.data.start_time + 2.0),
                    "enabled": True,
                    "keyframes": seed_keyframes,
                    "detections": [],
                }
                highlights.append(new_region)
                logger.info(f"[Overlay Action] Created region {region_id}")

            elif action.action == "delete_region":
                # Delete a region by ID
                if not action.target or not action.target.region_id:
                    raise ValueError("delete_region requires target.region_id")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                del highlights[idx]
                logger.info(f"[Overlay Action] Deleted region {action.target.region_id}")

            elif action.action == "update_region":
                # Update region boundaries
                if not action.target or not action.target.region_id:
                    raise ValueError("update_region requires target.region_id")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                region = highlights[idx]
                if action.data:
                    # T7180 (prod bug 44p): write canonical snake_case, and drop
                    # a stale camelCase pair if one exists. Auto-generated
                    # regions (multi_clip.py generate_default_highlight_regions)
                    # are created with snake_case start_time/end_time; every
                    # reader (_region_bounds, frontend restoreRegions) prefers
                    # snake_case WHEN PRESENT over camelCase. This action used to
                    # write only startTime/endTime, so a lever drag on an
                    # auto-generated region updated a key nothing read -- the
                    # render and a fresh page load kept using the original
                    # auto-placed bounds forever, silently dropping every
                    # keyframe the user placed outside them. Writing the same
                    # key every reader prefers, and removing the shadowed
                    # camelCase pair, makes this action's write actually visible.
                    if action.data.start_time is not None:
                        region['start_time'] = action.data.start_time
                        region.pop('startTime', None)
                    if action.data.end_time is not None:
                        region['end_time'] = action.data.end_time
                        region.pop('endTime', None)
                logger.info(f"[Overlay Action] Updated region {action.target.region_id}")

            elif action.action == "toggle_region":
                # Toggle region enabled/disabled
                if not action.target or not action.target.region_id:
                    raise ValueError("toggle_region requires target.region_id")
                if not action.data or action.data.enabled is None:
                    raise ValueError("toggle_region requires data.enabled")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                highlights[idx]['enabled'] = action.data.enabled
                logger.info(f"[Overlay Action] Toggled region {action.target.region_id} to {action.data.enabled}")

            elif action.action == "add_keyframe":
                # Add a keyframe to a region
                if not action.target or not action.target.region_id:
                    raise ValueError("add_keyframe requires target.region_id")
                if not action.data or action.data.time is None:
                    raise ValueError("add_keyframe requires data.time")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                region = highlights[idx]
                keyframes = region.get('keyframes', [])

                # Check if keyframe already exists at this time
                kf_idx = _find_keyframe_index(keyframes, action.data.time)
                if kf_idx != -1:
                    kf = keyframes[kf_idx]
                    if action.data.x is not None:
                        kf['x'] = action.data.x
                    if action.data.y is not None:
                        kf['y'] = action.data.y
                    if action.data.radiusX is not None:
                        kf['radiusX'] = action.data.radiusX
                    if action.data.radiusY is not None:
                        kf['radiusY'] = action.data.radiusY
                    if action.data.strokeOpacity is not None:
                        kf['strokeOpacity'] = action.data.strokeOpacity
                    if action.data.fillOpacity is not None:
                        kf['fillOpacity'] = action.data.fillOpacity
                    if action.data.color is not None:
                        kf['color'] = action.data.color
                    logger.info(f"[Overlay Action] Updated keyframe at {action.data.time}s")
                else:
                    new_kf = {
                        'time': action.data.time,
                        'x': action.data.x or 0.5,
                        'y': action.data.y or 0.5,
                        'radiusX': action.data.radiusX or 0.1,
                        'radiusY': action.data.radiusY or 0.15,
                        'strokeOpacity': action.data.strokeOpacity or 0.85,
                        'fillOpacity': action.data.fillOpacity or 0.05,
                        'color': action.data.color or '#FFFFFF',
                    }
                    if action.data.fromDetection:
                        new_kf['fromDetection'] = True
                    keyframes.append(new_kf)
                    # Sort keyframes by time
                    keyframes.sort(key=lambda k: k.get('time', 0))
                    region['keyframes'] = keyframes
                    logger.info(f"[Overlay Action] Added keyframe at {action.data.time}s")

            elif action.action == "update_keyframe":
                # Update existing keyframe properties
                if not action.target or not action.target.region_id or action.target.keyframe_time is None:
                    raise ValueError("update_keyframe requires target.region_id and target.keyframe_time")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                region = highlights[idx]
                keyframes = region.get('keyframes', [])
                kf_idx = _find_keyframe_index(keyframes, action.target.keyframe_time)
                if kf_idx == -1:
                    raise ValueError(f"Keyframe at {action.target.keyframe_time}s not found")

                kf = keyframes[kf_idx]
                if action.data:
                    if action.data.time is not None:
                        kf['time'] = action.data.time
                    if action.data.x is not None:
                        kf['x'] = action.data.x
                    if action.data.y is not None:
                        kf['y'] = action.data.y
                    if action.data.radiusX is not None:
                        kf['radiusX'] = action.data.radiusX
                    if action.data.radiusY is not None:
                        kf['radiusY'] = action.data.radiusY
                    if action.data.strokeOpacity is not None:
                        kf['strokeOpacity'] = action.data.strokeOpacity
                    if action.data.fillOpacity is not None:
                        kf['fillOpacity'] = action.data.fillOpacity
                    if action.data.color is not None:
                        kf['color'] = action.data.color

                # Re-sort if time changed
                keyframes.sort(key=lambda k: k.get('time', 0))
                logger.info(f"[Overlay Action] Updated keyframe at {action.target.keyframe_time}s")

            elif action.action == "delete_keyframe":
                # Delete a keyframe
                if not action.target or not action.target.region_id or action.target.keyframe_time is None:
                    raise ValueError("delete_keyframe requires target.region_id and target.keyframe_time")

                idx = _find_region_index(highlights, action.target.region_id)
                if idx == -1:
                    raise ValueError(f"Region {action.target.region_id} not found")

                region = highlights[idx]
                keyframes = region.get('keyframes', [])
                kf_idx = _find_keyframe_index(keyframes, action.target.keyframe_time)
                if kf_idx == -1:
                    # Idempotent: the gesture's postcondition ("no keyframe at
                    # this time") already holds, so this is success, not a 400.
                    # Delete is also the half of a snap-MOVE that the editor
                    # mirrors as delete(old)+add(new); failing it aborts nothing
                    # and merely strands the user behind an unretryable error
                    # toast. Logged at INFO so a genuine mismatch stays visible.
                    logger.info(
                        f"[Overlay Action] delete_keyframe at {action.target.keyframe_time}s: "
                        f"already absent from region {action.target.region_id} (no-op)"
                    )
                else:
                    del keyframes[kf_idx]
                    logger.info(f"[Overlay Action] Deleted keyframe at {action.target.keyframe_time}s")

            elif action.action == "set_effect_type":
                # Change effect type
                if not action.data or not action.data.effect_type:
                    raise ValueError("set_effect_type requires data.effect_type")

                effect_type = action.data.effect_type
                logger.info(f"[Overlay Action] Set effect type to {effect_type}")

            elif action.action == "set_highlight_color":
                if not action.data:
                    raise ValueError("set_highlight_color requires data")

                highlight_color = action.data.highlight_color
                logger.info(f"[Overlay Action] Set highlight color to {highlight_color}")

            elif action.action == "set_stroke_width":
                if not action.data or action.data.stroke_width is None:
                    raise ValueError("set_stroke_width requires data.stroke_width")
                val = max(1, min(6, action.data.stroke_width))
                cursor.execute("UPDATE working_videos SET stroke_width = ? WHERE id = ?", (val, working_video_id))
                logger.info(f"[Overlay Action] Set stroke_width to {val}")

            elif action.action == "set_fill_enabled":
                if not action.data or action.data.fill_enabled is None:
                    raise ValueError("set_fill_enabled requires data.fill_enabled")
                cursor.execute("UPDATE working_videos SET fill_enabled = ? WHERE id = ?", (int(action.data.fill_enabled), working_video_id))
                logger.info(f"[Overlay Action] Set fill_enabled to {action.data.fill_enabled}")

            elif action.action == "set_fill_opacity":
                if not action.data or action.data.fill_opacity is None:
                    raise ValueError("set_fill_opacity requires data.fill_opacity")
                val = max(0.0, min(0.4, action.data.fill_opacity))
                cursor.execute("UPDATE working_videos SET fill_opacity = ? WHERE id = ?", (val, working_video_id))
                logger.info(f"[Overlay Action] Set fill_opacity to {val}")

            elif action.action == "set_dim_strength":
                if not action.data or action.data.dim_strength is None:
                    raise ValueError("set_dim_strength requires data.dim_strength")
                val = max(0.0, min(0.4, action.data.dim_strength))
                cursor.execute("UPDATE working_videos SET dim_strength = ? WHERE id = ?", (val, working_video_id))
                logger.info(f"[Overlay Action] Set dim_strength to {val}")

            elif action.action == "set_highlight_shape":
                if not action.data or action.data.highlight_shape is None:
                    raise ValueError("set_highlight_shape requires data.highlight_shape")
                val = action.data.highlight_shape if action.data.highlight_shape in ('body', 'ground') else 'body'
                cursor.execute("UPDATE working_videos SET highlight_shape = ? WHERE id = ?", (val, working_video_id))
                logger.info(f"[Overlay Action] Set highlight_shape to {val}")

            elif action.action == "add_text":
                # T6630 round 4: a text REGION is a time span containing N
                # ELEMENTS that all render simultaneously during it. This ONE
                # action still creates EITHER kind of thing (no second add
                # path), distinguished by whether `data.region_id` names an
                # EXISTING region -- reusing OverlayActionData.region_id, the
                # same field create_region already uses for its optimistic-id
                # role, so no new wire field was needed:
                #
                #   - data.region_id ABSENT (or names a region that doesn't
                #     exist): creates a NEW REGION. `data.id` becomes the
                #     REGION's id -- this matches the pre-round-4 wire
                #     contract byte-for-byte, so nothing about the
                #     region-creation call changes. Its sole starter element
                #     gets a DERIVED id `f"{data.id}_el0"`, mirroring the
                #     v042 migration's own convention (a fresh region's first
                #     element has no prior id to preserve).
                #   - data.region_id names an EXISTING region: appends a NEW
                #     ELEMENT into that region's `elements` list; `data.id` is
                #     that ELEMENT's client-minted id. start_time/end_time are
                #     ignored here -- adding an element never changes the
                #     region's timing.
                if not action.data or not action.data.id:
                    raise ValueError("add_text requires data.id")
                if not action.data.spec:
                    raise ValueError("add_text requires data.spec")

                validated_spec = TextSpec(**action.data.spec)
                text_overlays = _get_text_overlays(cursor, working_video_id)

                target_region_id = action.data.region_id
                region_idx = _find_text_index(text_overlays, target_region_id) if target_region_id else -1

                if region_idx != -1:
                    new_element = {
                        "id": action.data.id,
                        "spec": validated_spec.model_dump(mode="json"),
                        "enabled": True,
                    }
                    text_overlays[region_idx]["elements"].append(new_element)
                    logger.info(
                        f"[Overlay Action] Added text element {action.data.id} "
                        f"to region {target_region_id}"
                    )
                else:
                    if action.data.start_time is None:
                        raise ValueError("add_text requires data.start_time when creating a new region")
                    region_id = action.data.id
                    new_region = {
                        "id": region_id,
                        "startTime": action.data.start_time,
                        "endTime": action.data.end_time if action.data.end_time is not None else (action.data.start_time + 2.0),
                        "elements": [{
                            "id": f"{region_id}_el0",
                            "spec": validated_spec.model_dump(mode="json"),
                            "enabled": True,
                        }],
                    }
                    text_overlays.append(new_region)
                    logger.info(f"[Overlay Action] Added text region {region_id}")

                _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                conn.commit()
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            elif action.action == "move_text_edge":
                # T6630 round 4: targets a REGION -- the timeline's addressable
                # unit is the region, not an element. Moves/resizes the
                # region's time span; every element inside keeps its own spec
                # untouched. Partial update of start_time and/or end_time
                # (mirrors update_region).
                if not action.target or not action.target.id:
                    raise ValueError("move_text_edge requires target.id")

                text_overlays = _get_text_overlays(cursor, working_video_id)
                idx = _find_text_index(text_overlays, action.target.id)
                if idx == -1:
                    raise ValueError(f"Text region {action.target.id} not found")

                region = text_overlays[idx]
                if action.data:
                    if action.data.start_time is not None:
                        region['startTime'] = action.data.start_time
                    if action.data.end_time is not None:
                        region['endTime'] = action.data.end_time
                _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                conn.commit()
                logger.info(f"[Overlay Action] Moved text region {action.target.id} edge")
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            elif action.action == "update_text_spec":
                # T6630 round 4: targets an ELEMENT (searches across every
                # region). Whole-spec replace, debounced client-side (design
                # SS4/O4): entity-surgical (one element per call), re-validated
                # atomically.
                if not action.target or not action.target.id:
                    raise ValueError("update_text_spec requires target.id")
                if not action.data or not action.data.spec:
                    raise ValueError("update_text_spec requires data.spec")

                validated_spec = TextSpec(**action.data.spec)
                text_overlays = _get_text_overlays(cursor, working_video_id)
                ri, ei = _find_text_element(text_overlays, action.target.id)
                if ri == -1:
                    raise ValueError(f"Text element {action.target.id} not found")

                text_overlays[ri]['elements'][ei]['spec'] = validated_spec.model_dump(mode="json")
                _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                conn.commit()
                logger.info(f"[Overlay Action] Updated text spec for element {action.target.id}")
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            elif action.action == "toggle_text":
                # T6630 round 4: targets an ELEMENT (searches across every region).
                if not action.target or not action.target.id:
                    raise ValueError("toggle_text requires target.id")
                if not action.data or action.data.enabled is None:
                    raise ValueError("toggle_text requires data.enabled")

                text_overlays = _get_text_overlays(cursor, working_video_id)
                ri, ei = _find_text_element(text_overlays, action.target.id)
                if ri == -1:
                    raise ValueError(f"Text element {action.target.id} not found")

                text_overlays[ri]['elements'][ei]['enabled'] = action.data.enabled
                _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                conn.commit()
                logger.info(f"[Overlay Action] Toggled text element {action.target.id} to {action.data.enabled}")
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            elif action.action == "delete_text":
                # T6630 round 4: deletes an ELEMENT (searches across every
                # region). A region always has >=1 element in the UI's model,
                # so deleting the LAST element of a region deletes the region
                # too -- no empty-region records are ever stored. To delete a
                # region and all its elements in ONE gesture, use
                # delete_text_region instead of calling this per element.
                if not action.target or not action.target.id:
                    raise ValueError("delete_text requires target.id")

                text_overlays = _get_text_overlays(cursor, working_video_id)
                ri, ei = _find_text_element(text_overlays, action.target.id)
                if ri == -1:
                    # Idempotent: mirrors delete_keyframe's no-op (overlay.py
                    # ~line 780) -- the gesture's postcondition ("no element
                    # with this id") already holds.
                    logger.info(
                        f"[Overlay Action] delete_text {action.target.id}: already "
                        f"absent (no-op)"
                    )
                else:
                    del text_overlays[ri]['elements'][ei]
                    if not text_overlays[ri]['elements']:
                        del text_overlays[ri]
                    _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                    conn.commit()
                    logger.info(f"[Overlay Action] Deleted text element {action.target.id}")
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            elif action.action == "delete_text_region":
                # T6630 round 4: deletes a REGION and every element inside it
                # in ONE surgical write (the lane's keyboard Delete/Backspace
                # on the focused region-block uses this, not N delete_text
                # calls -- one user gesture, one persist).
                if not action.target or not action.target.id:
                    raise ValueError("delete_text_region requires target.id")

                text_overlays = _get_text_overlays(cursor, working_video_id)
                idx = _find_text_index(text_overlays, action.target.id)
                if idx == -1:
                    logger.info(
                        f"[Overlay Action] delete_text_region {action.target.id}: already "
                        f"absent (no-op)"
                    )
                else:
                    del text_overlays[idx]
                    _save_text_overlays(cursor, working_video_id, text_overlays, new_version)
                    conn.commit()
                    logger.info(f"[Overlay Action] Deleted text region {action.target.id}")
                return JSONResponse({"success": True, "version": new_version, "region_id": None})

            else:
                raise ValueError(f"Unknown action: {action.action}")

            _save_overlay_data(cursor, working_video_id, highlights, effect_type, highlight_color, new_version)
            conn.commit()

            return JSONResponse({
                "success": True,
                "version": new_version,
                "region_id": region_id,
            })

        except ValueError as e:
            error = str(e)
            logger.warning(f"[Overlay Action] Validation error: {error}")
            return JSONResponse(status_code=400, content={
                "success": False,
                "version": version,
                "error": error,
            })
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e):
                logger.warning(f"[Overlay Action] Lock timeout during commit: {e}")
                return JSONResponse(status_code=503, content={
                    "success": False,
                    "error": "database_locked",
                    "message": "This item is being edited by another request. Please try again.",
                })
            error = str(e)
            logger.error(f"[Overlay Action] Error: {error}", exc_info=True)
            return JSONResponse(status_code=500, content={
                "success": False,
                "version": version,
                "error": error,
            })
        except Exception as e:
            error = str(e)
            logger.error(f"[Overlay Action] Error: {error}", exc_info=True)
            return JSONResponse(status_code=500, content={
                "success": False,
                "version": version,
                "error": error,
            })


def _decode_text_layers(text_layers: list, frame_w: int, frame_h: int) -> list:
    """Decode each pre-rasterised PNG text layer ONCE (T5225), splitting it into
    a BGR float array + a normalised (0..1) alpha mask at the frame's own
    dimensions.

    O3 hard constraint: the rasterised layer's dims MUST equal the frame dims
    this render loop is about to encode -- a mismatch RAISES rather than
    silently `cv2.resize`-ing (a silent rescale would burn mis-scaled text into
    a real export and mask a real upstream bug, e.g. a re-export at a different
    aspect ratio than what was rasterised. CLAUDE.md: no silent fallback for
    internal data).
    """
    import cv2
    import numpy as np

    decoded = []
    for layer in text_layers:
        arr = np.frombuffer(layer['png'], dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("[Overlay Text] failed to decode a text layer PNG")
        h, w = img.shape[:2]
        if (w, h) != (frame_w, frame_h):
            raise ValueError(
                f"[Overlay Text] rasterised layer dims {w}x{h} != frame dims "
                f"{frame_w}x{frame_h} -- refusing to silently rescale"
            )
        if img.ndim != 3 or img.shape[2] != 4:
            raise ValueError("[Overlay Text] decoded text layer has no alpha channel")
        decoded.append({
            'startTime': layer['startTime'],
            'endTime': layer['endTime'],
            'bgr': img[:, :, :3].astype(np.float32),
            'alpha': (img[:, :, 3:4].astype(np.float32)) / 255.0,
        })
    return decoded


# T6990: text fades OUT over the final TEXT_FADE_OUT_SEC of each layer's window
# instead of hard-cutting on its end frame. SHARED CONSTANT (source of truth):
# mirrored VERBATIM into `modal_functions/video_processing.py` (the Modal image
# cannot import `app`, so its inline `_blend_text_layers` copy defines its own;
# `TestModalInlineParity` pins the two equal) and into the frontend preview
# `src/frontend/src/constants/textSpec.js` (so scrubbing == export). Change all
# three together or preview/local/Modal drift.
TEXT_FADE_OUT_SEC = 0.25


def _blend_text_layers(frame, decoded_layers: list, current_time: float):
    """Alpha-blend every ACTIVE text layer onto `frame` (BGR uint8), in order.

    ACTIVE = half-open ``startTime <= t < endTime`` (design O6 -- deliberately
    asymmetric with highlight regions' closed ``[start, end]``; see the
    export-pipeline knowledge doc). Purely a per-frame numpy blend -- the layer
    itself was rasterised exactly ONCE, upstream (`_rasterize_text_layers`),
    never here.

    T6990: the layer's alpha is scaled by a fade-OUT envelope over the final
    ``TEXT_FADE_OUT_SEC`` of its window (``min(1, (endTime - t) / fade)``) so the
    text ramps to transparent rather than popping off on its end frame. Fade-IN
    is intentionally NOT implemented (out of scope for T6990). CLAMP: the plain
    ``min(1, ...)`` rule with no per-region floor means a region SHORTER than
    ``TEXT_FADE_OUT_SEC`` never reaches full alpha -- an accepted simplification
    (sub-0.25s regions are pathological drags), keeps the envelope identical
    across all three surfaces without threading each region's own start.
    """
    import numpy as np

    for layer in decoded_layers:
        if layer['startTime'] <= current_time < layer['endTime']:
            fade = min(1.0, (layer['endTime'] - current_time) / TEXT_FADE_OUT_SEC)
            alpha = layer['alpha'] * fade
            frame = (frame.astype(np.float32) * (1 - alpha) + layer['bgr'] * alpha).astype(np.uint8)
    return frame


def _process_frames_to_ffmpeg(
    input_path: str,
    output_path: str,
    highlight_regions: list,
    highlight_effect_type: str,
    progress_callback,
    overlay_settings: dict | None = None,
    text_layers: list | None = None,
) -> int:
    """
    Process video frames with highlight overlays, piping directly to FFmpeg.

    This avoids writing individual frame files to disk - frames are piped
    directly to FFmpeg's stdin for encoding, which is much faster.

    Returns the total number of frames processed.
    """
    import cv2

    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    # DEBUG: Log what we received
    logger.info(f"[Overlay Export] DEBUG - _process_frames_to_ffmpeg called with {len(highlight_regions)} regions, effect={highlight_effect_type}")
    if highlight_regions and len(highlight_regions) > 0:
        first_region = highlight_regions[0]
        logger.info(f"[Overlay Export] DEBUG - First region: {first_region.get('start_time')}-{first_region.get('end_time')}s, {len(first_region.get('keyframes', []))} keyframes")
        if first_region.get('keyframes'):
            logger.info(f"[Overlay Export] DEBUG - First keyframe: {first_region['keyframes'][0]}")

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError("Could not open video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    logger.info(f"[Overlay Export] Video: {width}x{height} @ {fps}fps, {frame_count} frames")
    logger.info("[Overlay Export] Piping frames directly to FFmpeg (no disk I/O)")

    # Get GPU encoding params
    encoding_params = get_encoding_command_parts(prefer_quality=True)

    # Start FFmpeg process with stdin pipe for raw frames
    # We'll pipe raw BGR frames and let FFmpeg encode them
    ffmpeg_cmd = [
        'ffmpeg', '-y',
        # Input: raw video frames from pipe
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',
        '-s', f'{width}x{height}',
        '-r', str(fps),
        '-i', 'pipe:0',
        # Audio from original file
        '-i', input_path,
        '-map', '0:v',
        '-map', '1:a?',
    ]
    ffmpeg_cmd.extend(encoding_params)
    ffmpeg_cmd.extend([
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        output_path
    ])

    logger.info(f"[Overlay Export] FFmpeg command: {' '.join(ffmpeg_cmd[:10])}...")

    # Start FFmpeg process
    # IMPORTANT: We use a thread to drain stderr to prevent deadlock!
    # If stderr buffer fills up, FFmpeg blocks, which blocks stdin, which blocks our write()
    ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE
    )

    # Drain stderr in a background thread to prevent deadlock
    stderr_output = []
    def drain_stderr():
        try:
            for line in ffmpeg_proc.stderr:
                stderr_output.append(line)
        except Exception:
            pass
    stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
    stderr_thread.start()

    # Sort regions by start time for efficient lookup. _region_bounds tolerates
    # both camelCase (action-written) and snake_case (transform-written) blobs.
    sorted_regions = sorted(highlight_regions, key=lambda r: _region_bounds(r)[0])

    # T5225: decode every text layer's PNG ONCE, before the frame loop -- never
    # re-rasterised or re-decoded per frame.
    decoded_text_layers = _decode_text_layers(text_layers or [], width, height)

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                r_start, r_end = _region_bounds(region)
                if r_start <= current_time <= r_end:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                region_keyframes = _keyframes_within_bounds(active_region)

                # T5250: exit fade-out envelope, derived from the region bounds +
                # current_time (shared spec, mirrored in HighlightOverlay + video_processing).
                # Applied by render_highlight_on_frame — never mutates keyframe data.
                reveal_opacity, reveal_scale = compute_spotlight_reveal(
                    current_time, *_region_bounds(active_region)
                )

                highlight = KeyframeInterpolator.interpolate_highlight(region_keyframes, current_time)
                if highlight is not None:
                    # Check if keyframe coordinates need to be scaled from detection space to working video space
                    # Detection may have run on source video (e.g., 2560x1440) but rendering is on working video (e.g., 1080x1920)
                    detection_width = active_region.get('videoWidth')
                    detection_height = active_region.get('videoHeight')

                    if detection_width and detection_height and (detection_width != width or detection_height != height):
                        # Scale coordinates from detection space to working video space
                        scale_x = width / detection_width
                        scale_y = height / detection_height
                        highlight = {
                            **highlight,
                            'x': highlight['x'] * scale_x,
                            'y': highlight['y'] * scale_y,
                            'radiusX': highlight['radiusX'] * scale_x,
                            'radiusY': highlight['radiusY'] * scale_y,
                        }

                    frame = KeyframeInterpolator.render_highlight_on_frame(
                        frame,
                        highlight,
                        (width, height),
                        crop=None,
                        effect_type=highlight_effect_type,
                        overlay_settings=overlay_settings,
                        reveal_opacity=reveal_opacity,
                        reveal_scale=reveal_scale,
                    )

            # T5225: alpha-blend any ACTIVE text layer AFTER the highlight but
            # BEFORE the frame is written -- decoded once above, blended fresh
            # every frame.
            if decoded_text_layers:
                frame = _blend_text_layers(frame, decoded_text_layers, current_time)

            # Write frame directly to FFmpeg's stdin (no disk I/O!)
            ffmpeg_proc.stdin.write(frame.tobytes())
            frame_idx += 1

            # Report progress every 30 frames
            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 80)
                progress_callback(progress, f"Processing frames... {frame_idx}/{frame_count}")

    finally:
        cap.release()
        # Close stdin to signal EOF to FFmpeg
        if ffmpeg_proc.stdin:
            ffmpeg_proc.stdin.close()

    # Wait for FFmpeg to finish
    ffmpeg_proc.wait()
    stderr_thread.join(timeout=5.0)  # Wait for stderr drain thread

    if ffmpeg_proc.returncode != 0:
        stderr_text = b''.join(stderr_output).decode(errors='replace')
        logger.error(f"[Overlay Export] FFmpeg error: {stderr_text}")
        raise RuntimeError(f"FFmpeg encoding failed: {stderr_text[:500]}")

    logger.info(f"[Overlay Export] Processed {frame_idx} frames via pipe")
    return frame_idx


@router.post("/overlay")
async def export_overlay_only(
    video: UploadFile = File(...),
    export_id: str = Form(...),
    project_id: int = Form(None),  # Optional: for export_jobs tracking
    highlight_regions_json: str = Form(None),
    highlight_keyframes_json: str = Form(None),  # Legacy format (deprecated)
    highlight_effect_type: str = Form(DEFAULT_HIGHLIGHT_EFFECT.value),
    _durable: None = Depends(durable_sync),  # T4110: sync final_videos row to R2 before 200
):
    """
    Export video with highlight overlays ONLY - no cropping, no AI upscaling.

    This is a fast export for Overlay mode where the video has already been
    cropped/trimmed during Framing export.

    Audio from input video is always preserved.

    Highlight format (new region-based):
    [
        {
            "id": "region-123",
            "start_time": 0,
            "end_time": 3,
            "keyframes": [
                {"time": 0, "x": 100, "y": 200, "radiusX": 50, "radiusY": 80, "strokeOpacity": 0.85, "fillOpacity": 0.05, "color": "#FFFFFF"},
                ...
            ]
        },
        ...
    ]
    """

    # Fetch project name for progress messages
    project_name = None
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
                row = cursor.fetchone()
                if row:
                    project_name = row['name']
        except Exception as e:
            logger.warning(f"[Overlay Export] Failed to fetch project name: {e}")

    # Create export_jobs record for tracking (if project_id provided)
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO export_jobs (id, project_id, type, status, input_data)
                    VALUES (?, ?, 'overlay', 'processing', '{}')
                """, (export_id, project_id))
                conn.commit()
            logger.info(f"[Overlay Export] Created export_jobs record: {export_id} for project '{project_name}'")
        except Exception as e:
            logger.warning(f"[Overlay Export] Failed to create export_jobs record: {e}")

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting overlay export...",
        "status": "processing",
        "projectId": project_id,
        "projectName": project_name,
        "type": "overlay"
    }

    logger.info(f"[Overlay Export] Effect type: {highlight_effect_type}")

    # Parse highlight regions (new format) or keyframes (legacy format)
    highlight_regions = []

    if highlight_regions_json:
        # New region-based format
        try:
            regions_data = json.loads(highlight_regions_json)
            for region in regions_data:
                highlight_regions.append({
                    'id': region.get('id', ''),
                    'start_time': region['start_time'],
                    'end_time': region['end_time'],
                    'keyframes': [
                        {
                            'time': kf['time'],
                            'x': kf['x'],
                            'y': kf['y'],
                            'radiusX': kf['radiusX'],
                            'radiusY': kf['radiusY'],
                            'strokeOpacity': kf['strokeOpacity'],
                            'fillOpacity': kf['fillOpacity'],
                            'color': kf['color']
                        }
                        for kf in region.get('keyframes', [])
                    ]
                })
            logger.info(f"[Overlay Export] Received {len(highlight_regions)} highlight regions:")
            for region in highlight_regions:
                logger.info(f"  Region {region['id']}: {region['start_time']:.2f}s - {region['end_time']:.2f}s, {len(region['keyframes'])} keyframes")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {e!s}") from e
    elif highlight_keyframes_json:
        # Legacy flat keyframe format - convert to single region
        try:
            highlight_data = json.loads(highlight_keyframes_json)
            keyframes = [
                {
                    'time': kf['time'],
                    'x': kf['x'],
                    'y': kf['y'],
                    'radiusX': kf['radiusX'],
                    'radiusY': kf['radiusY'],
                    'strokeOpacity': kf.get('strokeOpacity', kf.get('opacity', 0.85)),
                    'fillOpacity': kf.get('fillOpacity', kf.get('opacity', 0.05)),
                    'color': kf['color']
                }
                for kf in highlight_data
            ]
            if keyframes:
                highlight_regions.append({
                    'id': 'legacy',
                    'start_time': keyframes[0]['time'],
                    'end_time': keyframes[-1]['time'],
                    'keyframes': keyframes
                })
            logger.info(f"[Overlay Export] Legacy format: {len(keyframes)} keyframes converted to 1 region")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {e!s}") from e

    # Create temp directory (no frames_dir needed - we pipe directly to FFmpeg)
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"overlay_{uuid.uuid4().hex}.mp4")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Update progress
        progress_data = {"progress": 10, "message": "Processing video...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Fast path: no highlights - just copy the video
        if not highlight_regions:
            logger.info("[Overlay Export] No highlights - copying video directly")
            import shutil
            shutil.copy(input_path, output_path)

            progress_data = {"progress": 100, "message": "Export complete!", "status": ExportStatus.COMPLETE, "projectId": project_id, "projectName": project_name, "type": "overlay"}
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            return FileResponse(
                output_path,
                media_type='video/mp4',
                filename=f"overlayed_{video.filename}",
                background=None
            )

        # Progress updates from thread
        progress_queue = asyncio.Queue()

        def on_progress(progress: int, message: str):
            # Can't await from thread, so just update the dict
            export_progress[export_id] = {
                "progress": progress,
                "message": message,
                "status": "processing",
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay"
            }
            # Queue progress for async sending
            try:
                progress_queue.put_nowait((progress, message))
            except asyncio.QueueFull:
                pass  # Skip if queue is full

        # Run frame processing in thread pool to avoid blocking event loop
        # Frames are piped directly to FFmpeg - no disk I/O for individual frames!
        loop = asyncio.get_event_loop()
        logger.info("[Overlay Export] Processing frames with direct FFmpeg pipe...")

        # Start a task to send progress updates
        async def send_progress_updates():
            while True:
                try:
                    progress, message = await asyncio.wait_for(progress_queue.get(), timeout=0.5)
                    await manager.send_progress(export_id, {
                        "progress": progress,
                        "message": message,
                        "status": "processing",
                        "projectId": project_id,
                        "projectName": project_name,
                        "type": "overlay"
                    })
                except TimeoutError:
                    continue
                except asyncio.CancelledError:
                    break

        progress_task = asyncio.create_task(send_progress_updates())

        try:
            frame_idx = await loop.run_in_executor(
                _frame_processor_pool,
                _process_frames_to_ffmpeg,
                input_path,
                output_path,
                highlight_regions,
                highlight_effect_type,
                on_progress
            )
        finally:
            progress_task.cancel()
            try:
                await progress_task
            except asyncio.CancelledError:
                pass

        logger.info(f"[Overlay Export] Completed processing {frame_idx} frames")

        # Update export_jobs record to complete
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (export_id,))
                    conn.commit()
            except Exception as e:
                logger.warning(f"[Overlay Export] Failed to update export_jobs record: {e}")

        # Complete
        progress_data = {"progress": 100, "message": "Export complete!", "status": ExportStatus.COMPLETE, "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        def cleanup_temp_dir():
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"overlayed_{video.filename}",
            background=BackgroundTask(cleanup_temp_dir)
        )

    except HTTPException as e:
        # Extract error message from HTTPException
        error_msg = str(e.detail) if hasattr(e, 'detail') else str(e)
        logger.error(f"[Overlay Export] HTTPException: {error_msg}")

        # Update export_jobs record to error
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (error_msg[:500], export_id))
                    conn.commit()
            except Exception:
                pass

        # Send error progress via WebSocket
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {error_msg}",
            export_type='overlay',
            project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed: {cleanup_error}")
        raise
    except Exception as e:
        logger.error(f"[Overlay Export] Failed: {e!s}", exc_info=True)
        # Update export_jobs record to error
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (str(e)[:500], export_id))
                    conn.commit()
            except Exception:
                pass
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {e!s}",
            export_type='overlay',
            project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {e!s}") from e


@router.post("/final")
async def export_final(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    overlay_data: str = Form("{}"),
    _durable: None = Depends(durable_sync),  # T4110: sync final_videos row to R2 before 200
):
    """
    Export final video with overlays for a project.

    This endpoint:
    1. Receives the rendered video with overlays from the frontend
    2. Saves it to final_videos folder
    3. Creates final_videos DB entry with next version number
    4. Updates project.final_video_id to point to latest version

    Request:
    - project_id: The project ID
    - video: The rendered video file with overlays
    - overlay_data: JSON with overlay configurations (for metadata)

    Response:
    - success: boolean
    - final_video_id: The new final video ID
    - filename: The saved filename
    """
    logger.info(f"[Final Export] Starting for project {project_id}")

    try:
        json.loads(overlay_data)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=400, detail="Invalid overlay_data JSON") from err

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists and has a working video
        cursor.execute("""
            SELECT id, name, working_video_id, final_video_id
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # T5410: the user's pre-export overlay marker (column-guarded for the
        # deploy->migrate window, v032 not yet applied -- mirrors _has_slowmo below).
        poster_marker_time = None
        if column_exists(cursor, "projects", "poster_marker_time"):
            cursor.execute("SELECT poster_marker_time FROM projects WHERE id = ?", (project_id,))
            pm_row = cursor.fetchone()
            if pm_row and pm_row["poster_marker_time"] is not None:
                poster_marker_time = float(pm_row["poster_marker_time"])

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project must have a working video before final export"
            )

        # T5215: intro_card_id landed in v034; guarded (deploy->migrate window).
        _has_intro = column_exists(cursor, "final_videos", "intro_card_id")
        intro_select = ", intro_card_id" if _has_intro else ""

        # T4010: capture the PRIOR final the project points at, to swap atomically
        # and clean up the old version after commit (unless an active share serves it).
        # T5215: also capture its intro_card_id -- carries the reel's attachment
        # forward across this re-export's new version row (same regression the
        # `_finalize_overlay_export` path above guards against).
        prior_final_id = project['final_video_id']
        prior_filename = None
        prior_intro_card_id = None
        if prior_final_id:
            cursor.execute(f"SELECT filename{intro_select} FROM final_videos WHERE id = ?", (prior_final_id,))
            prior_row = cursor.fetchone()
            prior_filename = prior_row['filename'] if prior_row else None
            prior_intro_card_id = prior_row['intro_card_id'] if (prior_row and _has_intro) else None
        keep_prior = _prior_final_is_shared(prior_filename)

        # Generate unique filename using project name + UUID (no local storage)
        project_name = project['name'] or f"project_{project_id}"
        safe_name = re.sub(r'[^\w\s-]', '', project_name).strip()
        safe_name = re.sub(r'[\s]+', '_', safe_name)
        if not safe_name:
            safe_name = f"project_{project_id}"

        # Use UUID suffix to ensure uniqueness in R2
        filename = f"{safe_name}_final_{uuid.uuid4().hex[:8]}.mp4"
        user_id = get_current_user_id()

        # Upload directly from memory to R2 (no temp file)
        content = await video.read()
        if not upload_bytes_to_r2(user_id, f"final_videos/{filename}", content):
            raise HTTPException(status_code=500, detail="Failed to upload final video to R2")
        logger.info(f"[Final Export] Uploaded final video to R2: {filename} ({len(content)} bytes)")

        # T5280: no poster (og:image JPEG) extraction here -- it moved to the
        # publish gesture (downloads.py publish_to_my_reels), since share links are
        # the poster's only consumer and can't exist before publish. Drafts that
        # never publish skip the ffmpeg cost entirely.
        # T5090 (KEPT): reuse the already-open cursor to read the project's ordered
        # working-clip segment data (only SELECTs have run so far) and compute the
        # first slow-mo section; FREEZE it on the row below so publish/backfill
        # survive the publish-time working_clips prune. poster_filename stays NULL
        # here; publish fills it.
        slowmo_section = first_slowmo_section(read_clip_segments_for_project(cursor, project_id))
        slowmo_start = slowmo_section[0] if slowmo_section else None
        slowmo_end = slowmo_section[1] if slowmo_section else None

        # Get next version number for final video
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM final_videos
            WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']
        logger.info(f"[Final Export] Creating final video version {next_version} for project {project_id}")

        # Determine source_type: check if this is an auto-created project for a 5-star clip
        cursor.execute("""
            SELECT id FROM raw_clips WHERE auto_project_id = ?
        """, (project_id,))
        is_auto_project = cursor.fetchone() is not None
        source_type = 'brilliant_clip' if is_auto_project else 'custom_project'

        cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
        project_row = cursor.fetchone()
        fv_name = project_row['name'] if project_row else f"Video {project_id}"

        # T3600: freeze collection metadata while working data still exists.
        # T3605: freeze game_ids too.
        duration, aspect_ratio, tags_blob = compute_project_metadata(cursor, project_id)
        game_ids_blob = compute_project_game_ids(cursor, project_id)
        # T3630: clip_count + quality_score + the Glicko seed (rating/rd) +
        # source_clip_id/clip_start_time, all frozen in one shot.
        (clip_count, quality_score, rating, rd,
         source_clip_id, clip_start_time) = compute_project_ranking_freeze(cursor, project_id)
        # T3920: unified two-half in-match start (file-relative + prior-half durations)
        clip_game_start_time = compute_unified_clip_start(cursor, source_clip_id, clip_start_time)

        # T5215: carry the reel's attachment (captured above from the prior row,
        # or NULL/inherit-default on a first-ever export) into the new version.
        intro_cols = ", intro_card_id" if _has_intro else ""
        intro_placeholders = ", ?" if _has_intro else ""
        intro_values = (prior_intro_card_id,) if _has_intro else ()

        # Create new final video entry with version number and source_type
        cursor.execute(f"""
            INSERT INTO final_videos (project_id, filename, version, source_type, name,
                duration, aspect_ratio, tags, game_ids, clip_count, quality_score,
                rating, rd, match_count, source_clip_id, clip_start_time, clip_game_start_time,
                poster_filename, slowmo_section_start, slowmo_section_end{intro_cols})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?{intro_placeholders})
        """, (project_id, filename, next_version, source_type, fv_name,
              duration, aspect_ratio, tags_blob, game_ids_blob, clip_count, quality_score,
              rating, rd, source_clip_id, clip_start_time, clip_game_start_time, None,
              slowmo_start, slowmo_end, *intro_values))
        final_video_id = cursor.lastrowid
        logger.info(f"[Final Export] Created final video id={final_video_id} with source_type={source_type}")

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

        # T4010: drop the superseded prior row in the same transaction as the swap
        # (its R2 object is deleted post-commit). Skipped when a share still serves it.
        if prior_final_id and not keep_prior:
            cursor.execute("DELETE FROM final_videos WHERE id = ?", (prior_final_id,))

        # Track source clips for before/after comparison
        cursor.execute("""
            SELECT wc.id, wc.raw_clip_id, wc.uploaded_filename, wc.segments_data, wc.sort_order,
                   rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            ORDER BY wc.sort_order
        """, (project_id,))
        working_clips = cursor.fetchall()

        for idx, wc in enumerate(working_clips):
            # Determine source path
            if wc['raw_clip_id'] and wc['raw_filename']:
                source_path = str(get_raw_clips_path() / wc['raw_filename'])
            elif wc['uploaded_filename']:
                source_path = str(get_uploads_path() / wc['uploaded_filename'])
            else:
                continue  # Skip if no source

            # Get frame range from segments_data
            start_frame = 0
            end_frame = 0
            framerate = 30.0

            if wc['segments_data']:
                try:
                    segments = decode_data(wc['segments_data'])
                    trim_range = segments.get('trimRange')
                    if trim_range:
                        start_frame = int(trim_range.get('start', 0) * framerate)
                        end_frame = int(trim_range.get('end', 0) * framerate)
                    elif segments.get('boundaries'):
                        # No trim, use full clip from boundaries
                        boundaries = segments['boundaries']
                        if len(boundaries) >= 2:
                            end_frame = int(boundaries[-1] * framerate)
                except Exception:
                    pass

            # Insert tracking record
            cursor.execute("""
                INSERT INTO before_after_tracks
                (final_video_id, raw_clip_id, source_path, start_frame, end_frame, clip_index)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (final_video_id, wc['raw_clip_id'], source_path, start_frame, end_frame, idx))

        logger.info(f"[Final Export] Tracked {len(working_clips)} source clips for before/after")

        # T8070: refresh the per-clip reel-source window (see _finalize_overlay_export
        # for rationale). This inline finalizer does NOT call the shared helper, so it
        # needs its own identical refresh. Column-guarded for the deploy->migrate window.
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

        conn.commit()

        logger.info(f"[Final Export] Created final video {final_video_id} for project {project_id}")

    # T4010: only after the swap is committed, best-effort delete the prior object.
    if not keep_prior:
        _delete_prior_final_object(user_id, prior_filename, filename)

    # T5410: capture the poster AFTER finalize, BEFORE the durable_sync barrier
    # (the `_durable` dependency awaits the R2 sync AFTER this handler returns,
    # so setting poster_* on the local row here still rides that same sync).
    await generate_poster_at_export(
        user_id, final_video_id, filename,
        slowmo_section, duration, poster_marker_time,
    )

    return JSONResponse({
        'success': True,
        'final_video_id': final_video_id,
        'filename': filename,
        'project_id': project_id
    })


@router.get("/projects/{project_id}/final-video")
async def get_final_video(project_id: int):
    """Get presigned URL for the final video of a project.

    Returns JSON with the presigned URL instead of a 302 redirect.
    XHR/fetch following 302 redirects to R2 is blocked by CORS, so the
    frontend must fetch from R2 directly using the presigned URL.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest final video for this project
        cursor.execute("""
            SELECT filename
            FROM final_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Final video not found")

        user_id = get_current_user_id()
        presigned_url = generate_presigned_url(
            user_id=user_id,
            relative_path=f"final_videos/{result['filename']}",
            expires_in=3600,
            content_type="video/mp4"
        )
        if presigned_url:
            return {"url": presigned_url, "filename": result['filename']}
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL for final video")


async def _load_highlights_from_raw_clips(project_id: int, cursor) -> list:
    """
    Load highlight regions from raw_clips and transform to working video space.

    Returns transformed highlight regions ready for the current project's framing.

    DEDUPLICATION: If the same raw_clip is used multiple times in a project
    (e.g., user adds the same clip twice), we only load its default_highlight_regions
    once to prevent duplicate/overlapping regions.
    """
    # Get working clips with framing data and raw clip defaults
    # Note: Same raw_clip_id may appear multiple times if clip is used more than once
    cursor.execute("""
        SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
               rc.default_highlight_regions
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ?
          AND rc.default_highlight_regions IS NOT NULL
    """, (project_id,))

    working_clips = cursor.fetchall()

    if not working_clips:
        return []

    # Get working video dimensions
    cursor.execute("""
        SELECT wv.filename
        FROM working_videos wv
        JOIN projects p ON p.working_video_id = wv.id
        WHERE p.id = ?
    """, (project_id,))
    wv_result = cursor.fetchone()

    # Default dimensions if we can't determine from video
    working_video_dims = {'width': 1080, 'height': 1920}

    if wv_result:
        import cv2

        from ...database import get_working_videos_path
        wv_path = get_working_videos_path() / wv_result['filename']
        if wv_path.exists():
            cap = cv2.VideoCapture(str(wv_path))
            if cap.isOpened():
                working_video_dims = {
                    'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                    'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                }
                cap.release()

    all_transformed_regions = []
    processed_raw_clip_ids = set()  # Track processed raw_clips to prevent duplicates

    for clip in working_clips:
        raw_clip_id = clip['raw_clip_id']

        # Skip if we've already processed this raw_clip (prevents duplicates when
        # the same clip is used multiple times in a project)
        if raw_clip_id in processed_raw_clip_ids:
            logger.info(f"[Overlay Data] Skipping duplicate raw_clip {raw_clip_id}")
            continue
        processed_raw_clip_ids.add(raw_clip_id)

        # Parse raw clip default highlights
        raw_regions = decode_data(clip['default_highlight_regions']) or []

        if not raw_regions:
            continue

        # Parse framing data
        crop_keyframes = []
        segments_data = {}

        if clip['crop_data']:
            try:
                crop_keyframes = decode_data(clip['crop_data'])
            except Exception:
                pass

        if clip['segments_data']:
            try:
                segments_data = decode_data(clip['segments_data'])
            except Exception:
                pass

        # Transform regions from raw clip space to working video space
        transformed_regions = transform_all_regions_to_working(
            raw_regions=raw_regions,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=30.0
        )

        all_transformed_regions.extend(transformed_regions)

    logger.info(f"[Overlay Data] Loaded {len(all_transformed_regions)} regions from raw_clips")
    return all_transformed_regions


@router.get("/projects/{project_id}/overlay-data")
async def get_overlay_data(project_id: int):
    """
    Get saved overlay editing state for a project.

    Called by frontend when entering Overlay mode to restore previous edits.
    If no project-specific overlay data exists, checks source raw_clips for
    default highlight data (from previous projects using the same clips).

    Response:
    - highlights_data: Parsed JSON array of highlight regions (each region's
      `detections` is a read-time projection of `detections_data`, see below)
    - detections_data: flat, whole-timeline detection payload
      {videoWidth, videoHeight, fps, detections:[{timestamp,frame,boxes}]},
      or null if the video has none (T5600 -- canonical store, survives region delete)
    - text_overlays: Parsed JSON array of text overlay configs
    - effect_type: 'brightness_boost' | 'dark_overlay'
    - highlight_color: Hex color string or null (user's last selected color)
    - has_data: boolean indicating if any data exists
    - from_raw_clip: boolean indicating if data came from raw_clip defaults
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T5600's detections_data may be absent during the deploy->v027 window
        # (versioned migrations do not auto-run). Naming it unconditionally made this
        # hot read 500 ("no such column: detections_data") on every below-head profile
        # DB, i.e. EVERY user until an admin triggered the migrate -- the exact bug
        # class column_exists()/_has_stage_columns exist to prevent. NULL is the right
        # value during the window (it is the column's own default), and the reader
        # below already falls back to hoisting detections from the regions.
        _has_detections = column_exists(cursor, "working_videos", "detections_data")
        # T4350: highlight_carry_note (v046) surfaces "N highlights need re-placement"
        # after a re-export dropped/reset carried highlights. Column-guarded like
        # detections_data so a below-head profile DB does not 500 the overlay screen.
        _has_carry_note = column_exists(cursor, "working_videos", "highlight_carry_note")
        cursor.execute(f"""
            SELECT highlights_data, text_overlays, effect_type, highlight_color, duration,
                   highlight_shape, stroke_width, fill_enabled, fill_opacity, dim_strength,
                   version, overlay_version,
                   {'detections_data' if _has_detections else 'NULL AS detections_data'},
                   {'highlight_carry_note' if _has_carry_note else 'NULL AS highlight_carry_note'}
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        highlights = []
        text_overlays = []
        effect_type = DEFAULT_HIGHLIGHT_EFFECT.value
        highlight_color = None
        video_duration = None
        from_raw_clip = False
        highlight_shape = 'body'
        stroke_width = 2
        fill_enabled = True
        fill_opacity = 0.20
        dim_strength = 0.20
        video_detections = None
        highlight_carry_note = None  # T4350
        # T4330: seeds the frontend actionClient's version tracker so a tab's
        # FIRST overlay edit is conflict-checked too, not just the 2nd+ (which
        # is all the client's own echoed-version tracking alone would catch).
        # 0 when there's no working_videos row yet (has_data=False path below).
        version = 0

        if result:
            if result['highlights_data']:
                try:
                    highlights = decode_data(result['highlights_data'])
                except Exception:
                    pass

            if result['text_overlays']:
                text_overlays = decode_data(result['text_overlays']) or []

            if result['detections_data']:
                try:
                    video_detections = decode_data(result['detections_data'])
                except Exception:
                    logger.error(
                        f"[Overlay Data] Failed to decode detections_data for project {project_id}",
                        exc_info=True,
                    )
                    video_detections = None

            effect_type = normalize_effect_type(result['effect_type'])
            highlight_color = result['highlight_color']
            video_duration = result['duration']
            # T4330 conflict-check bug fix: `working_videos.version` is the EXPORT
            # row-counter (bumps once per re-export), not the mutation counter
            # `overlay_action`'s 409-check actually compares against
            # (`overlay_version`, see `_get_overlay_data`). Seeding the frontend's
            # actionClient from the wrong counter made the first overlay edit after
            # any re-export always fail the version check -- a false "edited
            # elsewhere" conflict on a single tab, no concurrent editor involved.
            version = result['overlay_version'] or 0
            highlight_shape = result['highlight_shape'] or 'body'
            stroke_width = result['stroke_width']
            fill_enabled = bool(result['fill_enabled'])
            fill_opacity = result['fill_opacity']
            dim_strength = result['dim_strength']
            highlight_carry_note = result['highlight_carry_note']  # T4350 (may be None)

        # If no project-specific highlights, check raw_clips for defaults
        if not highlights:
            highlights = await _load_highlights_from_raw_clips(project_id, cursor)
            if highlights:
                from_raw_clip = True
                logger.info(f"[Overlay Data] Using default highlights from raw_clip for project {project_id}")

        # T5600: detections_data is the canonical store. Old exports (pre-migration,
        # or a row the migration couldn't backfill) have it NULL -- hoist a flat
        # payload from the regions' embedded detections at read time. Read-only:
        # never persisted here, only in the v027 migration.
        if video_detections is None:
            video_detections = hoist_video_detections(highlights)

        # Project the canonical payload onto each region as a read-time slice
        # (never persisted) so region.detections/videoWidth/videoHeight/fps stay
        # correct even though detections_data is now their source of truth.
        for region in highlights:
            start, end = _region_bounds(region)
            region['detections'] = slice_detections(video_detections, start, end)
            if video_detections:
                region['videoWidth'] = video_detections.get('videoWidth')
                region['videoHeight'] = video_detections.get('videoHeight')
                region['fps'] = video_detections.get('fps')

        # Diagnostic logging
        total_boxes = sum(len(d.get('boxes', [])) for h in highlights for d in (h.get('detections') or []))
        logger.info(f"[Overlay Data] project={project_id}: {len(highlights)} regions, {total_boxes} detection boxes, duration={video_duration}, from_raw_clip={from_raw_clip}")
        if highlights:
            sample = highlights[0]
            logger.info(f"[Overlay Data] First region: id={sample.get('id')}, detections={len(sample.get('detections', []))}, videoWidth={sample.get('videoWidth')}")

        # T5410: the pre-export poster marker (projects.poster_marker_time), so
        # the overlay timeline can render the marker at the user's saved choice
        # (or the default midpoint, computed client-side, when None). Also send
        # the reel's first slow-mo section (SAME helper the export-time selector
        # uses) so the client can compute the identical open-play window for
        # that default preview -- never a guessed default that could diverge
        # from what export actually picks.
        poster_marker_time = get_project_poster_marker_time(project_id)
        poster_slowmo_section = first_slowmo_section(load_project_clip_segments(project_id))

        # T5225: interior clip cut-points on the concatenated timeline, for the
        # Overlay text layer's range-snapping. Read-only, additive, no migration
        # (design SS2.2). Degrades to [] rather than 500 when clip data can't be
        # resolved (e.g. a published reel whose working_clips were pruned) --
        # clip_boundary_offsets never raises (O2, binding).
        clip_boundaries = clip_boundary_offsets(project_id)

        # T6380/T6510: hydrate the overlay cover state. poster_source on the
        # project's CURRENT final video tells the client whether a custom upload
        # is the cover actually served, so a reload restores "Custom image in
        # use" instead of falsely showing the auto/marker state (bug 2 -- the
        # uploaded state was previously written only from the upload response
        # and never read back). T6510 removed the upload WRITE path but this
        # READ path is RETAINED for grandfathered poster_source='upload' reels
        # (their stored poster keeps serving; the client offers a one-way "Use a
        # frame instead" via /poster/revert) -- do NOT delete it as dead code.
        # Read-only: no write-back (CLAUDE.md restore rule 4). poster_source is a
        # v032 column on this HOT read path, so it
        # is column-guarded -- a below-head profile must not 500 the whole
        # overlay screen (mirrors the poster_marker_time guard at :181 and the
        # detections_data guard above; the T5630 _has_stage_columns landmine).
        poster_source = None
        poster_filename = None
        if column_exists(cursor, "final_videos", "poster_source"):
            cursor.execute("""
                SELECT fv.poster_source AS poster_source,
                       fv.poster_filename AS poster_filename
                FROM projects p JOIN final_videos fv ON fv.id = p.final_video_id
                WHERE p.id = ?
            """, (project_id,))
            poster_row = cursor.fetchone()
            if poster_row:
                poster_source = poster_row["poster_source"]
                poster_filename = poster_row["poster_filename"]

        return JSONResponse({
            'version': version,
            'highlights_data': highlights,
            'detections_data': video_detections,
            'text_overlays': text_overlays,
            'effect_type': effect_type,
            'highlight_color': highlight_color,
            'has_data': len(highlights) > 0 or len(text_overlays) > 0,
            'from_raw_clip': from_raw_clip,
            'video_duration': video_duration,
            'highlight_shape': highlight_shape,
            'stroke_width': stroke_width,
            'fill_enabled': fill_enabled,
            'fill_opacity': fill_opacity,
            'dim_strength': dim_strength,
            'highlight_carry_note': highlight_carry_note,  # T4350: null | "dropped:N" | "multiclip_reset" | "legacy_uncertain"
            'poster_marker_time': poster_marker_time,
            'poster_slowmo_section': list(poster_slowmo_section) if poster_slowmo_section else None,
            'poster_source': poster_source,
            'poster_filename': poster_filename,
            'clip_boundaries': clip_boundaries,
        })


@router.get("/highlights/{filename}")
async def get_highlight_image(filename: str):
    """
    Serve a highlight player image by filename.

    Images are extracted from raw clips during highlight persistence
    and stored in the highlights directory for debugging/inspection.

    Response:
    - PNG image file of the player bounding box
    """
    # Validate filename to prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Redirect to R2 presigned URL
    user_id = get_current_user_id()
    presigned_url = generate_presigned_url(
        user_id=user_id,
        relative_path=f"highlights/{filename}",
        expires_in=3600,
        content_type="image/png"
    )
    if presigned_url:
        return RedirectResponse(url=presigned_url, status_code=302)
    raise HTTPException(status_code=404, detail="Failed to generate R2 URL for highlight image")


@router.get("/highlights")
async def list_highlights(raw_clip_id: int | None = None):
    """
    List all highlight images, optionally filtered by raw_clip_id.

    Response:
    - images: List of image info dicts with filename, url, raw_clip_id, frame, keyframe_index
    """
    images = list_highlight_images(raw_clip_id)
    return JSONResponse({
        'images': images,
        'count': len(images)
    })


# =============================================================================
# T5410: Poster marker + upload endpoints (pre-export, gesture-scoped)
# =============================================================================

class PosterTimeRequest(BaseModel):
    """Body for the poster-time surgical write. A concrete, finite, non-negative
    final-video time is REQUIRED.

    T6560: the null/clear path was REMOVED here. T6510 established that the
    preview image is ALWAYS a frame (a default is resolved, shown, and moved),
    so there is no valid "none" state -- the marker can only be MOVED to another
    frame, never cleared. Making `time` required (no `= None` default) means a
    missing/undefined/null body now 422s LOUDLY at this persistence boundary
    instead of silently clearing the reel's poster, so no UI path (present or
    future regression) can reach the invalid state. Resetting to the AUTOMATIC
    frame is a different gesture (POST /poster/revert), which regenerates a real
    frame and overwrites the R2 object -- it never lands on "nothing"."""
    time: float

    @field_validator("time")
    @classmethod
    def _finite_nonnegative(cls, value: float) -> float:
        if not math.isfinite(value) or value < 0:
            raise ValueError("poster time must be a finite, non-negative number")
        return value


@router.post("/projects/{project_id}/poster-time")
async def set_poster_time(project_id: int, body: PosterTimeRequest):
    """Surgical, gesture-only write of the user's pre-export poster marker
    (T5410) -- fired from the overlay timeline marker's drag-end or the
    "Use current frame as cover" button, never a useEffect. The marker can only
    be MOVED to a concrete frame; there is no clear-to-none (T6560) -- see
    PosterTimeRequest. Reset-to-auto is POST /poster/revert.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

    # T6550: the write is column-guarded for the deploy->migrate window (v032 not
    # yet applied). set_project_poster_marker_time returns False when the column
    # isn't there yet -- surface that as a 503 (transient, retryable) rather than
    # a lying 200 success or a raw 500. 503 (not 4xx) is deliberate: this is a
    # known, time-bounded server-not-ready state, not a client error, and the
    # overlay action layer treats 5xx as retryable (bounded retry + a persistent
    # "your edits aren't saving / Retry" toast that also gates export), so the
    # user's drag re-lands automatically once the admin runs the migration.
    if not set_project_poster_marker_time(project_id, body.time):
        raise HTTPException(
            status_code=503,
            detail="The poster marker is not available yet for this project "
                   "(pending migration). Try again in a moment.",
        )
    return JSONResponse({"success": True, "time": body.time})


# T6510: the custom-cover UPLOAD endpoint (POST /poster/upload) was REMOVED.
# The preview image is now always a frame from the reel (default resolved,
# shown, and moved via the timeline marker), so there is no upload write path.
# Existing poster_source='upload' reels are GRANDFATHERED: the /overlay-data
# READ path still returns their poster_source/poster_filename (see
# _get_overlay_data above) and their stored R2 poster keeps serving, and
# /poster/revert below is the one-way switch back to a frame. The retired
# `store_override_poster` service helper was deleted with this endpoint.


@router.post("/projects/{project_id}/poster/revert")
async def revert_poster_image(project_id: int):
    """Revert a custom cover (a grandfathered upload or an overlay marker) back
    to the auto/marker cover (T6380). The one-way "Use a frame instead" switch
    (the upload write path itself was removed in T6510).

    Regenerates the open-play frame the export-time selector picks and
    OVERWRITES the deterministic poster key, so shares / og:image / the share
    email need zero changes; resets poster_source to 'overlay' (marker still
    set) or 'auto', and poster_frame_time to the regenerated frame's time.
    Reuses the SINGLE poster-selection path (`generate_poster_at_export` via
    `revert_to_auto_poster`) -- no forked re-derivation.

    Gesture-only (the Remove click). Requires an exported final video (same
    precondition as upload) -- with no final video there is nothing to revert
    to, so this fails loudly (400) rather than the silent local-only no-op the
    T5410 controls shipped with (the bug this fixes)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT p.final_video_id AS final_video_id, fv.filename AS filename "
            "FROM projects p LEFT JOIN final_videos fv ON fv.id = p.final_video_id "
            "WHERE p.id = ?",
            (project_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        final_video_id = row["final_video_id"]
        final_filename = row["filename"]
        if not final_video_id or not final_filename:
            raise HTTPException(
                status_code=400,
                detail="Project has no exported final video yet -- nothing to revert",
            )

    user_id = get_current_user_id()
    stored = await revert_to_auto_poster(
        user_id, project_id, final_video_id, final_filename,
    )
    if not stored:
        raise HTTPException(
            status_code=500, detail="Failed to regenerate the auto/marker cover image"
        )

    # Report the resulting source so the client updates from the response (not
    # optimistically): 'overlay' when the project still carries a marker, else
    # 'auto'. Mirrors generate_poster_at_export's own source decision.
    poster_source = (
        "overlay" if get_project_poster_marker_time(project_id) is not None else "auto"
    )
    return JSONResponse(
        {"success": True, "poster_filename": stored, "poster_source": poster_source}
    )


# =============================================================================
# Modal GPU Rendering Endpoints
# =============================================================================


class OverlayRenderRequest(BaseModel):
    """Request body for Modal-based overlay render."""
    project_id: int
    export_id: str
    effect_type: str = "dark_overlay"


def _cv2_probe_local_dims(path) -> tuple[int, int] | None:
    """cv2 probe of a LOCAL file path. Returns None (never raises) on any
    failure so the caller can fall through to the R2 probe below."""
    import cv2

    if not path.exists():
        return None
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            return None
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        cap.release()
    return (width, height) if width > 0 and height > 0 else None


def _ffprobe_remote_dims(url: str) -> tuple[int, int] | None:
    """ffprobe a video stream's width/height via HTTP range requests -- no
    full download needed just to read the header. Mirrors the existing
    `poster.py::_probe_duration` remote-probe pattern. Returns None (never
    raises) on any failure."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        url,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        width_str, height_str = out.stdout.strip().split("x")
        width, height = int(width_str), int(height_str)
        return (width, height) if width > 0 and height > 0 else None
    except Exception as e:
        logger.info(f"[Overlay Text] ffprobe remote dims probe failed: {e}")
        return None


def _probe_working_video_dims(user_id: str, working_filename: str) -> tuple[int, int]:
    """Probe the EXACT frame dims of a working video (T5225 design O3).

    Two-tier probe, NEVER a silent wrong default (CLAUDE.md: no silent
    fallback for internal data -- a wrong dims value would burn mis-scaled
    text into a real export):
      1. Local on-disk copy (`get_working_videos_path()/filename`) via cv2 --
         the fast, common-case path: the SAME pod that just finished framing
         this working video still has it on disk (`storage.upload_to_r2`
         always writes from a local_path before/alongside the R2 upload).
      2. Fall back to the DURABLE R2 copy via a presigned URL + ffprobe (range
         request, no full download) when the local copy is absent -- e.g. a
         different or restarted pod serving this Overlay export request in a
         multi-pod/ephemeral-disk deployment. This is the gap the local-only
         probe missed: the local render loop's OWN cv2 probe is always safe
         because it reads a copy it JUST downloaded itself; this producer runs
         BEFORE either render loop's own download, so it cannot assume that.
    Raises only when BOTH tiers fail -- never silently defaults.
    """
    from ...database import get_working_videos_path

    wv_path = get_working_videos_path() / working_filename
    dims = _cv2_probe_local_dims(wv_path)
    if dims:
        return dims

    url = generate_presigned_url(user_id, f"working_videos/{working_filename}")
    if url:
        dims = _ffprobe_remote_dims(url)
        if dims:
            return dims

    raise RuntimeError(
        f"[Overlay Text] could not determine working video dims for "
        f"{working_filename} -- no local copy and R2 probe failed/unavailable"
    )


def _flatten_text_regions(text_overlays: list) -> list:
    """Flatten text REGIONS into the flat per-ELEMENT block shape the render
    pipeline already understands (T6630 round 4 -- a region is a time span
    containing N elements that render simultaneously; the renderer only ever
    knows how to draw ONE spec at a time). Each element becomes an individual
    block carrying its REGION's timing: `{spec, startTime, endTime, enabled}`
    -- exactly the shape `_rasterize_text_layers` consumed BEFORE the
    region/element reframe, so `text_render.py`/`render_text_layer` and every
    line below this function's call site are UNCHANGED. This is the ONE
    flatten point; nothing downstream needs to know regions exist.
    """
    flat = []
    for region in text_overlays or []:
        start = region.get('startTime')
        end = region.get('endTime')
        for element in region.get('elements', []):
            flat.append({
                'spec': element.get('spec'),
                'startTime': start,
                'endTime': end,
                'enabled': element.get('enabled', True),
            })
    return flat


def _rasterize_text_layers(user_id: str, text_overlays: list, working_filename: str) -> list:
    """Rasterise each ENABLED text ELEMENT ONCE at the working video's exact
    frame dims (design SS6.1/SS6.2) and PNG-encode it, so both render loops
    (Modal + local) blend IDENTICAL bytes -- never re-rasterising per frame.

    `text_overlays` arrives as REGIONS (T6630 round 4); `_flatten_text_regions`
    unwraps them into the SAME flat per-block shape this function always
    consumed, so everything below is untouched.

    Runs app-side (this process can import Pillow/text_render; the Modal image
    cannot) so the Modal boundary only ever needs `cv2.imdecode` -- no Pillow
    install, no inline-renderer mirror, no second parity surface (design SS6.1,
    O5's precedent from spotlight_reveal).
    """
    from io import BytesIO

    from ...schemas import TextSpec
    from ...services.text_render import render_text_layer

    text_overlays = _flatten_text_regions(text_overlays)
    enabled = [b for b in text_overlays if b.get('enabled', True)]
    if not enabled:
        return []

    width, height = _probe_working_video_dims(user_id, working_filename)
    layers = []
    for block in enabled:
        spec = TextSpec(**block['spec'])
        img = render_text_layer(spec, width, height)  # RGBA PIL.Image, content-hash cached
        buf = BytesIO()
        img.save(buf, format='PNG')
        layers.append({
            'startTime': block['startTime'],
            'endTime': block['endTime'],
            'png': buf.getvalue(),
        })
    logger.info(f"[Overlay Text] Rasterised {len(layers)} text layer(s) at {width}x{height}")
    return layers


async def _run_overlay_export_background(
    export_id: str,
    project_id: int,
    project_name: str,
    user_id: str,
    profile_id: str,
    working_filename: str,
    highlight_regions: list,
    effect_type: str,
    video_duration: float,
    overlay_settings: dict | None = None,
    text_overlays: list | None = None,
):
    """
    Run overlay export in background via asyncio.create_task.
    Routes to Modal or local automatically via call_modal_overlay_auto.
    All progress is reported via WebSocket.
    """
    try:
        from app.services.export_helpers import create_progress_callback, send_progress
        from app.services.export_helpers import store_modal_call_id as store_call_id

        logger.info(f"[Overlay Background] Starting export for project {project_id}")

        await send_progress(
            export_id, 5, 100, 'processing', 'Starting export...',
            'overlay', project_id=project_id, project_name=project_name
        )

        output_filename = f"final_{project_id}_{uuid.uuid4().hex[:8]}.mp4"

        progress_callback = create_progress_callback(
            export_id, 'overlay',
            project_id=project_id, project_name=project_name
        )

        def modal_call_id_callback(modal_call_id: str):
            store_call_id(export_id, modal_call_id)

        # T5225: rasterise ONCE per spec here (app-side, Pillow-capable), before
        # dispatching to either render loop. Runs in a thread so a slow Pillow
        # render/word-wrap pass never blocks the event loop.
        text_layers = await asyncio.to_thread(
            _rasterize_text_layers, user_id, text_overlays or [], working_filename
        )

        result = await call_modal_overlay_auto(
            job_id=export_id,
            user_id=user_id,
            input_key=f"working_videos/{working_filename}",
            output_key=f"final_videos/{output_filename}",
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            video_duration=video_duration,
            progress_callback=progress_callback,
            call_id_callback=modal_call_id_callback,
            overlay_settings=overlay_settings,
            profile_id=profile_id,
            text_layers=text_layers,
        )

        if result.get("status") != "success":
            error = result.get("error", "Unknown error")
            raise RuntimeError(f"Overlay processing failed: {error}")

        await send_progress(
            export_id, 95, 100, 'finalizing', 'Saving to library...',
            'overlay', project_id=project_id, project_name=project_name
        )

        parallel_used = result.get("parallel", False)
        logger.info(f"[Overlay Background] Processing complete (parallel={parallel_used})")

        _t0 = time_module.monotonic()
        final_video_id, slowmo_section, final_duration, poster_marker_time = await asyncio.to_thread(
            _finalize_overlay_export,
            project_id, output_filename, export_id, user_id,
            gpu_seconds=result.get("gpu_seconds"), modal_function=result.get("modal_function"),
        )
        logger.info(f"[T1110] _finalize_overlay_export (background) took {time_module.monotonic() - _t0:.2f}s (threaded)")

        # T5410: capture the poster AFTER finalize, BEFORE the sync barrier below,
        # so poster_filename/_frame_time/_source ride the same durable R2 sync.
        # Best-effort/never-raises -- poster failure must never fail export.
        await generate_poster_at_export(
            user_id, final_video_id, output_filename,
            slowmo_section, final_duration, poster_marker_time,
        )

        # T4110: DURABLE BOUNDARY. The new final_videos/export_jobs rows are
        # committed only to the LOCAL profile.sqlite; a single Fly machine that
        # cycles before they reach R2 loses the re-export (prod project 46). Push
        # them to R2 (blocking, never deferring) BEFORE announcing completion, and
        # GATE the COMPLETE event on that sync. On failure, emit a retryable
        # sync_failed completion (the WebSocket analog of T4050's 503) instead of a
        # lying "Export complete", so the client offers Retry — not Move-to-My-Reels.
        from app.services.export_helpers import sync_export_db_to_r2
        synced = await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id)
        if synced:
            complete_data = {
                "progress": 100,
                "message": "Export complete!",
                "status": ExportStatus.COMPLETE,
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay",
                "finalVideoId": final_video_id,
                "finalFilename": output_filename
            }
        else:
            complete_data = _export_sync_failed_data('overlay', project_id, project_name)
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        logger.info(
            f"[Overlay Background] {'Complete' if synced else 'SYNC FAILED (retryable)'}: "
            f"final_video_id={final_video_id} project={project_id}"
        )

    except Exception as e:
        logger.error(f"[Overlay Background] Failed: {e}", exc_info=True)

        # Update export_jobs to error
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (str(e)[:500], export_id))
                conn.commit()
        except Exception:
            pass

        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {e}",
            export_type='overlay',
            project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        # The error path committed an export_jobs='error' row locally; persist it.
        # (Success-path sync happens above, gated, before COMPLETE is announced.)
        from app.services.export_helpers import sync_export_db_to_r2
        await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id)


@router.post("/render-overlay")
async def render_overlay(request: OverlayRenderRequest, http_request: Request):
    """
    Render overlay export using Modal GPU (or local fallback).

    This endpoint reads highlight data from the database and renders
    the overlay on the project's working video.

    When Modal is enabled:
    - Video stays in R2 (no download to backend)
    - Modal downloads, processes, uploads result
    - Much faster for cloud deployments

    When Modal is disabled:
    - Falls back to local processing

    Steps:
    1. Validate project has working_video
    2. Get highlight regions from working_video overlay_data
    3. Call Modal (or local) to process
    4. Save final_video and update project
    """
    project_id = request.project_id
    export_id = request.export_id
    effect_type = request.effect_type

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    logger.info(f"[Overlay Render] Starting for project {project_id}, user: {user_id}, Modal: {modal_enabled()}")

    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 5,
        "message": "Validating project...",
        "status": "processing"
    }

    # Get project info and working video
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT p.id, p.name, p.working_video_id,
                   wv.filename as working_filename,
                   wv.highlights_data, wv.text_overlays, wv.effect_type, wv.highlight_color, wv.duration,
                   wv.highlight_shape, wv.stroke_width, wv.fill_enabled, wv.fill_opacity, wv.dim_strength
            FROM projects p
            JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found or has no working video")

        from app.services.export_helpers import derive_project_name
        project_name = derive_project_name(project_id, cursor) or project['name']

        working_filename = project['working_filename']

        video_duration = project['duration'] if project['duration'] else None

        overlay_settings = {
            'highlight_shape': project['highlight_shape'] or 'body',
            'stroke_width': project['stroke_width'],
            'fill_enabled': bool(project['fill_enabled']),
            'fill_opacity': project['fill_opacity'],
            'dim_strength': project['dim_strength'],
        }

        # Create export_jobs record
        try:
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'overlay', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        except Exception as e:
            logger.warning(f"[Overlay Render] Failed to create export_jobs record: {e}")

    # Parse highlight regions and normalize to canonical snake_case keys.
    # T4900: the Modal renderer reads region["start_time"] directly (KeyError
    # on a camelCase-only blob). create_region/update_region write canonical
    # snake_case since T7180, so this is now read-side back-compat for rows
    # written before T7180 rather than the primary defense — kept as the
    # single DB-read boundary so both the local and Modal paths stay covered
    # without touching the stored blob.
    highlight_regions = []
    if project['highlights_data']:
        try:
            highlight_regions = [
                _normalize_region_keys(r)
                for r in (decode_data(project['highlights_data']) or [])
            ]
            # DEBUG: Log what we loaded from database
            logger.info(f"[Overlay Render] DEBUG - Loaded highlights_data from DB: {len(project['highlights_data'])} chars")
            if highlight_regions and highlight_regions[0].get('keyframes'):
                first_kf = highlight_regions[0]['keyframes'][:3]
                logger.info(f"[Overlay Render] DEBUG - First region keyframes sample: {first_kf}")
        except Exception as e:
            logger.error(f"[Overlay Render] DEBUG - decode error: {e}")
    else:
        logger.warning("[Overlay Render] DEBUG - highlights_data is empty/None!")

    # T5225: text overlay blocks for this render. Read-only for render input (not
    # a persist path -- a decode failure here can't destroy stored data), so this
    # mirrors the existing highlights_data style in THIS function (log + continue)
    # rather than the action handler's raise-never-erase rule (_get_text_overlays).
    text_overlays = []
    if project['text_overlays']:
        try:
            text_overlays = decode_data(project['text_overlays']) or []
        except Exception as e:
            logger.error(f"[Overlay Render] text_overlays decode error: {e}")

    # Apply global highlight_color to all keyframes if set
    # This allows users to change the highlight color without re-editing each keyframe
    # `in row` checks VALUES not column names for sqlite3.Row -- `.keys()` required.
    global_highlight_color = project['highlight_color'] if 'highlight_color' in project.keys() else None  # noqa: SIM118
    if global_highlight_color:
        logger.info(f"[Overlay Render] Applying global highlight color: {global_highlight_color}")
        for region in highlight_regions:
            for keyframe in region.get('keyframes', []):
                keyframe['color'] = global_highlight_color

    # Use saved effect_type if not specified
    logger.info(f"[Overlay Render] DEBUG - effect_type from request: {effect_type}, from DB: {project['effect_type']}")
    if not effect_type and project['effect_type']:
        effect_type = project['effect_type']
    effect_type = effect_type or "dark_overlay"

    # Always use sequential processing (parallel costs 3-4x more per E7 experiment)
    logger.info(f"[Overlay Render] Working video: {working_filename}, {len(highlight_regions)} regions, effect: {effect_type}")
    logger.info(f"[Overlay Render] Duration: {video_duration}s, Config: sequential (1 GPU)")

    # Check if we actually need overlay processing
    # Skip Modal/GPU if there are no highlight regions with keyframes to render
    has_keyframes = any(
        region.get('keyframes') and len(region.get('keyframes', [])) > 0
        for region in highlight_regions
    )
    # T5225: a project with text but no highlight keyframes must NOT take
    # the no-keyframes copy shortcut below -- that path R2-copies the working
    # video verbatim and would silently drop the text (the bug the design's
    # audit found, SS6.5). T6630 round 4: `text_overlays` is now REGIONS, and
    # a region itself carries no `enabled` key (only its ELEMENTS do) -- so
    # this must check the FLATTENED elements, or `.get('enabled', True)`
    # would default every region to enabled=True regardless of whether every
    # element inside it is actually disabled. Reuses the SAME flatten helper
    # _rasterize_text_layers uses, so both readers agree on "is there
    # anything to draw."
    has_text = any(el.get('enabled', True) for el in _flatten_text_regions(text_overlays))

    # A region the user ENABLED but that carries no keyframes renders nothing,
    # so the export silently drops a spotlight the editor was showing. Regions
    # created before create_region persisted its seed keyframes are stored that
    # way; they heal on the user's next keyframe edit, but until then this is
    # the only place the discrepancy is observable. Surface it.
    for region in highlight_regions:
        if not region.get('enabled', True):
            continue
        if not region.get('keyframes'):
            logger.warning(
                f"[Overlay Render] Enabled region {region.get('id')} has NO keyframes - "
                f"nothing will be drawn for it (pre-fix create_region data)"
            )
            continue
        # T7180 (prod bug 44p): a region can have keyframes yet still render
        # nothing if its bounds are inverted (start >= end) or if every
        # keyframe falls outside the current [start, end] window -- both are
        # silent (export still completes 200/success) and were previously
        # only discoverable by reading raw DB state. Log loudly; do not
        # self-repair the bounds here (that would mask the real write-site
        # bug for whichever caller produced them).
        r_start, r_end = _region_bounds(region)
        if r_start >= r_end:
            logger.error(
                f"[Overlay Render] CRITICAL: enabled region {region.get('id')} has "
                f"inverted bounds start={r_start} end={r_end} - nothing will be drawn for it"
            )
        elif not _keyframes_within_bounds(region):
            logger.error(
                f"[Overlay Render] CRITICAL: enabled region {region.get('id')} "
                f"[{r_start}, {r_end}] has {len(region['keyframes'])} keyframe(s) but "
                f"NONE fall within its bounds - nothing will be drawn for it"
            )

    if not has_keyframes and not has_text:
        # No overlays to render - just copy working video to final video
        logger.info("[Overlay Render] Skipping GPU processing (no keyframes or text to render)")
        logger.info("[Overlay Render] Copying working video to final video directly")

        progress_data = {
            "progress": 50,
            "message": "Copying video...",
            "status": "processing",
            "projectId": project_id,
            "projectName": project_name,
            "type": "overlay"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        try:
            from app.services.export_helpers import send_progress
            from app.storage import copy_file_in_r2

            # Generate output filename and copy in R2
            output_filename = f"final_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
            source_key = f"working_videos/{working_filename}"
            dest_key = f"final_videos/{output_filename}"

            await copy_file_in_r2(user_id, source_key, dest_key)
            logger.info(f"[Overlay Render] Copied {source_key} -> {dest_key}")

            # Send progress update
            await send_progress(
                export_id, 95, 100, 'finalizing', 'Saving to library...',
                'overlay', project_id=project_id, project_name=project_name
            )

            _t0 = time_module.monotonic()
            final_video_id, slowmo_section, final_duration, poster_marker_time = await asyncio.to_thread(
                _finalize_overlay_export, project_id, output_filename, export_id, user_id
            )
            logger.info(f"[T1110] _finalize_overlay_export (no GPU) took {time_module.monotonic() - _t0:.2f}s (threaded)")
            logger.info(f"[Overlay Render] Complete (no GPU): final_video_id={final_video_id}")

            # T5410: capture the poster AFTER finalize, BEFORE the sync barrier below.
            await generate_poster_at_export(
                user_id, final_video_id, output_filename,
                slowmo_section, final_duration, poster_marker_time,
            )

            # T4110: durable boundary — sync the new final_videos row to R2 before
            # announcing completion; on failure return 503 (+ retryable WS event).
            from app.services.export_helpers import sync_export_db_to_r2
            if not await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id):
                sync_failed = _export_sync_failed_data('overlay', project_id, project_name)
                export_progress[export_id] = sync_failed
                await manager.send_progress(export_id, sync_failed)
                return JSONResponse(status_code=503, content=DURABLE_SYNC_FAILED_RESPONSE)

            # Send final completion
            completion_data = {
                "progress": 100,
                "status": "complete",
                "message": "Export complete (no overlay effect)",
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay"
            }
            export_progress[export_id] = completion_data
            await manager.send_progress(export_id, completion_data)

            return JSONResponse({
                "status": "success",
                "final_video_id": final_video_id,
                "filename": output_filename,
                "modal_used": False,
                "parallel_used": False,
                "skipped_processing": True
            })

        except Exception as e:
            logger.error(f"[Overlay Render] Copy failed: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to copy video: {e}") from e

    # Check for E2E test mode - skip full overlay rendering, just copy working video as final
    is_test_mode = http_request.headers.get('X-Test-Mode', '').lower() == 'true'

    if is_test_mode and not modal_enabled():
        logger.info("[Overlay Render] TEST MODE: Skipping overlay rendering, copying working video as final")

        try:
            from app.services.export_helpers import send_progress
            from app.storage import copy_file_in_r2

            # Generate output filename and copy in R2
            output_filename = f"final_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
            source_key = f"working_videos/{working_filename}"
            dest_key = f"final_videos/{output_filename}"

            await send_progress(
                export_id, 50, 100, 'processing', 'Test mode: copying video...',
                'overlay', project_id=project_id, project_name=project_name
            )

            await copy_file_in_r2(user_id, source_key, dest_key)
            logger.info(f"[Overlay Render] TEST MODE: Copied {source_key} -> {dest_key}")

            await send_progress(
                export_id, 95, 100, 'finalizing', 'Saving to library...',
                'overlay', project_id=project_id, project_name=project_name
            )

            _t0 = time_module.monotonic()
            final_video_id, slowmo_section, final_duration, poster_marker_time = await asyncio.to_thread(
                _finalize_overlay_export, project_id, output_filename, export_id, user_id
            )
            logger.info(f"[T1110] _finalize_overlay_export (test mode) took {time_module.monotonic() - _t0:.2f}s (threaded)")
            logger.info(f"[Overlay Render] TEST MODE complete: final_video_id={final_video_id}")

            # T5410: capture the poster AFTER finalize, BEFORE the sync barrier below.
            await generate_poster_at_export(
                user_id, final_video_id, output_filename,
                slowmo_section, final_duration, poster_marker_time,
            )

            # T4110: durable boundary — sync the new final_videos row to R2 before
            # announcing completion; on failure return 503 (+ retryable WS event).
            from app.services.export_helpers import sync_export_db_to_r2
            if not await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id):
                sync_failed = _export_sync_failed_data('overlay', project_id, project_name)
                export_progress[export_id] = sync_failed
                await manager.send_progress(export_id, sync_failed)
                return JSONResponse(status_code=503, content=DURABLE_SYNC_FAILED_RESPONSE)

            # Send final completion via WebSocket
            completion_data = {
                "progress": 100,
                "status": "complete",
                "message": "Export complete (test mode)",
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay"
            }
            export_progress[export_id] = completion_data
            await manager.send_progress(export_id, completion_data)

            return JSONResponse({
                "status": "success",
                "final_video_id": final_video_id,
                "filename": output_filename,
                "modal_used": False,
                "parallel_used": False,
                "test_mode": True
            })

        except Exception as e:
            logger.error(f"[Overlay Render] TEST MODE failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Test mode overlay export failed: {e}") from e

    # Always run in background so the per-user write lock is released immediately.
    # All progress is reported via WebSocket (export_progress/manager), not the
    # task's return value, so this is deliberately fire-and-forget -- no result
    # to await, no reference needed at this call site.
    asyncio.create_task(  # noqa: RUF006
        _run_overlay_export_background(
            export_id=export_id,
            project_id=project_id,
            project_name=project_name,
            user_id=user_id,
            profile_id=profile_id,
            working_filename=working_filename,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            video_duration=video_duration,
            overlay_settings=overlay_settings,
            text_overlays=text_overlays,
        )
    )
    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "export_id": export_id}
    )
