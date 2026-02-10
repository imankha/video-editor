"""
Multi-clip export endpoints.

This module handles exports involving multiple video clips:
- /multi-clip - Export multiple clips with transitions
- /chapters - Extract chapter markers from video
- /concat-for-overlay - Concatenate clips for overlay mode

Uses the transition strategy pattern for different transition types.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional
import json
import os
import tempfile
import uuid
import asyncio
import logging
import ffmpeg
import shutil
import hashlib
import base64
import torch

from ...websocket import export_progress, manager
from ...services.clip_cache import get_clip_cache
from ...services.transitions import apply_transition
from ...services.clip_pipeline import process_clip_with_pipeline
from ...constants import VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT, AI_UPSCALE_FACTOR, ExportStatus
from ...services.ffmpeg_service import get_video_duration
from ...database import get_db_connection
from ...storage import upload_to_r2, upload_bytes_to_r2, delete_from_r2, generate_presigned_url, download_from_r2
from ...user_context import get_current_user_id, set_current_user_id
from ...services.modal_client import modal_enabled, call_modal_clips_ai, call_modal_detect_players_batch

logger = logging.getLogger(__name__)

router = APIRouter()

# AI upscaler will be imported on-demand
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
except (ImportError, OSError, AttributeError) as e:
    logger.warning(f"AI upscaler dependencies not available: {e}")


# Default duration for auto-generated highlight regions (seconds)
DEFAULT_HIGHLIGHT_REGION_DURATION = 2.0

# YOLO model singleton for local detection
_yolo_model = None
PERSON_CLASS_ID = 0


def get_yolo_model():
    """Load YOLO model for local detection (singleton pattern)."""
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
            # Go up from app/routers/export/ to src/backend/
            backend_dir = Path(__file__).parent.parent.parent.parent
            model_path = backend_dir / "yolov8x.pt"
            if not model_path.exists():
                logger.info(f"YOLO model not found at {model_path}, will download...")
                model_path = "yolov8x.pt"
            logger.info(f"Loading YOLO model from {model_path}")
            _yolo_model = YOLO(str(model_path))
            logger.info("YOLO model loaded successfully")
        except ImportError:
            logger.error("ultralytics package not installed")
            return None
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            return None
    return _yolo_model


def run_local_detection_on_frame(video_path: str, timestamp: float, confidence_threshold: float = 0.5) -> dict:
    """
    Run YOLO detection on a single frame extracted at the given timestamp.

    Returns dict with 'boxes' array containing detected player bounding boxes.
    """
    import cv2

    model = get_yolo_model()
    if model is None:
        return {'timestamp': timestamp, 'boxes': []}

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.error(f"Cannot open video: {video_path}")
        return {'timestamp': timestamp, 'boxes': []}

    try:
        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Seek to timestamp
        frame_number = int(timestamp * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()

        if not ret or frame is None:
            logger.warning(f"Failed to read frame at timestamp {timestamp}")
            return {'timestamp': timestamp, 'boxes': []}

        # Run YOLO detection
        results = model(frame, verbose=False, conf=confidence_threshold)

        # Extract person detections
        boxes = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                class_id = int(box.cls[0])
                if class_id != PERSON_CLASS_ID:
                    continue

                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()

                # Convert to center + dimensions format
                boxes.append({
                    'x': (x1 + x2) / 2,
                    'y': (y1 + y2) / 2,
                    'width': x2 - x1,
                    'height': y2 - y1,
                    'confidence': conf
                })

        return {
            'timestamp': timestamp,
            'boxes': boxes,
            'video_width': width,
            'video_height': height
        }

    finally:
        cap.release()


async def run_local_batch_detection(
    user_id: str,
    output_key: str,
    timestamps: List[float],
    confidence_threshold: float = 0.5,
    progress_callback=None
) -> dict:
    """
    Run local YOLO detection on multiple timestamps.

    Downloads video from R2, runs detection on each timestamp, returns results.
    """
    # Download video from R2 to temp file
    temp_dir = Path(tempfile.gettempdir()) / "video_editor_detection"
    temp_dir.mkdir(exist_ok=True)
    temp_video = temp_dir / f"detect_{uuid.uuid4().hex[:8]}.mp4"

    try:
        logger.info(f"[Local Detection] Downloading video from R2: {output_key}")
        success = download_from_r2(user_id, output_key, temp_video)

        if not success:
            logger.error(f"[Local Detection] Failed to download video from R2")
            return {"status": "error", "error": "Failed to download video"}

        logger.info(f"[Local Detection] Running detection on {len(timestamps)} timestamps")

        if progress_callback:
            await progress_callback(92, "Detecting players (local GPU)...", "detecting_players")

        # Run detection on each timestamp
        detections = []
        video_width = 0
        video_height = 0

        for i, ts in enumerate(timestamps):
            result = run_local_detection_on_frame(str(temp_video), ts, confidence_threshold)
            detections.append({
                'timestamp': ts,
                'boxes': result.get('boxes', [])
            })

            # Capture video dimensions from first frame
            if i == 0:
                video_width = result.get('video_width', 0)
                video_height = result.get('video_height', 0)

            # Log progress periodically
            if (i + 1) % 4 == 0:
                logger.info(f"[Local Detection] Processed {i + 1}/{len(timestamps)} timestamps")

        total_boxes = sum(len(d['boxes']) for d in detections)
        logger.info(f"[Local Detection] Complete: {total_boxes} players detected across {len(timestamps)} frames")

        return {
            "status": "success",
            "detections": detections,
            "video_width": video_width,
            "video_height": video_height
        }

    finally:
        # Clean up temp file
        if temp_video.exists():
            temp_video.unlink()
            logger.debug(f"[Local Detection] Cleaned up temp file: {temp_video}")


async def run_local_detection_on_video_file(
    video_path: str,
    source_clips: List[Dict[str, Any]],
    confidence_threshold: float = 0.5,
) -> List[Dict[str, Any]]:
    """
    Run local YOLO detection directly on a video file (no R2 download needed).

    This is used for local multi-clip export where the video is already on disk.
    """
    # Calculate detection timestamps
    timestamps = calculate_detection_timestamps(source_clips)

    if not timestamps:
        logger.warning("[Local Detection] No timestamps to detect, returning default regions")
        return generate_default_highlight_regions(source_clips)

    logger.info(f"[Local Detection] Running detection on {len(timestamps)} timestamps from local file")

    try:
        # Run detection on each timestamp
        detections = []
        video_width = 0
        video_height = 0

        for i, ts in enumerate(timestamps):
            result = run_local_detection_on_frame(video_path, ts, confidence_threshold)
            detections.append({
                'timestamp': ts,
                'boxes': result.get('boxes', [])
            })

            # Capture video dimensions from first frame
            if i == 0:
                video_width = result.get('video_width', 0)
                video_height = result.get('video_height', 0)

            # Log progress periodically
            if (i + 1) % 4 == 0:
                logger.info(f"[Local Detection] Processed {i + 1}/{len(timestamps)} timestamps")

        total_boxes = sum(len(d['boxes']) for d in detections)
        logger.info(f"[Local Detection] Complete: {total_boxes} players detected across {len(timestamps)} frames")

    except Exception as e:
        logger.error(f"[Local Detection] Detection error: {e}, using default regions")
        return generate_default_highlight_regions(source_clips)

    # Build detection lookup by timestamp
    detection_by_time = {}
    for det in detections:
        ts = det.get("timestamp", 0)
        detection_by_time[round(ts, 2)] = det.get("boxes", [])

    # Build highlight regions with raw detection data
    regions = []
    detection_idx = 0

    for clip_idx, clip in enumerate(source_clips):
        region_start = clip['start_time']
        region_end = min(clip['start_time'] + DEFAULT_HIGHLIGHT_REGION_DURATION, clip['end_time'])

        if region_end - region_start < 0.5:
            detection_idx += 4
            continue

        # Collect detection data for this clip's timestamps
        clip_detections = []
        for i in range(4):
            if detection_idx + i >= len(timestamps):
                break

            ts = timestamps[detection_idx + i]
            ts_rounded = round(ts, 2)
            boxes = detection_by_time.get(ts_rounded, [])

            clip_detections.append({
                'timestamp': ts,
                'boxes': boxes,
            })

        detection_idx += 4

        has_detections = sum(1 for d in clip_detections if d.get('boxes'))

        region = {
            'id': f'region-auto-{clip_idx}-{int(region_start * 1000)}',
            'start_time': region_start,
            'end_time': region_end,
            'enabled': True,
            'label': clip['name'],
            'autoGenerated': True,
            'keyframes': [],
            'detections': clip_detections,
            'videoWidth': video_width,
            'videoHeight': video_height,
        }
        regions.append(region)

        logger.info(f"[Local Detection] Clip {clip_idx}: {has_detections}/{len(clip_detections)} timestamps have player detections")

    logger.info(f"[Local Detection] Generated {len(regions)} highlight regions with player detection")
    return regions


def normalize_clip_data_for_modal(clip_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize clip data format for Modal processing.

    The frontend sends different formats depending on how the clip was edited:
    - Frontend format: {segments: {boundaries, segmentSpeeds, trimRange}, trimRange, cropKeyframes}
    - DB export format: {segments: {trim_start, trim_end, segments: [...]}, cropKeyframes}

    Modal expects: {segmentsData: {trimRange: {start, end}, segments: [{start, end, speed}]}, cropKeyframes}

    Args:
        clip_data: Clip configuration from frontend

    Returns:
        Normalized clip data for Modal
    """
    result = dict(clip_data)  # Copy original
    segments = clip_data.get('segments', {})
    trim_range = clip_data.get('trimRange')

    # Build normalized segmentsData for Modal
    segments_data = {}

    # Handle trimRange - can be at top level or inside segments
    if trim_range:
        segments_data['trimRange'] = trim_range
    elif isinstance(segments, dict):
        if 'trimRange' in segments:
            segments_data['trimRange'] = segments['trimRange']
        elif 'trim_start' in segments or 'trim_end' in segments:
            # DB export format
            segments_data['trimRange'] = {
                'start': segments.get('trim_start', 0),
                'end': segments.get('trim_end', clip_data.get('duration', 15.0))
            }

    # Handle segments/speed data
    if isinstance(segments, dict):
        if 'segments' in segments and isinstance(segments['segments'], list):
            # DB export format: {segments: [{start, end, speed}, ...]}
            segments_data['segments'] = segments['segments']
        elif 'boundaries' in segments and 'segmentSpeeds' in segments:
            # Frontend format: convert boundaries/segmentSpeeds to segments array
            boundaries = segments['boundaries']
            speeds = segments['segmentSpeeds']
            converted_segments = []
            for i in range(len(boundaries) - 1):
                converted_segments.append({
                    'start': boundaries[i],
                    'end': boundaries[i + 1],
                    'speed': speeds.get(str(i), 1.0)
                })
            if converted_segments:
                segments_data['segments'] = converted_segments

    result['segmentsData'] = segments_data

    clip_index = clip_data.get('clipIndex', '?')
    logger.info(f"[normalize_clip_data] Clip {clip_index}: input segments={clip_data.get('segments')}, input trimRange={clip_data.get('trimRange')}, output segmentsData={segments_data}")
    return result


