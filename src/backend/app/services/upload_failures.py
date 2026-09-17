"""T10270: durable per-event record of every upload failure, plus the
attempt/outcome aggregate bridge.

**Fence F3 (load-bearing, do not weaken): `record_upload_failure` is the ONLY
function that inserts into `upload_failures`.** There is deliberately no
`record_event(table, payload)` generic sink — a future "let's log X here too"
needs its own task and its own design review, not a second door into this
table. See `.claude/knowledge/backend-services.md` for the full fence list
(F1-F5) and docs/plans/tasks/T10270-design.md §2.6 for why this table is an
operational incident record, NOT analytics state (no analytics report may
read it).

Contract (design §3.4): `record_upload_failure` never raises and never
retries. A failed observability write must never break the upload's own error
path — every failure inside is swallowed and logged, mirroring the previous
`games_upload._record_upload_failure` contract it replaces.

Loop-safety (T6200 cardinal rule): this is a plain blocking function
(psycopg2). An `async def` caller MUST offload it via
`await run_in_context(record_upload_failure_from_payload, payload)` —
`run_in_context` forwards positional args only, so the async call site builds
a payload dict rather than calling the keyword-only writer directly. A plain
`def` caller (already off the loop) may call `record_upload_failure(...)`
directly with keywords.
"""

from __future__ import annotations

import logging

from app.services.pg import get_pg
from app.user_context import (
    get_current_impersonator_id,
    get_current_platform,
    get_current_user_id,
)
from app.version import APP_BUILD, APP_VERSION

logger = logging.getLogger(__name__)

# F1: closed vocabularies. An unknown stage/reason is logged loudly and
# coerced to "unknown" -- it never coins a new dimension.
UPLOAD_STAGES = frozenset({
    "hashing",     # client: hash / faststart analyze, before any server call
    "preparing",   # POST /prepare-upload, and the client-side checks on its response
    "uploading",   # part PUTs to R2, PATCH /upload/{id}/parts
    "finalizing",  # POST /finalize-upload
    "creating",    # POST /api/games (pending insert)
    "attaching",   # POST /api/games/{id}/videos
    "activating",  # game activation
    "batching",    # POST /api/clips/upload (per item)
})

UPLOAD_FAILURE_REASONS = frozenset({
    # carried over from analytics.MILESTONE_REASONS
    "timeout", "network", "refused", "sync_failed", "user_abandoned",
    "r2_rejected", "unknown",
    # precise operational reasons (new; NEVER passed to record_milestone directly)
    "hash_timeout", "analyze_failed", "unexpected_status", "fetch_rejected",
    "insufficient_credits", "probe_failed", "source_missing",
    "duration_exceeds_cap", "size_over_cap", "session_not_found",
    "size_mismatch", "game_not_ready",
})

# TOTAL map: every UPLOAD_FAILURE_REASONS member has an entry, so a coarse
# aggregate bucket is never skipped for a reason record_upload_failure can
# actually receive. `test_t10270_upload_failures.py` asserts totality -- adding
# a reason without deciding its coarse bucket fails RED, not silently.
MILESTONE_REASON_BY_UPLOAD_REASON = {
    # identity for the seven carried-over reasons
    "timeout": "timeout",
    "network": "network",
    "refused": "refused",
    "sync_failed": "sync_failed",
    "user_abandoned": "user_abandoned",
    "r2_rejected": "r2_rejected",
    "unknown": "unknown",
    # precise -> coarse
    "hash_timeout": "timeout",
    "analyze_failed": "unknown",
    "unexpected_status": "refused",
    "fetch_rejected": "network",
    "insufficient_credits": "refused",
    "probe_failed": "refused",
    "source_missing": "sync_failed",
    "duration_exceeds_cap": "refused",
    "size_over_cap": "refused",
    "session_not_found": "refused",
    "size_mismatch": "network",
    "game_not_ready": "refused",
}

_ERROR_TEXT_CAP = 300
_FILENAME_CAP = 120
_USER_AGENT_CAP = 200


