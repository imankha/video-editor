"""Tests for app/services/credit_ledger.py (T5840: credits -> Postgres).

Real Postgres via the `pg_conn` fixture (conftest.py) -- the whole point of
this module is DB-level atomicity/locking, so a mocked connection would prove
nothing. `pg_conn` opens the credits_ready gate by default; tests of the
gate itself close it explicitly and restore it in a finally.
"""

import pytest

from app.services import credit_ledger
from app.services.credit_ledger import (
    CreditsUnavailable,
    confirm_reservation,
    credit_key,
    debit,
    get_balance,
    grant,
    has_key,
    list_transactions,
    recover_orphaned_reservations,
    release_reservation,
    reserve_credits,
    set_balance,
    stats_for_admin,
)

USER = "user-a"
OTHER_USER = "user-b"


class TestCreditKey:
    def test_known_source(self):
        assert credit_key("stripe_purchase", "pi_123") == "stripe:pi_123"
        assert credit_key("quest_reward", "quest_1") == "quest:quest_1"
        assert credit_key("admin_set", "req_1") == "adminset:req_1"

    def test_unregistered_source_raises(self):
        with pytest.raises(ValueError):
            credit_key("not_a_real_source", "x")

    def test_game_video_add_is_registered(self):
        """T8945: add_game_videos (games.py, T8700) calls
        deduct_credits(..., source="game_video_add", ...) but the source was
        never added to KEY_PREFIX -- credit_key raised ValueError for every
        real (non-free) video attach, a 500 the client saw as a raw network
        failure (Failed to fetch) rather than a clean error. This was
        UNREACHABLE until T8940 fixed uploadMultiVideoGame's activate-ordering
        bug, which is why it surfaced only now. Distinct prefix from
        game_upload (activate_game's source) so the two never collide."""
        assert credit_key("game_video_add", "12:abc123") == "game_video_add:12:abc123"


class TestGrant:
    def test_first_grant_creates_row(self, pg_conn):
        result = grant(USER, 100, "quest_reward", credit_key("quest_reward", "q1"))
        assert result == {"applied": True, "balance": 100}
        assert get_balance(USER) == 100

    def test_grant_twice_same_key_is_idempotent(self, pg_conn):
        key = credit_key("quest_reward", "q1")
        first = grant(USER, 100, "quest_reward", key)
        second = grant(USER, 100, "quest_reward", key)

        assert first["applied"] is True
        assert second["applied"] is False
        assert second["balance"] == 100, "retry must not double-credit"
        assert get_balance(USER) == 100

    def test_grant_different_keys_both_apply(self, pg_conn):
        grant(USER, 100, "quest_reward", credit_key("quest_reward", "q1"))
        result = grant(USER, 50, "quest_reward", credit_key("quest_reward", "q2"))

        assert result == {"applied": True, "balance": 150}

    def test_grant_rejects_non_positive_amount(self, pg_conn):
        with pytest.raises(ValueError):
            grant(USER, 0, "quest_reward", "quest:q1")
        with pytest.raises(ValueError):
            grant(USER, -5, "quest_reward", "quest:q1")

    def test_absent_user_balance_is_zero(self, pg_conn):
        assert get_balance("no-such-user") == 0