def calculate_effective_duration(clip_data: Dict[str, Any], raw_duration: float) -> float:
    """
    Calculate the effective duration of a clip after applying trim and speed changes.

    Handles multiple data formats from the database:
    1. Frontend format: {segments: {segmentSpeeds, boundaries}, trimRange: {start, end}}
    2. DB Export format: {trim_start, trim_end, segments: [{start, end, speed}, ...]}
    3. DB Trim-only format: {trim_start, trim_end}
    4. Normalized format: {segmentsData: {trimRange, segments}}

    Args:
        clip_data: Clip configuration with trimRange and segments
        raw_duration: Original video duration in seconds

    Returns:
        Effective duration in seconds (accounting for trim and speed)
    """
    clip_index = clip_data.get('clipIndex', '?')

    # Check for normalized format first (segmentsData wrapper)
    # Note: normalized_clips_data uses 'segment_data' key, not 'segmentsData'
    segments_data = clip_data.get('segmentsData', {}) or clip_data.get('segment_data', {})
    segments = clip_data.get('segments') or segments_data.get('segments')
    trim_range = clip_data.get('trimRange') or segments_data.get('trimRange')

    logger.debug(f"[calc_effective_duration] Clip {clip_index}: raw_duration={raw_duration}, segments={segments}, trim_range={trim_range}, segmentsData={segments_data}")

    # Step 1: Extract trim boundaries from all possible sources
    trim_start = 0
    trim_end = raw_duration

    # Check clip_data top-level for trim_start/trim_end
    if 'trim_start' in clip_data:
        trim_start = clip_data.get('trim_start', 0)
    if 'trim_end' in clip_data:
        trim_end = clip_data.get('trim_end', raw_duration)

    # Check segments dict for trim_start/trim_end (DB export format)
    if segments and isinstance(segments, dict):
        if 'trim_start' in segments:
            trim_start = segments.get('trim_start', 0)
        if 'trim_end' in segments:
            trim_end = segments.get('trim_end', raw_duration)

    # Check trimRange (frontend format)
    if trim_range:
        trim_start = trim_range.get('start', trim_start)
        trim_end = trim_range.get('end', trim_end)

    # Step 2: Check for speed changes and calculate duration accordingly

    # Handle segments as a list of {start, end, speed} objects directly
    # This happens when segments comes from segment_data.segments (normalized format)
    if segments and isinstance(segments, list) and len(segments) > 0:
        first_seg = segments[0]
        if isinstance(first_seg, dict) and 'speed' in first_seg:
            total_duration = 0.0
            for seg in segments:
                seg_start = max(seg.get('start', 0), trim_start)
                seg_end = min(seg.get('end', raw_duration), trim_end)
                if seg_end > seg_start:
                    speed = seg.get('speed', 1.0)
                    total_duration += (seg_end - seg_start) / speed
            logger.info(f"[calc_effective_duration] Clip {clip_index}: list format, trim_start={trim_start}, trim_end={trim_end}, total_duration={total_duration}")
            return total_duration

    # DB Export format: segments contains 'segments' array of {start, end, speed}
    if segments and isinstance(segments, dict) and 'segments' in segments:
        segment_list = segments.get('segments', [])
        if isinstance(segment_list, list) and segment_list and isinstance(segment_list[0], dict) and 'speed' in segment_list[0]:
            total_duration = 0.0
            for seg in segment_list:
                seg_start = max(seg.get('start', 0), trim_start)
                seg_end = min(seg.get('end', raw_duration), trim_end)
                if seg_end > seg_start:
                    speed = seg.get('speed', 1.0)
                    total_duration += (seg_end - seg_start) / speed
            return total_duration

    # Frontend format: segments has segmentSpeeds and boundaries
    if segments and isinstance(segments, dict) and segments.get('segmentSpeeds'):
        boundaries = segments.get('boundaries', [0, raw_duration])
        speeds = segments.get('segmentSpeeds', {})

        total_duration = 0.0
        for i in range(len(boundaries) - 1):
            seg_start = max(boundaries[i], trim_start)
            seg_end = min(boundaries[i + 1], trim_end)

            if seg_end > seg_start:
                speed = speeds.get(str(i), 1.0)
                total_duration += (seg_end - seg_start) / speed

        return total_duration

    # No speed changes - just return trimmed duration
    effective = trim_end - trim_start
    logger.info(f"[calc_effective_duration] Clip {clip_index}: trim_start={trim_start}, trim_end={trim_end}, effective={effective}")
    return effective


