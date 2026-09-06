"""
Database configuration and initialization for Video Editor.

Uses SQLite with the database file stored in user_data/<user_id>/profile.sqlite.
Tables are created automatically on first access or when missing.

The database and directories are auto-created on demand, so deleting
the user_data/<user_id> folder will simply reset the app to a clean state.

User Isolation:
The current user ID is determined by the session cookie (or X-User-ID header
in tests). Every visitor gets a UUID via /api/auth/init-guest. If no user
context is set, get_current_user_id() raises RuntimeError.
"""

import json
import logging
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from enum import Enum
from pathlib import Path
from typing import Any

from . import migrations
from .profile_context import get_current_profile_id
from .storage import (
    R2_ENABLED,
    sync_database_from_r2_if_newer,
    sync_database_to_r2_with_version,
)
from .user_context import get_current_user_id

logger = logging.getLogger(__name__)

# Base path for user data
USER_DATA_BASE = Path(__file__).parent.parent.parent.parent / "user_data"

# Track initialized user namespaces (per user_id)
_initialized_users: set = set()

# Track database versions per (user_id, profile_id) (for R2 sync)
_user_db_versions: dict = {}  # (user_id, profile_id) -> version number
_db_version_lock = threading.Lock()

# R2 restore cooldown — avoids hammering R2 on transient failures
_r2_restore_cooldowns: dict[str, float] = {}  # cache_key -> last failure timestamp
RESTORE_COOLDOWN_SECONDS = 30

# Database size thresholds (archive system targets <400KB)
DB_SIZE_WARNING_THRESHOLD = 400 * 1024  # 400KB - archive target exceeded
DB_SIZE_CRITICAL_THRESHOLD = 768 * 1024  # 768KB - sync performance degrades


# ---------------------------------------------------------------------------
# T930: Persistent sync failure state
# ---------------------------------------------------------------------------

def _sync_pending_path(user_id: str) -> Path:
    """Path to the LEGACY (unscoped) pending marker. `scope=None` callers and a
    marker written by a previous deploy still land/read here."""
    return USER_DATA_BASE / user_id / ".sync_pending"


# ---------------------------------------------------------------------------
# T4310/T5870/T6390/T5081: CAS-conflict, genuine-failure, and pending markers.
#
# T4310 introduced .sync_conflict; T5870 added .sync_failed (a definitively-failed
# sync the bounded re-drain could not heal, distinct from a merely-PENDING one).
# Both drive the "Could not save to the cloud" banner and both LEAVE .sync_pending
# set, so the existing retry UX is unchanged. T5081 scoped .sync_pending itself
# the same way (see mark_sync_pending/has_sync_pending_scope below) — it was the
# last unscoped marker in this family. UNLIKE conflict/failed (alarm state,
# clearable on judgement), pending is a DURABILITY RECORD — see the INV-P
# comment above mark_sync_pending for its stricter three-reason-only clear rule
# and why `scope` is required (no `scope=None`) on pending's mark/clear.
#
# T6390 fixes a correctness defect AND adds diagnostics:
#   * SCOPING — the markers were per-USER files (USER_DATA_BASE/{user_id}/.sync_*)
#     but describe per-DB, per-PROFILE state. One user has user.sqlite plus a
#     profile.sqlite per profile; a single file spoke for all of them, so a success
#     on ONE db erased a live conflict on ANOTHER (silent-stale-data, T6040 class).
#     Now each marker is a PER-SCOPE file — `.sync_{kind}.{scope}` where scope is
#     USER_DB_SCOPE for user.sqlite or the profile_id for a profile DB — cleared
#     only for the scope that succeeded. `has_sync_*` reports a conflict if ANY
#     scope is conflicted (header priority conflict > failed > pending unchanged).
#     Separate files (not one shared JSON set) because profile+user syncs run in
#     PARALLEL threads; per-scope files mean each thread writes only its own scope,
#     so the race the old post-gather reassertion papered over cannot happen.
#   * DIAGNOSIS — each marker now holds a JSON payload (reason, db, profile_id,
#     loaded, r2, machine, req_id, method, path, writer, written_at, ts), surfaced
#     via read_sync_diag() and the X-Sync-Diag header, instead of a bare timestamp.
#     Readers TOLERATE the legacy bare `str(time.time())` body (a marker written by
#     the running deploy) and the legacy unscoped path — never raise on them.
#
# Backward-compatible signatures (CONFLICT/FAILED ONLY — pending's mark/clear
# require an explicit scope, see INV-P above): `scope=None` on mark_* writes
# the legacy bare file and on clear_* clears ALL scopes + the legacy file
# (reserved for genuine full-recovery callers and legacy tolerance — NOT a
# single-DB success path).
# ---------------------------------------------------------------------------

USER_DB_SCOPE = "user"  # marker scope for user.sqlite (profile DBs use their profile_id)
_CONFLICT_KIND = "conflict"
_FAILED_KIND = "failed"


def _marker_dir(user_id: str) -> Path:
    return USER_DATA_BASE / user_id


def _scoped_marker_path(user_id: str, kind: str, scope: str) -> Path:
    return _marker_dir(user_id) / f".sync_{kind}.{scope}"


def _legacy_marker_path(user_id: str, kind: str) -> Path:
    return _marker_dir(user_id) / f".sync_{kind}"


def _write_marker(path: Path, diag: dict | None) -> None:
    payload = dict(diag or {})
    payload.setdefault("ts", time.time())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def _mark(user_id: str, kind: str, scope: str | None, diag: dict | None) -> None:
    if scope is None:
        # Legacy/compat call shape (mark_sync_*(user_id)): bare unscoped file.
        _write_marker(_legacy_marker_path(user_id, kind), diag)
    else:
        _write_marker(_scoped_marker_path(user_id, kind, scope), {**(diag or {}), "scope": scope})


def _clear(user_id: str, kind: str, scope: str | None) -> None:
    if scope is None:
        # Full recovery: clear every scope AND the legacy bare file.
        _legacy_marker_path(user_id, kind).unlink(missing_ok=True)
        try:
            for p in _marker_dir(user_id).glob(f".sync_{kind}.*"):
                p.unlink(missing_ok=True)
        except OSError:
            pass
    else:
        _scoped_marker_path(user_id, kind, scope).unlink(missing_ok=True)
        # A legacy bare marker cannot be attributed to a scope (old deploy); clear it
        # opportunistically on any scoped success so it can't strand the banner past
        # the deploy window. Self-limiting: new code never writes a bare marker.
        _legacy_marker_path(user_id, kind).unlink(missing_ok=True)


def _has(user_id: str, kind: str) -> bool:
    if _legacy_marker_path(user_id, kind).exists():
        return True
    try:
        return any(_marker_dir(user_id).glob(f".sync_{kind}.*"))
    except OSError:
        return False


_PENDING_KIND = "pending"

# ---------------------------------------------------------------------------
# T5081 — INV-P, the pending-marker invariant (expert design, review round 3):
#
#   `.sync_pending.{scope}` exists  <=>  that scope's local DB may hold
#   committed writes not yet confirmed present in R2.
#
#   SET by: a write observed for that scope, or an upload attempt for that
#   scope that did not confirm success.
#   CLEARED by exactly three things, and NOTHING else:
#     (a) the code that just received success=True from the R2 upload
#         primitive FOR THAT EXACT SCOPE (sync_db_to_r2_explicit /
#         sync_user_db_to_r2_explicit — the only two callers; sync_db_to_cloud
#         is a separate legacy primitive with no production caller left after
#         T5081 and does NOT participate in INV-P);
#     (b) a restore-if-newer that actually replaced that scope's local DB
#         with R2's copy — the peer fact to recording the new baseline via
#         set_local_db_version/set_local_user_db_version. EVERY site that
#         performs that download+swap clears its own scope right after
#         recording the baseline: database.ensure_database (site 1),
#         services.user_db.ensure_user_database (site 2),
#         services.user_db.ensure_user_database_fresh (site 3),
#         services.materialization.ensure_profile_db_local (site 4). (T5087
#         deleted a fifth site, migrations._migrate_profile_db, once JIT
#         retired the bulk sweep; the four above are the complete list.)
#         There is deliberately no
#         SINGLE call site for reason (b) — a caller like a CAS-conflict
#         retry endpoint cannot tell whether IT performed the restore or an
#         earlier, unrelated request already did (a conflict schedules a
#         reheal via schedule_profile_db_reheal/schedule_user_db_reheal,
#         which nulls the cached version and makes the NEXT access of ANY
#         kind — e.g. an ordinary status poll — perform the actual restore);
#         round 6 tried plumbing a "did I just download" signal out to such a
#         caller and found it silently no-ops in the realistic sequence
#         (conflict -> an intervening read re-pulls -> the caller runs and
#         sees "already current"). Clearing at the swap site itself has no
#         such race: whichever request's restore branch actually replaces
#         the bytes is, structurally, the one that observes it;
#     (c) deletion of that scope's local DB (clear_scope_markers).
#
#   There is no fourth clear — no `scope=None`, no "recovery", no
#   opportunistic sweep. `.sync_pending` is a DURABILITY RECORD (unlike
#   `.sync_conflict`/`.sync_failed`, which are ALARM STATE and may be cleared
#   on judgement calls, e.g. a manual Retry). Once every non-(a)/(b)/(c) clear
#   is gone, absence of a marker is a durability PROOF: has_sync_pending()
#   False means "confirmed in R2 or never written", never "someone force-
#   cleared it" — which is what makes /api/sync/flush-verify trustworthy.
#
#   `scope` is REQUIRED on mark/clear (no default, ValueError if falsy).
#   Production has no legitimate reason to write a bare marker: both fly.toml
#   files declare no [mounts], so USER_DATA_BASE is the container's ephemeral
#   writable layer — a marker from a previous deploy cannot survive into the
#   new one. Legacy-format back-compat exists ONLY for a stray file (a bug
#   elsewhere, or a test), handled loudly by adopt_legacy_pending_marker, not
#   silently tolerated in the scoped read path.
#
#   CLEAR REASON (a) MUST BE COMPARE-AND-CLEAR (review round 3, BLOCKING):
#   an upload takes real wall-clock time (checkpoint + PUT, commonly >0.5s
#   under the T5870 burst harness), during which a DIFFERENT request can
#   commit a NEWER write to the SAME scope and re-mark it pending. If the
#   in-flight upload's eventual success then unconditionally unlinked the
#   marker, it would discharge a write it never uploaded — and because
#   "nothing pending" is read downstream as a durability PROOF (the re-drain
#   returns "healed" on an empty drain), a genuinely still-outstanding write
#   would be silently reported as saved. `mark_sync_pending` returns the
#   token it wrote (a timestamp made unique by construction with a uuid
#   suffix, not by clock resolution alone — two marks landing in the same
#   tick must still compare as different tokens, or the guard silently
#   degrades to the pre-fix unconditional clear); a caller about to attempt
#   an upload reads the CURRENT token with `read_pending_token` first and
#   passes it to
#   `clear_sync_pending(..., if_token=token)` on success — the clear then only
#   fires if nothing re-marked the scope since.
#
#   CLEAR REASON (b) IS ALSO COMPARE-AND-CLEAR (review round 5, BLOCKING, found
#   after an earlier version of this doc claimed otherwise): a restore-if-newer
#   is a HEAD plus, when behind, a full DB download — real wall-clock time with
#   no lock held. A write can commit and mark the SAME scope pending WHILE that
#   download is in flight; an unconditional clear right after would discharge
#   that brand-new write's durability record along with the stale one the
#   restore actually addressed. Every site downloads STRAIGHT INTO the live
#   local path, so the vulnerable window is the whole download; each reads
#   `read_pending_token` immediately BEFORE calling the R2 restore helper,
#   then passes what it captured to `clear_sync_pending(..., if_token=...)`
#   right after recording the new baseline — identical shape to reason (a),
#   just triggered by a download landing instead of an upload landing.
#   (The deleted fifth site, migrations._migrate_profile_db, used to download
#   into a temp file first and read the token right before its swap instead —
#   a tighter bracket, not a different rule. Moot now that it is gone.)
#
#   Reason (c) does not need this: deleting the scope's local DB entirely
#   invalidates any pending record for it regardless of when it was marked
#   (there is no local file left for an in-flight write to land in), so
#   clear_scope_markers calls `clear_sync_pending` WITHOUT `if_token`
#   (unconditional).
# ---------------------------------------------------------------------------

