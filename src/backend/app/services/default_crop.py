"""Centered default crop — the zero-effort "keep your player in the shot" default (T3700 P0).

A clip with no crop is NOT an error: the user just didn't customize the frame. We apply a
sensible centered default so a framing export always succeeds. This is a real, named product
default (not a silent fallback hiding a bug). It mirrors the frontend default in
`src/frontend/src/modes/framing/utils/defaultCrop.js` / `useCrop.js` so a clip the user opened
(visible default) and a clip they never opened get the SAME crop.
"""

# Fixed crop sizes optimized for upscaling, keyed by output aspect ratio.
# Mirrors DEFAULT_CROP_SIZES in the frontend.
DEFAULT_CROP_SIZES = {
    "9:16": (205, 365),
    "16:9": (640, 360),
}


def default_crop_size(video_width: int, video_height: int, aspect_ratio: str) -> tuple[int, int]:
    """Crop (width, height) for the target aspect ratio.

    Uses a predefined size when available, otherwise the largest rectangle of that
    aspect ratio that fits inside the video.
    """
    if aspect_ratio in DEFAULT_CROP_SIZES:
        return DEFAULT_CROP_SIZES[aspect_ratio]

    ratio_w, ratio_h = (float(x) for x in aspect_ratio.split(":"))
    ratio = ratio_w / ratio_h
    if video_width / video_height > ratio:
        # Video is wider — constrain by height
        crop_h = video_height
        crop_w = round(crop_h * ratio)
    else:
        # Video is taller — constrain by width
        crop_w = video_width
        crop_h = round(crop_w / ratio)
    return int(crop_w), int(crop_h)


def default_crop_keyframes(video_width: int, video_height: int, aspect_ratio: str,
                           total_frames: int = 1) -> list[dict]:
    """Frame-based keyframes for a static, centered default crop.

    Returns two identical permanent keyframes (start + end) so the crop is constant
    across the clip — the same shape produced by the frontend's default initialization.
    """
    crop_w, crop_h = default_crop_size(video_width, video_height, aspect_ratio)
    box = {
        "x": round((video_width - crop_w) / 2),
        "y": round((video_height - crop_h) / 2),
        "width": crop_w,
        "height": crop_h,
    }
    end_frame = max(1, int(total_frames))
    return [{"frame": 0, **box}, {"frame": end_frame, **box}]
