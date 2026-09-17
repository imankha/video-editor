"""T10270: upload-failure observability -- durable per-event record.

Covers `services/upload_failures.py`'s writer contract (design doc §3.4):
vocabulary totality, never-raises, terminal gating into the existing
record_milestone aggregate, the impersonation flag, the TTL sweep, and
purge-with-the-user. See docs/plans/tasks/T10270-design.md.

Run with: pytest src/backend/tests/test_t10270_upload_failures.py -v
"""

import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.services.upload_failures import (
    MILESTONE_REASON_BY_UPLOAD_REASON,
    UPLOAD_FAILURE_REASONS,
    record_upload_failure,
    record_upload_failure_from_payload,
    sweep_expired_upload_failures,
)

# ---------------------------------------------------------------------------
# Pure logic -- no Postgres required
# ---------------------------------------------------------------------------

class TestVocabularyTotality:
    def test_every_reason_has_a_milestone_bucket(self):
        """F1: adding a reason without deciding its coarse bucket must fail RED,
        not silently drop into record_milestone as an unmapped KeyError later."""
        missing = UPLOAD_FAILURE_REASONS - set(MILESTONE_REASON_BY_UPLOAD_REASON)
        assert missing == set(), f"reasons with no coarse milestone mapping: {missing}"

    def test_every_mapping_value_is_a_real_milestone_reason(self):
        """The coarse side of the map must itself be a valid analytics.MILESTONE_REASONS
        member, or record_milestone's own validation would degrade it to 'unknown'
        silently -- the map's whole point is to choose the bucket deliberately."""
        from app.analytics import MILESTONE_REASONS
        bad = {v for v in MILESTONE_REASON_BY_UPLOAD_REASON.values() if v not in MILESTONE_REASONS}
        assert bad == set(), f"coarse reasons not in analytics.MILESTONE_REASONS: {bad}"

    def test_no_extra_mapping_entries(self):
        """The map should not carry entries for reasons that aren't registered --
        that would hide a typo'd/retired reason instead of failing loudly."""
        extra = set(MILESTONE_REASON_BY_UPLOAD_REASON) - UPLOAD_FAILURE_REASONS
        assert extra == set(), f"mapping entries for unregistered reasons: {extra}"


class TestWriterValidation:
    """Coercion behavior (F1) is independent of the DB call -- verified via the
    log line / a stubbed get_pg, no real Postgres needed."""

    def test_unknown_stage_coerces_and_does_not_raise(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        # Never raises even with a bogus stage/reason -- the CONTRACT (design §3.4).
        record_upload_failure(kind="game", stage="not_a_real_stage", reason="unknown", terminal=True)

    def test_unknown_reason_coerces_and_does_not_raise(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        record_upload_failure(kind="game", stage="preparing", reason="not_a_real_reason", terminal=True)


class TestNeverRaisesContract:
    def test_get_pg_raising_is_swallowed(self, monkeypatch):
        """A pre-migration UndefinedTable (or any other PG error) must never
        propagate -- the writer's whole point is to never break the caller's
        upload error path (design §3.4 CONTRACT, §5 step 7)."""
        def _boom():
            raise RuntimeError("relation \"upload_failures\" does not exist")
        monkeypatch.setattr("app.services.upload_failures.get_pg", _boom)
        # Must not raise.
        record_upload_failure(kind="game", stage="preparing", reason="refused", terminal=True,
                               user_id="someone")

    def test_get_pg_raising_still_bridges_the_milestone(self, monkeypatch):
        """Design §5 step 7 / regression guard: a pre-migration table failure on
        the INSERT must NOT also silently disable the record_milestone aggregate
        that worked before this table existed -- that would be a NEW regression
        introduced by this task, not a pre-existing limitation."""
        def _boom():
            raise RuntimeError("relation \"upload_failures\" does not exist")
        monkeypatch.setattr("app.services.upload_failures.get_pg", _boom)
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="game", stage="preparing", reason="refused", terminal=True,
                                   user_id="someone")
        mock_milestone.assert_called_once_with("someone", "game_upload_failed", reason="refused")

    def test_payload_adapter_delegates_to_the_one_writer(self, monkeypatch):
        """run_in_context forwards positional args only -- the adapter must thread
        a dict through to record_upload_failure(**payload) and nowhere else
        (fence F3: no second writer)."""
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        with patch("app.services.upload_failures.record_upload_failure") as mock_writer:
            record_upload_failure_from_payload({"kind": "clip", "stage": "batching",
                                                 "reason": "probe_failed", "terminal": True})
        mock_writer.assert_called_once_with(kind="clip", stage="batching",
                                             reason="probe_failed", terminal=True)


class TestTerminalGating:
    """The honest split (design §3.4/§6): terminal=False writes the row but
    must NOT bridge into record_milestone -- that's what keeps rates from
    double-counting once the beacon phase gate is removed."""

    def test_non_terminal_does_not_call_record_milestone(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="game", stage="preparing", reason="refused",
                                   terminal=False, user_id="u1")
        mock_milestone.assert_not_called()

    def test_terminal_calls_record_milestone_with_coarse_reason(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="game", stage="preparing", reason="insufficient_credits",
                                   terminal=True, user_id="u1")
        mock_milestone.assert_called_once_with("u1", "game_upload_failed", reason="refused")

    def test_terminal_clip_kind_uses_clip_milestone_event(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="clip", stage="batching", reason="probe_failed",
                                   terminal=True, user_id="u1")
        mock_milestone.assert_called_once_with("u1", "clip_upload_failed", reason="refused")

    def test_terminal_without_user_id_skips_milestone(self, monkeypatch):
        """An anonymous beacon (no user_id resolvable) can't attribute a
        milestone -- mirrors the old _record_upload_failure's `if not user_id:
        return` guard. `user_id=None` falls back to the current request context
        (design pseudocode: `user_id or current user`), so this test must ALSO
        clear that context -- other test modules leave a contextvar user_id set
        for the rest of the process, and a real anonymous beacon has none."""
        from app.user_context import reset_user_id
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        reset_user_id()
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="game", stage="uploading", reason="timeout",
                                   terminal=True, user_id=None)
        mock_milestone.assert_not_called()