_PENDING_TOKEN_UNCHECKED = object()  # sentinel: "no if_token given" != "token was None"


def mark_sync_pending(user_id: str, scope: str) -> str:
    """Mark `scope` (a profile_id or USER_DB_SCOPE) as having unsynced writes.
    See the INV-P comment above. Content is not the JSON diag payload `_mark`
    writes for conflict/failed — pending has no diagnosis to carry — but it is
    NOT a bare `time.time()` either: two marks landing in the same clock tick
    (`time.time()`'s resolution is platform-dependent — observed colliding on
    Windows dev machines) must still produce distinct tokens, or the INV-P
    compare-and-clear guard silently degrades to an unconditional clear. A
    `:`-suffixed uuid makes the token unique by construction; the leading
    timestamp is kept for humans grepping the raw file.
    Returns the token written, for a compare-and-clear via clear_sync_pending
    (see read_pending_token)."""
    if not scope:
        raise ValueError("mark_sync_pending requires an explicit scope "
                          "(USER_DB_SCOPE or a profile_id)")
    path = _scoped_marker_path(user_id, _PENDING_KIND, scope)
    path.parent.mkdir(parents=True, exist_ok=True)
    token = f"{time.time()}:{uuid.uuid4().hex}"
    path.write_text(token)
    return token


def read_pending_token(user_id: str, scope: str) -> str | None:
    """The current pending marker's content for `scope`, or None if absent.
    Call this BEFORE attempting an upload, then pass the result to
    `clear_sync_pending(..., if_token=...)` on success — see the INV-P
    compare-and-clear comment above `_PENDING_TOKEN_UNCHECKED`."""
    try:
        return _scoped_marker_path(user_id, _PENDING_KIND, scope).read_text()
    except (FileNotFoundError, OSError):
        return None


def clear_sync_pending(user_id: str, scope: str, *, if_token=_PENDING_TOKEN_UNCHECKED) -> None:
    """Clear THIS scope's pending marker — one of the three INV-P clear
    reasons ONLY (see the comment above). Deliberately does NOT delegate to
    `_clear` and does NOT sweep the legacy bare file: `.sync_conflict`/
    `.sync_failed`'s opportunistic legacy-sweep is fine for alarm state, but
    for a durability record it is exactly wrong — sweeping the bare marker on
    the FIRST scope's success silently discards whatever the bare marker
    might have also meant for every OTHER scope (found in review round 2).

    `if_token`: pass the value `read_pending_token` returned BEFORE the
    upload or restore this clear is discharging — the clear then fires only
    if the marker's content is still exactly that (including both being
    absent). REQUIRED for both reason (a) (upload success) and reason (b)
    (restore-if-newer download+swap) — both take real wall-clock time with
    no lock held, during which a different write can re-mark the same scope.
    Omit it ONLY for reason (c) (clear_scope_markers, on local DB deletion):
    there is no local file left for an in-flight write to land in, so an
    unconditional clear is correct there.
    """
    if not scope:
        raise ValueError("clear_sync_pending requires an explicit scope")
    path = _scoped_marker_path(user_id, _PENDING_KIND, scope)
    if if_token is not _PENDING_TOKEN_UNCHECKED:
        try:
            current = path.read_text()
        except (FileNotFoundError, OSError):
            current = None
        if current != if_token:
            return  # re-marked (a newer write) or already cleared — not ours to discard
    path.unlink(missing_ok=True)


def has_sync_pending(user_id: str) -> bool:
    """True if ANY scope (or a stray legacy bare marker) has unsynced writes."""
    return _has(user_id, _PENDING_KIND)


def has_sync_pending_scope(user_id: str, scope: str) -> bool:
    """True if THIS scope specifically has unsynced writes — the gate
    `drain_pending_scopes` uses so it never re-uploads a db with nothing
    pending. Pure per-scope check: a legacy bare marker is NOT consulted here
    (it cannot name which scope it meant) — see `adopt_legacy_pending_marker`,
    which upgrades one into real per-scope markers before any scoped decision
    is made, so this function never needs to guess."""
    return _scoped_marker_path(user_id, _PENDING_KIND, scope).exists()


def list_pending_scopes(user_id: str) -> set[str]:
    """Every profile_id/USER_DB_SCOPE with its OWN scoped pending marker (never
    the legacy bare file — see has_sync_pending_scope)."""
    try:
        return {p.name.split(".", 2)[2] for p in _marker_dir(user_id).glob(f".sync_{_PENDING_KIND}.*")}
    except OSError:
        return set()


def adopt_legacy_pending_marker(user_id: str) -> set[str]:
    """One-shot upgrade of a stray pre-T5081 unscoped `.sync_pending` into
    explicit per-scope markers for every db this user has on local disk.

    Production should never actually hit this (see the INV-P comment above —
    ephemeral disk, and every real caller now passes a scope) — if one turns
    up, it means a bug wrote one, and we refuse to guess which single db it
    meant: "every db of this user" is the only sound reading. Logs CRITICAL
    rather than silently self-repairing. Idempotent; writes the scoped markers
    FIRST and unlinks the bare file LAST, so a crash mid-adopt leaves
    duplicated-but-correct state, never a lost record.
    """
    legacy = _sync_pending_path(user_id)
    if not legacy.exists():
        return set()
    scopes: set[str] = set()
    if (USER_DATA_BASE / user_id / "user.sqlite").exists():
        scopes.add(USER_DB_SCOPE)
    profiles_dir = USER_DATA_BASE / user_id / "profiles"
    if profiles_dir.is_dir():
        scopes |= {p.name for p in profiles_dir.iterdir() if (p / "profile.sqlite").exists()}
    for s in sorted(scopes):
        mark_sync_pending(user_id, s)
    legacy.unlink(missing_ok=True)
    logger.critical(
        f"[SYNC] adopted a stray unscoped .sync_pending for user={user_id} into "
        f"scopes={sorted(scopes)} — no production caller should produce this"
    )
    return scopes


def clear_scope_markers(user_id: str, scope: str) -> None:
    """Clear every sync marker (pending, conflict, failed) for a scope whose
    LOCAL db no longer exists — INV-P clear reason (c). Call this whenever a
    profile's (or user's) local db is deleted: a marker left behind for a db
    that will never be uploaded again wedges `has_sync_pending`/
    `has_sync_conflict` true forever, with no gesture able to clear it."""
    for kind in (_PENDING_KIND, _CONFLICT_KIND, _FAILED_KIND):
        _scoped_marker_path(user_id, kind, scope).unlink(missing_ok=True)


