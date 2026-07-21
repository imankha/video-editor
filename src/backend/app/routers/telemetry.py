"""Client-side telemetry beacons (T5641).

Some failures happen entirely in the browser and never touch the server. The
Framing/Overlay video elements stream their source straight from R2 via a
presigned URL, so when the browser's media pipeline rejects a (valid) file with
MEDIA_ERR_SRC_NOT_SUPPORTED, the server never sees it -- the error only lands in
the user's console. After the client exhausts its format-error retries
(useVideo.js), it fire-and-forgets the captured diagnostic here so the failure
is visible in SERVER logs (and thus in our log tooling), not just the user's
console.

Deliberately lenient: NO hard auth. A dead/expired session can be the very
cause we're chasing, so requiring auth would drop exactly the reports we most
want. The user is attributed opportunistically from the request context when a
session is present, else logged anonymous. Always returns 204.
"""

import logging

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["telemetry"])


class VideoErrorReport(BaseModel):
    """Diagnostic captured by useVideo.js when a streaming video fails to play.

    Every field is optional -- a beacon must never fail validation and drop the
    report. `srcKey` is the R2 key PATH only (the client strips the presigned
    query string, which carries the signature)."""

    errorCode: int | None = None          # MediaError.code (4 = SRC_NOT_SUPPORTED)
    errorMessage: str | None = None
    networkState: int | None = None       # HTMLMediaElement.networkState
    readyState: int | None = None         # HTMLMediaElement.readyState
    bufferedSec: float | None = None
    currentTime: float | None = None
    videoWidth: int | None = None
    videoHeight: int | None = None
    srcKey: str | None = None             # R2 key path, signature stripped
    retries: int | None = None            # how many retries were attempted
    probeStatus: int | None = None        # HTTP status of the post-failure Range probe
    probeContentType: str | None = None
    probeIsHtml: bool | None = None       # probe returned HTML (e.g. an error page)?
    context: str | None = None            # which screen: "framing" | "overlay" | "annotate"
    userAgent: str | None = None


@router.post("/api/client-errors/video", status_code=204)
async def report_video_error(payload: VideoErrorReport) -> Response:
    """Fire-and-forget beacon for a browser video playback failure.

    Logs the diagnostic at WARNING with a greppable `[CLIENT_VIDEO_ERROR]`
    prefix so it surfaces in server logs / log tooling. Never raises.
    """
    # Opportunistic attribution: get_current_user_id() RAISES when no session
    # context is set, and this endpoint is deliberately unauthenticated (a dead
    # session can be the cause we're chasing), so fall back to anonymous.
    try:
        user_id = get_current_user_id() or "anon"
    except RuntimeError:
        user_id = "anon"
    logger.warning(
        "[CLIENT_VIDEO_ERROR] user=%s ctx=%s code=%s msg=%r net=%s ready=%s "
        "buffered=%.1fs curT=%.2fs dim=%sx%s retries=%s probe_status=%s "
        "probe_ct=%s probe_html=%s key=%s ua=%r",
        user_id,
        payload.context,
        payload.errorCode,
        (payload.errorMessage or "")[:200],
        payload.networkState,
        payload.readyState,
        payload.bufferedSec or 0.0,
        payload.currentTime or 0.0,
        payload.videoWidth,
        payload.videoHeight,
        payload.retries,
        payload.probeStatus,
        payload.probeContentType,
        payload.probeIsHtml,
        payload.srcKey,
        (payload.userAgent or "")[:150],
    )
    return Response(status_code=204)