class TestImpersonationFlag:
    """Design §3.4: the ROW is always written (impersonated=True), but the
    AGGREGATE is skipped -- an admin reproducing a failure is diagnostically
    valuable but must not pollute the real user's analytics."""

    def test_impersonated_terminal_failure_skips_milestone(self, monkeypatch):
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub_get_pg())
        monkeypatch.setattr(
            "app.services.upload_failures.get_current_impersonator_id",
            lambda: "admin-1",
        )
        mock_milestone = MagicMock()
        with patch("app.analytics.record_milestone", mock_milestone):
            record_upload_failure(kind="game", stage="preparing", reason="refused",
                                   terminal=True, user_id="victim-user")
        mock_milestone.assert_not_called()

    def test_impersonated_failure_still_inserts_a_row(self, pg_conn, monkeypatch):
        """Real-Postgres counterpart to the mocked test above: the row itself
        must land with impersonated=True, even though the milestone is skipped."""
        from app.services.pg import get_pg

        user_id = f"{TEST_USER_ID_PREFIX}imp-{uuid.uuid4().hex[:8]}"
        monkeypatch.setattr(
            "app.services.upload_failures.get_current_impersonator_id",
            lambda: "admin-1",
        )
        try:
            record_upload_failure(kind="game", stage="preparing", reason="refused",
                                   terminal=True, user_id=user_id)
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT impersonated FROM upload_failures WHERE user_id = %s", (user_id,),
                )
                row = cur.fetchone()
            assert row is not None
            assert row["impersonated"] is True
        finally:
            with get_pg() as conn:
                conn.cursor().execute("DELETE FROM upload_failures WHERE user_id = %s", (user_id,))


def _stub_get_pg():
    from contextlib import contextmanager

    @contextmanager
    def _cm():
        conn = MagicMock()
        cur = MagicMock()
        cur.fetchone.return_value = {"ok": True}
        conn.cursor.return_value = cur
        yield conn
    return _cm


# ---------------------------------------------------------------------------
# Real Postgres -- vocabulary-to-row + TTL sweep + purge
# ---------------------------------------------------------------------------

TEST_USER_ID_PREFIX = "t10270-"


def _insert_row(user_id: str, occurred_at=None, **overrides) -> None:
    from app.services.pg import get_pg
    fields = {
        "user_id": user_id, "profile_id": "prof-1", "kind": "game",
        "stage": "preparing", "reason": "refused", "terminal": True,
        "origin": "server", "impersonated": False, "app_build": 0,
    }
    fields.update(overrides)
    with get_pg() as conn:
        cur = conn.cursor()
        cols = list(fields.keys())
        cur.execute(
            f"INSERT INTO upload_failures ({', '.join(cols)}"
            + (", occurred_at" if occurred_at else "")
            + f") VALUES ({', '.join(['%s'] * len(cols))}"
            + (", %s" if occurred_at else "")
            + ")",
            [*fields.values(), *([occurred_at] if occurred_at else [])],
        )


