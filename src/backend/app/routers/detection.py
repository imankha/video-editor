"""
Detection endpoints for the Video Editor API.

This router handles YOLO-based object detection for:
- Player detection (person class)
- Ball detection (sports ball class)
- Video upload for detection (temp storage)

GPU Strategy:
- When MODAL_ENABLED=true: Use Modal cloud GPUs for detection
- When MODAL_ENABLED=false: Use local YOLO model (requires local GPU)

Caching:
- Detection results are cached in R2 per video/frame
- Cache path: detections/{working_video_filename}/frame_{frame_number}.json
- Frontend can check cache before requesting detection
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
import cv2
import os
import logging
import tempfile
import uuid
import shutil
import json
from pathlib import Path
from typing import Optional
from io import BytesIO

from ..models import (
    PlayerDetectionRequest,
    PlayerDetectionResponse,
    Detection,
    BoundingBox,
)
from ..services.modal_client import (
    modal_enabled,
    call_modal_detect_players,
)
from ..database import get_db_connection
from ..user_context import get_current_user_id
from ..storage import (
    file_exists_in_r2,
    upload_bytes_to_r2,
    get_r2_client,
    R2_BUCKET,
    r2_key,
    R2_ENABLED,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/detect", tags=["detection"])

# YOLO model singleton
_yolo_model = None

# YOLO class IDs
PERSON_CLASS_ID = 0

# Temp video storage for detection
# Maps video_id -> file path
_detection_videos = {}


def get_detection_cache_path(video_filename: str, frame_number: int) -> str:
    """
    Get the R2 relative path for a cached detection result.

    Cache structure: detections/{video_filename}/frame_{frame_number}.json
    This allows us to cache per-frame results and check existence quickly.
    """
    # Extract just the filename without path
    video_name = Path(video_filename).name
    return f"detections/{video_name}/frame_{frame_number}.json"


def get_cached_detection(user_id: str, video_filename: str, frame_number: int) -> Optional[dict]:
    """
    Check if detection result is cached in R2 and return it.

    Returns:
        Detection result dict if cached, None otherwise
    """
    if not R2_ENABLED:
        return None

    cache_path = get_detection_cache_path(video_filename, frame_number)

    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, cache_path)
    try:
        response = client.get_object(Bucket=R2_BUCKET, Key=key)
        data = response['Body'].read()
        result = json.loads(data.decode('utf-8'))
        logger.debug(f"Cache hit for detection: {key}")
        return result
    except client.exceptions.NoSuchKey:
        logger.debug(f"Cache miss for detection: {key}")
        return None
    except Exception as e:
        logger.warning(f"Failed to read detection cache: {key} - {e}")
        return None


def cache_detection_result(user_id: str, video_filename: str, frame_number: int, result: dict) -> bool:
    """
    Cache detection result to R2.

    Returns:
        True if cached successfully, False otherwise
    """
    if not R2_ENABLED:
        return False

    cache_path = get_detection_cache_path(video_filename, frame_number)

    try:
        data = json.dumps(result).encode('utf-8')
        success = upload_bytes_to_r2(user_id, cache_path, data)
        if success:
            logger.debug(f"Cached detection result: {cache_path}")
        return success
    except Exception as e:
        logger.warning(f"Failed to cache detection result: {cache_path} - {e}")
        return False


def check_detection_cached(user_id: str, video_filename: str, frame_number: int) -> bool:
    """
    Check if a detection result is cached (without downloading it).

    This is faster than get_cached_detection when we just need to know
    if the frame has been detected before.
    """
    if not R2_ENABLED:
        return False

    cache_path = get_detection_cache_path(video_filename, frame_number)
    return file_exists_in_r2(user_id, cache_path)


def get_yolo_model():
    """
    Load YOLO model (singleton pattern for efficiency).
    Model is loaded on first use to avoid slow startup.
    """
    global _yolo_model

    if _yolo_model is None:
        try:
            from ultralytics import YOLO

            # Look for model in backend directory
            backend_dir = Path(__file__).parent.parent.parent
            model_path = backend_dir / "yolov8x.pt"

            if not model_path.exists():
                # Try alternative locations
                alt_paths = [
                    Path("yolov8x.pt"),
                    Path("src/backend/yolov8x.pt"),
                ]
                for alt in alt_paths:
                    if alt.exists():
                        model_path = alt
                        break

            if not model_path.exists():
                logger.warning(f"YOLO model not found at {model_path}, will download...")
                model_path = "yolov8x.pt"  # Will auto-download

            logger.info(f"Loading YOLO model from {model_path}")
            _yolo_model = YOLO(str(model_path))
            logger.info("YOLO model loaded successfully")

        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="ultralytics package not installed. Run: pip install ultralytics"
            )
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to load YOLO model: {str(e)}")

    return _yolo_model


def extract_frame(video_path: str, frame_number: int):
    """Extract a specific frame from a video file."""
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {video_path}")

    try:
        # Get video properties
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if frame_number < 0 or frame_number >= total_frames:
            raise HTTPException(
                status_code=400,
                detail=f"Frame {frame_number} out of range (0-{total_frames-1})"
            )

        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()

        if not ret or frame is None:
            raise HTTPException(status_code=500, detail=f"Failed to read frame {frame_number}")

        return frame, width, height

    finally:
        cap.release()


def get_video_path(video_id: str = None, video_path: str = None) -> str:
    """
    Resolve video path from either video_id (uploaded) or direct path.
    Returns the actual file path to use for detection.
    """
    if video_id:
        if video_id not in _detection_videos:
            raise HTTPException(
                status_code=404,
                detail=f"Video not found. Please upload video first using /api/detect/upload"
            )
        return _detection_videos[video_id]

    if video_path:
        return video_path

    raise HTTPException(
        status_code=400,
        detail="Either video_id or video_path must be provided"
    )


@router.post("/upload")
async def upload_video_for_detection(video: UploadFile = File(...)):
    """
    Upload a video file for detection.

    Stores the video in a temp location and returns a video_id
    that can be used for subsequent detection calls.

    Returns: { video_id: str, message: str }
    """
    # Generate unique video ID
    video_id = str(uuid.uuid4())

    # Create temp directory if needed
    temp_dir = Path(tempfile.gettempdir()) / "video_editor_detection"
    temp_dir.mkdir(exist_ok=True)

    # Save video to temp file
    file_ext = Path(video.filename).suffix or ".mp4"
    temp_path = temp_dir / f"{video_id}{file_ext}"

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(video.file, buffer)

        # Store mapping
        _detection_videos[video_id] = str(temp_path)

        logger.info(f"Uploaded video for detection: {video_id} -> {temp_path}")

        return {
            "video_id": video_id,
            "message": "Video uploaded successfully"
        }

    except Exception as e:
        # Clean up on error
        if temp_path.exists():
            temp_path.unlink()
        logger.error(f"Failed to upload video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")


@router.delete("/upload/{video_id}")
async def delete_uploaded_video(video_id: str):
    """
    Delete an uploaded video file.

    Call this when detection is no longer needed to free up disk space.
    """
    if video_id not in _detection_videos:
        raise HTTPException(status_code=404, detail="Video not found")

    try:
        video_path = _detection_videos[video_id]
        if os.path.exists(video_path):
            os.remove(video_path)
        del _detection_videos[video_id]

        logger.info(f"Deleted detection video: {video_id}")

        return {"message": "Video deleted successfully"}

    except Exception as e:
        logger.error(f"Failed to delete video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete video: {str(e)}")


@router.post("/players", response_model=PlayerDetectionResponse)
async def detect_players(request: PlayerDetectionRequest):
    """
    Detect players (persons) in a single video frame.

    Returns bounding boxes for all detected persons above the confidence threshold.
    Results are cached in R2 to avoid redundant GPU calls.

    Accepts:
    - video_id (from /api/detect/upload) for local uploaded videos
    - video_path for direct local file access
    - user_id + input_key for R2-based videos (uses Modal GPU)
    - project_id for project-based detection (backend looks up working video R2 path)
    """
    # If project_id provided, look up working video R2 path and use Modal
    if request.project_id and modal_enabled():
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT wv.filename
                FROM projects p
                JOIN working_videos wv ON p.working_video_id = wv.id
                WHERE p.id = ?
            """, (request.project_id,))
            row = cursor.fetchone()

        if not row or not row['filename']:
            raise HTTPException(
                status_code=404,
                detail="Working video not found for project. Export from framing mode first."
            )

        user_id = get_current_user_id()
        video_filename = row['filename']
        input_key = f"working_videos/{video_filename}"

        # Check R2 cache first
        cached_result = get_cached_detection(user_id, video_filename, request.frame_number)
        if cached_result:
            logger.info(f"[Cache] Player detection cache hit for project {request.project_id} frame {request.frame_number}")
            # Convert cached result to response model
            detections = [
                Detection(
                    bbox=BoundingBox(**d["bbox"]),
                    confidence=d["confidence"],
                    class_name=d["class_name"],
                    class_id=d.get("class_id", PERSON_CLASS_ID)
                )
                for d in cached_result.get("detections", [])
            ]
            return PlayerDetectionResponse(
                frame_number=cached_result.get("frame_number", request.frame_number),
                detections=detections,
                video_width=cached_result.get("video_width", 0),
                video_height=cached_result.get("video_height", 0)
            )

        # Cache miss - call Modal GPU
        logger.info(f"[Modal] Player detection for project {request.project_id}: {user_id}/{input_key} frame {request.frame_number}")

        result = await call_modal_detect_players(
            user_id=user_id,
            input_key=input_key,
            frame_number=request.frame_number,
            confidence_threshold=request.confidence_threshold or 0.5,
        )

        if result.get("status") == "error":
            raise HTTPException(status_code=500, detail=result.get("error", "Modal detection failed"))

        # Cache the result for future requests
        cache_detection_result(user_id, video_filename, request.frame_number, result)

        # Convert Modal result to response model
        detections = [
            Detection(
                bbox=BoundingBox(**d["bbox"]),
                confidence=d["confidence"],
                class_name=d["class_name"],
                class_id=d.get("class_id", PERSON_CLASS_ID)
            )
            for d in result.get("detections", [])
        ]

        return PlayerDetectionResponse(
            frame_number=result.get("frame_number", request.frame_number),
            detections=detections,
            video_width=result.get("video_width", 0),
            video_height=result.get("video_height", 0)
        )

    # If R2 video provided and Modal is enabled, use Modal GPU
    if request.user_id and request.input_key and modal_enabled():
        logger.info(f"[Modal] Player detection for {request.user_id}/{request.input_key} frame {request.frame_number}")

        result = await call_modal_detect_players(
            user_id=request.user_id,
            input_key=request.input_key,
            frame_number=request.frame_number,
            confidence_threshold=request.confidence_threshold or 0.5,
        )

        if result.get("status") == "error":
            raise HTTPException(status_code=500, detail=result.get("error", "Modal detection failed"))

        # Convert Modal result to response model
        detections = [
            Detection(
                bbox=BoundingBox(**d["bbox"]),
                confidence=d["confidence"],
                class_name=d["class_name"],
                class_id=d.get("class_id", PERSON_CLASS_ID)
            )
            for d in result.get("detections", [])
        ]

        return PlayerDetectionResponse(
            frame_number=result.get("frame_number", request.frame_number),
            detections=detections,
            video_width=result.get("video_width", 0),
            video_height=result.get("video_height", 0)
        )

    # Fallback to local detection
    if request.user_id and request.input_key:
        logger.warning("R2 video provided but Modal is disabled - falling back to local detection is not supported")
        raise HTTPException(
            status_code=400,
            detail="R2 video detection requires Modal to be enabled (set MODAL_ENABLED=true)"
        )

    # Project-based detection requires Modal (working videos are in R2)
    if request.project_id:
        logger.warning("Project-based detection requires Modal to be enabled")
        raise HTTPException(
            status_code=400,
            detail="Project-based detection requires Modal to be enabled (set MODAL_ENABLED=true)"
        )

    # Resolve video path from ID or direct path
    video_path = get_video_path(request.video_id, request.video_path)

    logger.info(f"[Local] Player detection request: frame {request.frame_number} of {video_path}")

    # Extract frame
    frame, width, height = extract_frame(video_path, request.frame_number)

    # Run YOLO detection
    model = get_yolo_model()
    results = model(frame, verbose=False, conf=request.confidence_threshold)

    # Process results - filter for person class only
    detections = []
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue

        for i, box in enumerate(boxes):
            class_id = int(box.cls[0])

            # Only include person detections
            if class_id != PERSON_CLASS_ID:
                continue

            conf = float(box.conf[0])

            # Get box coordinates (xyxy format -> center + dimensions)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            box_width = x2 - x1
            box_height = y2 - y1

            detections.append(Detection(
                bbox=BoundingBox(
                    x=center_x,
                    y=center_y,
                    width=box_width,
                    height=box_height
                ),
                confidence=conf,
                class_name="person",
                class_id=class_id
            ))

    # Sort by confidence (highest first)
    detections.sort(key=lambda d: d.confidence, reverse=True)

    logger.info(f"[Local] Detected {len(detections)} players in frame {request.frame_number}")

    return PlayerDetectionResponse(
        frame_number=request.frame_number,
        detections=detections,
        video_width=width,
        video_height=height
    )


