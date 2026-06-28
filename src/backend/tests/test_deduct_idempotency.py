"""bug26p: deduct_credits is idempotent on (source, reference_id).

Game activation can be retried after a mid-flight failure (e.g. a crash between
the credit deduction and the status->ready commit). Without an idempotency guard
the retry would attempt to deduct again. These tests prove that a second
deduction with the same (source, reference_id) is a no-op that reports success.
"""

import pytest


@pytest.fixture(autouse=True)
def isolated_user_db(tmp_path, monkeypatch):
    """Fresh temp user database per test. Credit operations live entirely in the
    per-user SQLite DB, so no Postgres (create_user / pg_conn) is required."""
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", user_data_base)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    from app.services.user_db import ensure_user_database
    ensure_user_database("test-user-1")
    yield tmp_path


def _txns(user_id, source):
    from app.services.user_db import get_credit_transactions
    return [t for t in get_credit_transactions(user_id) if t["source"] == source]


def test_duplicate_deduction_does_not_double_charge(isolated_user_db):
    from app.services.user_db import grant_credits, deduct_credits, get_credit_balance
    grant_credits("test-user-1", 50, "quest_reward", "q1")

    first = deduct_credits("test-user-1", 10, "game_upload", "game_42")
    assert first["success"] is True
    assert first["balance"] == 40

    # Retry with the SAME (source, reference_id): must NOT deduct again.
    second = deduct_credits("test-user-1", 10, "game_upload", "game_42")
    assert second["success"] is True
    assert second["balance"] == 40  # unchanged

    assert get_credit_balance("test-user-1")["balance"] == 40
    # Only one ledger row was written for this deduction.
    assert len(_txns("test-user-1", "game_upload")) == 1


def test_duplicate_deduction_reports_success_even_if_now_insufficient(isolated_user_db):
    """A retry must succeed even if the balance is now too low to deduct again."""
    from app.services.user_db import grant_credits, deduct_credits
    grant_credits("test-user-1", 10, "quest_reward", "q1")

    first = deduct_credits("test-user-1", 10, "game_upload", "game_42")
    assert first["success"] is True
    assert first["balance"] == 0

    # Balance is now 0; a naive re-deduct would fail with insufficient funds.
    second = deduct_credits("test-user-1", 10, "game_upload", "game_42")
    assert second["success"] is True
    assert second["balance"] == 0


def test_different_reference_ids_both_deduct(isolated_user_db):
    from app.services.user_db import grant_credits, deduct_credits, get_credit_balance
    grant_credits("test-user-1", 50, "quest_reward", "q1")

    deduct_credits("test-user-1", 10, "game_upload", "game_1")
    deduct_credits("test-user-1", 10, "game_upload", "game_2")

    assert get_credit_balance("test-user-1")["balance"] == 30
    assert len(_txns("test-user-1", "game_upload")) == 2


def test_none_reference_id_is_not_deduped(isolated_user_db):
    """reference_id=None is not an idempotency key; both deductions apply."""
    from app.services.user_db import grant_credits, deduct_credits, get_credit_balance
    grant_credits("test-user-1", 50, "quest_reward", "q1")

    deduct_credits("test-user-1", 10, "framing_usage", None)
    deduct_credits("test-user-1", 10, "framing_usage", None)

    assert get_credit_balance("test-user-1")["balance"] == 30
