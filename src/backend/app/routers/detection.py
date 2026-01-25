"""
Detection endpoints for the Video Editor API.

This router handles YOLO-based object detection for:
- Player detection (person class)
- Ball detection (sports ball class)
- Video upload for detection (temp storage)

GPU Strategy:
- When MODAL_ENABLED=true: Use Modal cloud GPUs for detection
- When MODAL_ENABLED=false: Use local YOLO model (requires local GPU)
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
import cv2
import os
import logging
import tempfile
import uuid
import shutil
from pathlib import Path

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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/detect", tags=["detection"])

# YOLO model singleton
_yolo_model = None

# YOLO class IDs
PERSON_CLASS_ID = 0

# Temp video storage for detection
# Maps video_id -> file path
_detection_videos = {}


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

    Accepts:
    - video_id (from /api/detect/upload) for local uploaded videos
    - video_path for direct local file access
    - user_id + input_key for R2-based videos (uses Modal GPU)
    """
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
