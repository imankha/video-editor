"""
Image extraction service for player bounding boxes.

Extracts and saves player images from video frames for:
1. Visual reference and debugging
2. Potential future image matching/validation
3. Inspecting transformation results

Images are stored in the user's highlights directory and can be viewed
directly via the /api/highlights/<filename> endpoint.
"""

import cv2
import logging
from pathlib import Path
from typing import Optional, Dict

from ..database import get_highlights_path, get_raw_clips_path

logger = logging.getLogger(__name__)


def extract_player_image(
    video_path: str,
    frame_number: int,
    bbox: Dict,
    raw_clip_id: int,
    keyframe_index: int,
    padding_percent: float = 0.1
) -> Optional[str]:
    """
    Extract and save the player image from a video frame.

    Args:
        video_path: Path to the video file
        frame_number: Frame to extract from (0-indexed)
        bbox: Bounding box {x, y, radiusX, radiusY} - center-based with radii
        raw_clip_id: For naming the saved file
        keyframe_index: For naming the saved file
        padding_percent: Extra padding around the bbox (default 10%)

    Returns:
        Relative path to saved image (e.g., "highlights/clip_42_frame_75_kf0.png"),
        or None on failure

    The saved image filename format:
        clip_{raw_clip_id}_frame_{frame_number}_kf{keyframe_index}.png

    This allows easy identification and sorting of images.
    """
    try:
        # Validate video path
        if not Path(video_path).exists():
            logger.error(f"Video file not found: {video_path}")
            return None

        # Open video
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Cannot open video: {video_path}")
            return None

        try:
            # Get video properties
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

            if frame_number < 0 or frame_number >= total_frames:
                logger.warning(f"Frame {frame_number} out of range (0-{total_frames-1})")
                return None

            # Seek to frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()

            if not ret or frame is None:
                logger.error(f"Failed to read frame {frame_number}")
                return None

            # Get frame dimensions
            frame_height, frame_width = frame.shape[:2]

            # Convert center-based bbox to corner-based
            center_x = bbox.get('x', bbox.get('raw_x', 0))
            center_y = bbox.get('y', bbox.get('raw_y', 0))
            radius_x = bbox.get('radiusX', bbox.get('raw_radiusX', 50))
            radius_y = bbox.get('radiusY', bbox.get('raw_radiusY', 80))

            # Add padding
            padded_radius_x = radius_x * (1 + padding_percent)
            padded_radius_y = radius_y * (1 + padding_percent)

            x1 = int(center_x - padded_radius_x)
            y1 = int(center_y - padded_radius_y)
            x2 = int(center_x + padded_radius_x)
            y2 = int(center_y + padded_radius_y)

            # Clamp to frame bounds
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(frame_width, x2)
            y2 = min(frame_height, y2)

            # Validate crop region
            if x2 <= x1 or y2 <= y1:
                logger.warning(f"Invalid crop region: ({x1},{y1}) to ({x2},{y2})")
                return None

            # Extract region
            player_img = frame[y1:y2, x1:x2]

            if player_img.size == 0:
                logger.warning("Extracted image is empty")
                return None

            # Ensure highlights directory exists
            highlights_dir = get_highlights_path()
            highlights_dir.mkdir(parents=True, exist_ok=True)

            # Generate filename
            filename = f"clip_{raw_clip_id}_frame_{frame_number}_kf{keyframe_index}.png"
            filepath = highlights_dir / filename

            # Save image
            success = cv2.imwrite(str(filepath), player_img)

            if not success:
                logger.error(f"Failed to save image: {filepath}")
                return None

            logger.info(f"Saved player image: {filename} ({x2-x1}x{y2-y1} px)")

            # Return relative path
            return f"highlights/{filename}"

        finally:
            cap.release()

    except Exception as e:
        logger.error(f"Failed to extract player image: {e}")
        return None


def extract_player_images_for_region(
    video_path: str,
    raw_clip_id: int,
    keyframes: list,
    framerate: float = 30.0
) -> list:
    """
    Extract player images for all keyframes in a region.

    Args:
        video_path: Path to the raw clip video file
        raw_clip_id: ID of the raw clip
        keyframes: List of keyframe dicts with raw_frame, raw_x, raw_y, etc.
        framerate: Video framerate

    Returns:
        List of keyframes with player_image_path populated
    """
    updated_keyframes = []

    for i, kf in enumerate(keyframes):
        raw_frame = kf.get('raw_frame', 0)

        # Extract image
        image_path = extract_player_image(
            video_path=video_path,
            frame_number=raw_frame,
            bbox={
                'raw_x': kf.get('raw_x', 0),
                'raw_y': kf.get('raw_y', 0),
                'raw_radiusX': kf.get('raw_radiusX', 50),
                'raw_radiusY': kf.get('raw_radiusY', 80)
            },
            raw_clip_id=raw_clip_id,
            keyframe_index=i
        )

        # Update keyframe with image path
        updated_kf = kf.copy()
        updated_kf['player_image_path'] = image_path
        updated_keyframes.append(updated_kf)

    return updated_keyframes


def get_image_url(image_path: Optional[str]) -> Optional[str]:
    """
    Convert a relative image path to an API URL.

    Args:
        image_path: Relative path like "highlights/clip_42_frame_75_kf0.png"

    Returns:
        API URL like "/api/highlights/clip_42_frame_75_kf0.png"
    """
    if not image_path:
        return None

    # Extract just the filename from the path
    filename = Path(image_path).name
    return f"/api/highlights/{filename}"


def list_highlight_images(raw_clip_id: Optional[int] = None) -> list:
    """
    List all highlight images, optionally filtered by raw_clip_id.

    Args:
        raw_clip_id: If provided, only return images for this clip

    Returns:
        List of image info dicts: {filename, path, url, raw_clip_id, frame, keyframe_index}
    """
    highlights_dir = get_highlights_path()

    if not highlights_dir.exists():
        return []

    images = []
    pattern = f"clip_{raw_clip_id}_*.png" if raw_clip_id else "clip_*.png"

    for filepath in highlights_dir.glob(pattern):
        filename = filepath.name

        # Parse filename: clip_{id}_frame_{frame}_kf{kf_index}.png
        try:
            parts = filename.replace('.png', '').split('_')
            clip_id = int(parts[1])
            frame = int(parts[3])
            kf_index = int(parts[4].replace('kf', ''))

            images.append({
                'filename': filename,
                'path': str(filepath),
                'url': f"/api/highlights/{filename}",
                'raw_clip_id': clip_id,
                'frame': frame,
                'keyframe_index': kf_index
            })
        except (IndexError, ValueError):
            # Skip malformed filenames
            continue

    # Sort by clip_id, then frame, then keyframe_index
    images.sort(key=lambda x: (x['raw_clip_id'], x['frame'], x['keyframe_index']))

    return images
