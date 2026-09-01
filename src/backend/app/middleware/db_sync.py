"""
Request Context Middleware — user context + database sync.

Combines user/profile context setup with R2 database synchronization in a
SINGLE BaseHTTPMiddleware. This is critical because BaseHTTPMiddleware's
call_next() copies the asyncio context for the inner app. If user context
and sync were in separate BaseHTTPMiddleware classes, ContextVar changes
(user_id, profile_id) set in one middleware would be invisible to the other
after call_next() returns. By combining them, all ContextVar reads/writes
happen in the same context — before and after a single call_next() boundary.

Flow:
1. Resolve user_id: rb_session cookie → auth DB → user_id (T405)
   Fallback: X-User-ID header (backward compat for tests/dev)
2. If no user_id and path is not allowlisted → 401
3. Set profile_id from header (or session init)
4. Initialize write tracking context (mutable dict)
5. call_next() — route handler runs, may write to DB
6. Check mutable dict for writes, sync to R2 if needed
7. Clean up context

Also tracks sync failure state per user and surfaces it via X-Sync-Status
header so the frontend can show a warning indicator.
"""

import asyncio
import contextlib
import cProfile
import hashlib
import logging
import os
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass

import psycopg2
import psycopg2.pool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .. import session_init as _session_init
from ..database import (
    USER_DB_SCOPE,
    SyncResult,
    build_marker_diag,
    clear_request_context,
    clear_sync_conflict,
    clear_sync_failed,
    get_request_has_user_db_writes,
    get_request_has_writes,
    get_request_written_profile_dbs,
    get_request_written_user_dbs,
    has_sync_conflict,
    has_sync_failed,
    has_sync_pending,
    init_request_context,
    mark_sync_failed,
    mark_sync_pending,
    read_sync_diag,
    sync_db_to_r2_explicit,
    sync_user_db_to_r2_explicit,
)
from ..profile_context import set_current_profile_id
from ..profiling import (
    dump_profile,
    profile_breach_ms,
    profile_on_breach_enabled,
)
from ..services.auth_db import validate_session
from ..session_init import user_session_init
from ..storage import APP_ENV, R2_ENABLED
from ..user_context import (
    get_current_impersonator_id,
    set_current_impersonator_id,
    set_current_method,
    set_current_path,
    set_current_platform,
    set_current_req_id,
    set_current_user_id,
)
from ..utils.cookies import set_cookie as _set_cookie
from ..utils.offload import run_in_context

logger = logging.getLogger(__name__)

# T4050: payload returned when a durable (sync-before-respond) gesture commits
# locally but cannot push the change to R2. The frontend keeps the card in place
# and offers Retry instead of optimistically moving/removing it.
DURABLE_SYNC_FAILED_RESPONSE = {
    "detail": "Could not save to the cloud. Your reel was not moved. Please try again.",
    "code": "sync_failed",
    "retryable": True,
}


# T7510: routes whose durable-sync 503 (below) is itself a funnel-action
# FAILURE. Keyed by (method, request.url.path) — exact static routes only, no
# path params in the mapped set. Maps to the FLOW_EVENTS base event that
# record_milestone should log with reason="sync_failed". move_reels_to_profile
# is NOT here — it does its own inline sync + move_succeeded emission
# (downloads.py) rather than going through this generic durable_sync path.
DURABLE_SYNC_FAILURE_ACTIONS = {
    ("POST", "/api/clips/raw/save"): "clip_save_failed",
}


def set_durable_sync_failure_response(request: Request, payload: dict) -> None:
    """Route-specific 503 body for a durable-sync failure. The generic
    DURABLE_SYNC_FAILED_RESPONSE lies for routes that already committed part of
    their work (T6350: move-to-profile has copied+synced the TARGET and locally
    deleted the SOURCE by the time the source-side durable sync fails — "not
    moved" is false there). A handler sets this ONLY after the portion of its
    work that already durably committed, so any earlier abort keeps the truthful
    generic payload. Same ASGI scope as the middleware -> visible there."""
    request.state.durable_sync_failed_response = payload


async def durable_sync(request: Request) -> None:
    """FastAPI dependency: opt a write route into sync-before-respond (T4050).

    One-shot irreversible gestures (publish / restore-project / delete) commit to
    the LOCAL profile.sqlite and, by default, sync to R2 fire-and-forget AFTER the
    response is sent. If the machine is replaced (deploy/autostop/crash) or the
    0.5s upload-lock defer fires before that background task runs, the write never
    reaches R2 and a later session_init pulls the stale pre-gesture snapshot back
    down — the action silently reverts.

    Marking the route durable makes RequestContextMiddleware AWAIT the R2 sync
    INSIDE the still-held per-user write lock (lock_timeout=None, never defers) and
    return 503 instead of a lying 200 when the sync fails. Setting the marker on
    request.state is visible to the middleware because the endpoint Request and the
    middleware Request share the same ASGI scope.
    """
    request.state.durable_sync = True


FLY_MACHINE_ID = os.getenv("FLY_MACHINE_ID", "")
FLY_APP_NAME = os.getenv("FLY_APP_NAME", "")
PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"


def _set_machine_cookie(response):
    _set_cookie(response, "fly_machine_id", FLY_MACHINE_ID)

# Live machine IDs for stale-cookie detection. Populated on startup via Fly internal API.
_LIVE_MACHINES: set[str] = set()


def _refresh_live_machines():
    """Query Fly internal API for running machine IDs."""
    if not FLY_APP_NAME or not FLY_MACHINE_ID:
        return
    try:
        import urllib.request
        url = f"http://_api.internal:4280/v1/apps/{FLY_APP_NAME}/machines"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            import json
            machines = json.loads(resp.read())
            _LIVE_MACHINES.clear()
            for m in machines:
                if m.get("state") in ("started", "starting"):
                    _LIVE_MACHINES.add(m["id"])
            logger.info(f"[Replay] Live machines: {_LIVE_MACHINES}")
    except Exception as e:
        if FLY_MACHINE_ID:
            _LIVE_MACHINES.add(FLY_MACHINE_ID)
        logger.warning(f"[Replay] Could not fetch live machines: {e}, using self only")


_refresh_live_machines()

# Thresholds for slow request warnings (in seconds)
SLOW_SYNC_THRESHOLD = 0.5  # 500ms - warn if DB sync takes this long
SLOW_REQUEST_THRESHOLD = 0.2  # 200ms - warn if total request takes this long (profiling target)

# Per-user in-flight request counter. Used to surface serialization: if a user
# has multiple concurrent requests and one of them is slow, other requests
# that wait behind it show up as "in_flight=N" at entry and exit times.
_INFLIGHT: dict[str, int] = defaultdict(int)
_INFLIGHT_LOCK = threading.Lock()

# Users with a sync attempt currently executing. Distinct from the
# `.sync_pending` marker file, which is set BEFORE a sync attempt for
# crash-recovery and stays set until the attempt succeeds. During a
# normal in-flight sync, concurrent readers would otherwise read that
# marker and emit X-Sync-Status: failed, flashing the frontend warning
# button. The header check AND-gates the marker with this counter so only a
# persistent failure (marker present, no sync in flight) surfaces.
#
# T5870 round 2 (MAJOR-3): a REFCOUNT (dict[user -> count]), not a set. With a
# set, two overlapping syncs for one user share one entry, so the FIRST to
# finish `discard`s it and drops in-flight cover while the SECOND is still
# running — a concurrent read then emits X-Sync-Status. T5870 made that worse:
# a re-drained attempt now lasts seconds (not ~300ms) and the exposed state is a
# red alarm, not master's gray pending. A refcount keeps cover until the LAST
# concurrent attempt for that user ends.
_SYNC_IN_PROGRESS: dict[str, int] = {}
_SYNC_IN_PROGRESS_LOCK = threading.Lock()


def _begin_sync_attempt(user_id: str) -> None:
    with _SYNC_IN_PROGRESS_LOCK:
        _SYNC_IN_PROGRESS[user_id] = _SYNC_IN_PROGRESS.get(user_id, 0) + 1


def _end_sync_attempt(user_id: str) -> None:
    with _SYNC_IN_PROGRESS_LOCK:
        remaining = _SYNC_IN_PROGRESS.get(user_id, 0) - 1
        if remaining > 0:
            _SYNC_IN_PROGRESS[user_id] = remaining
        else:
            _SYNC_IN_PROGRESS.pop(user_id, None)


def is_sync_attempt_in_progress(user_id: str) -> bool:
    with _SYNC_IN_PROGRESS_LOCK:
        return _SYNC_IN_PROGRESS.get(user_id, 0) > 0

def _inflight_enter(user_id: str) -> int:
    with _INFLIGHT_LOCK:
        _INFLIGHT[user_id] += 1
        return _INFLIGHT[user_id]

def _inflight_exit(user_id: str) -> int:
    with _INFLIGHT_LOCK:
        _INFLIGHT[user_id] = max(0, _INFLIGHT[user_id] - 1)
        n = _INFLIGHT[user_id]
        if n == 0:
            _INFLIGHT.pop(user_id, None)
        return n


# T1531: Per-user WRITE lock. Writers (POST/PUT/PATCH/DELETE) serialize per-user
# so two concurrent writes can't race on the R2 db-version (last-write-wins
# would silently lose data). Readers (GET/HEAD/OPTIONS) take no lock — SQLite
# WAL handles read concurrency, and a stale read 200ms behind an in-flight
# write is acceptable. The dict is keyed per user, so users don't block each
# other. Locks are created lazily and never removed (one asyncio.Lock per
# active user is negligible memory).
WRITE_METHODS = frozenset(("POST", "PUT", "PATCH", "DELETE"))
_USER_WRITE_LOCKS: dict[str, asyncio.Lock] = {}
_USER_WRITE_LOCKS_GUARD = threading.Lock()
WRITE_LOCK_WAIT_LOG_MS = 50  # log when a writer waited longer than this for the lock
# T2720: max seconds to wait for the R2 upload lock before deferring sync.
# Prevents middleware from blocking ~14s behind the export worker's upload.
_SYNC_LOCK_TIMEOUT = 0.5


