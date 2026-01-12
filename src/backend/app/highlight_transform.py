"""
Highlight Transformation Library

Transforms highlight data between working video space and raw clip space.
All functions are pure (no side effects) and designed to be fully tested.

COORDINATE SPACES:
- Raw Clip Space: Original video dimensions and timing (before any edits)
- Working Video Space: After crop, trim, and speed modifications

KEY DATA STRUCTURES (from frontend):
- crop_data: List[CropKeyframe] where CropKeyframe = {frame, x, y, width, height, origin}
- segments_data: {boundaries, userSplits, trimRange, segmentSpeeds}
  - boundaries: [0.0, 5.0, 10.0, 15.0] - segment boundaries in seconds
  - segmentSpeeds: {"0": 1.0, "1": 0.5, "2": 1.0} - speed per segment index (string keys!)
  - trimRange: {"start": 2.0, "end": 12.0} or None

TRANSFORMATION FLOW:
- Save: working_time -> source_time (undo speed) -> raw_frame (add trim offset)
- Load: raw_frame -> source_time (subtract trim offset) -> working_time (apply speed)
"""

from typing import Dict, List, Optional, Tuple, Any
import logging
import uuid

logger = logging.getLogger(__name__)


# =============================================================================
# TIME MAPPING FUNCTIONS
# =============================================================================

def get_trim_range(segments_data: Optional[Dict]) -> Tuple[float, float]:
    """
    Extract trim range from segments_data.

    Returns (start, end) tuple. If no trim, returns (0, infinity).
    """
    if not segments_data:
        return (0.0, float('inf'))

    trim_range = segments_data.get('trimRange')
    if not trim_range:
        return (0.0, float('inf'))

    # Handle both dict and list formats
    if isinstance(trim_range, dict):
        return (trim_range.get('start', 0.0), trim_range.get('end', float('inf')))
    elif isinstance(trim_range, (list, tuple)) and len(trim_range) >= 2:
        return (trim_range[0], trim_range[1])

    return (0.0, float('inf'))


def get_segment_speed(segments_data: Optional[Dict], segment_index: int) -> float:
    """
    Get the speed multiplier for a segment.

    Args:
        segments_data: Segments configuration
        segment_index: 0-based segment index

    Returns:
        Speed multiplier (default 1.0)
    """
    if not segments_data:
        return 1.0

    speeds = segments_data.get('segmentSpeeds', {})
    # Keys are strings in the frontend format
    return speeds.get(str(segment_index), 1.0)


def get_segment_at_source_time(
    source_time: float,
    segments_data: Optional[Dict]
) -> Tuple[int, float, float]:
    """
    Find which segment contains a given source time.

    Args:
        source_time: Time in source video (after trim applied, before speed)
        segments_data: Segments configuration

    Returns:
        (segment_index, segment_start, segment_end)
    """
    if not segments_data:
        return (0, 0.0, float('inf'))

    boundaries = segments_data.get('boundaries', [0.0])

    # Ensure we have at least start boundary
    if not boundaries:
        return (0, 0.0, float('inf'))

    # Find the segment containing source_time
    for i in range(len(boundaries) - 1):
        seg_start = boundaries[i]
        seg_end = boundaries[i + 1]

        if seg_start <= source_time < seg_end:
            return (i, seg_start, seg_end)

    # If past all boundaries, return last segment
    if len(boundaries) >= 2:
        return (len(boundaries) - 2, boundaries[-2], boundaries[-1])

    return (0, boundaries[0] if boundaries else 0.0, float('inf'))