def record_upload_failure(
    *,
    kind: str,
    stage: str,
    reason: str,
    terminal: bool,
    origin: str = "server",
    user_id: str | None = None,
    http_status: int | None = None,
    error_text: str | None = None,
    blake3_hash: str | None = None,
    upload_session_id: str | None = None,
    r2_upload_id: str | None = None,
    file_size: int | None = None,
    original_filename: str | None = None,
    parts_total: int | None = None,
    parts_completed: int | None = None,
    attempt_no: int | None = None,
    elapsed_ms: int | None = None,
    user_agent: str | None = None,
) -> None:
    """Record one upload-failure event (design §3.4). Never raises.

    1. Always inserts a row into `upload_failures` (the durable record).
    2. When `terminal` and not impersonating, also bridges into the existing
       `record_milestone` aggregate (`game_upload_failed`/`clip_upload_failed`)
       via `MILESTONE_REASON_BY_UPLOAD_REASON` -- the aggregates keep working
       exactly as they do today.
    3. Always emits one canonical `[UPLOAD_FAILURE]` log line carrying the same
       fields, so the log and the row can never disagree (D1, design §3.8).
    """
    try:
        if stage not in UPLOAD_STAGES:
            logger.warning("[UPLOAD_FAILURE] Unknown stage %r, coercing to 'unknown'", stage)
            stage = "unknown"
        if reason not in UPLOAD_FAILURE_REASONS:
            logger.warning("[UPLOAD_FAILURE] Unknown reason %r, coercing to 'unknown'", reason)
            reason = "unknown"

        resolved_user_id = user_id or _safe_current_user_id()
        profile_id = _safe_current_profile_id()
        impersonated = get_current_impersonator_id() is not None

        try:
            platform = get_current_platform()
        except Exception:
            platform = "unknown"

        capped_error_text = error_text[:_ERROR_TEXT_CAP] if error_text else None
        capped_filename = original_filename[:_FILENAME_CAP] if original_filename else None
        capped_user_agent = user_agent[:_USER_AGENT_CAP] if user_agent else None

        # Each of the three sinks is independently guarded. In particular, a
        # pre-migration UndefinedTable on the INSERT (design §5 step 7: the
        # deploy-before-migrate window) must degrade to a logged warning
        # WITHOUT also silently disabling the record_milestone aggregate that
        # worked fine before this table existed -- that would be a new
        # regression during the deploy window, not the "safe by construction"
        # behavior the design promises.
        try:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO upload_failures (
                        user_id, profile_id, kind, stage, reason, terminal, origin,
                        impersonated, http_status, error_text, blake3_hash,
                        upload_session_id, r2_upload_id, file_size, original_filename,
                        parts_total, parts_completed, attempt_no, elapsed_ms,
                        platform, user_agent, app_build, commit_sha
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )
                    """,
                    (
                        resolved_user_id, profile_id, kind, stage, reason, terminal, origin,
                        impersonated, http_status, capped_error_text, blake3_hash,
                        upload_session_id, r2_upload_id, file_size, capped_filename,
                        parts_total, parts_completed, attempt_no, elapsed_ms,
                        platform, capped_user_agent, APP_BUILD, APP_VERSION,
                    ),
                )
        except Exception:
            logger.exception("[UPLOAD_FAILURE] row insert failed -- swallowed (never blocks the aggregate below)")

        if terminal and not impersonated and resolved_user_id:
            from app.analytics import record_milestone
            event = "clip_upload_failed" if kind == "clip" else "game_upload_failed"
            record_milestone(resolved_user_id, event, reason=MILESTONE_REASON_BY_UPLOAD_REASON[reason])

        logger.error(
            "[UPLOAD_FAILURE] kind=%s stage=%s reason=%s terminal=%s origin=%s "
            "user=%s profile=%s impersonated=%s http_status=%s hash=%s session=%s "
            "upload_id=%s file_size=%s filename=%r parts=%s/%s attempt=%s "
            "elapsed_ms=%s platform=%s build=%s error=%r",
            kind, stage, reason, terminal, origin,
            resolved_user_id, profile_id, impersonated, http_status, blake3_hash,
            upload_session_id, r2_upload_id, file_size, capped_filename,
            parts_completed, parts_total, attempt_no, elapsed_ms, platform,
            APP_BUILD, capped_error_text,
        )
    except Exception:
        logger.exception("[UPLOAD_FAILURE] record_upload_failure itself failed -- swallowed")


def record_upload_failure_from_payload(payload: dict) -> None:
    """Adapter for `run_in_context`, which forwards positional args only.

    Async call sites (T6200 cardinal rule) build a payload dict and thread it
    through this single positional parameter instead of calling
    `record_upload_failure(**kwargs)` directly, which `run_in_context` cannot
    express. This is NOT a second writer -- it does nothing but unpack and
    delegate to the one real writer above (fence F3).
    """
    record_upload_failure(**payload)


def _safe_current_user_id() -> str | None:
    try:
        return get_current_user_id()
    except Exception:
        return None


def _safe_current_profile_id() -> str | None:
    try:
        from app.profile_context import get_current_profile_id
        return get_current_profile_id()
    except Exception:
        return None


UPLOAD_FAILURES_TTL_DAYS = 90


def sweep_expired_upload_failures() -> int:
    """F2: TTL is code, not a chore. Called from the existing hourly
    `cleanup._do_cleanup()` loop -- no new scheduler. Returns the row count
    deleted (0 on a not-yet-migrated environment, never raises)."""
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT to_regclass('public.upload_failures') IS NOT NULL AS ok")
            if not cur.fetchone()["ok"]:
                return 0
            cur.execute(
                "DELETE FROM upload_failures WHERE occurred_at < now() - make_interval(days => %s)",
                (UPLOAD_FAILURES_TTL_DAYS,),
            )
            return cur.rowcount
    except Exception:
        logger.exception("[UPLOAD_FAILURE] TTL sweep failed")
        return 0