@router.get("/status")
async def detection_status():
    """Check detection status and available backends."""
    global _yolo_model

    return {
        "modal_enabled": modal_enabled(),
        "local_model_loaded": _yolo_model is not None,
        "model_type": "YOLOv8x",
        "supported_classes": {
            "person": PERSON_CLASS_ID,
        },
        "backends": {
            "modal": "Available" if modal_enabled() else "Disabled (set MODAL_ENABLED=true)",
            "local": "Ready" if _yolo_model else "Not loaded (loads on first use)"
        }
    }


@router.get("/cache/{project_id}/{frame_number}")
async def check_detection_cache(project_id: int, frame_number: int):
    """
    Check if detection result is cached for a specific frame.

    This allows the frontend to show cached results immediately
    without making a detection request.

    Returns:
        - cached: bool - whether the frame is cached
        - detections: list - detection results (if cached)
    """
    if not modal_enabled():
        return {"cached": False, "detections": [], "reason": "Modal not enabled"}

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wv.filename
            FROM projects p
            JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        row = cursor.fetchone()

    if not row or not row['filename']:
        return {"cached": False, "detections": [], "reason": "Working video not found"}

    user_id = get_current_user_id()
    video_filename = row['filename']

    # Try to get cached result
    cached_result = get_cached_detection(user_id, video_filename, frame_number)

    if cached_result:
        return {
            "cached": True,
            "frame_number": cached_result.get("frame_number", frame_number),
            "detections": cached_result.get("detections", []),
            "video_width": cached_result.get("video_width", 0),
            "video_height": cached_result.get("video_height", 0)
        }

    return {"cached": False, "detections": []}