class TestDebit:
    def test_debit_with_sufficient_balance(self, pg_conn):
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        result = debit(USER, 60, "framing_usage", credit_key("framing_usage", "export_1"))

        assert result == {"ok": True, "applied": True, "balance": 40, "required": 60}

    def test_debit_same_key_twice_is_idempotent(self, pg_conn):
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        key = credit_key("framing_usage", "export_1")
        first = debit(USER, 60, "framing_usage", key)
        second = debit(USER, 60, "framing_usage", key)

        assert first["applied"] is True
        assert second["applied"] is False
        assert second["balance"] == 40, "retry must not double-deduct"

    def test_debit_writes_reference_id(self, pg_conn):
        """M5 regression: debit() dropped reference_id entirely, so
        game_upload/storage_extension rows landed NULL -- regressing GDPR
        export, credit history, and admin forensics (and inconsistent with
        reserve_credits, which DOES preserve it)."""
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        debit(USER, 20, "game_upload", credit_key("game_upload", "game_42"), reference_id="game_42")

        txn = list_transactions(USER)[0]
        assert txn["source"] == "game_upload"
        assert txn["reference_id"] == "game_42"

    def test_insufficient_balance_rolls_back_ledger_row(self, pg_conn):
        grant(USER, 10, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        result = debit(USER, 60, "framing_usage", credit_key("framing_usage", "export_1"))

        assert result == {"ok": False, "applied": False, "balance": 10, "required": 60}
        assert get_balance(USER) == 10, "balance must be untouched"
        txns = list_transactions(USER)
        assert len(txns) == 1, "only the original grant row -- the rolled-back debit row must not survive"
        assert txns[0]["amount"] == 10

    def test_debit_rejects_non_positive_amount(self, pg_conn):
        with pytest.raises(ValueError):
            debit(USER, 0, "framing_usage", "export:e1")

    def test_balance_check_constraint_cannot_be_violated(self, pg_conn):
        """Belt-and-braces: even a crafted attempt to over-debit cannot push
        balance negative -- the conditional UPDATE predicate refuses it."""
        grant(USER, 5, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        for i in range(3):
            debit(USER, 10, "framing_usage", credit_key("framing_usage", f"export_{i}"))
        assert get_balance(USER) == 5


class TestSetBalance:
    def test_set_from_zero(self, pg_conn):
        result = set_balance(USER, 50, "adminset:admin-1:req-1")
        assert result == {"applied": True, "balance": 50, "delta": 50}

    def test_set_retry_same_key_is_no_op(self, pg_conn):
        """M3 fix: a genuine retry (same key, same amount) must report
        applied=False -- the key already ran, this call changed nothing.
        (Distinct from a first-time call that coincidentally matches the
        current balance -- see test_set_first_time_no_op_delta_zero below.)"""
        key = "adminset:admin-1:req-1"
        first = set_balance(USER, 50, key)
        assert first == {"applied": True, "balance": 50, "delta": 50}

        result = set_balance(USER, 50, key)
        assert result == {"applied": False, "balance": 50, "delta": 0}

    def test_set_first_time_no_op_delta_zero(self, pg_conn):
        """A brand-new key whose target happens to already match the current
        balance (0 == 0) is a real (if unusual) first-time call, not a retry
        -- applied=True, nothing to insert (CHECK(amount<>0) forbids a
        zero-amount ledger row)."""
        result = set_balance(USER, 0, "adminset:admin-1:req-fresh")
        assert result == {"applied": True, "balance": 0, "delta": 0}

    def test_set_down_records_negative_delta(self, pg_conn):
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        result = set_balance(USER, 10, "adminset:admin-1:req-2")
        assert result == {"applied": True, "balance": 10, "delta": -90}

    def test_set_rejects_negative_amount(self, pg_conn):
        with pytest.raises(ValueError):
            set_balance(USER, -1, "adminset:admin-1:req-3")

    def test_reused_key_different_amount_is_refused(self, pg_conn):
        key = "adminset:admin-1:req-4"
        set_balance(USER, 50, key)
        result = set_balance(USER, 999, key)
        assert result["applied"] is False
        assert get_balance(USER) == 50, "must not silently reinterpret a reused key"


class TestHasKeyAndTransactions:
    def test_has_key(self, pg_conn):
        key = credit_key("stripe_purchase", "pi_1")
        assert has_key(USER, key) is False
        grant(USER, 100, "stripe_purchase", key)
        assert has_key(USER, key) is True

    def test_list_transactions_ordering(self, pg_conn):
        grant(USER, 10, "quest_reward", credit_key("quest_reward", "q1"))
        grant(USER, 20, "quest_reward", credit_key("quest_reward", "q2"))
        txns = list_transactions(USER)
        assert [t["amount"] for t in txns] == [20, 10], "newest first"


class TestStatsForAdmin:
    def test_absent_user_balance_is_zero_not_null(self, pg_conn):
        """T5840: unlike the old R2/local-file path, an absent user is a real
        0, never null -- there is no more 'unavailable' state to represent."""
        stats = stats_for_admin(["no-such-user"])
        assert stats["no-such-user"]["credits_balance"] == 0
        assert stats["no-such-user"]["credits_spent"] == 0
        assert stats["no-such-user"]["purchase_credit_amounts"] == []

    def test_aggregates_spend_and_purchases(self, pg_conn):
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        debit(USER, 30, "framing_usage", credit_key("framing_usage", "export_1"))
        set_balance(USER, 200, "adminset:admin-1:req-1")  # admin_set excluded from "spent"

        stats = stats_for_admin([USER])[USER]
        assert stats["credits_purchased"] == 100
        assert stats["credits_spent"] == 30
        assert stats["credits_balance"] == 200
        assert stats["purchase_credit_amounts"] == [100]

    def test_empty_user_ids_returns_empty(self, pg_conn):
        assert stats_for_admin([]) == {}


class TestBackwardCompatShims:
    """These preserve the old user_db.py call signatures so most of the 16
    real call sites (games.py, payments.py, etc.) are a mechanical import
    swap -- covering them directly, not just via the primitives."""

    def test_deduct_credits_preserves_reference_id(self, pg_conn):
        """M5: the actual games.py call sites (game_upload, storage_extension)
        go through this shim, not debit() directly."""
        from app.services.credit_ledger import deduct_credits, grant_credits

        grant_credits(USER, 100, "stripe_purchase", "pi_1")
        result = deduct_credits(USER, 20, "game_upload", reference_id="game_42")

        assert result["success"] is True
        txn = list_transactions(USER)[0]
        assert txn["reference_id"] == "game_42"

    def test_deduct_credits_idempotent_retry(self, pg_conn):
        from app.services.credit_ledger import deduct_credits, grant_credits

        grant_credits(USER, 100, "stripe_purchase", "pi_1")
        first = deduct_credits(USER, 20, "game_upload", reference_id="game_42")
        second = deduct_credits(USER, 20, "game_upload", reference_id="game_42")

        assert first["success"] is True
        assert second["success"] is True
        assert second["balance"] == 80, "retry must not double-charge"


class TestReservations:
    """Phase 1 moves credit_reservations verbatim (design RESOLVED-1) -- these
    pin the SQLite behavior now backed by Postgres."""

    def test_reserve_drops_balance(self, pg_conn):
        grant(USER, 50, "quest_reward", credit_key("quest_reward", "q1"))
        result = reserve_credits(USER, 20, "job-1", 10.0)
        assert result == {"success": True, "balance": 30, "required": 20}
        assert get_balance(USER) == 30

    def test_reserve_insufficient_funds(self, pg_conn):
        grant(USER, 5, "quest_reward", credit_key("quest_reward", "q1"))
        result = reserve_credits(USER, 50, "job-1")
        assert result == {"success": False, "balance": 5, "required": 50}
        assert get_balance(USER) == 5

    def test_confirm_reservation_writes_ledger_row(self, pg_conn):
        grant(USER, 50, "quest_reward", credit_key("quest_reward", "q1"))
        reserve_credits(USER, 20, "job-1", 10.0)
        ok = confirm_reservation(USER, "job-1")
        assert ok is True
        assert get_balance(USER) == 30  # already deducted at reserve time
        txns = list_transactions(USER)
        usage = next(t for t in txns if t["source"] == "framing_usage")
        assert usage["amount"] == -20
        assert usage["reference_id"] == "job-1"

    def test_confirm_nonexistent_reservation_returns_false(self, pg_conn):
        assert confirm_reservation(USER, "nonexistent") is False

    def test_release_reservation_restores_balance(self, pg_conn):
        grant(USER, 50, "quest_reward", credit_key("quest_reward", "q1"))
        reserve_credits(USER, 20, "job-1")
        ok = release_reservation(USER, "job-1")
        assert ok is True
        assert get_balance(USER) == 50

    def test_release_nonexistent_reservation_returns_false(self, pg_conn):
        assert release_reservation(USER, "nonexistent") is False

    def test_recover_orphaned_reservations_without_profile_id_is_conservative(self, pg_conn):
        """M6 (review round 2): a reservation with no profile_id (legacy, or
        this fixture not bothering to set one) can't be confirmed against any
        export_jobs table, so recovery is conservative and does NOT release
        it. Full profile_id-aware release/retain matrix lives in
        test_reservation_recovery_scoping.py."""
        from app.services.pg import get_pg

        grant(USER, 100, "quest_reward", credit_key("quest_reward", "q1"))
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE credits SET balance = balance - 30 WHERE user_id = %s", (USER,))
            cur.execute(
                "INSERT INTO credit_reservations (job_id, user_id, amount, video_seconds, created_at) "
                "VALUES ('old-job', %s, 30, 15.0, now() - INTERVAL '120 seconds')",
                (USER,),
            )

        count = recover_orphaned_reservations(USER)
        assert count == 0
        assert get_balance(USER) == 70

    def test_recent_reservation_not_recovered(self, pg_conn):
        grant(USER, 100, "quest_reward", credit_key("quest_reward", "q1"))
        reserve_credits(USER, 30, "recent-job")

        count = recover_orphaned_reservations(USER)
        assert count == 0
        assert get_balance(USER) == 70

    def test_reservations_are_user_scoped(self, pg_conn):
        """Unlike the SQLite version (the file WAS the user scope), the shared
        Postgres table needs an explicit user_id -- confirm it can't leak."""
        grant(USER, 50, "quest_reward", credit_key("quest_reward", "q1"))
        grant(OTHER_USER, 50, "quest_reward", credit_key("quest_reward", "q1"))
        reserve_credits(USER, 20, "job-shared-name")
        reserve_credits(OTHER_USER, 20, "job-shared-name-2")

        assert confirm_reservation(OTHER_USER, "job-shared-name") is False
        assert confirm_reservation(USER, "job-shared-name") is True
        assert get_balance(OTHER_USER) == 30  # still reserved, untouched


class TestCreditsReadyGate:
    def test_mutations_503_while_gate_closed(self, pg_conn):
        from app.services.pg import get_pg

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE credit_migration_state SET ready_at = NULL WHERE id = 1")
        credit_ledger.reset_ready_cache_for_tests()
        try:
            with pytest.raises(CreditsUnavailable):
                grant(USER, 10, "quest_reward", credit_key("quest_reward", "q1"))
            with pytest.raises(CreditsUnavailable):
                debit(USER, 10, "framing_usage", credit_key("framing_usage", "e1"))
            with pytest.raises(CreditsUnavailable):
                set_balance(USER, 10, "adminset:admin-1:req-1")
            # N7: reserve_credits/confirm_reservation/release_reservation/
            # recover_orphaned_reservations are also gated -- the AC "gate
            # 503s every mutation path" wasn't pinned for these.
            with pytest.raises(CreditsUnavailable):
                reserve_credits(USER, 10, "job-gate-test")
            with pytest.raises(CreditsUnavailable):
                confirm_reservation(USER, "job-gate-test")
            with pytest.raises(CreditsUnavailable):
                release_reservation(USER, "job-gate-test")
            with pytest.raises(CreditsUnavailable):
                recover_orphaned_reservations(USER)
        finally:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("UPDATE credit_migration_state SET ready_at = now() WHERE id = 1")
            credit_ledger.reset_ready_cache_for_tests()

    def test_reads_still_work_while_gate_closed(self, pg_conn):
        from app.services.pg import get_pg

        grant(USER, 10, "quest_reward", credit_key("quest_reward", "q1"))
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE credit_migration_state SET ready_at = NULL WHERE id = 1")
        credit_ledger.reset_ready_cache_for_tests()
        try:
            # Reads must pass through untouched.
            assert get_balance(USER) == 10
            assert list_transactions(USER)[0]["amount"] == 10
            assert has_key(USER, credit_key("quest_reward", "q1")) is True
        finally:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("UPDATE credit_migration_state SET ready_at = now() WHERE id = 1")
            credit_ledger.reset_ready_cache_for_tests()

    def test_gate_state_is_cached_after_first_ready_read(self, pg_conn):
        """Once ready=True is observed, later closing the DB row must not
        re-close the in-process gate (design 4a: cached after first success)."""
        from app.services.pg import get_pg

        grant(USER, 5, "quest_reward", credit_key("quest_reward", "q-cache"))  # primes cache to True
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE credit_migration_state SET ready_at = NULL WHERE id = 1")
        try:
            # No reset_ready_cache_for_tests() call here -- this is the point.
            result = grant(OTHER_USER, 5, "quest_reward", credit_key("quest_reward", "q-cache-2"))
            assert result["applied"] is True
        finally:
            with get_pg() as conn:
                cur = conn.cursor()
                cur.execute("UPDATE credit_migration_state SET ready_at = now() WHERE id = 1")
            credit_ledger.reset_ready_cache_for_tests()