def working_time_to_source_time(
    working_time: float,
    segments_data: Optional[Dict]
) -> float:
    """
    Convert working video time to source time (undo speed changes).

    Working time is what the user sees in the timeline after speed changes.
    Source time is the actual position in the source video.

    If segment has speed 0.5x (slow motion), 1 second of working time = 0.5 seconds source time.
    If segment has speed 2.0x (fast forward), 1 second of working time = 2.0 seconds source time.

    Args:
        working_time: Time in the working video (after speed applied)
        segments_data: {boundaries, segmentSpeeds, trimRange}

    Returns:
        Source time (before speed, but within trimmed region)
    """
    if not segments_data:
        return working_time

    boundaries = segments_data.get('boundaries', [])
    trim_start, trim_end = get_trim_range(segments_data)

    if len(boundaries) < 2:
        return working_time + trim_start

    # Walk through non-trimmed segments, accumulating visual time
    accumulated_working_time = 0.0

    for i in range(len(boundaries) - 1):
        seg_start = boundaries[i]
        seg_end = boundaries[i + 1]

        # Skip trimmed segments
        if seg_end <= trim_start or seg_start >= trim_end:
            continue

        # Clamp segment to trim range
        effective_start = max(seg_start, trim_start)
        effective_end = min(seg_end, trim_end)

        speed = get_segment_speed(segments_data, i)
        segment_source_duration = effective_end - effective_start
        segment_working_duration = segment_source_duration / speed  # Slowing down increases visual duration

        if accumulated_working_time + segment_working_duration > working_time:
            # Target time is within this segment
            remaining_working_time = working_time - accumulated_working_time
            source_offset = remaining_working_time * speed  # Convert back to source time
            return effective_start + source_offset

        accumulated_working_time += segment_working_duration

    # If we've gone past all segments, return end of last visible segment
    return trim_end


def source_time_to_working_time(
    source_time: float,
    segments_data: Optional[Dict]
) -> Optional[float]:
    """
    Convert source time to working video time (apply speed changes).

    Inverse of working_time_to_source_time.

    Args:
        source_time: Time in source video
        segments_data: {boundaries, segmentSpeeds, trimRange}

    Returns:
        Working video time, or None if source_time is in a trimmed region
    """
    if not segments_data:
        return source_time

    boundaries = segments_data.get('boundaries', [])
    trim_start, trim_end = get_trim_range(segments_data)

    # Check if source_time is in trimmed region
    if source_time < trim_start or source_time > trim_end:
        return None

    if len(boundaries) < 2:
        return source_time - trim_start

    # Walk through segments up to source_time, accumulating working time
    accumulated_working_time = 0.0

    for i in range(len(boundaries) - 1):
        seg_start = boundaries[i]
        seg_end = boundaries[i + 1]

        # Skip fully trimmed segments
        if seg_end <= trim_start or seg_start >= trim_end:
            continue

        # Clamp segment to trim range
        effective_start = max(seg_start, trim_start)
        effective_end = min(seg_end, trim_end)

        speed = get_segment_speed(segments_data, i)

        if source_time <= effective_start:
            # Haven't reached this segment yet
            break
        elif source_time >= effective_end:
            # Fully within this segment - add full working duration
            segment_source_duration = effective_end - effective_start
            segment_working_duration = segment_source_duration / speed
            accumulated_working_time += segment_working_duration
        else:
            # Target is within this segment
            source_offset = source_time - effective_start
            working_offset = source_offset / speed
            accumulated_working_time += working_offset
            break

    return accumulated_working_time


def working_time_to_raw_frame(
    working_time: float,
    segments_data: Optional[Dict],
    framerate: float = 30.0
) -> Optional[int]:
    """
    Convert working video time to raw clip frame number.

    Steps:
    1. Convert working_time to source_time (undo speed changes)
    2. Source time IS the raw clip time (within the visible region)
    3. Convert to frame number

    Args:
        working_time: Time in seconds within the working video
        segments_data: {boundaries, segmentSpeeds, trimRange}
        framerate: Video framerate (default 30)

    Returns:
        Raw clip frame number, or None if time is outside valid range
    """
    if working_time < 0:
        return None

    source_time = working_time_to_source_time(working_time, segments_data)

    # Validate source_time is within trim range
    trim_start, trim_end = get_trim_range(segments_data)
    if source_time < trim_start or source_time > trim_end:
        return None

    return int(round(source_time * framerate))