def _read_marker_diag(user_id: str, kind: str) -> dict | None:
    """Return ONE scope's diag payload for `kind` (the first by filename among the
    scopes conflicted for this kind), or None. `read_sync_diag` applies the real
    cross-KIND priority (conflict > failed); WITHIN a kind the diag header is a
    single-incident hint, so first-by-name is sufficient (`has_sync_conflict` still
    reports the aggregate correctly regardless of which scope's diag is surfaced).

    Tolerates the legacy bare float body (returns a minimal {'reason': 'legacy'})
    and any unparseable/partial file — the reader must never raise on a marker
    written by the previous deploy.
    """
    d = _marker_dir(user_id)
    try:
        candidates = sorted(d.glob(f".sync_{kind}.*")) if d.exists() else []
    except OSError:
        candidates = []
    for p in candidates:
        try:
            body = json.loads(p.read_text())
            if isinstance(body, dict):
                return body
        except (json.JSONDecodeError, OSError, ValueError):
            continue
    if _legacy_marker_path(user_id, kind).exists():
        return {"reason": "legacy"}
    return None


def build_marker_diag(*, db: str, profile_id: str | None, loaded: int | None,
                      r2: int | None = None, r2_diag: dict | None = None) -> dict:
    """Assemble the marker payload — the R2-side facts from the storage primitive
    (reason + writer/written_at of whoever moved R2 ahead) merged with the
    request-side facts known here (db, profile_id, loaded, machine, req_id,
    method, path). Absent request context (a background worker) leaves those None
    — honest, never a fabricated value."""
    from .storage import FLY_MACHINE_ID
    from .user_context import get_current_method, get_current_path, get_current_req_id
    merged = dict(r2_diag or {})
    merged.update({
        "db": db,
        "profile_id": profile_id,
        "loaded": loaded,
        "r2": r2,
        "machine": FLY_MACHINE_ID or None,
        "req_id": get_current_req_id() or None,
        "method": get_current_method() or None,
        "path": get_current_path() or None,
    })
    return merged


def mark_sync_conflict(user_id: str, scope: str | None = None, diag: dict | None = None) -> None:
    """Write the CAS-conflict marker for `scope` (USER_DB_SCOPE or a profile_id).
    `scope=None` writes the legacy bare marker (compat)."""
    _mark(user_id, _CONFLICT_KIND, scope, diag)


def clear_sync_conflict(user_id: str, scope: str | None = None) -> None:
    """Clear the conflict marker for `scope`. `scope=None` clears ALL scopes + the
    legacy file (full recovery only — never a single-DB success)."""
    _clear(user_id, _CONFLICT_KIND, scope)


def has_sync_conflict(user_id: str) -> bool:
    """True if ANY scope (or a legacy bare marker) records a CAS conflict."""
    return _has(user_id, _CONFLICT_KIND)


def mark_sync_failed(user_id: str, scope: str | None = None, diag: dict | None = None) -> None:
    """Write the genuine-failure marker for `scope` (a real, unrecovered failure
    the bounded re-drain could not heal). `scope=None` writes the legacy bare file."""
    _mark(user_id, _FAILED_KIND, scope, diag)


def clear_sync_failed(user_id: str, scope: str | None = None) -> None:
    """Clear the failure marker for `scope`. `scope=None` clears ALL scopes."""
    _clear(user_id, _FAILED_KIND, scope)


def has_sync_failed(user_id: str) -> bool:
    """True if ANY scope (or a legacy bare marker) records a genuine failure."""
    return _has(user_id, _FAILED_KIND)


def read_sync_diag(user_id: str) -> dict | None:
    """The diag payload of the WINNING marker for the X-Sync-Diag header, following
    the same priority as X-Sync-Status: conflict outranks failed. None if neither.
    Tolerates legacy-format markers."""
    diag = _read_marker_diag(user_id, _CONFLICT_KIND)
    if diag is not None:
        diag.setdefault("state", "conflict")
        return diag
    diag = _read_marker_diag(user_id, _FAILED_KIND)
    if diag is not None:
        diag.setdefault("state", "failed")
        return diag
    return None


class SyncResult(str, Enum):
    """3-state result of an R2 upload attempt via the *_explicit sync functions.

    Truthy ONLY for OK (see __bool__) so pre-T4310 callers doing
    `if not sync_db_to_r2_explicit(...)` keep treating CONFLICT and FAILED
    identically as "not success" — unchanged behavior. Callers that need to
    distinguish a conflict (freeze + escalate, never blind-retry an overwrite)
    compare with `== SyncResult.CONFLICT`.
    """
    OK = "ok"
    CONFLICT = "conflict"
    FAILED = "failed"

    def __bool__(self) -> bool:
        return self is SyncResult.OK


def column_exists(cursor, table: str, column: str) -> bool:
    """True if `column` exists on `table`.

    T5085: since T5083, every REQUEST path is migrated to head by the JIT
    seam before the handler runs (ensure_database / ensure_user_database),
    so this is no longer "tolerate the deploy->migrate window" (that window
    closed when the bulk admin-triggered runner was retired) -- it is now
    defence in depth for ROLLING-DEPLOY SKEW (EPIC decision 8, additive-only
    migrations): old code on machine A can still serve a request against a
    DB that machine B's newer code just migrated one version ahead of what
    A's queries expect. Permanent, not a window. Callers SELECT the column
    only when present and default it otherwise (the column's own default is
    the correct value on the machine that hasn't deployed the new code yet).
    `table`/`column` are internal constants, never user input. Mirrors
    T5630's _has_stage_columns pattern.
    """
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())

# Query timing threshold for slow query warnings (in seconds)
SLOW_QUERY_THRESHOLD = 0.1  # 100ms - warn if query takes this long

# Per-request context for write tracking.
#
# IMPORTANT: We use a mutable dict instead of a plain bool because Starlette's
# BaseHTTPMiddleware runs the route handler in a copied context (separate task).
# ContextVar changes in the handler (setting bool to True) are NOT visible to
# the outer middleware. But a mutable dict IS shared across the context copy —
# mutations to the dict object are visible to both sides.
_request_context: ContextVar[dict | None] = ContextVar('request_context', default=None)
_request_user_id: ContextVar[str | None] = ContextVar('request_user_id', default=None)


