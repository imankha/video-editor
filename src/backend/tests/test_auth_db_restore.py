"""
T1290: Auth DB restore must succeed or fail fatally.

When R2 is enabled, a failed restore must NOT silently fall through to
`init_auth_db()` (which would create a fresh empty DB and wipe all sessions
and email→user_id mappings — the root cause of the sarkarati@ incident).

Rules enforced by these tests:
  1. R2 enabled + transient failure → retry 3 times then raise a fatal
     RuntimeError. `init_auth_db()` must NOT be called.
  2. R2 enabled + 404 (no backup yet) → fall through to `init_auth_db()`
     (first boot on a fresh environment is legitimate).
  3. R2 disabled (local dev) → fall through to `init_auth_db()` with no
     restore attempt.

These tests mock the R2 client + `sync_auth_db_from_r2` — they do not hit
real R2. The end-to-end "deploy with a bad R2 key" check is manual (see
the task file's Manual Verification section).
"""
import logging
from unittest.mock import patch, MagicMock

import pytest

from app.services import auth_db


class _FakeClientError(Exception):
    """Stand-in for botocore ClientError carrying a 404."""

    def __init__(self, code: str = "500"):
        self.response = {"Error": {"Code": code}}
        super().__init__(f"ClientError {code}")


# ---------------------------------------------------------------------------
# restore_auth_db_or_fail — the new startup helper
# ---------------------------------------------------------------------------

def test_restore_fails_fatally_after_3_attempts_when_r2_enabled(caplog):
    """R2 enabled + persistent transient error → raise after 3 attempts;
    init_auth_db() is never called."""
    caplog.set_level(logging.WARNING)

    with patch("app.services.auth_db.sync_auth_db_from_r2") as mock_sync, \
         patch("app.services.auth_db.init_auth_db") as mock_init, \
         patch("app.services.auth_db._r2_enabled", return_value=True):
        mock_sync.side_effect = ConnectionError("simulated R2 outage")

        with pytest.raises(RuntimeError, match="auth DB restore"):
            auth_db.restore_auth_db_or_fail()

        # 3 attempts total
        assert mock_sync.call_count == 3, (
            f"expected 3 restore attempts, got {mock_sync.call_count}"
        )
        # init_auth_db MUST NOT be called — that would create an empty DB
        assert mock_init.call_count == 0, (
            "init_auth_db() must not run after a fatal restore failure"
        )


def test_restore_logs_each_retry_attempt(caplog):
    """Every failed attempt is logged with attempt number."""
    caplog.set_level(logging.WARNING)

    with patch("app.services.auth_db.sync_auth_db_from_r2") as mock_sync, \
         patch("app.services.auth_db.init_auth_db"), \
         patch("app.services.auth_db._r2_enabled", return_value=True):
        mock_sync.side_effect = ConnectionError("boom")

        with pytest.raises(RuntimeError):
            auth_db.restore_auth_db_or_fail()

    # Expect warnings for attempt 1 and 2 (retries) and an error for final failure.
    warning_msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("attempt 1" in m.lower() for m in warning_msgs), warning_msgs
    assert any("attempt 2" in m.lower() for m in warning_msgs), warning_msgs
    assert any("attempt 3" in m.lower() for m in warning_msgs), warning_msgs


def test_restore_succeeds_on_retry_does_not_raise():
    """If a later attempt succeeds, we proceed normally without raising."""
    with patch("app.services.auth_db.sync_auth_db_from_r2") as mock_sync, \
         patch("app.services.auth_db.init_auth_db") as mock_init, \
         patch("app.services.auth_db._r2_enabled", return_value=True):
        # Fail twice, then succeed
        mock_sync.side_effect = [ConnectionError("x"), ConnectionError("y"), True]

        auth_db.restore_auth_db_or_fail()  # no raise

        assert mock_sync.call_count == 3
        # init_auth_db runs after a successful restore (idempotent table create)
        assert mock_init.call_count == 1


def test_restore_404_falls_through_to_init_when_r2_enabled():
    """A genuine 'no backup yet' (sync returns False) is legitimate on first
    boot — we should call init_auth_db() without raising."""
    with patch("app.services.auth_db.sync_auth_db_from_r2", return_value=False) as mock_sync, \
         patch("app.services.auth_db.init_auth_db") as mock_init, \
         patch("app.services.auth_db._r2_enabled", return_value=True):
        auth_db.restore_auth_db_or_fail()

        assert mock_sync.call_count == 1
        assert mock_init.call_count == 1


def test_restore_r2_disabled_skips_sync_and_inits():
    """Local dev path: R2 disabled → no restore attempt, empty DB is fine."""
    with patch("app.services.auth_db.sync_auth_db_from_r2") as mock_sync, \
         patch("app.services.auth_db.init_auth_db") as mock_init, \
         patch("app.services.auth_db._r2_enabled", return_value=False):
        auth_db.restore_auth_db_or_fail()

        assert mock_sync.call_count == 0, "should not touch R2 when disabled"
        assert mock_init.call_count == 1


# ---------------------------------------------------------------------------
# sync_auth_db_from_r2 must raise on transient errors (not swallow + False)
# so the outer retry loop can see the failure.
# ---------------------------------------------------------------------------

def test_sync_auth_db_from_r2_raises_on_transient_error():
    """Transient errors must propagate so the outer retry loop can act."""
    fake_client = MagicMock()
    fake_client.exceptions.ClientError = _FakeClientError
    fake_client.download_file.side_effect = ConnectionError("net down")

    with patch("app.storage.R2_ENABLED", True), \
         patch("app.storage.get_r2_client", return_value=fake_client), \
         patch("app.storage.R2_BUCKET", "test-bucket"):
        with pytest.raises(Exception):
            auth_db.sync_auth_db_from_r2()


def test_sync_auth_db_from_r2_returns_false_on_404():
    """A true 'object not found' must return False (not raise) so the caller
    can proceed with a fresh init — this is the legitimate first-boot case."""
    fake_client = MagicMock()
    fake_client.exceptions.ClientError = _FakeClientError
    fake_client.download_file.side_effect = _FakeClientError("404")

    with patch("app.storage.R2_ENABLED", True), \
         patch("app.storage.get_r2_client", return_value=fake_client), \
         patch("app.storage.R2_BUCKET", "test-bucket"):
        assert auth_db.sync_auth_db_from_r2() is False