def raw_frame_to_working_time(
    raw_frame: int,
    segments_data: Optional[Dict],
    framerate: float = 30.0
) -> Optional[float]:
    """
    Convert raw clip frame number to working video time.

    Inverse of working_time_to_raw_frame.

    Args:
        raw_frame: Frame number in raw clip
        segments_data: {boundaries, segmentSpeeds, trimRange}
        framerate: Video framerate

    Returns:
        Working video time in seconds, or None if frame is in trimmed region
    """
    source_time = raw_frame / framerate

    # Check if in trimmed region
    trim_start, trim_end = get_trim_range(segments_data)
    if source_time < trim_start or source_time > trim_end:
        return None

    return source_time_to_working_time(source_time, segments_data)


# =============================================================================
# COORDINATE MAPPING FUNCTIONS
# =============================================================================

def interpolate_crop_at_frame(
    crop_keyframes: List[Dict],
    frame: int
) -> Optional[Dict]:
    """
    Get the interpolated crop rectangle at a specific frame.

    Uses linear interpolation between keyframes.

    Args:
        crop_keyframes: List of {frame, x, y, width, height} from crop_data
        frame: Target frame number

    Returns:
        {x, y, width, height} interpolated crop at that frame, or None if no keyframes
    """
    if not crop_keyframes:
        return None

    # Sort by frame
    sorted_kfs = sorted(crop_keyframes, key=lambda kf: kf.get('frame', 0))

    # Handle edge cases
    if frame <= sorted_kfs[0].get('frame', 0):
        kf = sorted_kfs[0]
        return {
            'x': kf.get('x', 0),
            'y': kf.get('y', 0),
            'width': kf.get('width', 0),
            'height': kf.get('height', 0)
        }

    if frame >= sorted_kfs[-1].get('frame', 0):
        kf = sorted_kfs[-1]
        return {
            'x': kf.get('x', 0),
            'y': kf.get('y', 0),
            'width': kf.get('width', 0),
            'height': kf.get('height', 0)
        }

    # Find surrounding keyframes
    for i in range(len(sorted_kfs) - 1):
        kf1 = sorted_kfs[i]
        kf2 = sorted_kfs[i + 1]

        frame1 = kf1.get('frame', 0)
        frame2 = kf2.get('frame', 0)

        if frame1 <= frame <= frame2:
            # Linear interpolation
            if frame2 == frame1:
                t = 0
            else:
                t = (frame - frame1) / (frame2 - frame1)

            return {
                'x': kf1.get('x', 0) + t * (kf2.get('x', 0) - kf1.get('x', 0)),
                'y': kf1.get('y', 0) + t * (kf2.get('y', 0) - kf1.get('y', 0)),
                'width': kf1.get('width', 0) + t * (kf2.get('width', 0) - kf1.get('width', 0)),
                'height': kf1.get('height', 0) + t * (kf2.get('height', 0) - kf1.get('height', 0))
            }

    # Fallback (shouldn't reach here)
    return None


