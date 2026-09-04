"""
Per-profile R2 video probing (T8370).

Generalizes `games._probe_video_metadata` (which is hardcoded to the global
`games/{hash}.mp4` namespace) to any per-profile R2 key, so the clip-upload
batch endpoint can probe an uploaded clip source the same way game activation
probes a game video: presigned URL + ffprobe, authoritative duration/dims/fps.
"""

import logging

from app.services.video_probe import probe_r2_video as _probe_r2_video_raw
from app.storage import R2_BUCKET, get_r2_client, r2_key
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)


def probe_r2_video(key: str) -> dict | None:
    """Probe a per-profile R2 object (current user/profile context) via ffprobe.

    `key` is a path RELATIVE to the profile prefix (e.g. "raw_clips/{hash}.mp4"),
    matching `storage.r2_head_object`'s convention. Returns a dict with
    duration/width/height/fps, or None on any failure — never raises (the
    caller treats a failed probe as a per-item batch failure, not a 500).
    """
    try:
        client = get_r2_client()
        if client is None:
            return None
        user_id = get_current_user_id()
        full_key = r2_key(user_id, key)
        return _probe_r2_video_raw(client, R2_BUCKET, full_key)
    except Exception as e:
        logger.warning(f"[media_probe] probe failed for key={key}: {e}")
        return None