class TrackedCursor:
    """
    SQLite cursor wrapper that tracks if write operations occurred.

    Wraps a sqlite3.Cursor to detect INSERT, UPDATE, DELETE, etc.
    and marks the connection as having writes.
    """

    def __init__(self, cursor: sqlite3.Cursor, connection: 'TrackedConnection'):
        self._cursor = cursor
        self._connection = connection

    def execute(self, sql: str, parameters: Any = None) -> 'TrackedCursor':
        """Execute SQL and track if it's a write operation."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'REPLACE')):
            self._connection._mark_write()

        start = time.perf_counter()
        if parameters is None:
            self._cursor.execute(sql)
        else:
            self._cursor.execute(sql, parameters)
        duration = time.perf_counter() - start

        if duration >= SLOW_QUERY_THRESHOLD:
            # Extract first 100 chars of SQL for logging (avoid huge queries in logs)
            sql_preview = sql[:100].replace('\n', ' ').strip()
            if len(sql) > 100:
                sql_preview += '...'
            logger.warning(
                f"[SLOW QUERY] db={self._connection._db_type} {duration * 1000:.0f}ms - {sql_preview}"
            )
        return self

    def execute_local(self, sql: str, parameters: Any = None) -> 'TrackedCursor':
        """Execute SQL without triggering R2 sync. Use for local-only metadata writes
        (e.g., last_accessed_at) that don't need immediate cloud persistence."""
        start = time.perf_counter()
        if parameters is None:
            self._cursor.execute(sql)
        else:
            self._cursor.execute(sql, parameters)
        duration = time.perf_counter() - start
        if duration >= SLOW_QUERY_THRESHOLD:
            sql_preview = sql[:100].replace('\n', ' ').strip()
            if len(sql) > 100:
                sql_preview += '...'
            logger.warning(
                f"[SLOW QUERY] db={self._connection._db_type} {duration * 1000:.0f}ms - {sql_preview}"
            )
        return self

    def executemany(self, sql: str, seq_of_parameters) -> 'TrackedCursor':
        """Execute SQL for multiple parameter sets."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE')):
            self._connection._mark_write()

        start = time.perf_counter()
        self._cursor.executemany(sql, seq_of_parameters)
        duration = time.perf_counter() - start
        if duration >= SLOW_QUERY_THRESHOLD:
            sql_preview = sql[:100].replace('\n', ' ').strip()
            if len(sql) > 100:
                sql_preview += '...'
            logger.warning(
                f"[SLOW QUERY] db={self._connection._db_type} executemany {duration * 1000:.0f}ms - {sql_preview}"
            )
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def fetchmany(self, size=None):
        if size is None:
            return self._cursor.fetchmany()
        return self._cursor.fetchmany(size)

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def close(self):
        self._cursor.close()

    def __iter__(self):
        return iter(self._cursor)


class TrackedConnection:
    """
    SQLite connection wrapper that tracks if write operations occurred.

    This enables batched syncing - we only sync to R2 if writes happened
    during the request, and we sync once at the end, not after every write.
    """

    def __init__(
        self,
        conn: sqlite3.Connection,
        db_type: str = 'profile',
        owner_user_id: str | None = None,
        owner_profile_id: str | None = None,
    ):
        self._conn = conn
        self._has_writes = False
        self._db_type = db_type
        # WHOSE database this connection points at. Without it the middleware can
        # only sync the SESSION user by construction, so a handler that writes
        # another user's DB (admin credit grants, the Stripe webhook) leaves that
        # write stranded on local disk -- the 400-credit prod loss.
        self._owner_user_id = owner_user_id
        self._owner_profile_id = owner_profile_id

    def _mark_write(self):
        """Mark that a write operation occurred."""
        self._has_writes = True
        # Also mark in request context for middleware to detect.
        # Uses mutable dict so the change is visible across BaseHTTPMiddleware's
        # context copy boundary (see _request_context comment above).
        # `has_writes` tracks profile-DB writes only; user-DB writes set
        # `has_user_db_writes`. The middleware routes user-only writes
        # through the user-DB-only sync path, which doesn't need profile_id.
        ctx = _request_context.get()
        if ctx is not None:
            if self._db_type == 'user':
                ctx['has_user_db_writes'] = True
                if self._owner_user_id:
                    ctx.setdefault('written_user_dbs', set()).add(self._owner_user_id)
            else:
                ctx['has_writes'] = True
                if self._owner_user_id:
                    ctx.setdefault('written_profile_dbs', set()).add(
                        (self._owner_user_id, self._owner_profile_id)
                    )

    @property
    def has_writes(self) -> bool:
        """Check if any write operations occurred."""
        return self._has_writes

    def cursor(self) -> TrackedCursor:
        """Return a tracked cursor."""
        return TrackedCursor(self._conn.cursor(), self)

    def commit(self):
        """Commit the transaction."""
        self._conn.commit()

    def rollback(self):
        """Rollback the transaction."""
        self._conn.rollback()

    def close(self):
        """Close the connection."""
        self._conn.close()

    def execute(self, sql: str, parameters: Any = None) -> TrackedCursor:
        """Execute SQL directly on connection."""
        cursor = self.cursor()
        return cursor.execute(sql, parameters)

    @property
    def row_factory(self):
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, value):
        self._conn.row_factory = value


def check_database_size(db_path: Path) -> None:
    """
    Log warning if database size exceeds archive target.

    Call this periodically (e.g., after sync) to monitor database growth.
    The archive system (T66) targets keeping the DB under 400KB.
    """
    if not db_path.exists():
        return

    try:
        size = db_path.stat().st_size

        if size > DB_SIZE_CRITICAL_THRESHOLD:
            logger.warning(
                f"Database size critical: {size / 1024:.1f}KB exceeds {DB_SIZE_CRITICAL_THRESHOLD // 1024}KB. "
                f"Sync performance may degrade. Check if cleanup_database_bloat is running."
            )
        elif size > DB_SIZE_WARNING_THRESHOLD:
            logger.info(
                f"Database size: {size / 1024:.1f}KB (target: <{DB_SIZE_WARNING_THRESHOLD // 1024}KB)"
            )
    except Exception as e:
        logger.debug(f"Could not check database size: {e}")


def get_local_db_version(user_id: str, profile_id: str) -> int | None:
    """
    Get the locally cached database version for a user+profile.

    First checks in-memory cache, then falls back to reading from the
    database file itself. This ensures version survives process restarts.
    """
    cache_key = (user_id, profile_id)
    with _db_version_lock:
        cached = _user_db_versions.get(cache_key)
        if cached is not None:
            return cached

    # Not in cache - try to read from database file
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        return None

    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        cursor = conn.cursor()
        # Check if db_version table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='db_version'")
        if not cursor.fetchone():
            conn.close()
            return None
        cursor.execute("SELECT version FROM db_version WHERE id = 1")
        row = cursor.fetchone()
        conn.close()
        if row:
            version = row[0]
            # Cache it for future lookups
            with _db_version_lock:
                _user_db_versions[cache_key] = version
            return version
    except Exception as e:
        logger.debug(f"Could not read db_version from {db_path}: {e}")

    return None


def has_recent_sync_error(user_id: str, profile_id: str) -> bool:
    """True if the last R2 restore for this profile failed transiently and the
    retry cooldown is still active — i.e. we do NOT currently hold authoritative
    (freshly R2-synced) data for it.

    Distinct from "no data": a genuinely new/empty profile syncs cleanly
    (NOT_FOUND, version locked to 0, no cooldown) and returns False here. Only a
    real transient failure (network/download error) sets the cooldown. Callers
    that make irreversible decisions from local rows — the sweep's R2-delete
    gate — must treat a True here as indeterminate (assume a live ref) rather
    than trust a possibly-empty local DB.
    """
    cache_key = f"{user_id}:{profile_id}"
    last_fail = _r2_restore_cooldowns.get(cache_key)
    if last_fail is None:
        return False
    return (time.time() - last_fail) < RESTORE_COOLDOWN_SECONDS


def set_local_db_version(user_id: str, profile_id: str, version: int | None) -> None:
    """
    Set the locally cached database version for a user+profile.

    Persists to both in-memory cache AND database file, so version
    survives process restarts.
    """
    cache_key = (user_id, profile_id)
    with _db_version_lock:
        if version is None:
            _user_db_versions.pop(cache_key, None)
        else:
            _user_db_versions[cache_key] = version

    # Also persist to database file
    if version is not None:
        db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
        if db_path.exists():
            try:
                conn = sqlite3.connect(str(db_path), timeout=5)
                cursor = conn.cursor()
                # Create table if not exists
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS db_version (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        version INTEGER NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                # Upsert version
                cursor.execute("""
                    INSERT OR REPLACE INTO db_version (id, version, updated_at)
                    VALUES (1, ?, CURRENT_TIMESTAMP)
                """, (version,))
                conn.commit()
                conn.close()
                logger.debug(f"Persisted db_version {version} to {db_path}")
            except Exception as e:
                logger.warning(f"Could not persist db_version to {db_path}: {e}")


def _clear_persisted_db_version(db_path: Path) -> None:
    """Delete the db_version row persisted in a profile.sqlite file.

    set_local_db_version(..., None) only pops the in-memory cache; the file's
    db_version row survives and get_local_db_version reads it back (see its
    fallback branch). So invalidating for a re-pull MUST also clear the row, or
    the stale version is resurrected and the first-access restore never runs.
    """
    if not db_path.exists():
        return
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        conn.execute("DELETE FROM db_version WHERE id = 1")
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Could not clear persisted db_version from {db_path}: {e}")


def schedule_profile_db_reheal(user_id: str, profile_id: str) -> None:
    """T6160: after a CAS conflict, make the NEXT request re-pull R2's newer copy.

    ensure_database restores from R2 on first access only (local_version is None),
    so a running machine that has a version cached never notices R2 moving ahead
    and every write conflicts forever (staging 2026-07-27). We do NOT add a
    per-request HEAD (20s+ cold, rejected in ensure_database's comment). Instead,
    the conflict itself invalidates the loaded-from version — memory cache AND the
    persisted db_version row — plus the restore cooldown (a conflict means R2 was
    reachable, so any prior transient-error cooldown is stale). The next
    ensure_database then reads local_version=None and performs a WAL-safe
    first-access restore. Costs one HEAD only when a conflict actually happened.

    The refused in-flight edit is DISCARDED by that re-pull, never merged/force-
    pushed — the CAS refusal stays intact (see T6160-design.md decision 2).
    """
    set_local_db_version(user_id, profile_id, None)
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    _clear_persisted_db_version(db_path)
    _r2_restore_cooldowns.pop(f"{user_id}:{profile_id}", None)


def init_request_context() -> None:
    """Initialize request context for write tracking. Call at start of request.

    Creates a mutable dict that is shared across Starlette's BaseHTTPMiddleware
    context boundary, so writes in the route handler are visible to the
    middleware's post-request sync logic.
    """
    _request_context.set({'has_writes': False})
    _request_user_id.set(get_current_user_id())


def get_request_has_writes() -> bool:
    """Check if any writes occurred during this request."""
    ctx = _request_context.get()
    if ctx is None:
        return False
    return ctx.get('has_writes', False)


def get_request_written_user_dbs() -> set:
    """user_ids whose user.sqlite was written during this request.

    Normally just the session user. It differs when a handler writes SOMEONE
    ELSE's DB (admin credit grants, Stripe webhook fulfilment) -- those are the
    writes the middleware would otherwise never upload.
    """
    ctx = _request_context.get()
    if ctx is None:
        return set()
    return set(ctx.get('written_user_dbs', ()))


def get_request_written_profile_dbs() -> set:
    """(user_id, profile_id) pairs whose profile.sqlite was written this request.

    NOTE: only covers connections opened through get_db_connection. Raw
    connections (materialization._open_profile_db) are invisible here and must
    still sync themselves explicitly.
    """
    ctx = _request_context.get()
    if ctx is None:
        return set()
    return set(ctx.get('written_profile_dbs', ()))


def clear_request_context() -> None:
    """Clear request context. Call at end of request."""
    _request_context.set(None)
    _request_user_id.set(None)


def get_user_data_path() -> Path:
    """Get the user data directory path for the current user and profile."""
    return USER_DATA_BASE / get_current_user_id() / "profiles" / get_current_profile_id()


def get_database_path() -> Path:
    """Get the database file path for the current user."""
    return get_user_data_path() / "profile.sqlite"


# Dynamic path getters for video storage subdirectories
def get_raw_clips_path() -> Path:
    """Get the raw clips directory path for the current user."""
    return get_user_data_path() / "raw_clips"


def get_uploads_path() -> Path:
    """Get the uploads directory path for the current user."""
    return get_user_data_path() / "uploads"


def get_working_videos_path() -> Path:
    """Get the working videos directory path for the current user."""
    return get_user_data_path() / "working_videos"


def get_final_videos_path() -> Path:
    """Get the final videos directory path for the current user."""
    return get_user_data_path() / "final_videos"


def get_downloads_path() -> Path:
    """Get the downloads directory path for the current user."""
    return get_user_data_path() / "downloads"


def get_games_path() -> Path:
    """Get the games directory path for the current user."""
    return get_user_data_path() / "games"


def get_clip_cache_path() -> Path:
    """Get the clip cache directory path for the current user."""
    return get_user_data_path() / "clip_cache"


def get_highlights_path() -> Path:
    """Get the highlights directory path for player images (cross-project reuse)."""
    return get_user_data_path() / "highlights"



def ensure_directories():
    """
    Ensure all required directories exist for the current user.
    Called automatically before database access.

    When R2 is enabled, only create the user_data base directory (for profile.sqlite).
    Video files are stored in R2, not locally.
    """
    # Always create base user data directory (needed for profile.sqlite)
    get_user_data_path().mkdir(parents=True, exist_ok=True)

    # When R2 is enabled, don't create local video directories - all files go to R2
    if R2_ENABLED:
        logger.debug("R2 enabled: skipping local video directory creation")
        return

    # Local mode only: create all video directories
    directories = [
        get_raw_clips_path(),
        get_uploads_path(),
        get_working_videos_path(),
        get_final_videos_path(),
        get_downloads_path(),
        get_games_path(),
        get_clip_cache_path(),
        get_highlights_path(),
    ]
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)


def ensure_database():
    """
    Ensure database exists with all required tables for the current user.
    Called automatically before each database access.
    This makes the app resilient to the user_data folder being deleted.

    If R2 is enabled, uses version-based sync to check if R2 has a newer version.
    """
    global _initialized_users
    user_id = get_current_user_id()
    db_path = get_database_path()

    # Quick path: if already initialized and DB exists, skip table creation
    # but still check R2 for newer version
    already_initialized = user_id in _initialized_users and db_path.exists()

    # Ensure directories exist
    ensure_directories()

    # If R2 is enabled, download from R2 only on first access (no local DB yet)
    # We do NOT check R2 version on every request - that HEAD request is slow (20s+ when cold)
    # Multi-device sync will be handled by user management (T200) with session invalidation
    if R2_ENABLED:
        profile_id = get_current_profile_id()
        local_version = get_local_db_version(user_id, profile_id)

        # Only download from R2 if we've never synced for this user+profile (first access)
        if local_version is None:
            # Check cooldown — don't hammer R2 on repeated transient failures
            cache_key = f"{user_id}:{profile_id}"
            last_fail = _r2_restore_cooldowns.get(cache_key)
            if last_fail and (time.time() - last_fail) < RESTORE_COOLDOWN_SECONDS:
                logger.debug(f"[Restore] Skipping R2 check for {cache_key} — cooldown active")
            else:
                local_exists = db_path.exists()
                local_size = db_path.stat().st_size if local_exists else 0
                logger.info(
                    f"[Restore] First access for user={user_id} profile={profile_id}, "
                    f"local_db={'exists' if local_exists else 'missing'} ({local_size} bytes), checking R2..."
                )
                # T6160: WAL safety. "First access" used to mean "no connections
                # yet," so a blind download-and-swap was safe. Now that a conflict
                # can re-trigger this path on a RUNNING machine (schedule_profile_
                # db_reheal cleared the version), a live connection may hold the
                # file open (-wal/-shm present) and a blind swap would let the next
                # connection replay the old WAL onto the new file (cross-DB page
                # mixing). Gate the actual DOWNLOAD (not the version check) exactly
                # as ensure_profile_db_local does — a live connection blocks only
                # the swap, retried on a later request, never corrupts.
                import time as _time

                from .services.db_refresh import clear_stale_wal_sidecars, wal_sidecars_present
                restore_start = _time.perf_counter()
                # T5081 (INV-P reason b, site 1): capture BEFORE the download --
                # this ORDINARY-request first-access path is exactly what a CAS
                # conflict re-triggers (schedule_profile_db_reheal nulled the
                # version), so it is very often the actual restore that
                # discharges a .sync_pending record a later conflict-retry
                # endpoint would otherwise find already resolved. See the INV-P
                # comment below sync_db_to_r2_explicit.
                pending_token = read_pending_token(user_id, profile_id)
                was_synced, new_version, was_error = sync_database_from_r2_if_newer(
                    user_id, db_path, local_version,
                    before_download=lambda: not wal_sidecars_present(db_path),
                )
                restore_elapsed = _time.perf_counter() - restore_start
                if was_synced:
                    # Defense-in-depth for the window between before_download's
                    # check and the download completing (see clear_stale_wal_sidecars).
                    clear_stale_wal_sidecars(db_path)
                    new_size = db_path.stat().st_size if db_path.exists() else 0
                    logger.info(
                        f"[Restore] Downloaded database from R2 for user={user_id} profile={profile_id}: "
                        f"version={new_version}, size={new_size} bytes, took {restore_elapsed:.2f}s"
                    )
                    # T7010: a first-access download that fires DURING a write request,
                    # following a CAS conflict (schedule_profile_db_reheal nulled the
                    # version — has_sync_conflict is still set here), is a mid-request
                    # DB heal that DISCARDS the local writes this process made since the
                    # conflict and re-runs the request against R2's fresh copy. That is a
                    # CRITICAL diagnostic event — name the in-flight endpoint so the
                    # discarded/re-run work is visible without correlating handler logs
                    # across the [Restore] boundary. A plain cold first-access restore
                    # (no prior conflict) is normal load-time work and is NOT flagged.
                    from .user_context import (
                        get_current_method,
                        get_current_path,
                        get_current_req_id,
                    )
                    _heal_method = (get_current_method() or "").upper()
                    if _heal_method in ("POST", "PUT", "PATCH", "DELETE") and has_sync_conflict(user_id):
                        logger.critical(
                            f"[Restore] MID-WRITE HEAL: re-downloaded profile.sqlite version={new_version} "
                            f"for user={user_id} profile={profile_id} DURING in-flight write "
                            f"{_heal_method} {get_current_path()} (req_id={get_current_req_id()}) after a "
                            f"CAS conflict — local writes from this request are discarded and re-run "
                            f"against the healed DB"
                        )
                    set_local_db_version(user_id, profile_id, new_version)
                    clear_sync_pending(user_id, profile_id, if_token=pending_token)
                    # Force re-initialization since we got a new DB
                    already_initialized = False
                elif was_error:
                    # Transient R2 failure — do NOT lock version to 0
                    # Will retry on next request after cooldown
                    _r2_restore_cooldowns[cache_key] = time.time()
                    logger.warning(
                        f"[Restore] R2 unreachable for {user_id}:{profile_id}, "
                        f"will retry after {RESTORE_COOLDOWN_SECONDS}s (took {restore_elapsed:.2f}s)"
                    )
                elif new_version is not None:
                    # R2 has a version but we didn't need to download (local exists)
                    logger.info(
                        f"[Restore] Local database up-to-date for user={user_id} profile={profile_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s"
                    )
                    set_local_db_version(user_id, profile_id, new_version)
                else:
                    # R2 returned NOT_FOUND — genuinely new user, lock to 0
                    logger.info(
                        f"[Restore] No R2 database found for user={user_id} profile={profile_id}, "
                        f"starting fresh (took {restore_elapsed:.2f}s)"
                    )
                    set_local_db_version(user_id, profile_id, 0)

        # T5083: JIT migrate-at-load-seam, strictly AFTER the restore-then-
        # clear sequence (set_local_db_version / clear_sync_pending) has
        # completed — never reorders INV-P (design §2.8). T5085 extracted the
        # body into migrations.run_profile_seam() so every non-login opener
        # of a profile.sqlite (share resolution, admin cross-user reads,
        # ensure_profile_db_local / _open_profile_db) shares this exact
        # logic instead of a second copy — see migrations/__init__.py.
        migrations.run_profile_seam(user_id, profile_id)

    # If already initialized, skip table creation
    if already_initialized:
        return

    # Create/verify tables
    is_fresh_db = not db_path.exists()
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Raw clips - extracted from Annotate mode (all clips saved in real-time)
        # game_id links to source game, auto_project_id tracks 5-star auto-projects
        # filename is empty string for pending clips (video not yet uploaded)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw_clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                rating INTEGER NOT NULL,
                tags BLOB,
                name TEXT,
                notes TEXT,
                start_time REAL,
                end_time REAL,
                game_id INTEGER,
                auto_project_id INTEGER,
                default_highlight_regions BLOB,
                video_sequence INTEGER,
                tagged_teammates BLOB DEFAULT NULL,
                my_athlete INTEGER DEFAULT 1,
                shared_by TEXT DEFAULT NULL,
                boundaries_version INTEGER DEFAULT 1,
                boundaries_updated_at TIMESTAMP,
                -- T8070: the start/end window the clip's currently-linked reel's
                -- most recent successful export actually rendered from. Written
                -- ONLY at reel creation (seed) + export completion (refresh);
                -- NEVER by the boundary-change path, so revert-to-exact restores
                -- the produced status. NULL = no produced reel. See migration v049.
                reel_source_start_time REAL,
                reel_source_end_time REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
                FOREIGN KEY (auto_project_id) REFERENCES projects(id) ON DELETE SET NULL
            )
        """)

        # Projects - organize clips for editing
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                aspect_ratio TEXT NOT NULL,
                working_video_id INTEGER,
                final_video_id INTEGER,
                is_auto_created INTEGER DEFAULT 0,
                last_opened_at TIMESTAMP,
                current_mode TEXT DEFAULT 'framing',
                archived_at TIMESTAMP DEFAULT NULL,
                restored_at TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                poster_marker_time REAL DEFAULT NULL,
                FOREIGN KEY (working_video_id) REFERENCES working_videos(id) ON DELETE SET NULL,
                FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE SET NULL
            )
        """)

        # Working clips - clips assigned to projects
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS working_clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                raw_clip_id INTEGER,
                uploaded_filename TEXT,
                exported_at TEXT DEFAULT NULL,
                sort_order INTEGER DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                crop_data BLOB,
                timing_data BLOB,
                segments_data BLOB,
                raw_clip_version INTEGER,
                width INTEGER,
                height INTEGER,
                fps REAL,
                rotation REAL DEFAULT 0,
                framing_version INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE
            )
        """)

        # Working videos - output from Framing mode
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS working_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                highlights_data BLOB,
                text_overlays BLOB,
                duration REAL,
                effect_type TEXT DEFAULT 'original',
                overlay_version INTEGER DEFAULT 0,
                highlight_color TEXT DEFAULT NULL,
                highlight_shape TEXT DEFAULT 'body',
                stroke_width REAL DEFAULT 2,
                fill_enabled INTEGER DEFAULT 1,
                fill_opacity REAL DEFAULT 0.20,
                dim_strength REAL DEFAULT 0.20,
                detections_data BLOB,
                framing_snapshot BLOB,
                highlight_carry_note TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Final videos - output from Overlay mode
        # duration/aspect_ratio/tags are frozen at export-finalize (T3600);
        # game_ids is frozen too (T3605): publish archives + deletes working
        # data, so they cannot be derived later. tags + game_ids are msgpack
        # arrays (distinct tag strings / sorted distinct game ids).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS final_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                filename TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                duration REAL,
                source_type TEXT,
                game_id INTEGER,
                name TEXT,
                rating_counts TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                watched_at TIMESTAMP,
                published_at TIMESTAMP,
                aspect_ratio TEXT,
                tags BLOB,
                game_ids BLOB,
                clip_count INTEGER,
                quality_score REAL,
                rating REAL,
                rd REAL,
                match_count INTEGER DEFAULT 0,
                source_clip_id INTEGER,
                clip_start_time REAL,
                clip_game_start_time REAL,
                poster_filename TEXT,
                slowmo_section_start REAL,
                slowmo_section_end REAL,
                poster_frame_time REAL,
                poster_source TEXT,
                intro_card_id INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_final_videos_published_ratio
            ON final_videos(published_at, aspect_ratio)
        """)

        # Intro card library (T5195, profile_db v034). Per-profile (epic decision
        # 7). Composition is DERIVED from (has_photo, len(shown_fields)) in
        # app/services/intro_cards.derive_composition — there is deliberately NO
        # template/layout column (no redundant state). focal_x/focal_y/zoom are
        # NULLABLE = inherit the profile's framing (decision 3b), never defaulted.
        # Kept in step with migrations/profile_db/v034_intro_card_library.py so a
        # fresh profile gets the table here and an existing one gets it there.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS intro_cards (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                name              TEXT NOT NULL,
                shown_fields      TEXT NOT NULL,
                treatment         TEXT NOT NULL,
                title_text        TEXT,  -- DEAD (T6620): title = profile Full Name ALWAYS; never read. Was a pre-T6570 override; nulled by v036. Kept only so old rows still open.
                subtitle_text     TEXT,  -- free-text card subtitle (T6570); NULL = none (kept in step with migration v035)
                image_key         TEXT,
                image_cutout_key  TEXT,
                focal_x           REAL,
                focal_y           REAL,
                zoom              REAL,
                text_elements     BLOB,  -- DEAD (T6640): typography is TEMPLATE-owned via ROLE_FOR_SLOT; never read. Was per-slot user styling; nulled by v038. Kept only so old rows still open.
                duration          REAL NOT NULL DEFAULT 4.0,
                is_default        INTEGER NOT NULL DEFAULT 0,
                created_at        TEXT DEFAULT (datetime('now')),
                updated_at        TEXT DEFAULT (datetime('now'))
            )
        """)

        # Games - store annotated game footage
        # Videos stored globally in R2 at games/{blake3_hash}.mp4
        # Game clip counts + rating breakdowns are derived live from raw_clips
        # (see games._compute_athlete_stats) -- no denormalized columns here.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                video_filename TEXT,
                blake3_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                video_duration REAL,
                video_width INTEGER,
                video_height INTEGER,
                video_size INTEGER,
                opponent_name TEXT,
                game_date TEXT,
                game_type TEXT,
                tournament_name TEXT,
                viewed_duration REAL DEFAULT 0,
                last_playhead_position REAL,
                video_fps REAL,
                status TEXT DEFAULT 'ready',
                auto_export_status TEXT,
                auto_export_attempts INTEGER DEFAULT 0,
                recap_video_url TEXT,
                shared_by TEXT DEFAULT NULL,
                source_profile_id TEXT DEFAULT NULL,
                source_game_id INTEGER DEFAULT NULL
            )
        """)


        # Export jobs - track background export tasks for durability
        # Progress is NOT stored here (ephemeral, WebSocket only)
        # Only state transitions: pending -> processing -> complete/error
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS export_jobs (
                id TEXT PRIMARY KEY,
                project_id INTEGER,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                input_data BLOB NOT NULL,
                output_video_id INTEGER,
                output_filename TEXT,
                modal_call_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                game_id INTEGER,
                game_name TEXT,
                acknowledged_at TIMESTAMP,
                gpu_seconds REAL,
                modal_function TEXT,
                stage TEXT DEFAULT 'queued',
                output_key TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Indexes for export_jobs
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_project
            ON export_jobs(project_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_status
            ON export_jobs(status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_type_status
            ON export_jobs(type, status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_export_jobs_unacknowledged
            ON export_jobs(status, acknowledged_at, completed_at DESC)
        """)

        # Before/After tracking - links final videos to their source footage
        # Used to generate before/after comparison videos
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS before_after_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                final_video_id INTEGER NOT NULL,
                raw_clip_id INTEGER,
                source_path TEXT NOT NULL,
                start_frame INTEGER NOT NULL,
                end_frame INTEGER NOT NULL,
                clip_index INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE CASCADE
            )
        """)

        # Index for before_after_tracks
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_before_after_tracks_final_video
            ON before_after_tracks(final_video_id)
        """)

        # T540: Achievements — non-derivable quest step completion (e.g., opened_framing_editor)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS achievements (
                key TEXT PRIMARY KEY,
                achieved_at TEXT DEFAULT (datetime('now'))
            )
        """)

        # Indexes for efficient version queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_clips_project_version
            ON working_clips(project_id, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_clips_project_raw_clip_version
            ON working_clips(project_id, raw_clip_id, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_clips_project_upload_version
            ON working_clips(project_id, uploaded_filename, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_working_videos_project_version
            ON working_videos(project_id, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_final_videos_project_version
            ON final_videos(project_id, version DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_clips_game_id
            ON raw_clips(game_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_clips_rating
            ON raw_clips(rating)
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_clips_game_end_time_seq
            ON raw_clips(game_id, end_time, video_sequence)
        """)

        # Modal tasks table - tracks background GPU tasks for resumability
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS modal_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                params TEXT NOT NULL,
                result TEXT,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                raw_clip_id INTEGER,
                project_id INTEGER,
                game_id INTEGER,
                retry_count INTEGER DEFAULT 0,
                FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
            )
        """)

        # Index for finding pending/running tasks
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_modal_tasks_status
            ON modal_tasks(status)
        """)

        # Index for finding tasks by game (for finish-annotation)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_modal_tasks_game_id
            ON modal_tasks(game_id)
        """)

        # User settings - persisted preferences (synced to R2)
        # Uses JSON for flexible settings storage without schema changes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                settings_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Collection settings (T3630) - per-profile key/value knobs for the
        # Season Highlights epic (T3640's season_target_duration is the first user).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS collection_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        # T82: Multi-video games - track individual video files per game
        # T7870 correction: create_game writes a game_videos row for EVERY game,
        # including single-video ones (_insert_game_videos is called unconditionally) --
        # games.blake3_hash is also set for single-video games as a legacy/query
        # convenience, not as the sole source of truth this comment used to claim.
        # T8870: recorded_at (evidence: the video's embedded recording clock time,
        # ISO-8601 UTC, never recomputed after insert) + offset_seconds (canonical
        # position on the game's real-time axis; time zero = offset 0 = earliest
        # video). Both nullable. offset_seconds is written at insert by
        # compute_video_offsets; afterwards ONLY the Fix-timing gesture (T8900) may
        # update it. Fresh DBs get the columns here; existing DBs via migration v051
        # (backfills offset_seconds = prefix-sum-by-sequence so migrated games render
        # identically to the pre-overlap concatenation math).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS game_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                blake3_hash TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                duration REAL,
                video_width INTEGER,
                video_height INTEGER,
                video_size INTEGER,
                fps REAL,
                recorded_at TEXT,
                offset_seconds REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, sequence)
            )
        """)

        # Index for game_videos lookup by game
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_game_videos_game
            ON game_videos(game_id)
        """)

        # T2930: Per-user storage expiry (moved from Postgres game_storage_refs)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS game_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blake3_hash TEXT NOT NULL UNIQUE,
                game_size_bytes INTEGER NOT NULL,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # T80: Track in-progress multipart uploads
        # Allows resuming interrupted uploads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pending_uploads (
                id TEXT PRIMARY KEY,
                blake3_hash TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                r2_upload_id TEXT NOT NULL,
                parts_json TEXT,
                label TEXT,
                kind TEXT NOT NULL DEFAULT 'game',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # T400: Auth tables
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                email TEXT,
                google_id TEXT,
                verified_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
        """)

        # T80: Database version tracking for R2 sync
        # Stored in DB so version survives process restarts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS db_version (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # T2800: Tag name to email mapping for teammate sharing
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS teammate_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag_name TEXT NOT NULL,
                email TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(tag_name, email)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_teammate_emails_tag
            ON teammate_emails(tag_name)
        """)

        # T2820: Track which tags have been shared for each game
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS teammate_shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL,
                tag_name TEXT NOT NULL,
                shared_clip_ids TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(game_id, tag_name),
                FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_teammate_shares_game
            ON teammate_shares(game_id)
        """)

        # T2847: Junction table for indexed teammate tag lookups
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clip_teammates (
                clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
                tag_name TEXT NOT NULL,
                UNIQUE(clip_id, tag_name)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_clip_teammates_tag
            ON clip_teammates(tag_name)
        """)

        # Initialize settings row if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO user_settings (id, settings_json)
            VALUES (1, '{}')
        """)

        # --- All migrations removed from runtime (2026-05-14) ---
        # Migrations live in scripts/migrations/ and are run manually.
        # See: scripts/migrations/README.md

        # (Previously: T900 FK cascades, published_at, fv.name backfill,
        #  T1583, T2800/T2840, T2870, T2847 -- all removed)

        if is_fresh_db:
            from .migrations.profile_db import RUNNER as PROFILE_DB_RUNNER
            conn.execute(f"PRAGMA user_version = {PROFILE_DB_RUNNER.latest_version}")

        conn.commit()

        _initialized_users.add(user_id)
        logger.debug(f"Database verified/initialized for user: {user_id}")

    finally:
        conn.close()

    # T85a: Cleanup tasks (T66, T243) moved to session_init.py user_session_init()
    # They now run explicitly during /api/auth/init instead of implicitly here.


