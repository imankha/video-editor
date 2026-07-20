"""Video-level player-detection payload: hoist + slice (T5600).

Detections used to live only inside each highlight region's ``detections``
array, so deleting a region destroyed its tracking squares. The canonical
store is now ``working_videos.detections_data`` -- a flat, whole-timeline
payload ``{videoWidth, videoHeight, fps, detections:[{timestamp,frame,boxes}]}``.
Region ``detections`` become a read-time projection (a time-slice of this
payload), never persisted per-region.

``hoist_video_detections`` recovers the flat payload from old exports that
only have per-region detections (used by both the v027 migration backfill
and the ``/overlay-data`` read-time fallback -- same logic, single home).
``slice_detections`` is the Python half of the cross-language mirror with
``sliceDetections`` in ``useHighlightRegions.js``; keep them in sync.
"""

from typing import Any

# Matches _keyframes_within_bounds (overlay.py) -- shared tolerance for
# timestamp-boundary inclusion.
DEFAULT_EPS = 0.04


def hoist_video_detections(regions: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Union of every region's ``detections`` into one flat, deduped payload.

    Dedup key is ``(round(timestamp, 2), frame)``. Metadata (videoWidth/
    videoHeight/fps) is taken from the first region that carries it. Returns
    None when there is nothing to hoist (no detections, or no region carries
    metadata) -- callers leave the column/response NULL rather than fabricate.
    """
    seen: set[tuple[float, Any]] = set()
    flat: list[dict[str, Any]] = []
    meta: dict[str, Any] | None = None

    for region in regions:
        if meta is None and (region.get('videoWidth') or region.get('videoHeight') or region.get('fps')):
            meta = {
                'videoWidth': region.get('videoWidth'),
                'videoHeight': region.get('videoHeight'),
                'fps': region.get('fps'),
            }
        for det in region.get('detections') or []:
            key = (round(det.get('timestamp', 0), 2), det.get('frame'))
            if key in seen:
                continue
            seen.add(key)
            flat.append(det)

    if not flat or meta is None:
        return None

    flat.sort(key=lambda d: d.get('timestamp', 0))
    return {**meta, 'detections': flat}


def slice_detections(
    video_detections: dict[str, Any] | None,
    start: float,
    end: float,
    eps: float = DEFAULT_EPS,
) -> list[dict[str, Any]]:
    """Time-slice the flat payload to a region's [start, end] bounds."""
    if not video_detections:
        return []
    return [
        d for d in video_detections.get('detections', [])
        if start - eps <= d.get('timestamp', 0) <= end + eps
    ]
