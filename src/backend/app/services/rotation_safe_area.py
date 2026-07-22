"""
Rotation safe-area geometry (T5640 — Framing horizon straighten) — Python mirror.

This is the backend copy of `src/frontend/src/utils/rotationSafeArea.js`. The
CLIENT is the single source of truth for the safe-area clamp (it runs at gesture
time and persists the clamped crop keyframes). This mirror exists only for the
characterization test / defense — per the project rule "correct data, not
workarounds," the export TRUSTS the stored clamped crop and never re-clamps at
render time. Keep the two implementations in sync.

Sign convention (design §2.1): theta = content-correction angle in degrees,
positive = rotate content counter-clockwise (math orientation, y-up). The render
is always crop(rotate_theta_aboutCenter_sameWH(frame)); theta=0 is identity.
"""

import math

# Hard rotation cap in degrees (mirrors MAX_ROT in the JS util).
MAX_ROT = 20


def max_axis_aligned_in_rotated(w: float, h: float, theta_deg: float) -> tuple[float, float]:
    """Largest axis-aligned rectangle (any aspect), centered, inside a W*H frame
    rotated by theta degrees. Returns (width, height) in frame pixels."""
    a = abs(theta_deg) * math.pi / 180
    if a == 0:
        return (w, h)

    sin_a = abs(math.sin(a))
    cos_a = abs(math.cos(a))
    longer = max(w, h)
    shorter = min(w, h)
    width_is_longer = w >= h

    if shorter <= 2 * sin_a * cos_a * longer or abs(sin_a - cos_a) < 1e-10:
        half_short = 0.5 * shorter
        if width_is_longer:
            wr = half_short / sin_a
            hr = half_short / cos_a
        else:
            wr = half_short / cos_a
            hr = half_short / sin_a
    else:
        cos_2a = cos_a * cos_a - sin_a * sin_a
        wr = (w * cos_a - h * sin_a) / cos_2a
        hr = (h * cos_a - w * sin_a) / cos_2a
    return (wr, hr)


def safe_area_for_aspect(w: float, h: float, theta_deg: float, r: float) -> dict:
    """Largest centered box of target aspect r that fits inside the inscribed
    rectangle for (w, h, theta). Returns {x0, y0, w_safe, h_safe}."""
    wr, hr = max_axis_aligned_in_rotated(w, h, theta_deg)

    if wr / hr >= r:
        w_safe = hr * r
        h_safe = hr
    else:
        w_safe = wr
        h_safe = wr / r

    x0 = (w - w_safe) / 2
    y0 = (h - h_safe) / 2
    return {"x0": x0, "y0": y0, "w_safe": w_safe, "h_safe": h_safe}


def clamp_crop_to_safe_area(crop: dict, w: float, h: float, theta_deg: float, r: float) -> dict:
    """Clamp a crop {x, y, width, height} to the inscribed safe area for
    (w, h, theta), preserving aspect r exactly. theta==0 is an identity fast
    path. Returns {x, y, width, height}."""
    if not theta_deg:
        return {"x": crop["x"], "y": crop["y"], "width": crop["width"], "height": crop["height"]}

    s = safe_area_for_aspect(w, h, theta_deg, r)

    cw = min(crop["width"], s["w_safe"])
    ch = min(crop["height"], s["h_safe"])
    if cw / ch > r:
        cw = ch * r
    else:
        ch = cw / r

    max_x = s["x0"] + s["w_safe"] - cw
    max_y = s["y0"] + s["h_safe"] - ch
    x = min(max(crop["x"], s["x0"]), max_x)
    y = min(max(crop["y"], s["y0"]), max_y)

    return {"x": x, "y": y, "width": cw, "height": ch}