def _get_user_write_lock(user_id: str) -> asyncio.Lock:
    """Return the asyncio.Lock for this user, creating it on first access."""
    with _USER_WRITE_LOCKS_GUARD:
        lock = _USER_WRITE_LOCKS.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            _USER_WRITE_LOCKS[user_id] = lock
        return lock


@contextlib.asynccontextmanager
async def _maybe_write_lock(user_id: str | None, method: str, path: str, req_id: str):
    """Hold the per-user write lock for write methods; no-op for reads."""
    if not user_id or method not in WRITE_METHODS:
        yield
        return
    lock = _get_user_write_lock(user_id)
    wait_start = time.perf_counter()
    async with lock:
        wait_ms = (time.perf_counter() - wait_start) * 1000.0
        if wait_ms >= WRITE_LOCK_WAIT_LOG_MS:
            req_id_suffix = f" req_id={req_id}" if req_id else ""
            logger.info(
                f"[WRITE_LOCK_WAIT] {method} {path} user={user_id} "
                f"waited_ms={int(wait_ms)}{req_id_suffix}"
            )
        yield

# T1152: Sync failure state is backed by the .sync_pending marker file on disk
# (same marker used by T930 for crash-survival). This keeps a single source of
# truth and makes the degraded state survive backend restarts.


def _status_for_result(result) -> str:
    """Map a SyncResult (or a plain bool from an older mock/test) to the
    "ok" | "conflict" | "failed" status string _background_sync tracks.
    """
    if result == SyncResult.CONFLICT:
        return "conflict"
    return "ok" if result else "failed"


def is_sync_failed(user_id: str) -> bool:
    """Check if the given user has a GENUINE (unrecovered) sync failure.

    T5870: this used to be `return has_sync_pending(user_id)`, which conflated a
    merely-queued/deferred/in-flight sync with a real failure — a 0.5s upload-lock
    DEFER (a retry-later state) surfaced to the user as "your edits aren't saving".
    Now a user is "failed" only when an attempt DEFINITIVELY failed (.sync_failed,
    set after the bounded re-drain gave up) or hit a CAS conflict (.sync_conflict).
    A bare .sync_pending is NOT a failure — it surfaces as the quiet "pending"
    header instead (see the header emission in _sync_aware_flow).
    """
    return has_sync_failed(user_id) or has_sync_conflict(user_id)


def set_sync_failed(user_id: str, failed: bool, profile_id: str | None = None) -> None:
    """Set or clear the ALARM markers (.sync_failed / .sync_conflict) for the
    scopes this caller can actually speak for: user.sqlite plus, when known,
    the request's own profile.

    T5081 (review round 3, Q4): this NO LONGER touches `.sync_pending` at all,
    and NEVER blanket-clears (no `scope=None`). `.sync_pending` is a
    DURABILITY RECORD (see the INV-P comment in database.py) — the old
    `clear_sync_pending(user_id)` (scope=None -> every scope) erased the
    durability record of writes this caller never verified, INCLUDING other
    profiles it has no way to verify. Once that fired, a later drain found
    nothing pending, reported a vacuous OK, and the caller logged "R2 sync OK"
    for a write that never reached R2 (review round 2, issue 2). A pending
    marker is discharged ONLY by a confirmed upload of that exact db
    (sync_*_to_r2_explicit), a restore that replaced it
    (`_retry_resolve_conflict`), or deletion of the db (`clear_scope_markers`).

    `.sync_failed`/`.sync_conflict` are ALARM state, not durability records —
    clearing them on a verified-recovered gesture (a manual /api/retry-sync
    success, an error-path recovery) is the correct, pre-existing semantic;
    T5081 only narrows WHICH scopes "full recovery" can honestly mean once
    truly foreign scopes exist that this call has no way to verify. A foreign
    scope that is genuinely still stuck keeps its own alarm, honestly.
    """
    scopes = {USER_DB_SCOPE} | ({profile_id} if profile_id else set())
    was_failed = is_sync_failed(user_id)
    if failed:
        for scope in sorted(scopes):
            mark_sync_failed(user_id, scope=scope)
        if not was_failed:
            logger.warning(f"[SYNC] User {user_id} entered degraded state - R2 sync failed")
    else:
        for scope in sorted(scopes):
            clear_sync_failed(user_id, scope=scope)
            clear_sync_conflict(user_id, scope=scope)
        if was_failed:
            logger.info(f"[SYNC] User {user_id} recovered for scopes={sorted(scopes)}")


# T5870: bounded, attempt-scoped re-drain of a deferred/failed background sync.
# _REDRAIN_MAX_ATTEMPTS retries with exponential backoff (base * 2**n) before the
# write is declared genuinely failed. Chosen so a transient upload-lock DEFER
# (the dominant frequency driver — 71% of syncs under a rapid-edit burst in the
# T5870 harness) is healed in-band without ever alarming the user, while a real
# R2 outage still surfaces within a few seconds.
_REDRAIN_MAX_ATTEMPTS = 3
_REDRAIN_BASE_BACKOFF_S = 0.4

# T5081: bounded fire-and-forget sweep of a FOREIGN profile's pending scope
# (see _sweep_foreign_pending_scopes). Capped per call so one write request
# never pays for an unbounded backlog; _FOREIGN_SWEEP_INFLIGHT dedupes
# concurrent sweeps for the same user (a write burst spawns one per request).
_FOREIGN_SWEEP_MAX_SCOPES = 2
_FOREIGN_SWEEP_INFLIGHT: set = set()
_FOREIGN_SWEEP_GUARD = threading.Lock()


def sync_status_header(user_id: str) -> str | None:
    """T5870: the single source of truth for the X-Sync-Status header value.

    Returns "conflict" | "failed" | "pending" | None. Suppressed (None) while an
    attempt is in flight (incl. the bounded re-drain) so a write mid-sync never
    flashes a warning. Ordering is a priority: a CAS conflict outranks a generic
    failure, which outranks a merely-pending write. Extracted as a pure function
    so it is directly unit-testable (the old inline predicate was not).
    """
    if is_sync_attempt_in_progress(user_id):
        return None
    if has_sync_conflict(user_id):
        return "conflict"
    if has_sync_failed(user_id):
        return "failed"
    if has_sync_pending(user_id):
        return "pending"
    return None


# T6390: the compact fields of the X-Sync-Diag header, in a fixed order so the
# client parser and a human reading the header see the same layout. Rendered as
# `k=v;k=v` (None values skipped). Kept small — `writer` is machine/req_id, never
# a URL — so it stays well under any header-size limit.
_DIAG_HEADER_FIELDS = (
    "state", "reason", "db", "profile_id", "loaded", "r2",
    "machine", "req_id", "method", "path", "writer", "written_at",
)


def _render_sync_diag(diag: dict | None) -> str:
    """Render a marker diag payload as a compact `k=v;` header value. Values are
    sanitised (no `;`/newlines) so the header stays well-formed; a None field is
    omitted rather than rendered as a fake default (No silent fallbacks)."""
    if not diag:
        return ""
    parts = []
    for key in _DIAG_HEADER_FIELDS:
        value = diag.get(key)
        if value is None:
            continue
        safe = str(value).replace(";", ",").replace("\r", " ").replace("\n", " ")
        parts.append(f"{key}={safe}")
    return ";".join(parts)


def session_scopes(profile_id: str | None) -> set[str]:
    """The scopes a session/request's own write could have touched: its
    profile (if any) plus user.sqlite, always."""
    return {USER_DB_SCOPE} | ({profile_id} if profile_id else set())


@dataclass(frozen=True)
class PendingDrainReport:
    """Outcome of one `drain_pending_scopes` call.

    `attempted` holds ONLY the scopes that genuinely had a pending marker and
    got uploaded. `aggregate()` distinguishes "verified OK" (SyncResult.OK)
    from "nothing was pending" (None) — a caller must never conflate a vacuous
    no-op with a durable confirmation (T5081 review round 2, issue 2: an
    upstream force-clear making a scope look not-pending must not be reported
    back as "saved")."""
    attempted: dict
    orphaned: set
    not_pending: set

    def aggregate(self) -> SyncResult | None:
        """CONFLICT > FAILED > OK over the ATTEMPTED scopes only. None means
        nothing was attempted."""
        if not self.attempted:
            return None
        vals = set(self.attempted.values())
        if SyncResult.CONFLICT in vals:
            return SyncResult.CONFLICT
        if SyncResult.FAILED in vals:
            return SyncResult.FAILED
        return SyncResult.OK


