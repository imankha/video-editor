"""T14120: the hourly clip_upload refund verifier checks a BOUNDED window.

Before: `reconcile_orphaned_clip_upload_debits` selected every clip_upload debit
older than 24h with no lower bound, so each successful batch (which never gets a
refund row) was re-checked every hour forever -- one `open_profile_db_readonly`
(R2 HEAD, maybe download + JIT migration) per batch ever uploaded.

After: only debits aged 24h..7d are checked. Per-run R2 work is bounded by the
upload rate over that window, not by total history; the 6-day width keeps the
refund guarantee across a long cleanup-loop outage.

Run with: pytest tests/test_t14120_clip_refund_window.py -v
"""

import uuid

from tests.test_t8370_clip_upload_reconciliation import (
    _has_refund,
    _insert_clip_upload_debit,
    _make_user,
)


def _spy_checked(monkeypatch, user_id):
    """Record which of THIS user's batches the verifier opened a profile DB for
    (the per-batch R2 HEAD); the shared dev Postgres holds other tests' rows."""
    from app.services import cleanup

    checked = []

    def _fake(uid, ref_id):
        if uid == user_id:
            checked.append(ref_id)
        return False  # no raw_clips -> orphaned

    monkeypatch.setattr(cleanup, "_clip_upload_batch_has_raw_clips", _fake)
    return checked


class TestClipRefundBoundedWindow:
    def test_batch_older_than_window_is_not_rechecked(self, pg_conn, monkeypatch):
        """T14120:C1/C2 -- a batch past the window is never re-opened, so the
        per-run HEAD count does not grow with total history."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "t14120old")
        old_ref = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, old_ref, amount=1, age_hours=8 * 24)
        checked = _spy_checked(monkeypatch, user_id)

        cleanup.reconcile_orphaned_clip_upload_debits()

        assert old_ref not in checked, "a batch older than the window must not be re-checked"
        assert not _has_refund(user_id, old_ref)

    def test_batch_inside_window_is_still_checked_and_refunded(self, pg_conn, monkeypatch):
        """T14120:C1 -- the refund guarantee holds for a batch inside the window."""
        from app.services import cleanup

        user_id = _make_user(pg_conn, "t14120in")
        in_ref = f"clipbatch:{uuid.uuid4().hex}"
        _insert_clip_upload_debit(user_id, in_ref, amount=1, age_hours=6 * 24)
        checked = _spy_checked(monkeypatch, user_id)

        cleanup.reconcile_orphaned_clip_upload_debits()

        assert checked == [in_ref]
        assert _has_refund(user_id, in_ref)
