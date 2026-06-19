"""Clip time-range normalization.

The annotation UI lets a user set a clip's start/end boundaries independently,
which can produce an inverted range (start_time > end_time). An inverted range
breaks downstream ffmpeg extraction (`-ss start -to end` reads nothing), so we
normalize at every DB write so that start_time <= end_time is always true.
"""

from typing import Optional, Tuple


def normalize_clip_range(
    start_time: Optional[float], end_time: Optional[float]
) -> Tuple[Optional[float], Optional[float]]:
    """Return (start, end) ordered so start <= end.

    If either value is None, both are returned unchanged (the caller decides how
    to handle a missing boundary). Only swaps when both are present and inverted.
    """
    if start_time is None or end_time is None:
        return start_time, end_time
    if start_time > end_time:
        return end_time, start_time
    return start_time, end_time