def drain_pending_scopes(
    user_id: str, scopes, *, lock_timeout: float | None = None,
) -> PendingDrainReport:
    """Upload exactly the scopes in `scopes` that actually have a pending
    marker — never a scope with nothing pending (the false-conflict class
    T5081 exists to close: re-uploading a provably clean db can trip a real
    CAS conflict against a copy with nothing to arbitrate).

    Blocking; call via asyncio.to_thread. Routes every upload through
    `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit` — the SAME
    primitives every other sync path uses — so version recording, T6390
    conflict marking + diag, T6160 reheal scheduling, and the INV-P
    pending-clear on success (see database.py) all live in ONE place and
    cannot drift from any other caller (they had drifted: this function used
    to duplicate all four inline).
    """
    from app import database as db_module

    db_module.adopt_legacy_pending_marker(user_id)  # loud no-op in production

    attempted: dict[str, SyncResult] = {}
    orphaned: set[str] = set()
    not_pending: set[str] = set()

    for scope in sorted(set(scopes)):
        if not db_module.has_sync_pending_scope(user_id, scope):
            not_pending.add(scope)
            continue

        if scope == USER_DB_SCOPE:
            db_path = db_module.USER_DATA_BASE / user_id / "user.sqlite"
        else:
            db_path = db_module.get_user_data_path_explicit(user_id, scope) / "profile.sqlite"

        if not db_path.exists():
            # T5081: a pending marker whose local db is gone (deleted profile,
            # or a delete path that predates clear_scope_markers) can never be
            # uploaded, and would wedge has_sync_pending — and therefore
            # /api/sync/flush-verify — true forever with no user-reachable
            # recovery. There are no bytes to lose by clearing it.
            logger.critical(
                f"[SYNC] ORPHAN pending marker user={user_id} scope={scope} "
                f"— local db missing at {db_path}; clearing its markers"
            )
            db_module.clear_scope_markers(user_id, scope)
            orphaned.add(scope)
            continue

        if scope == USER_DB_SCOPE:
            result = db_module.sync_user_db_to_r2_explicit(user_id, lock_timeout=lock_timeout)
        else:
            result = db_module.sync_db_to_r2_explicit(user_id, scope, lock_timeout=lock_timeout)
        attempted[scope] = result

    if not_pending:
        logger.debug(f"[SYNC] drain user={user_id} nothing pending, skipped: {sorted(not_pending)}")
    return PendingDrainReport(attempted, orphaned, not_pending)


def retry_pending_sync(user_id: str, profile_id: str | None = None) -> SyncResult:
    """Retry ONLY this session's own scopes (its profile + user.sqlite).

    T5081 review round 2 (issue 5): a pending scope belonging to ANOTHER
    profile is deliberately NOT drained here and cannot influence this return
    value. Folding a foreign profile into the aggregate poisoned the caller's
    verdict two ways: a session whose own write the in-band re-drain just
    healed still reported failure overall, and a foreign profile stuck in an
    unrecoverable CAS conflict made this function return CONFLICT on EVERY
    call for that user — which makes `_redrain_failed_sync` bail at attempt 1
    every time (correctly — a conflict isn't blind-retryable), permanently
    disabling in-band healing of this user's own, unrelated transient
    failures. Foreign scopes drain via `_sweep_foreign_pending_scopes`
    (fire-and-forget, off the response) or `POST /api/sync/flush-verify`
    (the one endpoint whose contract genuinely needs a full barrier) instead.

    Returns OK when nothing was pending: under INV-P (see database.py), the
    absence of a marker is a durability PROOF — nothing may clear one except a
    confirmed upload, a restore, or the db's deletion — so "nothing to do" IS
    "already durable", never a guess.
    """
    report = drain_pending_scopes(user_id, session_scopes(profile_id), lock_timeout=None)
    agg = report.aggregate()
    # NOT `agg or SyncResult.OK` — SyncResult.FAILED is falsy, so `or` would
    # silently coerce a real failure into OK (the same enum-truthiness trap
    # export_helpers.sync_export_db_to_r2 already documents for `and`-chains).
    return SyncResult.OK if agg is None else agg


# T6260: boot-set read endpoints that emit a content-hash ETag so an unchanged
# repeat request revalidates to 304 (empty body) instead of resending the body.
# EXACT-path match — only the list/scalar GETs, never their `/{id}/...` siblings
# (`/api/games/{id}/poster` already does its own R2-ETag 304, T5682). Boot set
# first (the highest-traffic reads issued behind app load); the epic widens this
# later. These stay `private, no-cache` (mutable per-user data): the ETag gives a
# validator to 304 against — it is NOT a stale-serving `max-age`/SWR window, so a
# user never sees their own just-saved edit revert.
ETAG_304_READ_PATHS = frozenset({
    "/api/profiles",
    "/api/projects",
    "/api/games",
    "/api/settings",
    "/api/downloads",
    "/api/downloads/count",
})

# Cache-Control for the ETag'd reads: force revalidation every time (no stale
# window), letting the ETag short-circuit unchanged responses to 304.
_ETAG_READ_CACHE_CONTROL = "private, no-cache"


