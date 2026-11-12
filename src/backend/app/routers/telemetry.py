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
import re
import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ValidationError

from ..services.ip_rate_limit import client_ip
from ..user_context import get_current_impersonator_id, get_current_user_id
from ..utils.offload import run_in_context

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


class ClientErrorReport(BaseModel):
    """T7510 frustration-signal tier 2: an uncaught client error/rejection,
    already captured into clientLogger's ring buffer (T7560). This beacon mirrors
    the T7480 upload-failure-beacon contract exactly: logs only, no DB write, no
    milestone counter, never blocks or throws."""

    message: str | None = None   # capped, no PII expected beyond the error text itself
    route: str | None = None     # which screen/route the error occurred on


@router.post("/api/client-errors/report", status_code=204)
async def report_client_error(payload: ClientErrorReport) -> Response:
    """Fire-and-forget beacon for an uncaught client error or unhandled rejection.

    T7510 explicit impersonation guard: this is a new sink that does NOT route
    through record_milestone (it writes to logs only, like the T7480 beacon), so
    it must check impersonation itself — an admin impersonating a user must leave
    ZERO footprint, including in server logs attributed to that user. When
    impersonating, return 204 without logging anything.
    """
    if get_current_impersonator_id():
        return Response(status_code=204)

    try:
        user_id = get_current_user_id() or "anon"
    except RuntimeError:
        user_id = "anon"

    logger.warning(
        "[CLIENT_ERROR] user=%s route=%s msg=%r",
        user_id,
        payload.route,
        (payload.message or "")[:300],
    )
    return Response(status_code=204)


class ImpressionReport(BaseModel):
    """T7515 tier 3: a blocking-dialog / error-toast IMPRESSION fired from the
    surface's SHOW gesture. `kind` is closed (toast|dialog, validated server-side);
    `name` is the surface's title/key; `session_count` is how many times this same
    surface has shown in the current session (the frustration-repetition signal)."""

    kind: str
    name: str
    session_count: int | None = None


@router.post("/api/telemetry/impression", status_code=204)
async def report_impression(payload: ImpressionReport) -> Response:
    """T7515 tier 3 sink. Routes to record_impression, which owns the impersonation
    guard, the free-text `user_actions` aggregate upsert, and the per-user
    `user_action_log` detail row (no PG schema change). Always 204, never raises."""
    from app.analytics import record_impression

    try:
        await run_in_context(record_impression, payload.kind, payload.name, payload.session_count)
    except Exception:
        logger.exception("[Telemetry] record_impression failed (ignored)")
    return Response(status_code=204)


class FunnelEventReport(BaseModel):
    """T10010: a client-side activation-funnel gesture (framing point added,
    preview started, a validated playback view, draft saved, result (re)opened).

    `event` is closed server-side to CLIENT_FUNNEL_EVENTS; `context` carries only
    coarse join keys/buckets/durations and is stripped to the PII-safe allow-list
    server-side (record_funnel_event), so no child name / email / free-text can
    ride in. Every field optional — a beacon must never fail validation."""

    event: str
    context: dict | None = None


@router.post("/api/telemetry/funnel-event", status_code=204)
async def report_funnel_event(payload: FunnelEventReport) -> Response:
    """T10010 sink. Routes to record_funnel_event, which owns the closed-vocabulary
    check, the PII allow-list on context, the server-side re-validation of the
    `result_viewed` threshold, and (via record_milestone) the impersonation guard
    plus the aggregate + per-user-log writes. No PG schema change. Always 204,
    never raises."""
    from app.analytics import record_funnel_event

    try:
        await run_in_context(record_funnel_event, payload.event, payload.context)
    except Exception:
        logger.exception("[Telemetry] record_funnel_event failed (ignored)")
    return Response(status_code=204)


class SessionBreadcrumbReport(BaseModel):
    """T7515 tier 4: session-exit breadcrumb. `dwell` maps screen→foreground
    seconds; `trail` is the ordered screen sequence; `last_screen` is where the
    session died. All bounded/sanitized server-side against the known screen set."""

    last_screen: str | None = None
    dwell: dict[str, float] | None = None
    trail: list[str] | None = None


@router.post("/api/telemetry/session-breadcrumbs", status_code=204)
async def report_session_breadcrumbs(payload: SessionBreadcrumbReport) -> Response:
    """T7515 tier 4 sink. Writes the breadcrumb to the CURRENT user's own
    `user_action_log` (per-event detail belongs in user.sqlite; Postgres stays
    aggregate-only, so there is no PG write). Explicit impersonation guard — an
    admin impersonating a user must leave ZERO footprint. Resolves the user from
    the session context; an anonymous beacon (no resolvable user) is logged and
    dropped — there is no user db to write to. Always 204, never raises."""
    if get_current_impersonator_id():
        return Response(status_code=204)

    try:
        user_id = get_current_user_id()
    except RuntimeError:
        user_id = None

    if not user_id:
        # This rides the same cross-site sendBeacon transport as the proven
        # session-close beacon, so it can legitimately arrive with the session
        # cookie stripped/expired. Per-event breadcrumbs have no home without a
        # user db — LOG the drop (greppable) rather than silently accept, so an
        # auth/transport regression that anonymizes every beacon is visible.
        logger.warning("[Telemetry] session-breadcrumb beacon dropped: no resolvable user context")
        return Response(status_code=204)

    from app.analytics import record_session_exit

    try:
        await run_in_context(record_session_exit, user_id, payload.last_screen, payload.dwell, payload.trail)
    except Exception:
        logger.exception("[Telemetry] record_session_exit failed (ignored)")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# T7410: first-party visit beacon (landing + app pre-auth + share pages)
