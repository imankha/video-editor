"""
Detection endpoints for the Video Editor API.

This router handles YOLO-based object detection for:
- Player detection (person class)
- Ball detection (sports ball class)
- Video upload for detection (temp storage)
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
    BallDetectionRequest,
    BallDetectionResponse,
    Detection,
    BoundingBox,
    BallPosition
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/detect", tags=["detection"])

# YOLO model singleton
_yolo_model = None

# YOLO class IDs
PERSON_CLASS_ID = 0
SPORTS_BALL_CLASS_ID = 32

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

    Accepts either video_id (from /api/detect/upload) or video_path.
    """
    # Resolve video path from ID or direct path
    video_path = get_video_path(request.video_id, request.video_path)

    logger.info(f"Player detection request: frame {request.frame_number} of {video_path}")

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

    logger.info(f"Detected {len(detections)} players in frame {request.frame_number}")

    return PlayerDetectionResponse(
        frame_number=request.frame_number,
        detections=detections,
        video_width=width,
        video_height=height
    )


@router.post("/ball", response_model=BallDetectionResponse)
async def detect_ball(request: BallDetectionRequest):
    """
    Detect the ball across a range of frames.

    Returns the highest confidence ball detection for each frame.
    Uses YOLO's sports ball class (class_id=32).
    """
    logger.info(f"Ball detection request: frames {request.start_frame}-{request.end_frame} of {request.video_path}")

    if not os.path.exists(request.video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {request.video_path}")

    cap = cv2.VideoCapture(request.video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open video: {request.video_path}")

    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if request.start_frame < 0 or request.end_frame >= total_frames:
            raise HTTPException(
                status_code=400,
                detail=f"Frame range out of bounds (0-{total_frames-1})"
            )

        model = get_yolo_model()
        ball_positions = []

        for frame_num in range(request.start_frame, request.end_frame + 1):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ret, frame = cap.read()

            if not ret or frame is None:
                continue

            # Run detection
            results = model(frame, verbose=False, conf=request.confidence_threshold)

            # Find highest confidence ball detection
            best_ball = None
            best_conf = 0.0

            for result in results:
                boxes = result.boxes
                if boxes is None:
                    continue

                for box in boxes:
                    class_id = int(box.cls[0])

                    # Only sports ball class
                    if class_id != SPORTS_BALL_CLASS_ID:
                        continue

                    conf = float(box.conf[0])
                    if conf > best_conf:
                        best_conf = conf
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        center_x = (x1 + x2) / 2
                        center_y = (y1 + y2) / 2
                        # Use average of width/height as radius
                        radius = ((x2 - x1) + (y2 - y1)) / 4

                        best_ball = BallPosition(
                            frame=frame_num,
                            x=center_x,
                            y=center_y,
                            radius=radius,
                            confidence=conf
                        )

            if best_ball:
                ball_positions.append(best_ball)

        logger.info(f"Detected ball in {len(ball_positions)} frames")

        return BallDetectionResponse(
            ball_positions=ball_positions,
            video_width=width,
            video_height=height
        )

    finally:
        cap.release()


@router.get("/status")
async def detection_status():
    """Check if YOLO model is loaded and ready."""
    global _yolo_model

    return {
        "model_loaded": _yolo_model is not None,
        "model_type": "YOLOv8x" if _yolo_model else None,
        "supported_classes": {
            "person": PERSON_CLASS_ID,
            "sports_ball": SPORTS_BALL_CLASS_ID
        }
    }
