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
import os
import re
import subprocess
import tempfile
import threading
import time as time_module
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from ...middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync

# Thread pool for CPU-intensive frame processing (prevents blocking event loop)
_frame_processor_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="overlay_")

from ...constants import DEFAULT_HIGHLIGHT_EFFECT, ExportStatus, normalize_effect_type
from ...database import (
    get_db_connection,
    get_raw_clips_path,
    get_uploads_path,
)
from ...highlight_transform import (
    transform_all_regions_to_working,
)
from ...profile_context import get_current_profile_id
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
    first_slowmo_section,
    load_project_clip_segments,
    read_clip_segments_for_project,
)
from ...storage import (
    delete_from_r2,
    generate_presigned_url,
    upload_bytes_to_r2,
)
from ...user_context import get_current_user_id
from ...utils.encoding import decode_data, encode_data
from ...websocket import export_progress, manager

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
    gpu_seconds: float = None,
    modal_function: str = None,
) -> int:
    """Save final_videos record, update project, update export_jobs, archive.

    Shared by all overlay export completion paths (no-keyframes copy, local,
    Modal GPU, test mode). Returns the final_video_id.
    """
    # T5280: the poster (og:image JPEG) is NO LONGER extracted here. Its only
    # consumers are share links, which can't exist before publish, so the ~5-seek
    # ffmpeg capture moved to the "Move to My Reels" gesture (downloads.py
    # publish_to_my_reels). A draft that never publishes now pays nothing.
    # T5090 (KEPT): still compute the reel's first slow-mo section from the
    # project's ordered working clips and FREEZE it onto the final_videos row --
    # this is cheap (no ffmpeg) and is the durable source of truth publish/backfill
    # read after the publish-time working_clips prune. poster_filename is left NULL
    # here; publish fills it.
    slowmo_section = first_slowmo_section(load_project_clip_segments(project_id))
    slowmo_start = slowmo_section[0] if slowmo_section else None
    slowmo_end = slowmo_section[1] if slowmo_section else None

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T4010: capture the PRIOR final the project currently points at so we can
        # atomically swap to the new version and clean up the old one after commit.
        cursor.execute("""
            SELECT fv.id, fv.filename
            FROM projects p JOIN final_videos fv ON fv.id = p.final_video_id
            WHERE p.id = ?
        """, (project_id,))
        prior = cursor.fetchone()
        prior_final_id = prior['id'] if prior else None
        prior_filename = prior['filename'] if prior else None
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

        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version, source_type, name,
                duration, aspect_ratio, tags, game_ids, clip_count, quality_score,
                rating, rd, match_count, source_clip_id, clip_start_time, clip_game_start_time,
                poster_filename, slowmo_section_start, slowmo_section_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        """, (project_id, output_filename, next_version, source_type, fv_name,
              duration, aspect_ratio, tags_blob, game_ids_blob, clip_count, quality_score,
              rating, rd, source_clip_id, clip_start_time, clip_game_start_time, None,
              slowmo_start, slowmo_end))
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

        conn.commit()

    # T4010: only after the swap is committed, best-effort delete the prior object.
    if not keep_prior:
        _delete_prior_final_object(user_id, prior_filename, output_filename)

    from app.analytics import record_milestone
    record_milestone(user_id, "export_completed", {"export_id": export_id, "type": "overlay"})
    record_milestone(user_id, "overlay_exported", {"export_id": export_id, "project_id": project_id})

    return final_video_id


# T4200: the sync_failed payload builder now lives in export_helpers so framing and
# multi-clip share the exact same event shape (no router→router imports). Kept as a
# thin module-local alias so existing overlay call sites read unchanged.
from ...services.export_helpers import export_sync_failed_data as _export_sync_failed_data

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


class OverlayActionData(BaseModel):
    """Data payload for overlay actions. Fields used depend on action type."""
    # Region fields
    region_id: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    enabled: bool | None = None

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

    1. **Region time keys** (T4900): surgical overlay actions (create_region,
       update_region) persist ``startTime``/``endTime``; the framing->overlay
       transform uses ``start_time``/``end_time``. The Modal renderer
       (video_processing.py) uses direct bracket access ``region["start_time"]``,
       so camelCase blobs KeyError in prod. Normalize to snake_case.
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

    Both ``startTime``/``endTime`` (camelCase, action-written) and
    ``start_time``/``end_time`` (snake_case, transform-written) are handled.
    Callers that go through ``render_overlay`` will have already been normalized
    by ``_normalize_region_keys``, so both keys exist; the local renderer keeps
    this helper as defence-in-depth for any caller that bypasses normalization.
    The ``0`` default only applies when BOTH keys are absent (corrupt blob);
    a present-but-None bound surfaces as a TypeError in arithmetic (visible bug).
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

        # Get current overlay data
        highlights, effect_type, highlight_color, working_video_id, version = _get_overlay_data(cursor, project_id)

        if working_video_id is None:
            raise HTTPException(status_code=404, detail="Project not found or has no working video")

        # Future: Check expected_version for conflict detection
        # if action.expected_version is not None and action.expected_version != version:
        #     return JSONResponse(status_code=409, content={
        #         "success": False,
        #         "error": "version_conflict",
        #         "current_version": version,
        #         "message": "Data was modified. Refresh and retry."
        #     })

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
                new_region = {
                    "id": region_id,
                    "startTime": action.data.start_time,
                    "endTime": action.data.end_time or (action.data.start_time + 2.0),
                    "enabled": True,
                    "keyframes": [],
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
                    if action.data.start_time is not None:
                        region['startTime'] = action.data.start_time
                    if action.data.end_time is not None:
                        region['endTime'] = action.data.end_time
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
                    raise ValueError(f"Keyframe at {action.target.keyframe_time}s not found")

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
        except Exception as e:
            error = str(e)
            logger.error(f"[Overlay Action] Error: {error}", exc_info=True)
            return JSONResponse(status_code=500, content={
                "success": False,
                "version": version,
                "error": error,
            })


def _process_frames_to_ffmpeg(
    input_path: str,
    output_path: str,
    highlight_regions: list,
    highlight_effect_type: str,
    progress_callback,
    overlay_settings: dict = None,
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
                    )

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
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {e!s}")
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
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {e!s}")

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
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {e!s}")


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
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid overlay_data JSON")

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

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project must have a working video before final export"
            )

        # T4010: capture the PRIOR final the project points at, to swap atomically
        # and clean up the old version after commit (unless an active share serves it).
        prior_final_id = project['final_video_id']
        prior_filename = None
        if prior_final_id:
            cursor.execute("SELECT filename FROM final_videos WHERE id = ?", (prior_final_id,))
            prior_row = cursor.fetchone()
            prior_filename = prior_row['filename'] if prior_row else None
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

        # Create new final video entry with version number and source_type
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version, source_type, name,
                duration, aspect_ratio, tags, game_ids, clip_count, quality_score,
                rating, rd, match_count, source_clip_id, clip_start_time, clip_game_start_time,
                poster_filename, slowmo_section_start, slowmo_section_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        """, (project_id, filename, next_version, source_type, fv_name,
              duration, aspect_ratio, tags_blob, game_ids_blob, clip_count, quality_score,
              rating, rd, source_clip_id, clip_start_time, clip_game_start_time, None,
              slowmo_start, slowmo_end))
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

        conn.commit()

        logger.info(f"[Final Export] Created final video {final_video_id} for project {project_id}")

    # T4010: only after the swap is committed, best-effort delete the prior object.
    if not keep_prior:
        _delete_prior_final_object(user_id, prior_filename, filename)

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
    - highlights_data: Parsed JSON array of highlight regions
    - text_overlays: Parsed JSON array of text overlay configs
    - effect_type: 'brightness_boost' | 'dark_overlay'
    - highlight_color: Hex color string or null (user's last selected color)
    - has_data: boolean indicating if any data exists
    - from_raw_clip: boolean indicating if data came from raw_clip defaults
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT highlights_data, text_overlays, effect_type, highlight_color, duration,
                   highlight_shape, stroke_width, fill_enabled, fill_opacity, dim_strength
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

        if result:
            if result['highlights_data']:
                try:
                    highlights = decode_data(result['highlights_data'])
                except Exception:
                    pass

            if result['text_overlays']:
                text_overlays = decode_data(result['text_overlays']) or []

            effect_type = normalize_effect_type(result['effect_type'])
            highlight_color = result['highlight_color']
            video_duration = result['duration']
            highlight_shape = result['highlight_shape'] or 'body'
            stroke_width = result['stroke_width']
            fill_enabled = bool(result['fill_enabled'])
            fill_opacity = result['fill_opacity']
            dim_strength = result['dim_strength']

        # If no project-specific highlights, check raw_clips for defaults
        if not highlights:
            highlights = await _load_highlights_from_raw_clips(project_id, cursor)
            if highlights:
                from_raw_clip = True
                logger.info(f"[Overlay Data] Using default highlights from raw_clip for project {project_id}")

        # Diagnostic logging
        total_boxes = sum(len(d.get('boxes', [])) for h in highlights for d in (h.get('detections') or []))
        logger.info(f"[Overlay Data] project={project_id}: {len(highlights)} regions, {total_boxes} detection boxes, duration={video_duration}, from_raw_clip={from_raw_clip}")
        if highlights:
            sample = highlights[0]
            logger.info(f"[Overlay Data] First region: id={sample.get('id')}, detections={len(sample.get('detections', []))}, videoWidth={sample.get('videoWidth')}")

        return JSONResponse({
            'highlights_data': highlights,
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
async def list_highlights(raw_clip_id: int = None):
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
# Modal GPU Rendering Endpoints
# =============================================================================


class OverlayRenderRequest(BaseModel):
    """Request body for Modal-based overlay render."""
    project_id: int
    export_id: str
    effect_type: str = "dark_overlay"


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
    overlay_settings: dict = None,
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
        final_video_id = await asyncio.to_thread(
            _finalize_overlay_export,
            project_id, output_filename, export_id, user_id,
            gpu_seconds=result.get("gpu_seconds"), modal_function=result.get("modal_function"),
        )
        logger.info(f"[T1110] _finalize_overlay_export (background) took {time_module.monotonic() - _t0:.2f}s (threaded)")

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
                   wv.highlights_data, wv.effect_type, wv.highlight_color, wv.duration,
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
    # T4900: create_region/update_region write camelCase startTime/endTime;
    # the Modal renderer reads region["start_time"] directly (KeyError on
    # camelCase blobs). Normalizing here — the single DB-read boundary — fixes
    # both the local and Modal paths without touching the stored blob or the
    # action writer.
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

    # Apply global highlight_color to all keyframes if set
    # This allows users to change the highlight color without re-editing each keyframe
    global_highlight_color = project['highlight_color'] if 'highlight_color' in project.keys() else None
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

    if not has_keyframes:
        # No overlays to render - just copy working video to final video
        logger.info("[Overlay Render] Skipping GPU processing (no keyframes to render)")
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
            final_video_id = await asyncio.to_thread(_finalize_overlay_export, project_id, output_filename, export_id, user_id)
            logger.info(f"[T1110] _finalize_overlay_export (no GPU) took {time_module.monotonic() - _t0:.2f}s (threaded)")
            logger.info(f"[Overlay Render] Complete (no GPU): final_video_id={final_video_id}")

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
            raise HTTPException(status_code=500, detail=f"Failed to copy video: {e}")

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
            final_video_id = await asyncio.to_thread(_finalize_overlay_export, project_id, output_filename, export_id, user_id)
            logger.info(f"[T1110] _finalize_overlay_export (test mode) took {time_module.monotonic() - _t0:.2f}s (threaded)")
            logger.info(f"[Overlay Render] TEST MODE complete: final_video_id={final_video_id}")

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
            raise HTTPException(status_code=500, detail=f"Test mode overlay export failed: {e}")

    # Always run in background so the per-user write lock is released immediately.
    # All progress is reported via WebSocket. call_modal_overlay_auto routes to
    # Modal or local automatically.
    asyncio.create_task(
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
        )
    )
    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "export_id": export_id}
    )