@contextmanager
def get_db_connection() -> TrackedConnection:
    """
    Context manager for database connections.
    Ensures database exists and connections are properly closed after use.

    Returns a TrackedConnection that automatically detects write operations,
    enabling batched syncing to R2 (sync once per request, not per write).

    Auto-creates the database and directories if they don't exist,
    making the app resilient to the user_data folder being deleted.
    """
    # Ensure database exists before connecting
    ensure_database()

    # timeout=30 means wait up to 30 seconds for lock at connection level
    raw_conn = sqlite3.connect(str(get_database_path()), timeout=30)
    raw_conn.row_factory = sqlite3.Row  # Return rows as dictionaries

    # Enable WAL mode for better concurrent access (allows reads while writing)
    raw_conn.execute("PRAGMA journal_mode=WAL")
    # Wait up to 30 seconds for lock instead of failing immediately
    raw_conn.execute("PRAGMA busy_timeout=30000")
    # T86: Enable foreign key enforcement (required for ON DELETE CASCADE/SET NULL)
    raw_conn.execute("PRAGMA foreign_keys=ON")

    conn = TrackedConnection(
        raw_conn,
        owner_user_id=get_current_user_id(),
        owner_profile_id=get_current_profile_id(),
    )
    try:
        yield conn
    finally:
        conn.close()