def _row_count(user_id: str) -> int:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS cnt FROM upload_failures WHERE user_id = %s", (user_id,))
        return cur.fetchone()["cnt"]


class TestWriterEndToEnd:
    def test_insert_then_row_is_readable(self, pg_conn):
        user_id = f"{TEST_USER_ID_PREFIX}{uuid.uuid4().hex[:8]}"
        try:
            record_upload_failure(kind="clip", stage="batching", reason="probe_failed",
                                   terminal=True, user_id=user_id, blake3_hash="abc123",
                                   file_size=1024, original_filename="clip.mp4")
            assert _row_count(user_id) == 1
        finally:
            from app.services.pg import get_pg
            with get_pg() as conn:
                conn.cursor().execute("DELETE FROM upload_failures WHERE user_id = %s", (user_id,))

    def test_error_text_and_filename_are_capped(self, pg_conn):
        from app.services.pg import get_pg
        user_id = f"{TEST_USER_ID_PREFIX}{uuid.uuid4().hex[:8]}"
        try:
            record_upload_failure(
                kind="game", stage="finalizing", reason="network", terminal=True,
                user_id=user_id, error_text="x" * 1000, original_filename="y" * 1000,
                user_agent="z" * 1000,
            )
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT error_text, original_filename, user_agent FROM upload_failures "
                    "WHERE user_id = %s", (user_id,),
                )
                row = cur.fetchone()
            assert len(row["error_text"]) == 300
            assert len(row["original_filename"]) == 120
            assert len(row["user_agent"]) == 200
        finally:
            with get_pg() as conn:
                conn.cursor().execute("DELETE FROM upload_failures WHERE user_id = %s", (user_id,))


class TestTtlSweep:
    def test_sweeps_rows_older_than_90_days_keeps_newer(self, pg_conn):
        user_id = f"{TEST_USER_ID_PREFIX}{uuid.uuid4().hex[:8]}"
        old = datetime.now(UTC) - timedelta(days=91)
        recent = datetime.now(UTC) - timedelta(days=1)
        try:
            _insert_row(user_id, occurred_at=old)
            _insert_row(user_id, occurred_at=recent)
            assert _row_count(user_id) == 2

            swept = sweep_expired_upload_failures()
            assert swept >= 1
            assert _row_count(user_id) == 1
        finally:
            from app.services.pg import get_pg
            with get_pg() as conn:
                conn.cursor().execute("DELETE FROM upload_failures WHERE user_id = %s", (user_id,))

    def test_noop_when_table_missing(self, monkeypatch):
        """F2/§5 step 7: to_regclass tolerance -- a not-yet-migrated environment
        must return 0, never raise."""
        def _stub():
            from contextlib import contextmanager

            @contextmanager
            def _cm():
                conn = MagicMock()
                cur = MagicMock()
                cur.fetchone.return_value = {"ok": False}
                conn.cursor.return_value = cur
                yield conn
            return _cm()
        monkeypatch.setattr("app.services.upload_failures.get_pg", _stub)
        assert sweep_expired_upload_failures() == 0


class TestPurgeWithUser:
    def test_purge_user_data_deletes_upload_failures_rows(self, tmp_path, monkeypatch, pg_conn):
        from app.routers.auth import _purge_user_data
        from app.services.auth_db import create_user

        monkeypatch.setattr("app.database.USER_DATA_BASE", tmp_path)
        monkeypatch.setattr("app.database.R2_ENABLED", False)
        monkeypatch.setattr("app.routers.auth.USER_DATA_BASE", tmp_path)
        monkeypatch.setattr("app.routers.auth.R2_ENABLED", False)

        user_id = f"{TEST_USER_ID_PREFIX}purge-{uuid.uuid4().hex[:8]}"
        try:
            create_user(user_id, email=f"{user_id}@example.com")
            _insert_row(user_id)
            assert _row_count(user_id) == 1

            _purge_user_data(user_id)

            assert _row_count(user_id) == 0
        finally:
            from app.services.pg import get_pg
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM upload_failures WHERE user_id = %s", (user_id,))
                cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
