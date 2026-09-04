"""
Hourly cleanup of expired sessions and OTP codes from Postgres.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

_cleanup_task: asyncio.Task | None = None


async def start_cleanup_loop():
    global _cleanup_task
    _cleanup_task = asyncio.create_task(_run_cleanup_loop())
    logger.info("[Cleanup] Hourly cleanup loop started")


async def stop_cleanup_loop():
    global _cleanup_task
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
        _cleanup_task = None
        logger.info("[Cleanup] Hourly cleanup loop stopped")


async def _run_cleanup_loop():
    while True:
        try:
            await asyncio.sleep(3600)
            await asyncio.to_thread(_do_cleanup)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("[Cleanup] Error in periodic cleanup")


def _do_cleanup():
    from .auth_db import cleanup_expired_sessions
    from .pg import get_pg

    cleanup_expired_sessions()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM otp_codes WHERE expires_at < now()")
        otp_deleted = cur.rowcount

    if otp_deleted > 0:
        logger.info(f"[Cleanup] Deleted {otp_deleted} expired OTP codes")

    # T8370 §7 Q3: piggyback the clip-upload debit reconciliation on this SAME
    # hourly loop rather than a new scheduler. Wrapped so a bug here can never
    # take down session/OTP cleanup (an unrelated concern sharing this tick).
    try:
        refunded = reconcile_orphaned_clip_upload_debits()
        if refunded:
            logger.info(f"[Cleanup] T8370: reconciled {refunded} orphaned clip_upload debit(s)")
    except Exception:
        logger.exception("[Cleanup] T8370 clip_upload reconciliation pass failed")


def _clip_upload_batch_has_raw_clips(user_id: str, reference_id: str) -> bool:
    """True if at least one `raw_clips` row exists for this clip_upload batch's
    accepted hashes, in the batch's OWN profile — i.e. the debit is NOT orphaned.

    Parses the reference_id shape Slice B writes:
    "clipbatch:{profile_id}:{comma-joined sorted blake3 hashes}". A reference_id
    that doesn't parse (malformed, or predates this format) is treated as "no
    evidence the batch landed" -> False, never raises — a background
    reconciliation pass must not die on one unreadable row.
    """
    from . import materialization

    try:
        _prefix, profile_id, hash_list = reference_id.split(":", 2)
        hashes = [h for h in hash_list.split(",") if h]
    except ValueError:
        return False
    if not profile_id or not hashes:
        return False

    conn = None
    try:
        conn = materialization.open_profile_db_readonly(user_id, profile_id)
        if conn is None:
            return False
        cur = conn.cursor()
        filenames = [f"{h}.mp4" for h in hashes]
        placeholders = ",".join("?" for _ in filenames)
        cur.execute(f"SELECT 1 FROM raw_clips WHERE filename IN ({placeholders}) LIMIT 1", filenames)
        return cur.fetchone() is not None
    except Exception:
        logger.exception(
            f"[T8370] reconciliation: failed to check raw_clips for "
            f"user={user_id} reference_id={reference_id!r}"
        )
        return False
    finally:
        if conn is not None:
            conn.close()


def reconcile_orphaned_clip_upload_debits() -> int:
    """T8370 §7 Q3 (approved with amendment): find `credit_transactions` rows
    with source='clip_upload' older than 24h that have no matching `raw_clips`
    row for their batch, refund each via the existing `refund_credits()`, and
    log CRITICAL — an orphaned debit is a real bug signal (a crash between
    debit and insert, or a client that silently gave up), not routine
    housekeeping. 24h is long enough that a client which merely lost
    connectivity and will retry on next app-open is not refunded out from
    under an in-progress upload.

    Idempotent two ways: `refund_credits`'s own `credit_key(source,
    reference_id)` dedup makes a second grant() call for the SAME orphan a
    no-op at the ledger level, AND this pass excludes any debit that already
    has a matching clip_upload_refund row so a repeat run doesn't even attempt
    the ledger call for an already-resolved orphan.

    Returns the count of NEWLY refunded orphans this pass.
    """
    from .credit_ledger import refund_credits
    from .pg import get_pg

    # T8370 (reviewer-caught): timezone-AWARE UTC, not naive utcnow() — a naive
    # datetime compared to credit_transactions.created_at (TIMESTAMPTZ) is
    # coerced via the session timezone, drifting the 24h threshold if that
    # session isn't UTC. Matches the admin.py datetime.now(UTC) convention.
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT ct.user_id, ct.amount, ct.reference_id
            FROM credit_transactions ct
            WHERE ct.source = 'clip_upload'
              AND ct.created_at < %s
              AND NOT EXISTS (
                  SELECT 1 FROM credit_transactions r
                  WHERE r.user_id = ct.user_id
                    AND r.source = 'clip_upload_refund'
                    AND r.reference_id = ct.reference_id
              )
            """,
            (cutoff,),
        )
        rows = cur.fetchall()

    refunded = 0
    for row in rows:
        user_id = row["user_id"]
        reference_id = row["reference_id"]
        amount = abs(row["amount"])  # debit rows are stored negative
        if _clip_upload_batch_has_raw_clips(user_id, reference_id):
            continue
        refund_credits(user_id, amount, reference_id, source="clip_upload_refund")
        logger.critical(
            f"[T8370] orphaned clip_upload debit reconciled: user={user_id} "
            f"amount={amount} reference_id={reference_id!r} — refunded (no matching raw_clips)"
        )
        refunded += 1
    return refunded