def working_coords_to_raw_coords(
    working_x: float,
    working_y: float,
    working_radiusX: float,
    working_radiusY: float,
    crop: Dict,
    working_video_dims: Dict
) -> Dict:
    """
    Transform coordinates from working video space to raw clip space.

    The crop defines what region of the raw clip is visible in the working video.
    Working video (0,0) corresponds to crop (x, y) in raw clip.
    Working video (width, height) corresponds to crop (x+width, y+height) in raw clip.

    Math:
        raw_x = crop.x + (working_x / working_video.width) * crop.width
        raw_y = crop.y + (working_y / working_video.height) * crop.height
        raw_radiusX = working_radiusX * (crop.width / working_video.width)
        raw_radiusY = working_radiusY * (crop.height / working_video.height)

    Args:
        working_x, working_y: Position in working video (pixels)
        working_radiusX, working_radiusY: Size in working video (pixels)
        crop: {x, y, width, height} - crop rectangle in raw clip space
        working_video_dims: {width, height} of working video

    Returns:
        {x, y, radiusX, radiusY} in raw clip space
    """
    working_width = working_video_dims.get('width', 1)
    working_height = working_video_dims.get('height', 1)

    crop_x = crop.get('x', 0)
    crop_y = crop.get('y', 0)
    crop_width = crop.get('width', working_width)
    crop_height = crop.get('height', working_height)

    # Avoid division by zero
    if working_width == 0 or working_height == 0:
        return {'x': crop_x, 'y': crop_y, 'radiusX': working_radiusX, 'radiusY': working_radiusY}

    # Transform position
    raw_x = crop_x + (working_x / working_width) * crop_width
    raw_y = crop_y + (working_y / working_height) * crop_height

    # Transform size (scale proportionally)
    scale_x = crop_width / working_width
    scale_y = crop_height / working_height
    raw_radiusX = working_radiusX * scale_x
    raw_radiusY = working_radiusY * scale_y

    return {
        'x': raw_x,
        'y': raw_y,
        'radiusX': raw_radiusX,
        'radiusY': raw_radiusY
    }


def raw_coords_to_working_coords(
    raw_x: float,
    raw_y: float,
    raw_radiusX: float,
    raw_radiusY: float,
    crop: Dict,
    working_video_dims: Dict
) -> Dict:
    """
    Transform coordinates from raw clip space to working video space.

    Inverse of working_coords_to_raw_coords.

    Math:
        working_x = ((raw_x - crop.x) / crop.width) * working_video.width
        working_y = ((raw_y - crop.y) / crop.height) * working_video.height

    Args:
        raw_x, raw_y: Position in raw clip (pixels)
        raw_radiusX, raw_radiusY: Size in raw clip (pixels)
        crop: {x, y, width, height} - crop rectangle in raw clip space
        working_video_dims: {width, height} of working video

    Returns:
        {x, y, radiusX, radiusY, visible} in working video space
        visible=True if the center point is within the working video bounds
    """
    working_width = working_video_dims.get('width', 1)
    working_height = working_video_dims.get('height', 1)

    crop_x = crop.get('x', 0)
    crop_y = crop.get('y', 0)
    crop_width = crop.get('width', 1)
    crop_height = crop.get('height', 1)

    # Avoid division by zero
    if crop_width == 0 or crop_height == 0:
        return {
            'x': 0, 'y': 0,
            'radiusX': raw_radiusX, 'radiusY': raw_radiusY,
            'visible': False
        }

    # Transform position
    working_x = ((raw_x - crop_x) / crop_width) * working_width
    working_y = ((raw_y - crop_y) / crop_height) * working_height

    # Transform size
    scale_x = working_width / crop_width
    scale_y = working_height / crop_height
    working_radiusX = raw_radiusX * scale_x
    working_radiusY = raw_radiusY * scale_y

    # Check if center point is within bounds
    visible = (0 <= working_x <= working_width) and (0 <= working_y <= working_height)

    return {
        'x': working_x,
        'y': working_y,
        'radiusX': working_radiusX,
        'radiusY': working_radiusY,
        'visible': visible
    }


# =============================================================================
# HIGH-LEVEL REGION TRANSFORMATIONS
# =============================================================================