# ---------------------------------------------------------------------------
# Cookie-free, aggregate-only: no cookies, no localStorage, no user/session id is
# ever read or stored by this endpoint. The IP is used ONLY to key the in-memory
# rate limiter below and is never written anywhere (not logged, not persisted).
# The whole stored payload is exactly (day, source bucket, page_class) -> count --
# small enough to quote verbatim on the kids-privacy page (T7120).

_PAGE_CLASS_RE = re.compile(r"^(landing(:[a-z0-9_-]{1,40})?|app|share)$")

# Cheap-and-honest bot filter: obvious non-browser UAs. Perfect filtering is out of
# scope -- investor charts care about trend shape, not pixel-perfect bot exclusion.
_BOT_UA_RE = re.compile(r"bot|crawler|spider|headless|curl|wget|python-requests", re.IGNORECASE)

_VISIT_RATE_WINDOW_SECONDS = 60
_VISIT_RATE_LIMIT_PER_WINDOW = 120  # generous: a real tab fires this beacon once per page class


class _InMemoryVisitRateLimiter:
    """Fixed-window per-IP counter, memory only (T7410 explicitly wants in-memory,
    not the Postgres-backed ip_rate_limit.py -- that path is sized for auth actions,
    not a high-volume anonymous beacon). Never persisted; lost on restart, which is
    fine for a soft abuse guard."""

    def __init__(self, limit: int, window_s: float):
        self._limit = limit
        self._window_s = window_s
        self._lock = threading.Lock()
        self._windows: dict[str, tuple[float, int]] = defaultdict(lambda: (0.0, 0))

    def allow(self, ip: str) -> bool:
        now = time.monotonic()
        with self._lock:
            window_start, count = self._windows[ip]
            if now - window_start >= self._window_s:
                window_start, count = now, 0
            count += 1
            self._windows[ip] = (window_start, count)
            return count <= self._limit


_visit_rate_limiter = _InMemoryVisitRateLimiter(_VISIT_RATE_LIMIT_PER_WINDOW, _VISIT_RATE_WINDOW_SECONDS)


class VisitBeaconReport(BaseModel):
    """Payload is deliberately this small -- see the module comment above. `click_id`
    is the raw query-param NAME the client saw (e.g. "fbclid"), never a resolved
    network name: the name->network mapping lives in ONE place server-side
    (analytics.CLICK_ID_NETWORK) so it is never forked into a per-client copy."""

    page_class: str
    ref: str | None = None
    utm_campaign: str | None = None
    click_id: str | None = None
    referrer_host: str | None = None  # hostname only, never a full URL


@router.post("/api/t", status_code=204)
async def report_visit(request: Request) -> Response:
    """Fire-and-forget anonymous visit counter. Always 204 (even when dropped by the
    rate limiter, bot filter, or an unparseable body) -- a beacon must never surface
    an error to the page.

    T15680: takes a raw `Request` instead of a FastAPI-parsed `VisitBeaconReport`
    parameter on purpose. FastAPI decides whether to JSON-decode the body from the
    request's Content-Type header; `navigator.sendBeacon(url, new Blob([body],
    {type: 'application/json'}))` is a cross-origin request whose Blob type isn't
    CORS-safelisted, and some mobile browser contexts resend it with a
    rewritten/missing Content-Type. FastAPI then handed the raw bytes straight to
    Pydantic, which 422'd even though the JSON itself was well-formed. Decoding with
    `model_validate_json` ourselves is Content-Type-independent, so a well-formed
    body always succeeds and a malformed one falls through to a logged 204 drop."""
    ua = request.headers.get("user-agent") or ""
    if _BOT_UA_RE.search(ua):
        return Response(status_code=204)
    if not _visit_rate_limiter.allow(client_ip(request)):
        return Response(status_code=204)

    raw_body = await request.body()
    try:
        payload = VisitBeaconReport.model_validate_json(raw_body)
    except ValidationError as exc:
        logger.warning(f"[Telemetry] visit beacon dropped: unparseable body={raw_body!r} errors={exc.errors()!r}")
        return Response(status_code=204)

    if not _PAGE_CLASS_RE.match(payload.page_class):
        logger.warning(f"[Telemetry] visit beacon dropped: invalid page_class={payload.page_class!r}")
        return Response(status_code=204)

    from app.analytics import bucket_visit_source
    from app.services.analytics_store import current_store

    source = bucket_visit_source(payload.ref, payload.utm_campaign, payload.click_id, payload.referrer_host)
    store = current_store()
    if store is None:
        logger.warning("[Telemetry] visit beacon dropped: analytics store not started")
        return Response(status_code=204)
    store.record_visit(source, payload.page_class)
    return Response(status_code=204)