def init_database():
    """
    Initialize the database and create all required directories for the current user.
    Called on application startup for logging purposes.
    Also called automatically by get_db_connection() if needed.
    """
    user_id = get_current_user_id()
    logger.info(f"Initializing database for user: {user_id}...")

    # Ensure directories exist
    ensure_directories()
    logger.info(f"Ensured directory exists: {get_user_data_path()}")
    if not R2_ENABLED:
        # Only log local directories when R2 is disabled (local mode)
        directories = [
            get_raw_clips_path(),
            get_uploads_path(),
            get_working_videos_path(),
            get_final_videos_path(),
            get_downloads_path(),
            get_games_path(),
            get_clip_cache_path(),
        ]
        for directory in directories:
            logger.info(f"Ensured directory exists: {directory}")
    else:
        logger.info("R2 storage enabled - video files stored in cloud, not locally")

    # Ensure database tables exist
    ensure_database()
    logger.info("Database tables created/verified successfully")


def is_database_initialized() -> bool:
    """Check if the database file exists and has tables for the current user."""
    db_path = get_database_path()
    if not db_path.exists():
        return False

    try:
        conn = sqlite3.connect(str(db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row['name'] for row in cursor.fetchall()}
        conn.close()
        required = {'raw_clips', 'projects', 'working_clips',
                   'working_videos', 'final_videos', 'games'}
        return required.issubset(tables)
    except Exception:
        return False


def reset_initialized_flag():
    """
    Reset the initialization flag for the current user. Useful for testing or when
    the database has been manually deleted.
    """
    global _initialized_users
    user_id = get_current_user_id()
    _initialized_users.discard(user_id)


def forget_local_db_state(user_id: str) -> None:
    """Drop every in-process cache entry for a user's profile databases.

    Called on account deletion so a same-process relogin/reregister re-checks R2 (and,
    when R2 was purged, starts genuinely fresh) instead of reusing a stale "already
    initialized" flag or cached version that skips the R2 restore path.
    """
    _initialized_users.discard(user_id)
    with _user_sqlite_version_lock:
        _user_sqlite_versions.pop(user_id, None)
    with _db_version_lock:
        for key in [k for k in _user_db_versions if k[0] == user_id]:
            _user_db_versions.pop(key, None)
    # T5083 fix: drop the seam's verified-at-head flag too, or a purge-then-
    # reregister under the same user_id would inherit the OLD profile's
    # verified status and skip the seam on the new registration's first access.
    migrations._clear_seam_verified(user_id)


def sync_db_to_cloud() -> str:
    """
    Sync the current user's database to R2 storage with version tracking.

    Returns:
        "ok" if sync succeeded (or R2 not enabled)
        "conflict" if version conflict detected (T950: re-downloaded newer version)
        "failed" if sync failed (network error, etc.)
    """
    if not R2_ENABLED:
        return "ok"

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    db_path = get_database_path()

    if not db_path.exists():
        return "ok"

    check_database_size(db_path)
    current_version = get_local_db_version(user_id, profile_id)

    # T4310 reviewer round 2 (BLOCKING-2): this is the /api/retry-sync request
    # wrapper, called synchronously from a request handler but only on an
    # explicit manual-retry gesture (not the hot request-path), so a HEAD here
    # adds no meaningful latency. skip_version_check=True previously let a
    # confirmed-refused-elsewhere conflict force-push over R2 on retry AND
    # regress the R2 version backwards, disarming CAS for every other machine.
    success, new_version = sync_database_to_r2_with_version(
        user_id, db_path, current_version, skip_version_check=False
    )

    if success and new_version is not None:
        set_local_db_version(user_id, profile_id, new_version)
        logger.debug(f"Database synced to R2 for user: {user_id}, profile: {profile_id}, version: {new_version}")
        return "ok"
    elif not success and new_version is not None:
        # T4310 reviewer round 2 (MAJOR-2): storage.py no longer re-downloads on
        # conflict (WAL-unsafe swap off the write lock — see storage.py), so the
        # baseline must NOT advance here either; advancing it without a confirmed
        # refresh is exactly the silent-clobber bug this task exists to prevent.
        logger.warning(f"Version conflict for user: {user_id}, profile: {profile_id}, R2 at v{new_version}")
        return "conflict"
    elif not success:
        logger.warning(f"Failed to sync database to R2 for user: {user_id}, profile: {profile_id}")
        return "failed"

    return "ok"


def sync_db_to_cloud_if_writes() -> str:
    """
    Sync database to R2 only if writes occurred during this request.
    Called by middleware at end of request.

    Returns: "ok", "conflict", or "failed"
    """
    if not R2_ENABLED:
        return "ok"

    if get_request_has_writes():
        return sync_db_to_cloud()
    return "ok"


# ---------------------------------------------------------------------------
# Explicit R2 sync for background workers (T940)
# ---------------------------------------------------------------------------

def get_user_data_path_explicit(user_id: str, profile_id: str) -> Path:
    """Get user data path without relying on ContextVars."""
    return USER_DATA_BASE / user_id / "profiles" / profile_id


def sync_db_to_r2_explicit(
    user_id: str, profile_id: str, lock_timeout: float | None = None,
    skip_version_check: bool = False,
) -> SyncResult:
    """
    Sync the profile database to R2 without relying on ContextVars.

    Designed for background workers (e.g. export_worker) that run outside
    the request-response lifecycle where ContextVars are no longer valid.
    T4310: CAS is ON by default here (skip_version_check=False) — every one of
    these callers is already off the request thread (asyncio.to_thread, a
    genuine background worker/scheduler, or an admin batch job), so the HEAD
    adds zero request-thread latency. The lone exception is a caller that
    invokes this function DIRECTLY and synchronously from a request handler
    (never wrapped in asyncio.to_thread) — that caller must pass
    skip_version_check=True explicitly to preserve the T1020/T2720 no-HEAD
    guarantee (see profiles.py create_profile, payments.py webhook).

    Both halves are keyed off the ARGS: the local file comes from
    get_user_data_path_explicit(user_id, profile_id) and the R2 upload key is
    derived from profile_id via profile_r2_key (NOT get_current_profile_id())
    (T5340). Before T5340 the key silently came from the ContextVar, so a caller
    whose ContextVar disagreed with profile_id (e.g. move_reels_to_profile
    syncing the target while the request profile is the source) uploaded the
    right DB to the WRONG profile's key.

    Returns SyncResult.OK on success (or if R2 is disabled/no-op),
    SyncResult.CONFLICT if CAS refused the upload (storage.py already
    re-downloaded the newer copy), SyncResult.FAILED otherwise. Truthy only for
    OK, so `if not sync_db_to_r2_explicit(...)` callers are unaffected.
    """
    # T5340: no silent fallback — the whole point of this function is ContextVar
    # independence. A missing profile_id is a caller bug; fail loudly rather than
    # letting the key derivation fall back to the ContextVar.
    if not profile_id:
        raise ValueError("sync_db_to_r2_explicit requires a profile_id (no ContextVar fallback)")

    # T4120: durability test seam (gated; inert on prod/staging). Returning
    # FAILED — never raising — exercises the REAL failure handling
    # (mark_sync_pending, sync_status="failed", the retryable sync_failed
    # surfaces) exactly as a true R2 outage would, without touching R2. Placed
    # before the R2_ENABLED check so it is deterministic regardless of config.
    from .storage import _force_r2_sync_failure
    if _force_r2_sync_failure():
        logger.warning(f"[TEST] FORCE_R2_SYNC_FAILURE active — short-circuiting profile sync for user={user_id}")
        return SyncResult.FAILED

    if not R2_ENABLED:
        return SyncResult.OK

    db_path = get_user_data_path_explicit(user_id, profile_id) / "profile.sqlite"
    if not db_path.exists():
        return SyncResult.OK

    check_database_size(db_path)
    current_version = get_local_db_version(user_id, profile_id)
    # T5081 (INV-P compare-and-clear, review round 3 BLOCKING): capture the
    # pending token BEFORE the upload starts. The upload below takes real
    # wall-clock time (checkpoint + PUT); if a DIFFERENT request commits a
    # NEWER write to this same scope while this upload is in flight, it
    # re-marks the scope with a fresh token. This upload's eventual success
    # must not discharge that newer write's marker — only clear if the token
    # is unchanged.
    pending_token = read_pending_token(user_id, profile_id)

    success, new_version, r2_diag = sync_database_to_r2_with_version(
        user_id, db_path, current_version, skip_version_check=skip_version_check,
        lock_timeout=lock_timeout, profile_id=profile_id, with_diag=True,
    )

    if success and new_version is not None:
        set_local_db_version(user_id, profile_id, new_version)
        # T6390: clear ONLY this profile's scope — never a blanket clear that would
        # stomp a live conflict on user.sqlite or another profile.
        clear_sync_conflict(user_id, scope=profile_id)
        clear_sync_failed(user_id, scope=profile_id)  # T5870 round 2 MINOR-1: an
        # out-of-band success (export worker etc.) heals a stale .sync_failed so an
        # idle user's red alarm clears instead of sticking indefinitely.
        # T5081 (INV-P clear reason a): the ONE place this scope's pending
        # record is discharged — the exact point R2 confirmed the bytes.
        # Compare-and-clear against the token captured before the upload
        # started (see the INV-P comment above mark_sync_pending).
        clear_sync_pending(user_id, profile_id, if_token=pending_token)
        logger.debug(f"[ExportWorker] Database synced to R2: user={user_id}, profile={profile_id}, v={new_version}")
        return SyncResult.OK
    elif not success and new_version is not None:
        # T4310 reviewer round 2 (MAJOR-2): storage.py refuses the conflicting
        # upload but no longer re-downloads (WAL-unsafe swap outside the write
        # lock — see storage.py). The baseline must stay frozen at
        # current_version: advancing it to new_version without a confirmed
        # refresh would let the NEXT attempt compare the still-stale local
        # copy against "confirmed" data and silently force-push it. A frozen
        # baseline means this conflict is detected and refused again on every
        # retry (safe) until T4315's restore path heals the local copy.
        # T6390: scope the marker to THIS profile and carry the diag payload.
        mark_sync_conflict(user_id, scope=profile_id, diag=build_marker_diag(
            db="profile", profile_id=profile_id, loaded=current_version,
            r2=new_version, r2_diag=r2_diag))
        # T6160: invalidate the loaded-from version so the NEXT request re-pulls
        # R2's newer copy (self-heal) — the baseline is NOT advanced here (that
        # would disarm CAS); the frozen-baseline guarantee above is unchanged.
        schedule_profile_db_reheal(user_id, profile_id)
        logger.warning(
            f"[ExportWorker] R2 version conflict for user={user_id}, profile={profile_id} "
            f"— refused (R2 at v{new_version}), baseline frozen at v{current_version}; "
            f"scheduled re-pull on next access (T6160)"
        )
        return SyncResult.CONFLICT
    else:
        logger.warning(f"[ExportWorker] Failed to sync database to R2: user={user_id}, profile={profile_id}")
        return SyncResult.FAILED


def sync_user_db_to_r2_explicit(
    user_id: str, lock_timeout: float | None = None,
    skip_version_check: bool = False,
) -> SyncResult:
    """
    Sync user.sqlite to R2 without relying on ContextVars.

    Designed for background workers that may modify user.sqlite (e.g. credit
    refunds). T4310: CAS is ON by default (skip_version_check=False) — see
    sync_db_to_r2_explicit's docstring for the request-thread exception
    (payments.py webhook passes skip_version_check=True explicitly).

    Returns SyncResult.OK on success (or if R2 is disabled/no-op),
    SyncResult.CONFLICT on a refused CAS upload, SyncResult.FAILED otherwise.
    """
    # T4120: durability test seam (gated; inert on prod/staging). See the profile
    # sync above — short-circuit before the R2_ENABLED check so both DBs fail
    # together under a forced fault.
    from .storage import _force_r2_sync_failure
    if _force_r2_sync_failure():
        logger.warning(f"[TEST] FORCE_R2_SYNC_FAILURE active — short-circuiting user.sqlite sync for user={user_id}")
        return SyncResult.FAILED

    if not R2_ENABLED:
        return SyncResult.OK

    db_path = USER_DATA_BASE / user_id / "user.sqlite"
    if not db_path.exists():
        return SyncResult.OK

    from .storage import sync_user_db_to_r2_with_version

    local_version = get_local_user_db_version(user_id)
    # T5081 (INV-P compare-and-clear, review round 3 BLOCKING): see the
    # matching comment in sync_db_to_r2_explicit.
    pending_token = read_pending_token(user_id, USER_DB_SCOPE)
    success, new_version, r2_diag = sync_user_db_to_r2_with_version(
        user_id, db_path, local_version, skip_version_check=skip_version_check,
        lock_timeout=lock_timeout, with_diag=True,
    )

    if success and new_version is not None:
        set_local_user_db_version(user_id, new_version)
        # T6390: clear ONLY the user.sqlite scope — never a live profile conflict.
        clear_sync_conflict(user_id, scope=USER_DB_SCOPE)
        clear_sync_failed(user_id, scope=USER_DB_SCOPE)  # T5870 round 2 MINOR-1: see profile sync above.
        clear_sync_pending(user_id, USER_DB_SCOPE, if_token=pending_token)  # T5081 (INV-P clear reason a).
        logger.debug(f"[ExportWorker] user.sqlite synced to R2: user={user_id}, v={new_version}")
        return SyncResult.OK
    elif not success and new_version is not None:
        # T4310 reviewer round 2 (MAJOR-2): baseline stays frozen — see
        # sync_db_to_r2_explicit for the rationale.
        # T6390: scope the marker to user.sqlite and carry the diag payload.
        mark_sync_conflict(user_id, scope=USER_DB_SCOPE, diag=build_marker_diag(
            db="user", profile_id=None, loaded=local_version,
            r2=new_version, r2_diag=r2_diag))
        # T6160: invalidate so the next ensure_user_database re-pulls (decision 4).
        # Lives in user_db.py because it must also drop the _initialized_user_dbs
        # flag ensure_user_database early-returns on. Baseline NOT advanced.
        from .services.user_db import schedule_user_db_reheal
        schedule_user_db_reheal(user_id)
        logger.warning(
            f"[ExportWorker] user.sqlite R2 version conflict for user={user_id} "
            f"— refused (R2 at v{new_version}), baseline frozen at v{local_version}; "
            f"scheduled re-pull on next access (T6160)"
        )
        return SyncResult.CONFLICT
    else:
        logger.warning(f"[ExportWorker] Failed to sync user.sqlite to R2: user={user_id}")
        return SyncResult.FAILED


# ---------------------------------------------------------------------------
# User.sqlite version tracking and sync (T920)
# ---------------------------------------------------------------------------

_user_sqlite_versions: dict = {}  # user_id -> version number
_user_sqlite_version_lock = threading.Lock()


def get_local_user_db_version(user_id: str) -> int | None:
    """Get locally cached version for a user's user.sqlite."""
    with _user_sqlite_version_lock:
        return _user_sqlite_versions.get(user_id)


def set_local_user_db_version(user_id: str, version: int | None) -> None:
    """Set locally cached version for a user's user.sqlite."""
    with _user_sqlite_version_lock:
        if version is None:
            _user_sqlite_versions.pop(user_id, None)
        else:
            _user_sqlite_versions[user_id] = version


def get_request_has_user_db_writes() -> bool:
    """Check if any user.sqlite writes occurred during this request."""
    ctx = _request_context.get()
    if ctx is None:
        return False
    return ctx.get('has_user_db_writes', False)


def sync_user_db_to_cloud_if_writes() -> bool:
    """Sync user.sqlite to R2 if writes occurred during this request.

    Called by middleware after syncing the profile DB.
    Returns True if sync succeeded (or no writes/R2 disabled), False on failure.
    """
    if not R2_ENABLED:
        return True

    if not get_request_has_user_db_writes():
        return True

    user_id = _request_user_id.get()
    if not user_id:
        return True

    db_path = USER_DATA_BASE / user_id / "user.sqlite"
    if not db_path.exists():
        return True

    from .storage import sync_user_db_to_r2_with_version

    local_version = get_local_user_db_version(user_id)
    success, new_version = sync_user_db_to_r2_with_version(
        user_id, db_path, local_version, skip_version_check=True
    )
    if success and new_version is not None:
        set_local_user_db_version(user_id, new_version)
        logger.debug(f"user.sqlite synced to R2 for user: {user_id}, version: {new_version}")
        return True
    elif not success:
        logger.warning(f"Failed to sync user.sqlite to R2 for user: {user_id}")
        return False

    return True


# Note: sync_db_to_r2_explicit and sync_user_db_to_r2_explicit defined above (~line 1385)