def build_clip_boundaries_from_durations(
    clips_data: List[Dict[str, Any]],
    actual_durations: List[float],
    transition: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Build clip boundary metadata using actual measured durations of processed clips.

    Args:
        clips_data: List of clip configurations (for names)
        actual_durations: List of actual durations in seconds for each processed clip
        transition: Optional transition config to account for overlaps

    Returns:
        List of dicts with name, start_time, end_time, duration for each clip
    """
    sorted_clips = sorted(clips_data, key=lambda x: x.get('clipIndex', 0))
    transition_type = transition.get('type', 'cut') if transition else 'cut'
    transition_duration = transition.get('duration', 0.5) if transition else 0.5

    source_clips = []
    current_time = 0.0

    for i, (clip_data, duration) in enumerate(zip(sorted_clips, actual_durations)):
        # Account for transition overlap (dissolve transitions cause clips to overlap)
        if i > 0 and transition_type == 'dissolve':
            current_time -= transition_duration

        clip_name = clip_data.get('clipName') or clip_data.get('fileName') or f'Clip {i + 1}'

        source_clips.append({
            'index': i,
            'name': clip_name,
            'start_time': current_time,
            'end_time': current_time + duration,
            'duration': duration
        })

        current_time += duration

    logger.info(f"[Clip Boundaries] Built boundaries for {len(source_clips)} clips, total duration: {current_time:.2f}s")
    return source_clips


def build_clip_boundaries_from_input(
    clips_data: List[Dict[str, Any]],
    transition: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Build clip boundary metadata by calculating durations from input data.
    This is a FALLBACK for Modal processing where we don't have access to processed clips.

    NOTE: This may be inaccurate if clip data has unexpected format. Prefer
    build_clip_boundaries_from_durations when actual processed clips are available.

    Args:
        clips_data: List of clip configurations with duration, trimRange, segments
        transition: Optional transition config to account for overlaps

    Returns:
        List of dicts with name, start_time, end_time, duration for each clip
    """
    sorted_clips = sorted(clips_data, key=lambda x: x.get('clipIndex', 0))
    transition_type = transition.get('type', 'cut') if transition else 'cut'
    transition_duration = transition.get('duration', 0.5) if transition else 0.5

    source_clips = []
    current_time = 0.0

    for i, clip_data in enumerate(sorted_clips):
        raw_duration = clip_data.get('duration', 15.0)
        effective_duration = calculate_effective_duration(clip_data, raw_duration)

        logger.info(f"[build_clip_boundaries] Clip {i}: raw_duration={raw_duration}, effective_duration={effective_duration}")

        # Account for transition overlap
        if i > 0 and transition_type == 'dissolve':
            current_time -= transition_duration

        clip_name = clip_data.get('clipName') or clip_data.get('fileName') or f'Clip {i + 1}'

        source_clips.append({
            'index': i,
            'name': clip_name,
            'start_time': current_time,
            'end_time': current_time + effective_duration,
            'duration': effective_duration
        })

        logger.debug(f"[Clip Boundaries] Clip {i}: raw={raw_duration:.2f}s, effective={effective_duration:.2f}s, start={current_time:.2f}s")
        current_time += effective_duration

    logger.info(f"[Clip Boundaries] Built boundaries from input for {len(source_clips)} clips, estimated total: {current_time:.2f}s")
    return source_clips


def generate_default_highlight_regions(source_clips: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Generate default highlight regions at the start of each clip.
    Creates a 2-second region at the beginning of each clip in the concatenated video.

    Args:
        source_clips: List of clip boundaries from build_clip_boundaries()

    Returns:
        List of highlight region objects ready for database storage
    """
    regions = []

    for i, clip in enumerate(source_clips):
        region_start = clip['start_time']
        region_end = min(clip['start_time'] + DEFAULT_HIGHLIGHT_REGION_DURATION, clip['end_time'])

        # Skip if region would be too short (less than 0.5 seconds)
        if region_end - region_start < 0.5:
            continue

        region = {
            'id': f'region-auto-{i}-{int(region_start * 1000)}',
            'start_time': region_start,
            'end_time': region_end,
            'enabled': True,
            'label': clip['name'],
            'autoGenerated': True,
            'keyframes': [],  # Empty - user creates keyframes manually or via detection
            'detections': [],  # No detection data (Modal disabled or fallback)
            'videoWidth': None,
            'videoHeight': None,
        }
        regions.append(region)

    logger.info(f"[Highlight Regions] Generated {len(regions)} default regions for {len(source_clips)} clips")
    return regions


def calculate_detection_timestamps(source_clips: List[Dict[str, Any]]) -> List[float]:
    """
    Calculate timestamps for player detection within each clip's overlay region.

    For each clip, we detect at 4 evenly spaced timestamps within the first 2 seconds
    (the overlay region): 0s, 0.66s, 1.33s, 2s relative to clip start.

    Args:
        source_clips: List of clip boundaries from build_clip_boundaries()

    Returns:
        List of absolute timestamps (in seconds) for detection in the working video
    """
    timestamps = []

    for clip in source_clips:
        clip_start = clip['start_time']
        clip_duration = clip['duration']

        # Overlay region is first 2 seconds of clip (or full clip if shorter)
        overlay_duration = min(DEFAULT_HIGHLIGHT_REGION_DURATION, clip_duration)

        # 4 evenly spaced detection points: 0, 0.66, 1.33, 2.0 seconds from clip start
        # If clip is shorter than 2s, scale proportionally
        for i in range(4):
            relative_time = (i / 3) * overlay_duration  # 0, 0.33, 0.66, 1.0 × overlay_duration
            absolute_time = clip_start + relative_time
            timestamps.append(absolute_time)

    return timestamps


async def run_player_detection_for_highlights(
    user_id: str,
    output_key: str,
    source_clips: List[Dict[str, Any]],
    progress_callback=None,
) -> List[Dict[str, Any]]:
    """
    Run batch player detection and enhance highlight regions with detected player boxes.

    Uses Modal GPU when available, falls back to local YOLO when Modal is disabled.

    Args:
        user_id: User folder in R2
        output_key: R2 key for the working video to analyze
        source_clips: List of clip boundaries from build_clip_boundaries()
        progress_callback: Optional async callback for progress updates

    Returns:
        List of highlight regions with detection-enhanced keyframes
    """
    # Calculate detection timestamps
    timestamps = calculate_detection_timestamps(source_clips)

    if not timestamps:
        logger.warning("[Player Detection] No timestamps to detect, returning default regions")
        return generate_default_highlight_regions(source_clips)

    logger.info(f"[Player Detection] Running batch detection on {len(timestamps)} timestamps for {len(source_clips)} clips")

    # Run batch detection - use Modal if enabled, otherwise local YOLO
    try:
        if modal_enabled():
            if progress_callback:
                await progress_callback(92, "Detecting players...", "detecting_players")

            detection_result = await call_modal_detect_players_batch(
                user_id=user_id,
                input_key=output_key,
                timestamps=timestamps,
                confidence_threshold=0.5,
            )
        else:
            # Use local YOLO detection (requires R2 access to download video)
            from ..storage import get_r2_client
            if get_r2_client() is None:
                logger.warning("[Player Detection] Modal disabled AND R2 not configured - cannot run local detection. Configure R2_ENABLED=true with credentials, or enable Modal.")
                return generate_default_highlight_regions(source_clips)

            logger.info("[Player Detection] Modal disabled, using local YOLO detection")
            detection_result = await run_local_batch_detection(
                user_id=user_id,
                output_key=output_key,
                timestamps=timestamps,
                confidence_threshold=0.5,
                progress_callback=progress_callback,
            )

        if detection_result.get("status") != "success":
            logger.warning(f"[Player Detection] Detection failed: {detection_result.get('error')}, using default regions")
            return generate_default_highlight_regions(source_clips)

        detections = detection_result.get("detections", [])
        video_width = detection_result.get("video_width", 810)
        video_height = detection_result.get("video_height", 1440)

        logger.info(f"[Player Detection] Got {len(detections)} detection results, video size: {video_width}x{video_height}")

    except Exception as e:
        logger.error(f"[Player Detection] Detection error: {e}, using default regions")
        return generate_default_highlight_regions(source_clips)

    # Build detection lookup by timestamp (with small tolerance for floating point)
    detection_by_time = {}
    for det in detections:
        ts = det.get("timestamp", 0)
        # Round to 2 decimal places for matching
        detection_by_time[round(ts, 2)] = det.get("boxes", [])

    # Build highlight regions with raw detection data (no auto-created keyframes)
    # User will click on detection boxes to create keyframes in the UI
    regions = []
    detection_idx = 0

    for clip_idx, clip in enumerate(source_clips):
        region_start = clip['start_time']
        region_end = min(clip['start_time'] + DEFAULT_HIGHLIGHT_REGION_DURATION, clip['end_time'])

        # Skip if region would be too short
        if region_end - region_start < 0.5:
            detection_idx += 4  # Skip the 4 detection timestamps for this clip
            continue

        # Collect raw detection data for this clip's 4 timestamps
        clip_detections = []
        for i in range(4):
            if detection_idx + i >= len(timestamps):
                break

            ts = timestamps[detection_idx + i]
            ts_rounded = round(ts, 2)
            boxes = detection_by_time.get(ts_rounded, [])

            clip_detections.append({
                'timestamp': ts,
                'boxes': boxes,  # Raw detection boxes - user clicks to create keyframe
            })

        detection_idx += 4  # Move to next clip's detection timestamps

        # Count how many timestamps have detections
        has_detections = sum(1 for d in clip_detections if d.get('boxes'))

        region = {
            'id': f'region-auto-{clip_idx}-{int(region_start * 1000)}',
            'start_time': region_start,
            'end_time': region_end,
            'enabled': True,
            'label': clip['name'],
            'autoGenerated': True,
            'keyframes': [],  # Empty - user creates by clicking detection boxes
            'detections': clip_detections,  # Raw detection data for UI to display
            'videoWidth': video_width,
            'videoHeight': video_height,
        }
        regions.append(region)

        logger.info(f"[Player Detection] Clip {clip_idx}: {has_detections}/{len(clip_detections)} timestamps have player detections")

    logger.info(f"[Player Detection] Generated {len(regions)} highlight regions with player detection")
    return regions


def calculate_multi_clip_resolution(
    clips_data: List[Dict[str, Any]],
    global_aspect_ratio: str
) -> Tuple[int, int]:
    """
    Calculate target resolution for all clips based on global aspect ratio.
    Uses the smallest crop dimensions across all clips to determine base size.
    """
    # Parse aspect ratio
    ratio_w, ratio_h = map(int, global_aspect_ratio.split(':'))

    # Find minimum crop size across all clips
    min_crop_width = float('inf')
    min_crop_height = float('inf')

    for clip in clips_data:
        for kf in clip.get('cropKeyframes', []):
            min_crop_width = min(min_crop_width, kf['width'])
            min_crop_height = min(min_crop_height, kf['height'])

    # Handle case where no keyframes exist
    if min_crop_width == float('inf') or min_crop_height == float('inf'):
        # Default to 1080x1920 for 9:16
        if ratio_w < ratio_h:
            return (1080, 1920)
        else:
            return (1920, 1080)

    # Calculate target resolution (upscaled, capped at max resolution)
    sr_w = int(min_crop_width * AI_UPSCALE_FACTOR)
    sr_h = int(min_crop_height * AI_UPSCALE_FACTOR)

    max_w, max_h = VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT
    scale_limit = min(max_w / sr_w, max_h / sr_h, 1.0)

    target_w = int(sr_w * scale_limit)
    target_h = int(sr_h * scale_limit)

    # Ensure even dimensions (required by most video codecs)
    target_w = target_w - (target_w % 2)
    target_h = target_h - (target_h % 2)

    return (target_w, target_h)


async def process_single_clip(
    clip_data: Dict[str, Any],
    video_file: UploadFile,
    temp_dir: str,
    target_fps: int,
    export_mode: str,
    include_audio: bool,
    progress_callback,
    loop: asyncio.AbstractEventLoop,
    upscaler=None
) -> str:
    """
    Process a single clip with its crop/trim/speed settings.
    Uses ClipProcessingPipeline to ensure correct ordering of operations.
    Uses caching to avoid re-processing unchanged clips.
    Returns path to processed clip.

    Args:
        upscaler: Optional AIVideoUpscaler instance to reuse across clips.
                  If None, a new one will be created (not recommended for multi-clip).
    """
    clip_index = clip_data['clipIndex']

    # Read video content
    video_content = await video_file.read()

    # Check AI upscaler availability
    if AIVideoUpscaler is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "AI upscaling dependencies not installed"}
        )

    # Reuse provided upscaler or create a new one
    # Creating a new upscaler per clip can cause VRAM exhaustion!
    if upscaler is None:
        upscaler = AIVideoUpscaler(
            device='cuda',
            export_mode=export_mode,
            sr_model_name='realesr_general_x4v3'
        )

    if upscaler.upsampler is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "AI SR model failed to load"}
        )

    # Get cache instance
    cache = get_clip_cache()

    # Use pipeline for guaranteed correct ordering of operations
    output_path = await process_clip_with_pipeline(
        clip_data=clip_data,
        video_content=video_content,
        temp_dir=temp_dir,
        target_fps=target_fps,
        export_mode=export_mode,
        include_audio=include_audio,
        cache=cache,
        upscaler=upscaler,
        progress_callback=progress_callback
    )

    return output_path


def create_chapter_metadata_file(
    clip_info: List[Dict[str, Any]],
    output_path: str
) -> str:
    """
    Create an ffmetadata file with chapter markers for each clip.

    Args:
        clip_info: List of dicts with 'name', 'start_time', 'end_time'
        output_path: Directory to write the metadata file

    Returns:
        Path to the created metadata file
    """
    metadata_path = os.path.join(os.path.dirname(output_path), 'chapters.txt')

    with open(metadata_path, 'w', encoding='utf-8') as f:
        f.write(";FFMETADATA1\n\n")

        for clip in clip_info:
            # Convert seconds to milliseconds for TIMEBASE=1/1000
            start_ms = int(clip['start_time'] * 1000)
            end_ms = int(clip['end_time'] * 1000)
            title = clip.get('name', f"Clip {clip.get('index', 0) + 1}")

            # Remove file extension from title for cleaner display
            if '.' in title:
                title = os.path.splitext(title)[0]

            f.write("[CHAPTER]\n")
            f.write("TIMEBASE=1/1000\n")
            f.write(f"START={start_ms}\n")
            f.write(f"END={end_ms}\n")
            f.write(f"title={title}\n\n")

    logger.info(f"[Chapters] Created metadata file with {len(clip_info)} chapters")
    return metadata_path


def add_chapters_to_video(
    input_path: str,
    metadata_path: str,
    output_path: str
) -> None:
    """Add chapter metadata to a video file."""
    import subprocess

    cmd = [
        'ffmpeg', '-y',
        '-i', input_path,
        '-i', metadata_path,
        '-map_metadata', '1',
        '-codec', 'copy',
        output_path
    ]

    logger.info(f"[Chapters] Adding chapters to video")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[Chapters] Failed to add chapters: {result.stderr}")
    else:
        logger.info(f"[Chapters] Successfully added chapters")


def concatenate_clips_with_transition(
    clip_paths: List[str],
    output_path: str,
    transition: Dict[str, Any],
    include_audio: bool = True,
    clip_info: Optional[List[Dict[str, Any]]] = None
) -> None:
    """
    Concatenate processed clips with transitions and embed chapter markers.

    Uses the transition strategy pattern for different transition types.

    Args:
        clip_paths: List of paths to processed clip files
        output_path: Path for the final concatenated output
        transition: Transition settings {'type': str, 'duration': float}
        include_audio: Whether to include audio in output
        clip_info: Optional list of clip info for chapter markers
    """
    transition_type = transition.get('type', 'cut')
    transition_duration = transition.get('duration', 0.5)

    if len(clip_paths) == 1:
        # Single clip - just copy
        shutil.copy(clip_paths[0], output_path)
        return

    # Use transition strategy pattern
    success = apply_transition(
        transition_type=transition_type,
        clip_paths=clip_paths,
        output_path=output_path,
        duration=transition_duration,
        include_audio=include_audio
    )

    if not success:
        raise RuntimeError(f"Transition '{transition_type}' failed")

    # Add chapter markers if clip info is provided
    if clip_info and len(clip_info) > 1:
        try:
            # Get actual durations of processed clips
            durations = [get_video_duration(path) for path in clip_paths]

            # Calculate chapter timestamps accounting for transitions
            chapter_data = []
            current_time = 0.0

            for i, (info, dur) in enumerate(zip(clip_info, durations)):
                # For dissolve transitions, clips overlap
                if i > 0 and transition_type == 'dissolve':
                    current_time -= transition_duration

                chapter_data.append({
                    'name': info.get('fileName', info.get('name', f'Clip {i + 1}')),
                    'index': i,
                    'start_time': current_time,
                    'end_time': current_time + dur
                })
                current_time += dur

            # Adjust end times so chapters don't overlap
            for i in range(len(chapter_data) - 1):
                chapter_data[i]['end_time'] = chapter_data[i + 1]['start_time']

            # Create and apply chapter metadata
            metadata_path = create_chapter_metadata_file(chapter_data, output_path)

            # Create temp output with chapters
            temp_output = output_path + '.chapters.mp4'
            add_chapters_to_video(output_path, metadata_path, temp_output)

            # Replace original with chaptered version
            if os.path.exists(temp_output) and os.path.getsize(temp_output) > 0:
                os.replace(temp_output, output_path)
                logger.info(f"[Multi-Clip] Added {len(chapter_data)} chapters to output")
            else:
                logger.warning("[Multi-Clip] Chapter embedding produced no output")

            # Cleanup
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
            if os.path.exists(temp_output):
                os.remove(temp_output)

        except Exception as e:
            logger.error(f"[Multi-Clip] Failed to add chapters: {e}")
            # Continue without chapters - video is still valid


@router.post("/multi-clip")
async def export_multi_clip(
    request: Request,
    export_id: str = Form(...),
    multi_clip_data_json: str = Form(...),
    include_audio: str = Form("true"),
    target_fps: int = Form(30),
    export_mode: str = Form("fast"),
    project_id: int = Form(None),  # Optional: for saving working video to DB
    project_name: str = Form(None),  # Optional: for metadata
):
    """
    Export multiple video clips with transitions.

    This endpoint handles multi-clip export where:
    1. Each clip has its own crop keyframes, segments, and trim settings
    2. A global aspect ratio applies to all clips
    3. Clips are concatenated with a specified transition (cut, fade, dissolve)

    Request format:
    - video_0, video_1, video_2, ... : Video files uploaded as multipart form
    - multi_clip_data_json: JSON containing clips configuration
    """
    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting multi-clip export...",
        "status": "processing",
        "projectId": project_id,
        "projectName": project_name,
    }

    logger.info(f"[Multi-Clip Export] Starting export {export_id}")

    # Regress status and create export_jobs record
    if project_id:
        # Clear both video IDs FIRST in its own transaction so it always happens
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE projects SET working_video_id = NULL, final_video_id = NULL WHERE id = ?", (project_id,))
                conn.commit()
            logger.info(f"[Multi-Clip Export] Cleared working_video_id and final_video_id for project {project_id} (status regression)")
        except Exception as e:
            logger.warning(f"[Multi-Clip Export] Failed to clear video IDs: {e}")

        # Create export_jobs record (separate transaction)
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO export_jobs (id, project_id, type, status, input_data)
                    VALUES (?, ?, 'framing', 'processing', '{}')
                """, (export_id, project_id))
                conn.commit()
            logger.info(f"[Multi-Clip Export] Created export_jobs record: {export_id}")
        except Exception as e:
            logger.warning(f"[Multi-Clip Export] Failed to create export_jobs record: {e}")

    # Parse form data to get video files
    form = await request.form()

    # Extract video files (video_0, video_1, etc.)
    video_files: Dict[int, UploadFile] = {}
    for key, value in form.items():
        if key.startswith('video_'):
            try:
                index = int(key.split('_')[1])
                video_files[index] = value
                logger.info(f"[Multi-Clip Export] Found video file: {key}")
            except (ValueError, IndexError):
                continue

    # Parse multi-clip data
    try:
        multi_clip_data = json.loads(multi_clip_data_json)
        clips_data = multi_clip_data.get('clips', [])
        global_aspect_ratio = multi_clip_data.get('globalAspectRatio', '9:16')
        transition = multi_clip_data.get('transition', {'type': 'cut', 'duration': 0.5})

        logger.info(f"[Multi-Clip Export] {len(clips_data)} clips, aspect ratio: {global_aspect_ratio}, transition: {transition}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid multi-clip data JSON: {str(e)}")

    include_audio_bool = include_audio.lower() == "true"

    # Validate video files match clip data
    if len(video_files) != len(clips_data):
        raise HTTPException(
            status_code=400,
            detail=f"Mismatch: {len(video_files)} video files but {len(clips_data)} clip configs"
        )

    # Validate all clips have framing data (crop keyframes)
    clips_missing_framing = []
    for i, clip in enumerate(clips_data):
        crop_keyframes = clip.get('cropKeyframes', [])
        if not crop_keyframes or len(crop_keyframes) == 0:
            clip_name = clip.get('clipName') or clip.get('fileName') or f'Clip {i + 1}'
            clips_missing_framing.append(clip_name)

    if clips_missing_framing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot export: {len(clips_missing_framing)} clip(s) missing framing data: {', '.join(clips_missing_framing)}. Please add crop keyframes to all clips before exporting."
        )

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    processed_paths: List[str] = []

    # Capture user context before async operations (context vars may drift in threads)
    captured_user_id = get_current_user_id()
    logger.info(f"[Multi-Clip Export] Captured user context: {captured_user_id}")

    try:
        # Calculate consistent target resolution for all clips
        target_resolution = calculate_multi_clip_resolution(clips_data, global_aspect_ratio)
        logger.info(f"[Multi-Clip Export] Target resolution: {target_resolution}")

        # Get event loop for progress callbacks
        loop = asyncio.get_running_loop()

        # ===== MODAL GPU PROCESSING =====
        if modal_enabled():
            logger.info(f"[Multi-Clip Export] Using Modal GPU for {len(clips_data)} clips")

            # Upload all source videos to R2 temp folder
            source_keys = []
            for clip_data in sorted(clips_data, key=lambda x: x.get('clipIndex', 0)):
                clip_index = clip_data.get('clipIndex')
                video_file = video_files.get(clip_index)

                if not video_file:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing video file for clip {clip_index}"
                    )

                # Read video content
                content = await video_file.read()
                await video_file.seek(0)  # Reset for potential local fallback

                # Upload to R2 temp folder
                source_key = f"temp/multi_clip_{export_id}/source_{clip_index}.mp4"
                upload_bytes_to_r2(captured_user_id, source_key, content)
                source_keys.append(source_key)
                logger.info(f"[Multi-Clip Export] Uploaded source clip {clip_index} to R2: {source_key}")

            # Create progress callback
            async def modal_progress_callback(progress: float, message: str, phase: str = "modal_processing"):
                progress_data = {
                    "progress": progress,
                    "message": message,
                    "status": "processing",
                    "phase": phase,  # Include phase for frontend tracking
                    "projectId": project_id,
                    "projectName": project_name,
                    "type": "multi_clip"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

            # Output key for the final video
            output_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
            output_key = f"working_videos/{output_filename}"

            # Callback to store Modal call_id for job recovery
            def store_modal_call_id(modal_call_id: str):
                """Store Modal call_id in export_jobs for recovery after backend crash."""
                if project_id:
                    try:
                        with get_db_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute("""
                                UPDATE export_jobs
                                SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            """, (modal_call_id, export_id))
                            conn.commit()
                        logger.info(f"[Multi-Clip Export] Stored modal_call_id: {modal_call_id} for recovery")
                    except Exception as e:
                        logger.warning(f"[Multi-Clip Export] Failed to store modal_call_id: {e}")

            # Normalize clip data format for Modal
            # Frontend sends {segments, trimRange}, Modal expects {keyframes, segment_data}
            normalized_clips_data = []
            for clip in clips_data:
                normalized = normalize_clip_data_for_modal(clip)
                # Map to unified function format
                # Include duration and clipName for build_clip_boundaries_from_input
                normalized_clips_data.append({
                    "keyframes": normalized.get("cropKeyframes", []),
                    "segment_data": normalized.get("segmentsData", {}),
                    "clipIndex": normalized.get("clipIndex", 0),
                    "duration": clip.get("duration", 15.0),
                    "clipName": clip.get("clipName") or clip.get("fileName"),
                })
            logger.info(f"[Multi-Clip Export] Normalized {len(normalized_clips_data)} clips for Modal")

            # Call unified Modal function - single container processes all clips
            result = await call_modal_clips_ai(
                job_id=export_id,
                user_id=captured_user_id,
                source_keys=source_keys,
                output_key=output_key,
                clips_data=normalized_clips_data,
                target_width=target_resolution[0],
                target_height=target_resolution[1],
                fps=target_fps,
                include_audio=include_audio_bool,
                transition=transition,
                progress_callback=modal_progress_callback,
                call_id_callback=store_modal_call_id,  # Store for recovery if connection drops
            )

            if result.get("status") == "connection_lost":
                # Connection lost while polling, but job may still be running on Modal
                # Don't show error - let frontend recover via /modal-status endpoint
                logger.warning(f"[Multi-Clip Export] Connection lost, job {export_id} may still be running on Modal")
                progress_data = {
                    "progress": -1,  # Indeterminate
                    "message": result.get("message", "Connection lost. Refresh to check status."),
                    "status": "processing",  # Still processing, not failed
                    "projectId": project_id,
                    "projectName": project_name,
                    "recoverable": True,
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)
                # Return success-ish response - job is still running, frontend will recover
                return JSONResponse({
                    "status": "processing",
                    "export_id": export_id,
                    "message": "Connection lost but job may still be running. Refresh to check status.",
                    "recoverable": True,
                })

            if result.get("status") != "success":
                error = result.get("error", "Unknown error")
                raise RuntimeError(f"Modal multi-clip processing failed: {error}")

            # Clean up temp source files from R2
            for source_key in source_keys:
                try:
                    await delete_from_r2(captured_user_id, source_key)
                except Exception as e:
                    logger.warning(f"[Multi-Clip Export] Failed to delete temp file {source_key}: {e}")

            # Get video duration from result (or estimate)
            video_duration = None  # Modal doesn't return this yet

            # Save to database if project_id provided
            working_video_id = None
            if project_id:
                # Run player detection BEFORE DB transaction (async operation)
                source_clips = build_clip_boundaries_from_input(normalized_clips_data, transition)

                # Run batch player detection on the working video
                # This creates highlight regions with detected player keyframes
                try:
                    highlight_regions = await run_player_detection_for_highlights(
                        user_id=captured_user_id,
                        output_key=output_key,
                        source_clips=source_clips,
                        progress_callback=modal_progress_callback,
                    )
                    logger.info(f"[Multi-Clip Export] Player detection complete: {len(highlight_regions)} regions with detected keyframes")
                except Exception as det_error:
                    logger.warning(f"[Multi-Clip Export] Player detection failed, using defaults: {det_error}")
                    highlight_regions = generate_default_highlight_regions(source_clips)

                try:
                    with get_db_connection() as conn:
                        cursor = conn.cursor()

                        # Get next version number for working_videos
                        cursor.execute("""
                            SELECT COALESCE(MAX(version), 0) + 1 as next_version
                            FROM working_videos WHERE project_id = ?
                        """, (project_id,))
                        next_version = cursor.fetchone()['next_version']

                        highlights_json = json.dumps(highlight_regions)

                        logger.info(f"[Multi-Clip Export] Generated {len(highlight_regions)} highlight regions for {len(source_clips)} clips")

                        # Insert working video record with highlight regions and version
                        cursor.execute("""
                            INSERT INTO working_videos (project_id, filename, version, highlights_data)
                            VALUES (?, ?, ?, ?)
                        """, (project_id, output_filename, next_version, highlights_json))
                        working_video_id = cursor.lastrowid

                        # Update project to point to the new working video
                        cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

                        # Update export_jobs record to complete
                        cursor.execute("""
                            UPDATE export_jobs
                            SET status = 'complete', output_video_id = ?, output_filename = ?, completed_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        """, (working_video_id, output_filename, export_id))

                        conn.commit()
                        logger.info(f"[Multi-Clip Export] Saved to DB: working_video_id={working_video_id}, project updated, export_jobs completed")
                except Exception as e:
                    logger.error(f"[Multi-Clip Export] Failed to save to database: {e}")

            # Final progress update
            progress_data = {
                "progress": 100,
                "message": "Multi-clip export complete!",
                "status": ExportStatus.COMPLETE,
                "projectId": project_id,
                "projectName": project_name,
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            logger.info(f"[Multi-Clip Export] Modal processing complete: {result.get('clips_processed')} clips")

            # Return response with presigned URL
            return JSONResponse({
                "status": "success",
                "export_id": export_id,
                "presigned_url": generate_presigned_url(captured_user_id, output_key),
                "filename": output_filename,
                "working_video_id": working_video_id,
                "clips_processed": result.get("clips_processed"),
                "modal_used": True,
                "video_duration": video_duration,
            })

        # ===== LOCAL GPU PROCESSING (fallback when Modal not enabled) =====

        # Create upscaler ONCE and reuse for all clips
        # This prevents VRAM exhaustion from loading the model multiple times
        if AIVideoUpscaler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI upscaling dependencies not installed"}
            )

        # Check CUDA availability before trying to initialize
        if not torch.cuda.is_available():
            raise HTTPException(
                status_code=503,
                detail={"error": "CUDA not available - GPU required for AI upscaling"}
            )

        # Clear any stale GPU memory before initializing model
        try:
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            logger.info(f"[Multi-Clip Export] CUDA memory cleared. Available: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f}GB")
        except Exception as e:
            logger.warning(f"[Multi-Clip Export] Failed to clear CUDA cache: {e}")

        try:
            shared_upscaler = AIVideoUpscaler(
                device='cuda',
                export_mode=export_mode,
                sr_model_name='realesr_general_x4v3'
            )
        except torch.cuda.OutOfMemoryError as e:
            logger.error(f"[Multi-Clip Export] CUDA out of memory during model init: {e}")
            torch.cuda.empty_cache()
            raise HTTPException(
                status_code=503,
                detail={"error": f"GPU out of memory - try closing other GPU applications: {e}"}
            )
        except RuntimeError as e:
            if "CUDA" in str(e) or "cuda" in str(e):
                logger.error(f"[Multi-Clip Export] CUDA error during model init: {e}")
                torch.cuda.empty_cache()
                raise HTTPException(
                    status_code=503,
                    detail={"error": f"CUDA error - GPU may be busy or unavailable: {e}"}
                )
            raise

        if shared_upscaler.upsampler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI SR model failed to load"}
            )

        logger.info(f"[Multi-Clip Export] Initialized shared AI upscaler")

        # Process each clip
        total_clips = len(clips_data)
        sorted_clips = sorted(clips_data, key=lambda x: x.get('clipIndex', 0))

        for i, clip_data in enumerate(sorted_clips):
            clip_index = clip_data.get('clipIndex', i)
            video_file = video_files.get(clip_index)

            if not video_file:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing video file for clip {clip_index}"
                )

            # Update progress
            base_progress = 10 + int((i / total_clips) * 70)
            progress_data = {
                "progress": base_progress,
                "message": f"Processing clip {i + 1}/{total_clips}...",
                "status": "processing"
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            # Progress callback for this clip
            def create_clip_progress_callback(clip_num, total):
                def callback(current, frame_total, message, phase='ai_upscale'):
                    clip_start = 10 + int((clip_num / total) * 70)
                    clip_end = 10 + int(((clip_num + 1) / total) * 70)
                    clip_progress = clip_start + int((current / max(frame_total, 1)) * (clip_end - clip_start))

                    progress_data = {
                        "progress": clip_progress,
                        "message": f"Clip {clip_num + 1}/{total}: {message}",
                        "status": "processing"
                    }
                    export_progress[export_id] = progress_data

                    try:
                        asyncio.run_coroutine_threadsafe(
                            manager.send_progress(export_id, progress_data),
                            loop
                        )
                    except Exception as e:
                        logger.error(f"Failed to send WebSocket update: {e}")

                return callback

            clip_progress_callback = create_clip_progress_callback(i, total_clips)

            # Process this clip with the shared upscaler
            output_path = await process_single_clip(
                clip_data=clip_data,
                video_file=video_file,
                temp_dir=temp_dir,
                target_fps=target_fps,
                export_mode=export_mode,
                include_audio=include_audio_bool,
                progress_callback=clip_progress_callback,
                loop=loop,
                upscaler=shared_upscaler
            )

            processed_paths.append(output_path)
            logger.info(f"[Multi-Clip Export] Clip {clip_index} processed: {output_path}")

            # Aggressive memory cleanup between clips
            # This prevents VRAM/RAM accumulation that can cause crashes
            import gc
            gc.collect()  # Force Python garbage collection first

            if torch.cuda.is_available():
                torch.cuda.synchronize()  # Ensure all GPU operations complete
                torch.cuda.empty_cache()  # Clear cached GPU memory
                logger.info(f"[Multi-Clip Export] Cleared GPU cache after clip {clip_index}")

            gc.collect()  # Final garbage collection after GPU cleanup

        # Concatenate clips with transition
        progress_data = {
            "progress": 85,
            "message": "Concatenating clips...",
            "status": "processing"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        final_output = os.path.join(temp_dir, f"final_{export_id}.mp4")
        concatenate_clips_with_transition(
            clip_paths=processed_paths,
            output_path=final_output,
            transition=transition,
            include_audio=include_audio_bool,
            clip_info=sorted_clips
        )

        logger.info(f"[Multi-Clip Export] Final output: {final_output}")

        # Get video duration for cost-optimized GPU selection in overlay mode
        video_duration = get_video_duration(final_output)
        logger.info(f"[Multi-Clip Export] Video duration: {video_duration:.2f}s")

        # Restore user context after async operations
        set_current_user_id(captured_user_id)
        logger.info(f"[Multi-Clip Export] Restored user context: {captured_user_id}")

        # Save working video to database if project_id provided
        working_video_id = None
        working_filename = None
        if project_id:
            try:
                # Generate unique filename
                working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"

                # Upload to R2 with periodic progress updates (can take 60+ seconds for large files)
                # Run upload in thread while sending heartbeat progress every 10 seconds
                upload_result = [None]  # Use list to store result from thread
                upload_error = [None]

                def do_upload():
                    try:
                        result = upload_to_r2(captured_user_id, f"working_videos/{working_filename}", Path(final_output))
                        upload_result[0] = result
                    except Exception as e:
                        upload_error[0] = e

                import threading
                upload_thread = threading.Thread(target=do_upload)
                upload_thread.start()

                # Send periodic progress while upload is running
                progress_value = 90
                while upload_thread.is_alive():
                    upload_progress = {
                        "progress": progress_value,
                        "message": "Uploading to cloud storage...",
                        "status": "processing"
                    }
                    export_progress[export_id] = upload_progress
                    await manager.send_progress(export_id, upload_progress)
                    # Wait up to 10 seconds, checking if thread is done
                    upload_thread.join(timeout=10)
                    # Slowly increment progress (90 -> 95 during upload)
                    if progress_value < 95:
                        progress_value += 1

                # Check for errors
                if upload_error[0]:
                    raise upload_error[0]
                if not upload_result[0]:
                    raise Exception("Failed to upload working video to R2")

                with get_db_connection() as conn:
                    cursor = conn.cursor()

                    # Get next version number
                    cursor.execute("""
                        SELECT COALESCE(MAX(version), 0) + 1 as next_version
                        FROM working_videos WHERE project_id = ?
                    """, (project_id,))
                    next_version = cursor.fetchone()['next_version']

                    # Reset final_video_id (working video changed, need re-export overlay)
                    cursor.execute("UPDATE projects SET final_video_id = NULL WHERE id = ?", (project_id,))

                    # Generate highlight regions at clip boundaries
                    # Use actual durations from processed clips (not calculated from input data)
                    actual_durations = [get_video_duration(path) for path in processed_paths]
                    source_clips = build_clip_boundaries_from_durations(clips_data, actual_durations, transition)

                    # Run player detection on local video file (before cleanup)
                    # Use local YOLO directly on the temp file, no R2 download needed
                    try:
                        highlight_regions = await run_local_detection_on_video_file(
                            video_path=final_output,
                            source_clips=source_clips,
                        )
                        logger.info(f"[Multi-Clip Export] Local detection complete: {len(highlight_regions)} regions")
                    except Exception as det_error:
                        logger.warning(f"[Multi-Clip Export] Local detection failed, using defaults: {det_error}")
                        highlight_regions = generate_default_highlight_regions(source_clips)

                    highlights_json = json.dumps(highlight_regions)

                    # Create working_videos record with duration and highlight regions
                    cursor.execute("""
                        INSERT INTO working_videos (project_id, filename, version, duration, highlights_data)
                        VALUES (?, ?, ?, ?, ?)
                    """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None, highlights_json))
                    working_video_id = cursor.lastrowid

                    # Update project with new working_video_id
                    cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

                    conn.commit()
                    logger.info(f"[Multi-Clip Export] Created working video {working_video_id} for project {project_id}")

            except Exception as e:
                logger.error(f"[Multi-Clip Export] Failed to save working video: {e}", exc_info=True)
                # Don't fail the whole export - still return success
                working_video_id = None

        # Complete - include working_video_id so frontend knows the video was saved
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": ExportStatus.COMPLETE,
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing",
            "workingVideoId": working_video_id,
            "workingFilename": working_filename
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        # Clean up
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        # Return JSON response (MVC: frontend doesn't need the video data)
        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'working_filename': working_filename,
            'project_id': project_id
        })

    except HTTPException:
        import time
        time.sleep(0.5)
        # Clean up GPU memory on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Multi-Clip Export] Cleanup failed: {cleanup_error}")
        raise
    except Exception as e:
        import traceback
        import socket
        full_traceback = traceback.format_exc()
        logger.error(f"[Multi-Clip Export] Failed: {str(e)}")
        logger.error(f"[Multi-Clip Export] Full traceback:\n{full_traceback}")

        # Translate network errors to user-friendly messages
        error_str = str(e)
        if isinstance(e, socket.gaierror) or "getaddrinfo failed" in error_str:
            user_error = "Internet connection lost. Your export may still complete - check 'In Progress' exports to see if it finished."
            is_recoverable = True
        elif "connection" in error_str.lower() or "network" in error_str.lower():
            user_error = "Network error during export. Please check your internet connection and try again."
            is_recoverable = True
        else:
            user_error = f"Export failed: {error_str}"
            is_recoverable = False

        # Send both 'message' and 'error' for frontend compatibility
        error_data = {
            "progress": 0,
            "message": user_error,
            "error": user_error,
            "status": "error",
            "recoverable": is_recoverable,
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        # Update export_jobs record to error status
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs
                        SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (str(e), export_id))
                    conn.commit()
                logger.info(f"[Multi-Clip Export] Updated export_jobs to error: {export_id}")
            except Exception as db_e:
                logger.warning(f"[Multi-Clip Export] Failed to update export_jobs error: {db_e}")
        import time
        time.sleep(0.5)
        # Clean up GPU memory on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Multi-Clip Export] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=user_error)


