"""T8370 §7 Q3 (approved with amendment): the clip-upload debit reconciliation reaper.

Design: an hourly pass piggybacked on the existing `app/services/cleanup.py` loop
finds `credit_ledger` (Postgres `credit_transactions`) rows with
source="clip_upload" older than 24h that have NO matching `raw_clips` row for their
batch (reference_id = "clipbatch:{sha256 of accepted hashes}"), refunds each via the
existing `refund_credits(..., source="clip_upload_refund")`, and logs CRITICAL. A
debit younger than 24h, or one that DOES have a matching raw_clips row, is left
alone.

This is Phase 1 (pre-implementation): `_do_cleanup`/reconciliation function does not
exist yet, so these tests are expected to fail with ImportError/AttributeError, not
assertion failures.

Run with: pytest src/backend/tests/test_t8370_clip_upload_reconciliation.py -v
"""

import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

TEST_USER_ID_PREFIX = "test_t8370_reap_"


def _make_user(pg_conn, suffix: str) -> str:
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user
    from app.services.credit_ledger import grant_credits
    user_id = f"{TEST_USER_ID_PREFIX}{suffix}_{uuid.uuid4().hex[:8]}"
    create_user(user_id, email=f"{user_id}@test.com")
    create_user_segment(user_id, "organic", None, "otp")
    grant_credits(user_id, 20, "admin_grant", reference_id=f"t8370-reap-seed-{user_id}")
    return user_id


def _insert_clip_upload_debit(user_id: str, reference_id: str, amount: int, age_hours: float) -> None:
    """Directly insert a credit_transactions row simulating a `clip_upload` debit
    at a controlled age (real `debit()` always stamps `created_at = now()`, so
    aging it requires a direct UPDATE after the fact)."""
    from app.services.credit_ledger import credit_key, debit

    key = credit_key("clip_upload", reference_id)
    result = debit(user_id, amount, "clip_upload", key, reference_id=reference_id)
    assert result["ok"], f"seed debit failed: {result}"

    from app.services.pg import get_pg
    created_at = datetime.utcnow() - timedelta(hours=age_hours)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE credit_transactions SET created_at = %s WHERE user_id = %s AND idempotency_key = %s",
            (created_at, user_id, key),
        )


def _has_refund(user_id: str, reference_id: str) -> bool:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM credit_transactions WHERE user_id = %s AND source = %s AND reference_id = %s",
            (user_id, "clip_upload_refund", reference_id),
        )
        return cur.fetchone() is not None


class TestClipUploadReconciliationReaper:
    def test_orphaned_debit_older_than_24h_gets_refunded_and_logged_critical(self, pg_conn, caplog):
        """A clip_upload debit >24h old with NO matching raw_clips row is refunded
        via refund_credits and a CRITICAL log line is emitted (fail-loud rule —
        an orphaned debit is a real bug signal, not routine housekeeping)."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "orphan")
        reference_id = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, reference_id, amount=3, age_hours=30)

        with caplog.at_level("CRITICAL"):
            cleanup.reconcile_orphaned_clip_upload_debits()

        assert _has_refund(user_id, reference_id), "orphaned >24h debit must be refunded"
        assert any("CRITICAL" in r.levelname or r.levelno >= 50 for r in caplog.records), (
            "an orphaned clip_upload debit refund must log at CRITICAL level"
        )

    def test_orphaned_debit_younger_than_24h_is_left_alone(self, pg_conn):
        """A debit still inside the 24h grace window (client may simply be retrying)
        must NOT be refunded — the whole point of the threshold."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "young")
        reference_id = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, reference_id, amount=2, age_hours=2)

        cleanup.reconcile_orphaned_clip_upload_debits()

        assert not _has_refund(user_id, reference_id), "a <24h-old debit must not be refunded"

    def test_debit_with_matching_raw_clips_row_is_left_alone(self, pg_conn, monkeypatch):
        """A clip_upload debit whose batch DID land rows (raw_clips exist matching
        the reference_id's batch) must never be refunded, no matter its age —
        it is not orphaned, the upload succeeded."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "matched")
        reference_id = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, reference_id, amount=2, age_hours=48)

        # Simulate "this batch DID create raw_clips rows" — the reaper's raw_clips
        # lookup is per-user/profile SQLite, so patch its existence-check helper
        # directly rather than requiring the real batch-hash bookkeeping to exist.
        monkeypatch.setattr(
            cleanup, "_clip_upload_batch_has_raw_clips", lambda uid, ref_id: ref_id == reference_id and uid == user_id
        )

        cleanup.reconcile_orphaned_clip_upload_debits()

        assert not _has_refund(user_id, reference_id), (
            "a clip_upload debit with a matching raw_clips row must never be refunded"
        )

    def test_reconciliation_pass_is_idempotent_on_repeat_run(self, pg_conn):
        """A second reconciliation pass over an already-refunded orphan must not
        refund it again (refund_credits is idempotent via credit_key, but the
        reaper itself should also not keep re-selecting a resolved row forever)."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "repeat")
        reference_id = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, reference_id, amount=4, age_hours=72)

        cleanup.reconcile_orphaned_clip_upload_debits()
        cleanup.reconcile_orphaned_clip_upload_debits()

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count(*) AS c FROM credit_transactions WHERE user_id = %s AND source = %s AND reference_id = %s",
                (user_id, "clip_upload_refund", reference_id),
            )
            refund_count = cur.fetchone()["c"]

        assert refund_count == 1, f"expected exactly one refund row after two passes, got {refund_count}"
