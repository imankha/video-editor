"""Concurrency tests for credit_ledger.debit() (T5840 AC: "two parallel deducts").

Real Postgres connections on separate threads -- `pg_conn`'s mock_get_pg() opens
a fresh psycopg2 connection per call, so each thread's debit() genuinely takes
its own connection and the row lock on `credits` is real, not simulated. A
mocked connection would prove nothing here; the whole point is DB-level locking.
"""

import threading

from app.services.credit_ledger import credit_key, debit, get_balance, grant, list_transactions

USER = "user-a"


def _run_in_threads(fns):
    results = [None] * len(fns)
    errors = [None] * len(fns)

    def _wrap(i, fn):
        try:
            results[i] = fn()
        except Exception as e:  # noqa: BLE001
            errors[i] = e

    threads = [threading.Thread(target=_wrap, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for e in errors:
        if e is not None:
            raise e
    return results


class TestConcurrentDebits:
    def test_two_parallel_debits_one_wins_no_overspend(self, pg_conn):
        """Balance 100, two threads each debit(60) on separate keys -> exactly
        one succeeds, final balance 40, exactly one ledger row survives."""
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))

        results = _run_in_threads([
            lambda: debit(USER, 60, "framing_usage", credit_key("framing_usage", "export_a")),
            lambda: debit(USER, 60, "framing_usage", credit_key("framing_usage", "export_b")),
        ])

        oks = [r["ok"] for r in results]
        assert oks.count(True) == 1, f"exactly one debit should succeed, got {results}"
        assert oks.count(False) == 1
        assert get_balance(USER) == 40, "no over-spend, no lost debit"
        assert len(list_transactions(USER)) == 2, "grant row + exactly one surviving debit row"

    def test_two_parallel_debits_both_fit_both_succeed(self, pg_conn):
        """Balance 100, two threads each debit(30) -> both succeed serialized,
        final balance 40, two ledger rows (proves the lock serializes rather
        than spuriously failing a debit that actually fits)."""
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))

        results = _run_in_threads([
            lambda: debit(USER, 30, "framing_usage", credit_key("framing_usage", "export_a")),
            lambda: debit(USER, 30, "framing_usage", credit_key("framing_usage", "export_b")),
        ])

        assert all(r["ok"] and r["applied"] for r in results), results
        assert get_balance(USER) == 40
        assert len(list_transactions(USER)) == 3  # grant + 2 debits

    def test_ten_parallel_debits_same_key_only_one_row(self, pg_conn):
        """Balance 100, 10 threads with the SAME idempotency key -> one row,
        balance 70 (only one debit actually applies; the rest are no-op retries)."""
        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_1"))
        key = credit_key("framing_usage", "export_shared")

        results = _run_in_threads([
            (lambda: debit(USER, 30, "framing_usage", key)) for _ in range(10)
        ])

        assert all(r["ok"] for r in results)
        assert sum(1 for r in results if r["applied"]) == 1, "only one of the 10 may actually apply"
        assert get_balance(USER) == 70
        assert len(list_transactions(USER)) == 2  # grant + one debit