@router.post("/chapters")
async def extract_chapters(
    video: UploadFile = File(...)
):
    """
    Extract chapter markers from a video file.

    Returns chapter data that can be used to auto-generate highlight regions
    in Overlay mode.
    """
    temp_dir = tempfile.mkdtemp()
    temp_file = os.path.join(temp_dir, "input.mp4")

    try:
        # Save uploaded file
        with open(temp_file, "wb") as f:
            content = await video.read()
            f.write(content)

        # Use ffprobe to extract chapter data
        probe = ffmpeg.probe(temp_file, show_chapters=None)

        chapters = []
        for chapter in probe.get('chapters', []):
            start_time = float(chapter.get('start_time', 0))
            end_time = float(chapter.get('end_time', 0))

            tags = chapter.get('tags', {})
            title = tags.get('title', f"Chapter {len(chapters) + 1}")

            chapters.append({
                "title": title,
                "start_time": start_time,
                "end_time": end_time
            })

        logger.info(f"[Chapters] Extracted {len(chapters)} chapters from video")

        return {"chapters": chapters}

    except Exception as e:
        logger.error(f"[Chapters] Failed to extract chapters: {e}")
        return {"chapters": []}

    finally:
        import time
        time.sleep(0.3)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


@router.post("/concat-for-overlay")
async def concat_for_overlay(
    request: Request,
):
    """
    Concatenate multiple video clips without any framing/cropping.

    This endpoint is used when the user wants to skip Framing mode and go
    directly to Overlay mode with pre-edited clips.
    """
    logger.info("[Concat for Overlay] Starting...")

    # Parse form data to get video files
    form = await request.form()

    # Extract video files (video_0, video_1, etc.)
    video_files: Dict[int, UploadFile] = {}
    for key, value in form.items():
        if key.startswith('video_'):
            try:
                index = int(key.split('_')[1])
                video_files[index] = value
                logger.info(f"[Concat for Overlay] Found video file: {key}")
            except (ValueError, IndexError):
                continue

    if not video_files:
        raise HTTPException(status_code=400, detail="No video files provided")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_paths = []

    try:
        # Save all uploaded files to temp directory
        sorted_indices = sorted(video_files.keys())
        clip_info = []

        for idx in sorted_indices:
            video_file = video_files[idx]
            file_ext = Path(video_file.filename).suffix or ".mp4"
            input_path = os.path.join(temp_dir, f"input_{idx}{file_ext}")

            with open(input_path, 'wb') as f:
                content = await video_file.read()
                f.write(content)

            input_paths.append(input_path)

            # Get video duration for clip info
            duration = get_video_duration(input_path)
            clip_info.append({
                'fileName': video_file.filename,
                'index': idx,
                'duration': duration
            })

            logger.info(f"[Concat for Overlay] Saved clip {idx}: {video_file.filename} ({duration:.2f}s)")

        # Single clip - just return it directly with metadata
        if len(input_paths) == 1:
            clip_metadata = {
                'source_clips': [{
                    'index': 0,
                    'name': clip_info[0]['fileName'],
                    'fileName': clip_info[0]['fileName'],
                    'start_time': 0,
                    'end_time': clip_info[0]['duration'],
                    'duration': clip_info[0]['duration']
                }]
            }

            metadata_json = json.dumps(clip_metadata)
            metadata_b64 = base64.b64encode(metadata_json.encode()).decode()

            return FileResponse(
                input_paths[0],
                media_type='video/mp4',
                filename=clip_info[0]['fileName'],
                headers={'X-Clip-Metadata': metadata_b64},
                background=BackgroundTask(lambda: shutil.rmtree(temp_dir) if os.path.exists(temp_dir) else None)
            )

        # Multiple clips - concatenate with chapter markers
        final_output = os.path.join(temp_dir, f"concat_{uuid.uuid4().hex}.mp4")

        # Use cut transition (simple concatenation)
        concatenate_clips_with_transition(
            clip_paths=input_paths,
            output_path=final_output,
            transition={'type': 'cut', 'duration': 0},
            include_audio=True,
            clip_info=clip_info
        )

        # Calculate clip timestamps in concatenated video
        source_clips = []
        current_time = 0.0
        for i, info in enumerate(clip_info):
            source_clips.append({
                'index': i,
                'name': info['fileName'],
                'fileName': info['fileName'],
                'start_time': current_time,
                'end_time': current_time + info['duration'],
                'duration': info['duration']
            })
            current_time += info['duration']

        clip_metadata = {'source_clips': source_clips}

        logger.info(f"[Concat for Overlay] Created concatenated video with {len(source_clips)} clips")

        metadata_json = json.dumps(clip_metadata)
        metadata_b64 = base64.b64encode(metadata_json.encode()).decode()

        return FileResponse(
            final_output,
            media_type='video/mp4',
            filename=f"concat_{len(source_clips)}_clips.mp4",
            headers={'X-Clip-Metadata': metadata_b64},
            background=BackgroundTask(lambda: shutil.rmtree(temp_dir) if os.path.exists(temp_dir) else None)
        )

    except HTTPException:
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"[Concat for Overlay] Failed: {str(e)}", exc_info=True)
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Concatenation failed: {str(e)}")
