"""
Overlay mode export endpoints.

This module handles exports related to the Overlay editing mode:
- /overlay - Apply highlight overlays to video
- /final - Save final video to project
- /projects/{id}/final-video - Stream final video
- /projects/{id}/overlay-data - Save/get overlay editing state

These endpoints handle highlight regions, effect types, and final output.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import Dict, Any
import json
import os
import re
import tempfile
import uuid
import subprocess
import logging

from ...websocket import export_progress, manager
from ...database import get_db_connection, get_final_videos_path, get_highlights_path, get_raw_clips_path, get_uploads_path
from ...highlight_transform import (
    transform_all_regions_to_raw,
    transform_all_regions_to_working,
)
from ...services.image_extractor import (
    extract_player_images_for_region,
    list_highlight_images,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/overlay")
async def export_overlay_only(
    video: UploadFile = File(...),
    export_id: str = Form(...),
    highlight_regions_json: str = Form(None),
    highlight_keyframes_json: str = Form(None),  # Legacy format (deprecated)
    highlight_effect_type: str = Form("original"),
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
                {"time": 0, "x": 100, "y": 200, "radiusX": 50, "radiusY": 80, "opacity": 0.15, "color": "#FFFF00"},
                ...
            ]
        },
        ...
    ]
    """
    import cv2
    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting overlay export...",
        "status": "processing"
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
                            'opacity': kf['opacity'],
                            'color': kf['color']
                        }
                        for kf in region.get('keyframes', [])
                    ]
                })
            logger.info(f"[Overlay Export] Received {len(highlight_regions)} highlight regions:")
            for region in highlight_regions:
                logger.info(f"  Region {region['id']}: {region['start_time']:.2f}s - {region['end_time']:.2f}s, {len(region['keyframes'])} keyframes")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {str(e)}")
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
                    'opacity': kf['opacity'],
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
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"overlay_{uuid.uuid4().hex}.mp4")
    frames_dir = os.path.join(temp_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Update progress
        progress_data = {"progress": 10, "message": "Processing video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        logger.info(f"[Overlay Export] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

        # Fast path: no highlights
        if not highlight_regions:
            cap.release()
            logger.info("[Overlay Export] No highlights - copying video directly")
            import shutil
            shutil.copy(input_path, output_path)

            progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            return FileResponse(
                output_path,
                media_type='video/mp4',
                filename=f"overlayed_{video.filename}",
                background=None
            )

        # Process all frames with highlights
        video_duration = frame_count / fps
        logger.info(f"[Overlay Export] Video duration: {video_duration:.3f}s")

        # Sort regions by start time for efficient lookup
        sorted_regions = sorted(highlight_regions, key=lambda r: r['start_time'])

        # Process all frames
        logger.info(f"[Overlay Export] Processing {frame_count} frames...")

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                if region['start_time'] <= current_time <= region['end_time']:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                highlight = KeyframeInterpolator.interpolate_highlight(active_region['keyframes'], current_time)
                if highlight is not None:
                    frame = KeyframeInterpolator.render_highlight_on_frame(
                        frame,
                        highlight,
                        (width, height),
                        crop=None,
                        effect_type=highlight_effect_type
                    )

            # Write frame
            frame_path = os.path.join(frames_dir, f"frame_{frame_idx:06d}.png")
            cv2.imwrite(frame_path, frame)
            frame_idx += 1

            # Update progress
            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 60)
                progress_data = {
                    "progress": progress,
                    "message": f"Processing frames... {frame_idx}/{frame_count}",
                    "status": "processing"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

        cap.release()
        logger.info(f"[Overlay Export] Rendered {frame_idx} frames")

        # Encode final video with audio from original
        progress_data = {"progress": 75, "message": "Encoding video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Calculate exact video duration based on frame count to preserve all frames
        video_duration = frame_idx / fps
        logger.info(f"[Overlay Export] Final frame count: {frame_idx}, duration: {video_duration:.6f}s")

        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', os.path.join(frames_dir, 'frame_%06d.png'),
            '-i', input_path,
            '-map', '0:v',
            '-map', '1:a?',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-t', str(video_duration),  # Use explicit duration instead of -shortest to preserve all frames
            output_path
        ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"[Overlay Export] Encoding error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"FFmpeg encoding failed: {result.stderr}")

        # Complete
        progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
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

    except HTTPException:
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
        logger.error(f"[Overlay Export] Failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
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
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {str(e)}")


@router.post("/final")
async def export_final(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    overlay_data: str = Form("{}")
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
        overlay_config = json.loads(overlay_data)
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

        # Generate filename using project name
        project_name = project['name'] or f"project_{project_id}"
        safe_name = re.sub(r'[^\w\s-]', '', project_name).strip()
        safe_name = re.sub(r'[\s]+', '_', safe_name)
        if not safe_name:
            safe_name = f"project_{project_id}"

        # Check for existing file and add version suffix if needed
        base_filename = f"{safe_name}_final"
        filename = f"{base_filename}.mp4"
        file_path = get_final_videos_path() / filename
        version_suffix = 1
        while file_path.exists():
            version_suffix += 1
            filename = f"{base_filename}_{version_suffix}.mp4"
            file_path = get_final_videos_path() / filename

        # Save the video file
        content = await video.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"[Final Export] Saved final video: {filename} ({len(content)} bytes)")

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

        # Create new final video entry with version number and source_type
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version, source_type)
            VALUES (?, ?, ?, ?)
        """, (project_id, filename, next_version, source_type))
        final_video_id = cursor.lastrowid
        logger.info(f"[Final Export] Created final video id={final_video_id} with source_type={source_type}")

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

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
                    segments = json.loads(wc['segments_data'])
                    trim_range = segments.get('trimRange')
                    if trim_range:
                        start_frame = int(trim_range.get('start', 0) * framerate)
                        end_frame = int(trim_range.get('end', 0) * framerate)
                    elif segments.get('boundaries'):
                        # No trim, use full clip from boundaries
                        boundaries = segments['boundaries']
                        if len(boundaries) >= 2:
                            end_frame = int(boundaries[-1] * framerate)
                except json.JSONDecodeError:
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

        return JSONResponse({
            'success': True,
            'final_video_id': final_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/final-video")
async def get_final_video(project_id: int):
    """Stream the final video for a project."""
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

        file_path = get_final_videos_path() / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )


@router.put("/projects/{project_id}/overlay-data")
async def save_overlay_data(
    project_id: int,
    highlights_data: str = Form("[]"),
    text_overlays: str = Form("[]"),
    effect_type: str = Form("original")
):
    """
    Save overlay editing state for a project.

    Called by frontend auto-save when user modifies highlights in Overlay mode.
    Saves to working_videos table for the project's current working video.

    Also transforms and saves highlight data to source raw_clips for cross-project
    reuse. The transformation converts from working video space to raw clip space,
    accounting for crop, trim, and speed changes.

    Request (form data):
    - highlights_data: JSON string of highlight regions
    - text_overlays: JSON string of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'

    Response:
    - success: boolean
    - saved_at: timestamp
    - raw_clips_updated: number of raw clips updated with defaults
    """
    logger.info(f"[Overlay Data] Saving for project {project_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project's current working video
        cursor.execute("""
            SELECT working_video_id FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project has no working video - complete framing first"
            )

        # Update working video with overlay data
        cursor.execute("""
            UPDATE working_videos
            SET highlights_data = ?,
                text_overlays = ?,
                effect_type = ?
            WHERE id = ?
        """, (highlights_data, text_overlays, effect_type, project['working_video_id']))

        # Transform and save highlight data to source raw_clips
        raw_clips_updated = 0

        if highlights_data and highlights_data != "[]":
            try:
                regions = json.loads(highlights_data)

                if regions:
                    raw_clips_updated = await _save_highlights_to_raw_clips(
                        project_id=project_id,
                        regions=regions,
                        cursor=cursor
                    )
            except json.JSONDecodeError as e:
                logger.warning(f"[Overlay Data] Failed to parse highlights: {e}")

        conn.commit()

        logger.info(f"[Overlay Data] Saved for working_video {project['working_video_id']}, "
                   f"updated {raw_clips_updated} raw_clips")

        return JSONResponse({
            'success': True,
            'saved_at': datetime.now().isoformat(),
            'working_video_id': project['working_video_id'],
            'raw_clips_updated': raw_clips_updated
        })


async def _save_highlights_to_raw_clips(
    project_id: int,
    regions: list,
    cursor
) -> int:
    """
    Transform highlight regions to raw clip space and save to raw_clips.

    Returns the number of raw clips updated.
    """
    # Get working clips with framing data and raw clip info
    cursor.execute("""
        SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
               rc.filename as raw_filename
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
    """, (project_id,))

    working_clips = cursor.fetchall()

    if not working_clips:
        logger.info("[Overlay Data] No working clips with raw_clip_id found")
        return 0

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
        # Try to get actual dimensions from the working video file
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

    logger.info(f"[Overlay Data] Working video dimensions: {working_video_dims}")

    clips_updated = 0

    for clip in working_clips:
        raw_clip_id = clip['raw_clip_id']
        raw_filename = clip['raw_filename']

        # Parse framing data
        crop_keyframes = []
        segments_data = {}

        if clip['crop_data']:
            try:
                crop_keyframes = json.loads(clip['crop_data'])
            except json.JSONDecodeError:
                pass

        if clip['segments_data']:
            try:
                segments_data = json.loads(clip['segments_data'])
            except json.JSONDecodeError:
                pass

        # Transform regions to raw clip space
        raw_regions = transform_all_regions_to_raw(
            regions=regions,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=30.0
        )

        if not raw_regions:
            logger.info(f"[Overlay Data] No regions transformed for raw_clip {raw_clip_id}")
            continue

        # Extract player images for each region
        raw_clip_path = get_raw_clips_path() / raw_filename

        for region in raw_regions:
            if raw_clip_path.exists():
                region['keyframes'] = extract_player_images_for_region(
                    video_path=str(raw_clip_path),
                    raw_clip_id=raw_clip_id,
                    keyframes=region['keyframes'],
                    framerate=30.0
                )

        # Save to raw_clips
        cursor.execute("""
            UPDATE raw_clips
            SET default_highlight_regions = ?
            WHERE id = ?
        """, (json.dumps(raw_regions), raw_clip_id))

        clips_updated += 1
        logger.info(f"[Overlay Data] Saved {len(raw_regions)} regions to raw_clip {raw_clip_id}")

    return clips_updated


async def _load_highlights_from_raw_clips(project_id: int, cursor) -> list:
    """
    Load highlight regions from raw_clips and transform to working video space.

    Returns transformed highlight regions ready for the current project's framing.
    """
    # Get working clips with framing data and raw clip defaults
    cursor.execute("""
        SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
               rc.default_highlight_regions
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ?
          AND rc.default_highlight_regions IS NOT NULL
          AND rc.default_highlight_regions != '[]'
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

    for clip in working_clips:
        # Parse raw clip default highlights
        raw_regions = []
        if clip['default_highlight_regions']:
            try:
                raw_regions = json.loads(clip['default_highlight_regions'])
            except json.JSONDecodeError:
                continue

        if not raw_regions:
            continue

        # Parse framing data
        crop_keyframes = []
        segments_data = {}

        if clip['crop_data']:
            try:
                crop_keyframes = json.loads(clip['crop_data'])
            except json.JSONDecodeError:
                pass

        if clip['segments_data']:
            try:
                segments_data = json.loads(clip['segments_data'])
            except json.JSONDecodeError:
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
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'
    - has_data: boolean indicating if any data exists
    - from_raw_clip: boolean indicating if data came from raw_clip defaults
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest working video's overlay data for this project
        cursor.execute("""
            SELECT highlights_data, text_overlays, effect_type
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        # Parse project-specific overlay data
        highlights = []
        text_overlays = []
        effect_type = 'original'
        from_raw_clip = False

        if result:
            if result['highlights_data']:
                try:
                    highlights = json.loads(result['highlights_data'])
                except json.JSONDecodeError:
                    pass

            if result['text_overlays']:
                try:
                    text_overlays = json.loads(result['text_overlays'])
                except json.JSONDecodeError:
                    pass

            effect_type = result['effect_type'] or 'original'

        # If no project-specific highlights, check raw_clips for defaults
        if not highlights:
            highlights = await _load_highlights_from_raw_clips(project_id, cursor)
            if highlights:
                from_raw_clip = True
                logger.info(f"[Overlay Data] Using default highlights from raw_clip for project {project_id}")

        return JSONResponse({
            'highlights_data': highlights,
            'text_overlays': text_overlays,
            'effect_type': effect_type,
            'has_data': len(highlights) > 0 or len(text_overlays) > 0,
            'from_raw_clip': from_raw_clip
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

    highlights_dir = get_highlights_path()
    file_path = highlights_dir / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(
        path=str(file_path),
        media_type="image/png",
        filename=filename
    )


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
