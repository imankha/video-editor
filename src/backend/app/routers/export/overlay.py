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
from ...database import get_db_connection, FINAL_VIDEOS_PATH

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
        file_path = FINAL_VIDEOS_PATH / filename
        version_suffix = 1
        while file_path.exists():
            version_suffix += 1
            filename = f"{base_filename}_{version_suffix}.mp4"
            file_path = FINAL_VIDEOS_PATH / filename

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

        # Create new final video entry with version number
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version)
            VALUES (?, ?, ?)
        """, (project_id, filename, next_version))
        final_video_id = cursor.lastrowid

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

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

        file_path = FINAL_VIDEOS_PATH / result['filename']
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

    Request (form data):
    - highlights_data: JSON string of highlight regions
    - text_overlays: JSON string of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'

    Response:
    - success: boolean
    - saved_at: timestamp
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

        conn.commit()

        logger.info(f"[Overlay Data] Saved for working_video {project['working_video_id']}")

        return JSONResponse({
            'success': True,
            'saved_at': datetime.now().isoformat(),
            'working_video_id': project['working_video_id']
        })


@router.get("/projects/{project_id}/overlay-data")
async def get_overlay_data(project_id: int):
    """
    Get saved overlay editing state for a project.

    Called by frontend when entering Overlay mode to restore previous edits.

    Response:
    - highlights_data: Parsed JSON array of highlight regions
    - text_overlays: Parsed JSON array of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'
    - has_data: boolean indicating if any data exists
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

        if not result:
            return JSONResponse({
                'highlights_data': [],
                'text_overlays': [],
                'effect_type': 'original',
                'has_data': False
            })

        # Parse JSON strings
        highlights = []
        text_overlays = []

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

        return JSONResponse({
            'highlights_data': highlights,
            'text_overlays': text_overlays,
            'effect_type': result['effect_type'] or 'original',
            'has_data': len(highlights) > 0 or len(text_overlays) > 0
        })