def transform_keyframe_to_raw(
    keyframe: Dict,
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> Optional[Dict]:
    """
    Transform a single highlight keyframe from working video space to raw clip space.

    Args:
        keyframe: {time, x, y, radiusX, radiusY, opacity, color, ...}
        crop_keyframes: From working_clips.crop_data
        segments_data: From working_clips.segments_data
        working_video_dims: {width, height} of the working video
        framerate: Video framerate

    Returns:
        {raw_frame, raw_x, raw_y, raw_radiusX, raw_radiusY, opacity, color}
        or None if the keyframe is in an invalid time range
    """
    working_time = keyframe.get('time', 0)

    # Convert time to raw frame
    raw_frame = working_time_to_raw_frame(working_time, segments_data, framerate)
    if raw_frame is None:
        return None

    # Get crop at this frame
    crop = interpolate_crop_at_frame(crop_keyframes, raw_frame)
    if crop is None:
        # No crop data - use identity transform (assume full frame)
        crop = {
            'x': 0, 'y': 0,
            'width': working_video_dims.get('width', 1920),
            'height': working_video_dims.get('height', 1080)
        }

    # Transform coordinates
    raw_coords = working_coords_to_raw_coords(
        working_x=keyframe.get('x', 0),
        working_y=keyframe.get('y', 0),
        working_radiusX=keyframe.get('radiusX', 30),
        working_radiusY=keyframe.get('radiusY', 50),
        crop=crop,
        working_video_dims=working_video_dims
    )

    return {
        'raw_frame': raw_frame,
        'raw_x': raw_coords['x'],
        'raw_y': raw_coords['y'],
        'raw_radiusX': raw_coords['radiusX'],
        'raw_radiusY': raw_coords['radiusY'],
        'opacity': keyframe.get('opacity', 0.15),
        'color': keyframe.get('color', '#FFFF00'),
        'player_image_path': None  # Will be filled in by image extraction
    }


def transform_keyframe_to_working(
    raw_keyframe: Dict,
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> Optional[Dict]:
    """
    Transform a single highlight keyframe from raw clip space to working video space.

    Args:
        raw_keyframe: {raw_frame, raw_x, raw_y, raw_radiusX, raw_radiusY, opacity, color}
        crop_keyframes: From working_clips.crop_data
        segments_data: From working_clips.segments_data
        working_video_dims: {width, height} of the working video
        framerate: Video framerate

    Returns:
        {time, x, y, radiusX, radiusY, opacity, color, frame}
        or None if the keyframe is outside visible range or crop bounds
    """
    raw_frame = raw_keyframe.get('raw_frame', 0)

    # Convert raw frame to working time
    working_time = raw_frame_to_working_time(raw_frame, segments_data, framerate)
    if working_time is None:
        return None

    # Get crop at this frame
    crop = interpolate_crop_at_frame(crop_keyframes, raw_frame)
    if crop is None:
        # No crop data - use identity transform
        crop = {
            'x': 0, 'y': 0,
            'width': working_video_dims.get('width', 1920),
            'height': working_video_dims.get('height', 1080)
        }

    # Transform coordinates
    working_coords = raw_coords_to_working_coords(
        raw_x=raw_keyframe.get('raw_x', 0),
        raw_y=raw_keyframe.get('raw_y', 0),
        raw_radiusX=raw_keyframe.get('raw_radiusX', 30),
        raw_radiusY=raw_keyframe.get('raw_radiusY', 50),
        crop=crop,
        working_video_dims=working_video_dims
    )

    # Skip if not visible
    if not working_coords.get('visible', True):
        return None

    # Calculate frame number in working video
    working_frame = int(round(working_time * framerate))

    return {
        'time': working_time,
        'frame': working_frame,
        'x': working_coords['x'],
        'y': working_coords['y'],
        'radiusX': working_coords['radiusX'],
        'radiusY': working_coords['radiusY'],
        'opacity': raw_keyframe.get('opacity', 0.15),
        'color': raw_keyframe.get('color', '#FFFF00'),
        'origin': 'restored'  # Mark as restored from raw clip
    }


def transform_highlight_region_to_raw(
    region: Dict,
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> Optional[Dict]:
    """
    Transform a complete highlight region from working video space to raw clip space.

    Args:
        region: {id, start_time, end_time, enabled, keyframes: [{time, x, y, radiusX, radiusY, ...}]}
        crop_keyframes: From working_clips.crop_data
        segments_data: From working_clips.segments_data
        working_video_dims: {width, height} of the working video
        framerate: Video framerate

    Returns:
        {
            id: str,
            raw_start_frame: int,
            raw_end_frame: int,
            duration_seconds: float,
            keyframes: [...]
        }
        or None if no keyframes could be transformed
    """
    if not region.get('enabled', True):
        return None

    start_time = region.get('start_time', region.get('startTime', 0))
    end_time = region.get('end_time', region.get('endTime', 0))

    # Transform time boundaries
    raw_start_frame = working_time_to_raw_frame(start_time, segments_data, framerate)
    raw_end_frame = working_time_to_raw_frame(end_time, segments_data, framerate)

    if raw_start_frame is None or raw_end_frame is None:
        return None

    # Transform keyframes
    raw_keyframes = []
    for kf in region.get('keyframes', []):
        raw_kf = transform_keyframe_to_raw(
            keyframe=kf,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=framerate
        )
        if raw_kf:
            raw_keyframes.append(raw_kf)

    if not raw_keyframes:
        return None

    return {
        'id': region.get('id', str(uuid.uuid4())),
        'raw_start_frame': raw_start_frame,
        'raw_end_frame': raw_end_frame,
        'duration_seconds': end_time - start_time,
        'keyframes': raw_keyframes
    }


def transform_highlight_region_to_working(
    raw_region: Dict,
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> Optional[Dict]:
    """
    Transform a highlight region from raw clip space to working video space.

    Args:
        raw_region: {id, raw_start_frame, raw_end_frame, duration_seconds, keyframes: [...]}
        crop_keyframes: From working_clips.crop_data
        segments_data: From working_clips.segments_data
        working_video_dims: {width, height} of the working video
        framerate: Video framerate

    Returns:
        {id, start_time, end_time, enabled, keyframes: [...]}
        or None if the entire region is outside the visible range
    """
    raw_start_frame = raw_region.get('raw_start_frame', 0)
    raw_end_frame = raw_region.get('raw_end_frame', 0)

    # Transform time boundaries
    start_time = raw_frame_to_working_time(raw_start_frame, segments_data, framerate)
    end_time = raw_frame_to_working_time(raw_end_frame, segments_data, framerate)

    # If start is not visible but end is, try to find a valid start
    if start_time is None and end_time is not None:
        # Region starts in trimmed area - use the beginning of visible area
        trim_start, _ = get_trim_range(segments_data)
        start_time = source_time_to_working_time(trim_start, segments_data)

    # If end is not visible but start is, try to find a valid end
    if start_time is not None and end_time is None:
        # Region ends in trimmed area - use the end of visible area
        _, trim_end = get_trim_range(segments_data)
        end_time = source_time_to_working_time(trim_end, segments_data)

    if start_time is None or end_time is None:
        return None

    # Transform keyframes
    working_keyframes = []
    for raw_kf in raw_region.get('keyframes', []):
        working_kf = transform_keyframe_to_working(
            raw_keyframe=raw_kf,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=framerate
        )
        if working_kf:
            working_keyframes.append(working_kf)

    if not working_keyframes:
        return None

    return {
        'id': raw_region.get('id', str(uuid.uuid4())),
        'start_time': start_time,
        'end_time': end_time,
        'enabled': True,
        'keyframes': working_keyframes
    }


def transform_all_regions_to_raw(
    regions: List[Dict],
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> List[Dict]:
    """
    Transform all highlight regions from working video space to raw clip space.

    Convenience function that filters out None results.
    """
    raw_regions = []
    for region in regions:
        raw_region = transform_highlight_region_to_raw(
            region=region,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=framerate
        )
        if raw_region:
            raw_regions.append(raw_region)
    return raw_regions


def transform_all_regions_to_working(
    raw_regions: List[Dict],
    crop_keyframes: List[Dict],
    segments_data: Optional[Dict],
    working_video_dims: Dict,
    framerate: float = 30.0
) -> List[Dict]:
    """
    Transform all highlight regions from raw clip space to working video space.

    Convenience function that filters out None results.
    """
    working_regions = []
    for raw_region in raw_regions:
        working_region = transform_highlight_region_to_working(
            raw_region=raw_region,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=framerate
        )
        if working_region:
            working_regions.append(working_region)
    return working_regions