async def _apply_read_etag(request: Request, response: Response) -> Response:
    """Attach a content-hash ETag to a boot-set read and answer 304 when it matches.

    T6260. The body is a small JSON payload already fully rendered by the handler
    (JSONResponse) — buffering it to hash costs a few-KB SHA-256 on already-in-
    memory bytes, never blocking I/O and never a real streaming/media response
    (gated to the exact `ETAG_304_READ_PATHS`). Computing the hash means the
    handler still did its work; the win is the saved response body on the wire,
    not saved server work (T6240 already took the handler off the event loop).

    On an `If-None-Match` hit we return a bodiless 304 that preserves the sync
    headers (`X-Sync-Status`/`X-Sync-Diag`) the flow already stamped; otherwise we
    re-emit the buffered 200 with the ETag added.
    """
    body = b"".join([chunk async for chunk in response.body_iterator])
    etag = '"' + hashlib.sha256(body).hexdigest() + '"'

    # A conditional request echoes the ETag(s) it holds; honor a direct match or
    # the wildcard. Browsers send exactly what we emitted (a single strong tag).
    inm = request.headers.get("if-none-match", "")
    candidates = {tok.strip() for tok in inm.split(",") if tok.strip()}
    if etag in candidates or "*" in candidates:
        # 304 carries validators + the sync headers, but no body-shaped headers
        # (content-length/type belong to the omitted body).
        headers = {
            k: v for k, v in response.headers.items()
            if k.lower() not in ("content-length", "content-type", "cache-control", "etag")
        }
        headers["ETag"] = etag
        headers["Cache-Control"] = _ETAG_READ_CACHE_CONTROL
        return Response(status_code=304, headers=headers, background=response.background)

    # Re-emit the full 200 with the validator attached. dict(response.headers)
    # carries a content-length equal to len(body) (JSONResponse set it), so the
    # reconstructed response stays consistent.
    headers = dict(response.headers)
    headers["ETag"] = etag
    headers["Cache-Control"] = _ETAG_READ_CACHE_CONTROL
    return Response(
        content=body,
        status_code=response.status_code,
        headers=headers,
        media_type=response.media_type,
        background=response.background,
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Combined middleware for user context setup and R2 database sync.

    Merges UserContextMiddleware and DatabaseSyncMiddleware into one class
    to avoid ContextVar isolation across BaseHTTPMiddleware boundaries.
    """

    # Skip sync for these path prefixes (static files, health checks, auth, etc.)
    # T1531: /api/quests/achievements — idempotent INSERT OR IGNORE writes that
    # don't need immediate R2 sync. Skipping avoids the ~768ms R2 upload (and
    # the per-user write lock) on a fire-and-forget POST. The local SQLite
    # commit is durable; data syncs to R2 on the next non-achievement write.
    SKIP_SYNC_PATHS = (
        '/docs',
        '/redoc',
        '/openapi.json',
        '/api/health',
        '/api/version',      # T5070: version handshake, no DB involvement
        '/api/auth',
        '/api/quests/achievements',
        '/api/shared/',
        '/api/fonts',        # T5180: StaticFiles mount, no user data
        '/static',
    )

    # T450: Routes that work WITHOUT prior user context (they establish it).
    # These get passed through even when no session cookie or X-User-ID is present.
    AUTH_ALLOWLIST_PREFIXES = (
        '/api/auth/',               # All auth sub-routes (google, email/*, me, logout)
        '/api/health',              # Health check
        '/api/version',             # T5070: version handshake works pre-login too
        '/api/quests/definitions',  # T1330: quest catalog is public (onboarding checklist)
        '/api/quests/progress',     # Pre-login quest panel: returns all-incomplete shape for anonymous callers
        '/api/shared/',             # T1750: public share links work without auth
        '/api/payments/webhook',    # T4940: Stripe server-to-server calls carry no session; signature verification IS the auth
        '/api/client-errors/',      # T5641: video-error beacon must land even when the session is dead
        '/api/telemetry/',          # T7515: frustration beacons (impression/session-exit) are fire-and-forget — never 401 an anonymous/expiring session (a 401 the client would swallow anyway); authenticated callers still get full context + session init to write their own user_action_log
        '/api/fonts',                # T5180: font manifest + TTFs are a static public asset (no user data), needed for @font-face before/without a session
        '/storage/warmup',          # T3310: unauthenticated warmup wakes Fly.io machine
        '/docs',                    # API docs
        '/redoc',                   # API docs
        '/openapi.json',            # OpenAPI spec
    )

    # Routes that are authenticated but touch only auth.sqlite — they don't
    # need the profile DB loaded, so skip the expensive user_session_init
    # cold path (R2 HEAD/GET on user.sqlite + profile.sqlite + cleanup passes).
    # /api/auth/init is intentionally NOT in this list — it runs session_init
    # itself in its handler, which is the explicit bootstrap call.
    SKIP_SESSION_INIT_PATHS = (
        '/api/auth/me',
        '/api/auth/whoami',
        '/api/auth/logout',
        '/api/auth/google',
        '/api/auth/send-otp',
        '/api/auth/verify-otp',
        '/api/auth/test-login',
        '/api/health',
        '/api/version',   # T5070: stateless version check, no per-user data needed
        '/api/client-errors/video',  # T5641: beacon logs only; attribution comes from context, no profile DB needed
    )

    def _is_allowlisted(self, request: Request) -> bool:
        """Check if this request can proceed without user context."""
        # OPTIONS preflight never needs user context
        if request.method == "OPTIONS":
            return True
        path = request.url.path
        return any(path.startswith(prefix) for prefix in self.AUTH_ALLOWLIST_PREFIXES)

    async def dispatch(self, request: Request, call_next) -> Response:
        """Profile-wrapped entry point.

        T1530/T1531: cProfile wraps ALL paths through the middleware (allowlisted,
        sync-skipped, and main) so any slow call is captured. The inner
        `_dispatch_impl` contains the original logic; this outer shell owns the
        timing/profile/log emission so there is a single place that logs
        `[SLOW REQUEST]` with the profile path attached.
        """
        method = request.method
        path = request.url.path
        req_id = request.headers.get("X-Request-ID", "")
        # Publish req_id to a ContextVar so downstream log lines (R2_CALL,
        # [Restore], slow-query traces) can attach it without being passed it
        # explicitly. Safe to set before user_id is resolved — the ContextVar
        # is request-scoped by Starlette.
        set_current_req_id(req_id)
        # T6390: publish method/path so the sync-conflict diagnostics (marker payload
        # + storage.py [SYNC_CONFLICT] CRITICAL) can name the gesture that hit a CAS
        # refusal, without threading them through the background-sync call chain.
        set_current_method(method)
        set_current_path(path)

        set_current_platform(request.headers.get("X-Platform", ""))

        force_profile = request.headers.get("X-Profile-Request", "").lower() in ("1", "true", "yes")
        do_profile = profile_on_breach_enabled() or force_profile

        prof = None
        if do_profile:
            prof = cProfile.Profile()
            prof.enable()

        request_start = time.perf_counter()
        meta: dict = {"sync_duration": 0.0, "handler_duration": 0.0,
                      "user_id": None, "inflight_entry": 0, "inflight_exit": 0,
                      "auth_ms": 0, "init_ms": 0}
        try:
            return await self._dispatch_impl(request, call_next, meta)
        finally:
            total_duration = time.perf_counter() - request_start
            total_ms = total_duration * 1000.0
            profile_path = None
            req_id_suffix = f" req_id={req_id}" if req_id else ""
            if prof is not None:
                prof.disable()
                if force_profile or total_ms >= profile_breach_ms():
                    profile_path = dump_profile(
                        prof,
                        tag=f"{method}_{path}",
                        elapsed_ms=total_ms,
                        req_id=req_id,
                        extra=meta.get("user_id"),
                    )

            sync_duration = meta["sync_duration"]
            handler_duration = meta["handler_duration"]

            if sync_duration >= SLOW_SYNC_THRESHOLD:
                logger.warning(
                    f"[SLOW DB SYNC] {method} {path} - sync took {sync_duration:.2f}s "
                    f"(threshold: {SLOW_SYNC_THRESHOLD}s). Consider background sync."
                    f"{req_id_suffix}"
                )
            if total_duration >= SLOW_REQUEST_THRESHOLD:
                profile_suffix = f" profile={profile_path}" if profile_path else ""
                logger.warning(
                    f"[SLOW REQUEST] {method} {path} - total {total_duration:.2f}s "
                    f"(sync: {sync_duration:.2f}s, handler: {total_duration - sync_duration:.2f}s)"
                    f"{req_id_suffix}{profile_suffix}"
                )
            profile_timing_suffix = f" profile={profile_path}" if profile_path else ""
            auth_ms = meta["auth_ms"]
            init_ms = meta["init_ms"]
            handler_ms = handler_duration * 1000
            sync_ms_val = sync_duration * 1000
            overhead_ms = total_ms - auth_ms - init_ms - handler_ms - sync_ms_val
            logger.info(
                f"[REQ_TIMING] {method} {path} user={meta.get('user_id') or 'none'} "
                f"total_ms={int(total_ms)} "
                f"auth_ms={int(auth_ms)} "
                f"init_ms={int(init_ms)} "
                f"handler_ms={int(handler_ms)} "
                f"sync_ms={int(sync_ms_val)} "
                f"overhead_ms={int(overhead_ms)} "
                f"inflight_entry={meta['inflight_entry']} "
                f"inflight_exit={meta['inflight_exit']}"
                f"{req_id_suffix}{profile_timing_suffix}"
            )

    async def _dispatch_impl(self, request: Request, call_next, meta: dict) -> Response:
        """Set user context, process request, sync DB if writes occurred."""
        # --- T1190: Fly.io machine pinning ---
        should_set_machine_cookie = False
        if FLY_MACHINE_ID:
            pinned = request.cookies.get("fly_machine_id")
            if pinned and pinned != FLY_MACHINE_ID:
                if request.headers.get("fly-replay-src") or pinned not in _LIVE_MACHINES:
                    if pinned not in _LIVE_MACHINES:
                        logger.warning(
                            f"[Replay] Stale cookie: machine {pinned} not in live set "
                            f"{_LIVE_MACHINES}, handling on {FLY_MACHINE_ID}"
                        )
                    else:
                        logger.warning(
                            f"[Replay] Circuit-breaker: machine {pinned} unavailable, "
                            f"handling on {FLY_MACHINE_ID}"
                        )
                    should_set_machine_cookie = True
                else:
                    logger.info(f"[Replay] Replaying to {pinned} (current: {FLY_MACHINE_ID})")
                    return Response(
                        status_code=200,
                        headers={"fly-replay": f"instance={pinned}"},
                    )
            elif not pinned:
                should_set_machine_cookie = True

        # --- User context setup (T405: cookie-first, header-fallback) ---
        user_id = None
        auth_source = "none"

        # 1. Try session cookie → central auth DB
        session_id = request.cookies.get("rb_session")
        # Distinguishes "cookie present but the DB was unreachable" (transient,
        # retryable) from "no/invalid cookie" (genuinely unauthenticated). Only
        # the latter is a 401; a DB blip must not read as "logged out" — the
        # <video> element that receives a 401 renders MEDIA_ELEMENT_ERROR.
        session_validation_unavailable = False
        if session_id:
            auth_start = time.perf_counter()
            try:
                # T6200: validate_session is a blocking psycopg2 query; running it
                # directly on the event loop serialized every concurrent
                # authenticated request (a burst drained together — the HAR
                # fingerprint). Offload to a worker thread so the loop stays free.
                # Bare to_thread is safe here: this runs BEFORE set_current_user_id
                # (below) and validate_session reads no request contextvar (it takes
                # session_id explicitly and resolves via the thread-safe PG pool).
                session = await asyncio.to_thread(validate_session, session_id)
            except (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.pool.PoolError) as e:
                logger.warning(f"[AUTH] Postgres unavailable during session validation: {e}")
                session = None
                session_validation_unavailable = True
            meta["auth_ms"] = (time.perf_counter() - auth_start) * 1000
            if session:
                user_id = session["user_id"]
                auth_source = "session"
                request.state.session = session

        # 2. Fallback: X-User-ID header (backward compat for dev/tests)
        # SECURITY: Only enabled in dev/staging -- never in production. An admin
        # route is not an exception: _require_admin() only checks whether the
        # resolved user_id IS an admin, never whether the caller really IS that
        # user_id, so trusting an unsigned header here is a full auth bypass.
        if not user_id and APP_ENV != "production":
            raw_user_id = request.headers.get('X-User-ID')
            if raw_user_id:
                sanitized = ''.join(c for c in raw_user_id if c.isalnum() or c in '_-')
                if sanitized:
                    user_id = sanitized
                    auth_source = "header"

        # 3. T450: No default fallback — if no user and not allowlisted, reject
        if not user_id:
            if self._is_allowlisted(request):
                # Auth/health endpoints proceed without user context
                logger.info(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"user=none (allowlisted) | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return await call_next(request)
            elif session_validation_unavailable:
                # Cookie WAS present but the auth DB was unreachable — transient,
                # not "logged out". 503 + Retry-After tells the client (and the
                # <video> element) to retry instead of treating it as a hard auth
                # failure that renders MEDIA_ELEMENT_ERROR / forces a re-login.
                logger.warning(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"503 — session cookie present but auth DB unavailable | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return JSONResponse(
                    status_code=503,
                    headers={"Retry-After": "2"},
                    content={"detail": "Service temporarily unavailable, please retry."},
                )
            else:
                logger.warning(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"REJECTED — no session cookie or X-User-ID | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required. Please refresh the page to initialize a session."},
                )

        req_id = request.headers.get("X-Request-ID", "")
        req_id_suffix = f" req_id={req_id}" if req_id else ""
        logger.info(
            f"[REQ] {request.method} {request.url.path} | "
            f"user={user_id} (via {auth_source}) | "
            f"origin={request.headers.get('origin', '-')}"
            f"{req_id_suffix}"
        )

        meta["user_id"] = user_id
        set_current_user_id(user_id)
        # T1515: flag impersonation so analytics writers skip recording. Only the
        # session-cookie path carries impersonation; header-fallback never does.
        _session = getattr(request.state, "session", None)
        set_current_impersonator_id(_session.get("impersonator_user_id") if _session else None)
        init_request_context()

        try:
            # Identity-only routes (auth.sqlite only) skip session_init so /me stays
            # cheap on cold cache. /api/auth/init and all non-auth paths still run it.
            path = request.url.path
            skip_session_init = path in self.SKIP_SESSION_INIT_PATHS

            profile_id = request.headers.get('X-Profile-ID')
            if profile_id and re.match(r'^[a-f0-9]{8}$', profile_id):
                # T7520: X-Profile-ID is client-supplied and was only FORMAT-
                # checked above. During an impersonation start/stop the OLD page
                # keeps running while navigation is in flight, so a request can
                # carry the NEW session cookie (user already flipped) together
                # with the STALE impersonated profile header — which pre-guard
                # created a cross-tenant profile.sqlite under the wrong user's
                # directory (and, via graceful-shutdown/sweep, an R2 orphan).
                # Reject a profile the authenticated user does not OWN before it
                # reaches set_current_profile_id -> ensure_database. The check is
                # keyed on get_current_user_id() (the resolved/impersonated
                # user), NOT the auth source, so it applies equally to the
                # X-User-ID admin path (no escape hatch — landmine 4).
                #
                # /api/shared/ exception: the claim flow's client sends a
                # PLACEHOLDER X-Profile-ID here purely to skip the R2-heavy
                # session_init cold path below — it is never the claimer's real
                # profile (see test_t5730_claim_import_flow.py's _headers()
                # comment). The claim handler resolves and validates the
                # claimer's ACTUAL profile itself via get_profiles() and its own
                # 400/410 responses; it never reads the request-context current
                # profile this header would set. Applying the ownership guard
                # here would 404 the placeholder before the handler's own,
                # correct resolution ever runs.
                if path.startswith('/api/shared/'):
                    set_current_profile_id(profile_id)
                else:
                    owned_ids = _session_init.peek_registered_profile_ids(user_id)
                    if owned_ids is None:
                        # Cache miss: opening user.sqlite is blocking (and a cold
                        # first access downloads it from R2), so offload it off the
                        # event loop exactly like user_session_init below. Warm
                        # requests hit the peek above and never reach here.
                        owned_ids = await run_in_context(
                            _session_init.load_registered_profile_ids, user_id
                        )
                    if profile_id not in owned_ids:
                        logger.critical(
                            f"[PROFILE_GUARD] Rejected foreign X-Profile-ID: "
                            f"user={user_id} profile={profile_id} "
                            f"impersonator={get_current_impersonator_id()} "
                            f"req_id={req_id} method={request.method} "
                            f"path={request.url.path} auth={auth_source}"
                        )
                        return JSONResponse(
                            status_code=404,
                            content={"detail": "Profile not found"},
                        )
                    set_current_profile_id(profile_id)
            elif not skip_session_init:
                if profile_id:
                    logger.warning(f"Invalid X-Profile-ID format: '{profile_id}', falling back to session init")
                init_start = time.perf_counter()
                # T6240: user_session_init does blocking R2 downloads + sqlite +
                # Postgres work. Running it directly on the event loop stalled EVERY
                # concurrent request until it returned — the T6200 fingerprint at
                # boot: the first request of a session is /api/profiles, which has
                # no X-Profile-ID to send, so it routes here, and the ~7 requests
                # issued behind it all drained together (~22s in the 2026-07-31 HAR).
                # Offload it so the loop stays free. run_in_context (NOT a bare
                # to_thread): user context is already set (set_current_user_id
                # above) and user_session_init -> ensure_database() reads
                # get_current_user_id()/get_current_profile_id() — a bare to_thread
                # would raise "No user context set" inside the worker thread. It
                # also copies the write-tracking context installed by
                # init_request_context() above (a shared mutable dict), so a
                # new-user boot's writes still mark for R2 sync from the thread.
                # The profile_id set on the copied context inside the thread does
                # not propagate back, so we re-apply it on the request context
                # below from the returned dict.
                init_result = await run_in_context(user_session_init, user_id)
                meta["init_ms"] = (time.perf_counter() - init_start) * 1000
                profile_id = init_result.get("profile_id")
                if profile_id:
                    set_current_profile_id(profile_id)

            # --- Skip sync for certain paths ---
            should_sync = R2_ENABLED and not any(
                request.url.path.startswith(prefix) for prefix in self.SKIP_SYNC_PATHS
            )

            if not should_sync:
                handler_start = time.perf_counter()
                response = await call_next(request)
                meta["handler_duration"] = time.perf_counter() - handler_start
                if should_set_machine_cookie:
                    _set_machine_cookie(response)
                return response

            # T1531: serialize WRITE requests per user (R2 version race protection).
            # Reads bypass the lock — SQLite WAL handles concurrent reads, and the
            # next request after a write will see locally-committed state since we
            # commit BEFORE releasing the lock.
            async with _maybe_write_lock(user_id, request.method, request.url.path, req_id):
                response = await self._sync_aware_flow(request, call_next, meta, user_id, req_id, profile_id=profile_id)
                if should_set_machine_cookie:
                    _set_machine_cookie(response)
                return response
        finally:
            clear_request_context()

    async def _sync_aware_flow(
        self,
        request: Request,
        call_next,
        meta: dict,
        user_id: str,
        req_id: str,
        profile_id: str | None = None,
    ) -> Response:
        """Original write-tracking + R2 sync flow. Held inside the per-user
        write lock when the request is a writer; runs lock-free for readers."""

        # --- T930/T1150: Retry pending sync from previous failed request ---
        # T1536: run on a worker thread so the sync boto3 call (200-1000ms)
        # doesn't block the asyncio event loop.
        # T1537: only retry on WRITE requests. A read changes nothing, so
        # there is nothing for it to push to R2; running retry here just adds
        # an unnecessary R2 PutObject (~300-1000ms) onto the read latency.
        # Worse, when N concurrent reads all retry the same object, R2 returns
        # 429 ("reduce concurrent request rate"), keeping the user stuck in
        # degraded state. Writers run inside the per-user write lock, so only
        # one retry runs at a time per user — no concurrent same-key uploads.
        if request.method in WRITE_METHODS and has_sync_pending(user_id):
            # T1539: Skip retry if another sync (e.g. export worker) is already
            # uploading for this user. Their upload will either succeed (making
            # our retry redundant) or fail (leaving the marker for next request).
            from ..storage import get_upload_lock
            profile_lock = get_upload_lock(user_id, "profile")
            if not profile_lock.acquire(blocking=False):
                logger.info(f"[SYNC] Skipping retry - upload in progress for user {user_id}")
            else:
                profile_lock.release()
                logger.info(f"[SYNC] Retrying pending sync for user {user_id}")
                _begin_sync_attempt(user_id)
                try:
                    ok = await asyncio.to_thread(retry_pending_sync, user_id, profile_id)
                    # T5081: retry_pending_sync (and the sync_*_explicit
                    # primitives it delegates to) already clear .sync_pending
                    # AND .sync_failed per scope on success — nothing further
                    # to clear here. A blanket clear_sync_failed(user_id) would
                    # wipe an unrelated profile's independently-live alarm.
                    if ok:
                        logger.info(f"[SYNC] Retry succeeded for user {user_id}")
                    else:
                        logger.warning(f"[SYNC] Retry still failing for user {user_id}")
                except Exception as e:
                    logger.warning(f"[SYNC] Retry failed for user {user_id}: {e}")
                finally:
                    _end_sync_attempt(user_id)
                # T5081: bounded, fire-and-forget drain of any OTHER profile of
                # this user with its own pending marker (a background export
                # worker's earlier failure, or another session) — never folded
                # into THIS request's own status (see retry_pending_sync's
                # docstring for why that would be actively harmful). Gated on
                # the same has_sync_pending(user_id) check above so a clean
                # request pays no extra glob.
                asyncio.create_task(  # noqa: RUF006
                    self._sweep_foreign_pending_scopes(user_id, session_scopes(profile_id))
                )

        # --- Request with sync tracking ---
        sync_duration = 0.0
        inflight_at_entry = _inflight_enter(user_id) if user_id else 0
        meta["inflight_entry"] = inflight_at_entry

        # Profiler enable/dispatch-level logging happens in dispatch() — see outer shell.
        force_profile = request.headers.get("X-Profile-Request", "").lower() in ("1", "true", "yes")
        do_profile = profile_on_breach_enabled() or force_profile
        method = request.method
        path = request.url.path

        try:
            # Process the request
            handler_start = time.perf_counter()
            response = await call_next(request)
            handler_duration = time.perf_counter() - handler_start
            meta["handler_duration"] = handler_duration

            # After request, check if writes occurred
            had_writes = get_request_has_writes()
            had_user_db_writes = get_request_has_user_db_writes()
            written_profile_dbs = get_request_written_profile_dbs()
            written_user_dbs = get_request_written_user_dbs()
            # T5081 (review round 3, F1): mark/sync based on the PRECISE
            # (user_id, profile_id) pair TrackedConnection recorded the write
            # against, never the request's own profile_id ContextVar — a
            # request can write to a DIFFERENT profile than its own context
            # (POST /api/profiles registers the NEW profile mid-request, per
            # persistence-sync.md's T7520 "registers last" ordering: the write
            # lands under the new profile_id while this middleware's
            # `profile_id` var is still the previous one). Marking the
            # CONTEXT's profile in that case would tag the wrong, untouched
            # profile as pending and leave the profile that ACTUALLY changed
            # with no durability record at all.
            own_profile_written = (user_id, profile_id) in written_profile_dbs
            own_user_written = user_id in written_user_dbs
            # Fail-safe, never silent: the precise sets are populated by the
            # SAME statement that flips had_writes/had_user_db_writes
            # (TrackedConnection._mark_write), so a boolean with no matching
            # attributed pair means a write path bypassed owner attribution.
            # Mark anyway — never lose a write — and shout so the gap is found.
            if had_writes and not written_profile_dbs:
                logger.critical(
                    f"[SYNC] profile write with no owner attribution user={user_id} "
                    f"{method} {path} — marking own profile defensively"
                )
                own_profile_written = bool(profile_id)
            if had_user_db_writes and not written_user_dbs:
                logger.critical(
                    f"[SYNC] user.sqlite write with no owner attribution "
                    f"user={user_id} {method} {path}"
                )
                own_user_written = True
            # Databases touched this request that are NOT the session user's --
            # admin credit grants, webhook fulfilment, cross-profile writes.
            # Historically invisible here (write tracking recorded only WHETHER a
            # write happened, never WHOSE), so they never got uploaded and died
            # with the machine. Captured NOW, before the background task starts:
            # clear_request_context() runs in the dispatch finally and the task
            # can outlive it.
            foreign_user_dbs = written_user_dbs - {user_id}
            foreign_profile_dbs = {
                pair for pair in written_profile_dbs
                if pair != (user_id, profile_id)
            }
            # T5081 (review round 3, MAJOR): mark foreign scopes pending BEFORE
            # the response returns too — the same T930 crash-safety reasoning
            # as the session's own marks below. Before this fix a foreign DB's
            # marker was written only in _background_sync's FAILURE branch, so
            # for the whole upload window (and permanently if the machine died
            # mid-upload) it held a committed write with no durability record
            # at all — INV-P false, and /api/sync/flush-verify would report it
            # clean.
            for foreign_uid in sorted(foreign_user_dbs):
                mark_sync_pending(foreign_uid, USER_DB_SCOPE)
            for foreign_uid, foreign_pid in sorted(foreign_profile_dbs):
                mark_sync_pending(foreign_uid, foreign_pid)
            if had_writes or had_user_db_writes:
                # T930: Mark pending BEFORE response returns (crash safety).
                # T5081: scoped to the db(s) THIS request's write actually
                # landed on (own_profile_written/own_user_written), so a
                # user.sqlite-only write no longer makes a later retry also
                # re-attempt an untouched profile.sqlite (and vice versa).
                if own_profile_written:
                    mark_sync_pending(user_id, profile_id)
                if own_user_written:
                    mark_sync_pending(user_id, USER_DB_SCOPE)
                # T3250: Signal sync in progress BEFORE response returns.
                # Prevents concurrent readers from seeing a stale .sync_pending
                # marker and flashing X-Sync-Status: failed.
                _begin_sync_attempt(user_id)

                # T4050: durable (sync-before-respond) gestures AWAIT the R2 push
                # INSIDE the still-held per-user write lock, so a machine swap can
                # never strand a committed publish/edit/delete. On failure we return
                # 503 (card stays, frontend offers Retry) instead of a lying 200.
                durable = bool(getattr(request.state, "durable_sync", False))
                if durable:
                    sync_status = await self._background_sync(
                        user_id, profile_id, req_id, method, path,
                        own_profile_written, own_user_written,
                        do_profile, force_profile,
                        durable=True,
                        foreign_user_dbs=foreign_user_dbs,
                        foreign_profile_dbs=foreign_profile_dbs,
                    )
                    if sync_status != "ok":
                        logger.warning(
                            f"[SYNC] DURABLE {method} {path} -> {sync_status}; "
                            f"returning 503 user={user_id}"
                            f"{(' req_id=' + req_id) if req_id else ''}"
                        )
                        # T7510: this durable-sync failure IS the taxonomy's
                        # failure outcome for the mapped funnel action (the
                        # gesture's _attempted milestone already fired inside the
                        # handler before call_next). record_milestone guards
                        # impersonation internally.
                        failure_action = DURABLE_SYNC_FAILURE_ACTIONS.get((method, path))
                        if failure_action:
                            from ..analytics import record_milestone
                            record_milestone(user_id, failure_action, reason="sync_failed")
                        # T6350: a multi-phase handler that already durably
                        # committed part of its work can register a truthful
                        # per-route body via set_durable_sync_failure_response;
                        # fall back to the generic (correct for single-phase
                        # gestures). Build a NEW dict — DURABLE_SYNC_FAILED_RESPONSE
                        # is module-level; mutating it would leak across requests.
                        payload = getattr(
                            request.state, "durable_sync_failed_response", None
                        ) or DURABLE_SYNC_FAILED_RESPONSE
                        return JSONResponse(
                            status_code=503,
                            content={**payload, "sync_state": sync_status},
                        )
                else:
                    # T3250: Fire sync as background task — response returns
                    # immediately. Write lock releases when _sync_aware_flow
                    # returns; background sync runs outside the lock.
                    # Intentionally fire-and-forget; _background_sync guards its
                    # own lifecycle. noqa: don't change task-ref semantics here.
                    asyncio.create_task(  # noqa: RUF006
                        self._background_sync(
                            user_id, profile_id, req_id, method, path,
                            own_profile_written, own_user_written,
                            do_profile, force_profile,
                            foreign_user_dbs=foreign_user_dbs,
                            foreign_profile_dbs=foreign_profile_dbs,
                        )
                    )

            # Surface sync state on the response header, but ONLY when no attempt
            # is running (an in-flight sync, incl. the T5870 bounded re-drain,
            # keeps the user in _SYNC_IN_PROGRESS and is suppressed here so a
            # write mid-sync never flashes a warning).
            # T5870: three honest states, not the old two-way "any pending == failed":
            #   conflict  — CAS refusal (.sync_conflict): needs restore-if-newer,
            #               NOT blind retry. Alarm + Retry-that-restores.
            #   failed    — a real R2 failure the re-drain could not heal
            #               (.sync_failed): alarm + working Retry.
            #   pending   — a write is queued/deferred/awaiting-retry (.sync_pending
            #               only): quiet "backup pending", NEVER "not saving". The
            #               re-drain is what makes this honest — the write IS still
            #               being delivered, not silently dropped.
            header_status = sync_status_header(user_id)
            if header_status is not None:
                response.headers["X-Sync-Status"] = header_status
                # T6390: alongside the status, a compact diag the browser console can
                # classify the incident from (reason / which db / loaded-vs-r2 / who
                # moved R2 ahead / req_id). Only for the alarm states — 'pending' has
                # no diagnosis to carry. MUST be in expose_headers (main.py) or it is
                # invisible to the cross-origin (staging/prod) client.
                if header_status in ("conflict", "failed"):
                    diag_header = _render_sync_diag(read_sync_diag(user_id))
                    if diag_header:
                        response.headers["X-Sync-Diag"] = diag_header

            # T6260: boot-set reads emit a content-hash ETag and 304-on-revalidate;
            # this OWNS their Cache-Control (private, no-cache — validator, not a
            # stale window), so it runs before the generic default below.
            if (
                method == "GET"
                and path in ETAG_304_READ_PATHS
                and response.status_code == 200
            ):
                response = await _apply_read_etag(request, response)
            # Default Cache-Control for other GET JSON responses that don't set their own.
            elif (
                method == "GET"
                and "cache-control" not in response.headers
                and response.headers.get("content-type", "").startswith("application/json")
            ):
                response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=5"

            return response

        except Exception:
            # On exception, still try to sync (changes may have been committed)
            try:
                had_writes = get_request_has_writes()
                had_user_db_writes = get_request_has_user_db_writes()
                written_profile_dbs = get_request_written_profile_dbs()
                written_user_dbs = get_request_written_user_dbs()
                # T5081: precise attribution — see the success-path comment above.
                own_profile_written = (user_id, profile_id) in written_profile_dbs
                own_user_written = user_id in written_user_dbs
                if had_writes and not written_profile_dbs:
                    logger.critical(
                        f"[SYNC] profile write with no owner attribution (error path) "
                        f"user={user_id} {method} {path} — marking own profile defensively"
                    )
                    own_profile_written = bool(profile_id)
                if had_user_db_writes and not written_user_dbs:
                    logger.critical(
                        f"[SYNC] user.sqlite write with no owner attribution (error path) "
                        f"user={user_id} {method} {path}"
                    )
                    own_user_written = True
                # T5081 (review round 3, MAJOR): mark foreign scopes here too —
                # see the identical comment on the success path above.
                foreign_user_dbs = written_user_dbs - {user_id}
                foreign_profile_dbs = {
                    pair for pair in written_profile_dbs if pair != (user_id, profile_id)
                }
                for foreign_uid in sorted(foreign_user_dbs):
                    mark_sync_pending(foreign_uid, USER_DB_SCOPE)
                for foreign_uid, foreign_pid in sorted(foreign_profile_dbs):
                    mark_sync_pending(foreign_uid, foreign_pid)
                if had_writes or had_user_db_writes:
                    if own_profile_written:
                        mark_sync_pending(user_id, profile_id)
                    if own_user_written:
                        mark_sync_pending(user_id, USER_DB_SCOPE)
                    _begin_sync_attempt(user_id)
                    # Intentional fire-and-forget; see note on the success path above.
                    asyncio.create_task(  # noqa: RUF006
                        self._background_sync(
                            user_id, profile_id, req_id, method, path,
                            own_profile_written, own_user_written,
                            do_profile, force_profile,
                            is_error_path=True,
                            foreign_user_dbs=foreign_user_dbs,
                            foreign_profile_dbs=foreign_profile_dbs,
                        )
                    )
            except Exception as tracking_error:
                logger.error(f"Failed to track sync state after error: {tracking_error}")

            # Re-raise the original exception
            raise

        finally:
            meta["sync_duration"] = sync_duration
            meta["inflight_exit"] = _inflight_exit(user_id) if user_id else 0


    async def _background_sync(
        self,
        user_id: str,
        profile_id: str | None,
        req_id: str,
        method: str,
        path: str,
        had_writes: bool,
        had_user_db_writes: bool,
        do_profile: bool,
        force_profile: bool,
        is_error_path: bool = False,
        durable: bool = False,
        foreign_user_dbs: set | None = None,
        foreign_profile_dbs: set | None = None,
    ):
        """T3250: R2 sync as background task. Runs after response is sent.

        _begin_sync_attempt must be called BEFORE this task is created
        (so the X-Sync-Status header doesn't flash "failed").
        _end_sync_attempt is called in the finally block here.

        Returns the sync status string ("ok" | "failed" | "conflict"). The
        fire-and-forget caller wraps this in asyncio.create_task and ignores the
        return; the T4050 durable caller awaits it inside the write lock and turns
        a non-ok result into a 503.

        durable: never defer on the upload lock (lock_timeout=None) — the 0.5s
        defer is a silent loss path, unacceptable for one-shot gestures.

        had_writes/had_user_db_writes (T5081, review round 3, F1): despite the
        generic names (kept to avoid a mechanical rename across every test
        call site), every caller now passes the PRECISE per-scope attribution
        (own_profile_written/own_user_written from _sync_aware_flow) — whether
        THIS call owns the profile/user.sqlite scope — never the coarse "did
        ANY write happen anywhere" flags. That precision is why the exception
        handler below can safely mark .sync_failed only for the scope(s) this
        call actually owns.
        """
        # is_error_path already blocks fully (errors must not be dropped); durable
        # gestures get the same full-block treatment so they never silently defer.
        lock_timeout = None if (is_error_path or durable) else _SYNC_LOCK_TIMEOUT
        sync_start = time.perf_counter()
        sync_status = "ok"
        # round 2 MAJOR-1: the SESSION user's OWN sync result, initialised before
        # the try so an early exception (before it is computed) still leaves it
        # defined for the finalisation gate. Overwritten with the real value once
        # the session's own sync completes; forced to "failed" in the except.
        own_status = "ok"
        # T6390: initialised before the try so the failed-marker scoping below (and
        # an early-exception except path) can tell which db failed without a NameError.
        db_status = "ok"
        user_status = "ok"
        try:
            if had_writes and had_user_db_writes:
                _user_id = user_id
                _profile_id = profile_id
                timing = {}
                do_sync_profile = do_profile

                def _sync_profile():
                    sub_prof = cProfile.Profile() if do_sync_profile else None
                    if sub_prof:
                        sub_prof.enable()
                    t0 = time.perf_counter()
                    try:
                        return sync_db_to_r2_explicit(_user_id, _profile_id, lock_timeout=lock_timeout)
                    finally:
                        elapsed_ms = (time.perf_counter() - t0) * 1000
                        timing['profile_ms'] = elapsed_ms
                        if sub_prof:
                            sub_prof.disable()
                            if force_profile or elapsed_ms >= profile_breach_ms():
                                dump_profile(
                                    sub_prof,
                                    tag=f"syncthread_profile_{_user_id}",
                                    elapsed_ms=elapsed_ms,
                                    req_id=req_id,
                                )

                def _sync_user():
                    sub_prof = cProfile.Profile() if do_sync_profile else None
                    if sub_prof:
                        sub_prof.enable()
                    t0 = time.perf_counter()
                    try:
                        return sync_user_db_to_r2_explicit(_user_id, lock_timeout=lock_timeout)
                    finally:
                        elapsed_ms = (time.perf_counter() - t0) * 1000
                        timing['user_ms'] = elapsed_ms
                        if sub_prof:
                            sub_prof.disable()
                            if force_profile or elapsed_ms >= profile_breach_ms():
                                dump_profile(
                                    sub_prof,
                                    tag=f"syncthread_user_{_user_id}",
                                    elapsed_ms=elapsed_ms,
                                    req_id=req_id,
                                )

                profile_ok, user_ok = await asyncio.gather(
                    asyncio.to_thread(_sync_profile),
                    asyncio.to_thread(_sync_user),
                )

                if profile_ok != user_ok:
                    logger.warning(
                        f"[SYNC_PARTIAL] user={_user_id} profile_ok={profile_ok} "
                        f"user_ok={user_ok} path={path} method={method}"
                    )

                db_status = _status_for_result(profile_ok)
                user_status = _status_for_result(user_ok)
                user_sync_success = bool(user_ok)

                # T6390: the T4310 post-gather reassertion is DELETED. It existed
                # because _sync_profile/_sync_user ran concurrently and both wrote the
                # SAME per-user marker file, so one thread's clear could stomp the
                # other's mark. Markers are now PER SCOPE (profile_id vs
                # USER_DB_SCOPE) and each thread's sync_*_explicit touches only its
                # own scope, so the race is structurally impossible — reasserting from
                # THIS request's two statuses would also (re)introduce the cross-DB
                # clear the task exists to remove. Scope the marker, don't reassert.

                if PROFILING_ENABLED:
                    parallel_ms = (time.perf_counter() - sync_start) * 1000
                    p_ms = timing.get('profile_ms', 0)
                    u_ms = timing.get('user_ms', 0)
                    logger.info(
                        f"[PROFILE] R2 sync: {parallel_ms:.0f}ms parallel "
                        f"(would be {p_ms + u_ms:.0f}ms sequential: "
                        f"profile: {p_ms:.0f}ms + user: {u_ms:.0f}ms)"
                    )
            elif had_writes:
                result = await asyncio.to_thread(
                    sync_db_to_r2_explicit, user_id, profile_id, lock_timeout
                )
                db_status = _status_for_result(result)
                user_status = "ok"
                user_sync_success = True
            elif had_user_db_writes:
                db_status = "ok"
                result = await asyncio.to_thread(
                    sync_user_db_to_r2_explicit, user_id, lock_timeout
                )
                user_status = _status_for_result(result)
                user_sync_success = bool(result)
            else:
                # T5081 (review round 3, F2): neither of THIS session's own dbs
                # was written — e.g. a foreign-only write (an admin credit
                # grant, a webhook) during a request whose own profile_id
                # touched nothing. Falling through to an unconditional
                # `sync_user_db_to_r2_explicit(user_id)` here (the old `else`)
                # re-uploaded a user.sqlite with nothing pending — the exact
                # false-conflict class this task exists to close. The actual
                # foreign write is synced by the foreign_user_dbs/
                # foreign_profile_dbs loops below.
                db_status = "ok"
                user_status = "ok"
                user_sync_success = True

            # T4310: conflict takes precedence over a generic failure — a conflict
            # is diagnosable (CAS refused a stale write, storage.py already
            # re-downloaded) where "failed" could be any transient R2 error.
            if "conflict" in (db_status, user_status):
                sync_status = "conflict"
            elif db_status == "failed" or not user_sync_success:
                sync_status = "failed"

            # T5870: the SESSION user's OWN sync result, captured before the foreign
            # loops fold their outcome into the aggregate sync_status. The re-drain
            # below heals the session's own write only — it must never run off (or
            # mask) a FOREIGN DB failure, which retry_pending_sync(session) cannot fix.
            own_status = sync_status
            foreign_unsynced = False

            # Upload any database this request touched that is NOT the session
            # user's. Each owner gets its own sync + its own sync-pending marker,
            # so a failure is attributed to the DB that actually failed.
            for foreign_uid in sorted(foreign_user_dbs or ()):
                result = await asyncio.to_thread(
                    sync_user_db_to_r2_explicit, foreign_uid, lock_timeout
                )
                if result:
                    logger.info(
                        f"[SYNC] {method} {path} -> synced FOREIGN user.sqlite "
                        f"user={foreign_uid} (session user={user_id})"
                    )
                else:
                    mark_sync_pending(foreign_uid, scope=USER_DB_SCOPE)  # T5081: scope-only
                    foreign_unsynced = True
                    if result == SyncResult.CONFLICT:
                        # T6390: sync_user_db_to_r2_explicit ALREADY marked the
                        # foreign owner's user-scope conflict WITH its diag — do not
                        # re-mark here (that would clobber the diag with an empty one).
                        if sync_status == "ok":
                            sync_status = "conflict"
                    else:
                        # round 2 MAJOR-1: the FOREIGN owner's write genuinely did
                        # not land — give THEM the alarm + Retry (.sync_failed), not
                        # just quiet .sync_pending. (The session's alarm is gated on
                        # its OWN status below.) T6390: scope to their user.sqlite.
                        mark_sync_failed(foreign_uid, scope=USER_DB_SCOPE, diag=build_marker_diag(
                            db="user", profile_id=None, loaded=None))
                        sync_status = "failed"
                    logger.error(
                        f"[SYNC] {method} {path} -> FAILED to sync foreign user.sqlite "
                        f"user={foreign_uid} (session user={user_id}); change is local-only"
                    )
            for foreign_uid, foreign_pid in sorted(foreign_profile_dbs or ()):
                result = await asyncio.to_thread(
                    sync_db_to_r2_explicit, foreign_uid, foreign_pid, lock_timeout
                )
                if result:
                    logger.info(
                        f"[SYNC] {method} {path} -> synced FOREIGN profile.sqlite "
                        f"user={foreign_uid} profile={foreign_pid}"
                    )
                else:
                    mark_sync_pending(foreign_uid, scope=foreign_pid)  # T5081: scope-only
                    foreign_unsynced = True
                    if result == SyncResult.CONFLICT:
                        # T6390: sync_db_to_r2_explicit already marked the foreign
                        # owner's profile-scope conflict with its diag — don't clobber.
                        if sync_status == "ok":
                            sync_status = "conflict"
                    else:
                        # round 2 MAJOR-1: alarm the FOREIGN owner (see loop above).
                        # T6390: scope to their profile.
                        mark_sync_failed(foreign_uid, scope=foreign_pid, diag=build_marker_diag(
                            db="profile", profile_id=foreign_pid, loaded=None))
                        sync_status = "failed"
                    logger.error(
                        f"[SYNC] {method} {path} -> FAILED to sync foreign profile.sqlite "
                        f"user={foreign_uid} profile={foreign_pid}; change is local-only"
                    )

            # T5870: bounded, attempt-scoped RE-DRAIN of a transient failure — the
            # single most important behavioural change. A deferred/failed sync is
            # retried in-band (still holding _SYNC_IN_PROGRESS, so it never flashes
            # a warning mid-heal) before the user is ever told anything failed. This
            # is what makes the quiet "pending" header HONEST: the write is still
            # being delivered, not silently dropped. Skipped for the durable path
            # (it returns 503 and its own gesture UX owns the retry) and the error
            # path (handled by set_sync_failed below), and never for a CAS conflict
            # (not blind-retryable — needs restore-if-newer via /api/retry-sync).
            # Gated on own_status (the SESSION user's OWN failure), NOT the aggregate:
            # retry_pending_sync(session) cannot fix a FOREIGN owner's failed upload,
            # and healing the session must never mask that — so a still-unsynced
            # foreign DB keeps the aggregate "failed" even after the session heals.
            if (own_status == "failed" and not durable and not is_error_path
                    and await self._redrain_failed_sync(user_id, profile_id)):
                own_status = "ok"
                # T5081: retry_pending_sync (which the re-drain calls) only
                # reports OK when every scope it found pending for this session
                # (this profile AND user.sqlite) actually synced — so a healed
                # re-drain means both are now genuinely clean, same as if the
                # first attempt had succeeded outright. Without this, the
                # per-db clear below (gated on db_status/user_status) would
                # skip a scope that WAS healed, because those two only reflect
                # the pre-redrain attempt.
                db_status = "ok"
                user_status = "ok"
                if sync_status == "failed" and not foreign_unsynced:
                    sync_status = "ok"
        except Exception as sync_error:
            log_msg = "Sync to R2 raised exception"
            if is_error_path:
                log_msg += " after request error"
            logger.error(f"{log_msg}: {sync_error}")
            sync_status = "failed"
            own_status = "failed"  # session's own sync errored (conservative)
            # T5081: an exception can abort BEFORE db_status/user_status are
            # (re)computed for this attempt, leaving them at their pre-try "ok"
            # default — which would wrongly look like a real success below.
            # An aborted attempt proves nothing landed for whichever scope(s)
            # this call actually owns — gated on had_writes/had_user_db_writes
            # (which now carry the PRECISE per-scope attribution, not a crude
            # "something happened" flag) so an exception during a profile-only
            # attempt does not also mark a .sync_failed alarm on a user.sqlite
            # scope this call never touched (review round 3 MINOR).
            db_status = "failed" if had_writes else "ok"
            user_status = "failed" if had_user_db_writes else "ok"
        finally:
            _end_sync_attempt(user_id)

        sync_duration = time.perf_counter() - sync_start

        # T5081 (review round 3, Q3): NO clear_sync_pending/clear_sync_failed
        # call belongs here. Every upload above ran through
        # sync_db_to_r2_explicit/sync_user_db_to_r2_explicit, which ALREADY
        # clear their own scope's .sync_pending (INV-P reason a) and
        # .sync_failed the instant they observe success — so by the time we
        # reach this line, whatever landed is already durably recorded as
        # such. A clear here would be redundant at best; at worst (a blanket
        # clear_sync_failed(user_id)) it silently heals a DIFFERENT profile's
        # still-genuinely-broken alarm, the exact self-stomp class T6390
        # fixed for conflict/failed and this task closes for pending. The
        # in-band re-drain above heals through the SAME primitives, so a
        # healed retry is covered by the identical guarantee.
        if sync_status == "ok":
            logger.info(f"[SYNC] {method} {path} -> R2 sync OK ({sync_duration:.2f}s)")
        elif sync_status == "conflict":
            logger.warning(f"[SYNC] {method} {path} -> version conflict ({sync_duration:.2f}s)")
        else:
            # T5870: a real failure the re-drain could not heal. Mark it genuinely
            # failed (alarm + working Retry) — but NOT on the durable path (its 503
            # UX owns it) or the error path (set_sync_failed below). Leaving only
            # .sync_pending there keeps those contracts unchanged (quiet "pending").
            # round 2 MAJOR-1: gate on own_status, NOT the aggregate. A foreign-only
            # failure (own_status == "ok") must not raise the SESSION's alarm — the
            # session's own data reached R2; the foreign owner already got its own
            # .sync_failed in the loops above.
            if own_status == "failed" and not durable and not is_error_path:
                # T6390: mark ONLY the scope(s) that actually failed, so this never
                # stomps a live conflict on the other db.
                if db_status == "failed" and profile_id:
                    mark_sync_failed(user_id, scope=profile_id, diag=build_marker_diag(
                        db="profile", profile_id=profile_id, loaded=None))
                if user_status == "failed":
                    mark_sync_failed(user_id, scope=USER_DB_SCOPE, diag=build_marker_diag(
                        db="user", profile_id=None, loaded=None))
            logger.warning(f"[SYNC] {method} {path} -> R2 sync FAILED ({sync_duration:.2f}s)")

        if is_error_path:
            set_sync_failed(user_id, sync_status != "ok", profile_id=profile_id)

        return sync_status

    async def _redrain_failed_sync(self, user_id: str, profile_id: str | None) -> bool:
        """T5870: bounded continuation of the ORIGINATING write gesture.

        This is deliberately NOT reactive persistence — the rule that a reviewer
        will (correctly) challenge. It is legal because:
          * it re-attempts the SAME write's R2 sync (the write that produced this
            _background_sync task), a fixed _REDRAIN_MAX_ATTEMPTS number of times;
          * it does NOT watch/observe any state, is NOT a useEffect/store watcher,
            and is NOT a background poller that generates new writes — it is the
            tail of one write gesture finishing its own delivery;
          * on exhaustion it STOPS and lets the write surface as genuinely failed.
        If you cannot name the gesture a write traces back to, the write must not
        exist — here the gesture is the user edit that opened this request.

        Returns True iff a retry landed the write. Bails immediately on a CAS
        conflict — a conflict is not blind-retryable; it needs restore-if-newer via
        the manual /api/retry-sync. T6390: the conflict decision comes from
        retry_pending_sync's RETURN VALUE (SyncResult.CONFLICT), not from re-reading
        the .sync_conflict marker file — the old per-user marker read could be
        defeated by the self-stomp this task fixes, so a genuinely-conflicted retry
        was blind-retried to exhaustion and mislabelled "failed".

        round 2 MAJOR-2: each attempt NON-BLOCKING-probes the per-user upload lock
        BEFORE re-uploading (mirrors the T1539 write-triggered retry). Fire-and-
        forget _background_sync tasks are not serialised per user, so a burst can
        spawn several concurrent re-drains for one user; without the probe each
        would block-acquire the same lock and stampede byte-identical uploads of
        the same R2 object (T1537: concurrent same-key PUTs -> 429s, user stuck
        degraded). The probe collapses the burst — only the re-drain that finds the
        lock free proceeds; the rest skip that attempt and heal on a later one (or
        are healed by the in-flight upload). It also means the blocking acquire
        inside retry_pending_sync is only reached when the lock looked free, so no
        thread parks for a multi-second export-worker hold.
        """
        from ..storage import get_upload_lock

        for attempt in range(_REDRAIN_MAX_ATTEMPTS):
            await asyncio.sleep(_REDRAIN_BASE_BACKOFF_S * (2 ** attempt))
            probe = get_upload_lock(user_id, "profile")
            if not probe.acquire(blocking=False):
                logger.info(
                    f"[SYNC_REDRAIN] user={user_id} attempt={attempt + 1} skipped "
                    f"— upload already in progress (no stampede)"
                )
                continue
            probe.release()
            try:
                # T5081 (review round 3, F8): consume the report directly so a
                # genuinely-empty drain (own_status=="failed" but this scope
                # already healed via another path) logs distinctly from a real
                # heal — both are legitimately "return True" under INV-P
                # (nothing pending IS durable), but only one actually uploaded.
                report = await asyncio.to_thread(
                    drain_pending_scopes, user_id, session_scopes(profile_id)
                )
            except Exception as e:
                logger.warning(
                    f"[SYNC_REDRAIN] user={user_id} attempt={attempt + 1} raised: {e}"
                )
                continue
            agg = report.aggregate()
            if agg == SyncResult.CONFLICT:
                # T6390: a CAS conflict is not blind-retryable — stop NOW, decided
                # from the return value, not a marker file.
                logger.warning(
                    f"[SYNC_REDRAIN] user={user_id} attempt={attempt + 1} hit a CAS "
                    f"conflict — stopping (needs restore-if-newer, not blind retry)"
                )
                return False
            if agg is None:
                logger.info(
                    f"[SYNC_REDRAIN] user={user_id} attempt={attempt + 1}: nothing left "
                    f"to drain — a concurrent sync already landed this write"
                )
                return True
            if agg == SyncResult.OK:
                logger.info(
                    f"[SYNC_REDRAIN] user={user_id} healed on attempt {attempt + 1}: "
                    f"{sorted(report.attempted)}"
                )
                return True
        logger.warning(
            f"[SYNC_REDRAIN] user={user_id} exhausted {_REDRAIN_MAX_ATTEMPTS} "
            f"attempts — marking genuinely failed"
        )
        return False

    async def _sweep_foreign_pending_scopes(self, user_id: str, own: set) -> None:
        """Drain pending scopes this session is NOT scoped to (another profile
        of the same user, marked pending by a background export worker or a
        different session).

        T5081 (review round 3, Q2): fire-and-forget and never folded into any
        status this request returns — this session's response must not wait
        on, or be failed by, a profile it did not touch (see
        `retry_pending_sync`'s docstring for why folding a foreign scope's
        outcome into the caller's own verdict was actively harmful). Bounded
        to `_FOREIGN_SWEEP_MAX_SCOPES` per call and skipped while an upload
        for this user is already in flight, so a write burst cannot stampede
        the same R2 keys (the T1537 429 failure mode). Deliberately NOT
        wrapped in `_begin_sync_attempt`/`_end_sync_attempt`: a foreign scope
        really IS pending, so suppressing `X-Sync-Status` while this heals it
        would be a lie about state the session itself doesn't own.

        Gesture: the tail of the user's OWN write request — the same
        justification `_redrain_failed_sync` already carries. It generates no
        new writes of its own, only finishes delivering ones that already
        happened.
        """
        from ..storage import get_upload_lock
        with _FOREIGN_SWEEP_GUARD:
            if user_id in _FOREIGN_SWEEP_INFLIGHT:
                return
            _FOREIGN_SWEEP_INFLIGHT.add(user_id)
        try:
            from app import database as db_module
            probe = get_upload_lock(user_id, "profile")
            if not probe.acquire(blocking=False):
                return
            probe.release()
            foreign = sorted(db_module.list_pending_scopes(user_id) - own)[:_FOREIGN_SWEEP_MAX_SCOPES]
            if not foreign:
                return
            report = await asyncio.to_thread(
                drain_pending_scopes, user_id, foreign, lock_timeout=_SYNC_LOCK_TIMEOUT
            )
            logger.info(
                f"[SYNC_SWEEP] user={user_id} foreign drain: {report.attempted} "
                f"orphaned={sorted(report.orphaned)}"
            )
        except Exception as e:
            logger.warning(f"[SYNC_SWEEP] user={user_id} raised: {e}")
        finally:
            with _FOREIGN_SWEEP_GUARD:
                _FOREIGN_SWEEP_INFLIGHT.discard(user_id)


# Keep old name for backward compatibility with imports
DatabaseSyncMiddleware = RequestContextMiddleware
