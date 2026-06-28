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

    The predefined sizes (the two product ratios, 9:16 and 16:9) are independent of the
    source dimensions, so they resolve even when ``video_width``/``video_height`` are
    unknown. An arbitrary ratio needs the source dims to size the box; without them we
    raise rather than silently guess (No Silent Fallbacks).
    """
    if aspect_ratio in DEFAULT_CROP_SIZES:
        return DEFAULT_CROP_SIZES[aspect_ratio]

    if not video_width or not video_height:
        raise ValueError(
            f"Cannot size a default crop for ratio {aspect_ratio!r} without source "
            f"dimensions (got width={video_width}, height={video_height})."
        )

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


def refit_crop_keyframes(keyframes: list[dict], video_width, video_height,
                         new_aspect_ratio: str) -> list[dict]:
    """Re-fit existing crop keyframes to a new aspect ratio, preserving framing (T3910).

    For each keyframe we keep the box CENTER (where the user pointed the crop), swap in the
    ratio-correct box size for ``new_aspect_ratio``, and clamp the repositioned box to the video
    bounds. ``frame`` and ``origin`` are copied verbatim so keyframe origins are never corrupted
    (the permanent frame-0 boundary stays permanent — see T350/T2000).

    This is the "re-fit, don't discard" behaviour: changing the reel ratio keeps each clip's
    framing position instead of snapping every box back to centered default.

    ``video_width``/``video_height`` MAY be None (T4050): a clip materialized from a legacy
    ``game_videos`` row never recorded its source dims. For the two product ratios the box size
    is fixed (it does not need the source dims), so we still re-shape the box to the new ratio
    and only clamp the top-left to >= 0 (we can't clamp to a frame we can't measure). This means
    a reframe is NEVER silently skipped just because dims are missing -- previously this path
    no-op'd and the reframe was dropped at export.

    Returns a NEW list; the input is not mutated. Keyframes missing box geometry are passed
    through unchanged (we can't re-center a box we can't measure).
    """
    new_w, new_h = default_crop_size(video_width, video_height, new_aspect_ratio)
    has_bounds = bool(video_width) and bool(video_height)
    max_x = max(0, video_width - new_w) if has_bounds else None
    max_y = max(0, video_height - new_h) if has_bounds else None

    refit = []
    for kf in keyframes:
        x, y = kf.get("x"), kf.get("y")
        w, h = kf.get("width"), kf.get("height")
        if None in (x, y, w, h):
            # No box geometry — leave the keyframe as-is rather than guessing a center.
            refit.append(dict(kf))
            continue

        center_x = x + w / 2
        center_y = y + h / 2
        new_x = max(round(center_x - new_w / 2), 0)
        new_y = max(round(center_y - new_h / 2), 0)
        if has_bounds:
            new_x = min(new_x, max_x)
            new_y = min(new_y, max_y)

        new_kf = dict(kf)
        new_kf.update({"x": new_x, "y": new_y, "width": new_w, "height": new_h})
        refit.append(new_kf)

    return refit


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
