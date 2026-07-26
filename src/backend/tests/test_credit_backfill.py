"""Tests for app/services/credit_backfill.py (T5840).

Builds fixture user.sqlite files (the legacy per-user format) at a tmp_path
USER_DATA_BASE and drives run_backfill()/reconcile_against_stripe() against
real Postgres (pg_conn). _force_download_user_db is monkeypatched per-test to
simulate the presence/absence of an R2 copy without touching real R2.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services import credit_backfill
from app.services.credit_ledger import credit_key, get_balance, grant, has_key, reserve_credits

USER = "user-a"


def _make_user_sqlite(path, user_id, balance, ledger_rows, reservations=None):
    """ledger_rows: list of (amount, source, reference_id, video_seconds, created_at)."""
    from app.services.user_db import _USER_DB_SCHEMA

    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.executescript(_USER_DB_SCHEMA)
    conn.execute("INSERT INTO credits (user_id, balance) VALUES (?, ?)", (user_id, balance))
    for i, (amount, source, reference_id, video_seconds, created_at) in enumerate(ledger_rows):
        conn.execute(
            """INSERT INTO credit_transactions
               (id, user_id, amount, source, reference_id, video_seconds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (i + 1, user_id, amount, source, reference_id, video_seconds, created_at),
        )
    for job_id, amount in (reservations or []):
        conn.execute(
            "INSERT INTO credit_reservations (job_id, amount, video_seconds) VALUES (?, ?, ?)",
            (job_id, amount, None),
        )
    conn.commit()
    conn.close()


@pytest.fixture()
def no_r2(monkeypatch):
    """Default: no R2 copy available (force-download returns False)."""
    monkeypatch.setattr(credit_backfill, "_force_download_user_db", lambda uid, path: False)


class TestBackfillOneUser:
    def test_local_only_ledger_migrates_and_balance_matches(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=130,
            ledger_rows=[
                (100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00"),
                (8, "new_account_bonus", None, None, "2025-12-31 00:00:00"),
                (22, "quest_reward", "quest_1", None, "2026-01-02 00:00:00"),
            ],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)

        row = report["rows"][0]
        assert row["status"] == "ok"
        assert row["flags"] == []
        assert row["tx_count"] == 3
        assert row["pg_balance_after"] == 130
        assert get_balance(USER) == 130
        assert has_key(USER, credit_key("stripe_purchase", "pi_abc"))
        assert has_key(USER, credit_key("quest_reward", "quest_1"))
        # NULL reference_id (signup bonus): content-only key (BLOCKING-1 fix --
        # bare `legacy:{id}` collided across diverged copies; BLOCKING-A fix --
        # an origin-tagged key re-keys the same row when copy presence changes
        # across a machine replacement).
        sig = credit_backfill._content_sig({"source": "new_account_bonus", "amount": 8, "created_at": "2025-12-31 00:00:00"})
        assert has_key(USER, f"legacy:{sig}:0")

    def test_rerun_is_idempotent_no_new_rows(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=100,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        credit_backfill.run_backfill(user_ids=[USER], apply=True)
        second = credit_backfill.run_backfill(user_ids=[USER], apply=True)

        row = second["rows"][0]
        assert row["tx_count"] == 0, "re-run must insert nothing new"
        assert row["delta"] == 0
        assert get_balance(USER) == 100

    def test_rerun_after_post_cutover_grant_preserves_new_row(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=100,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        credit_backfill.run_backfill(user_ids=[USER], apply=True)

        # A post-cutover grant lands directly in Postgres (not in the SQLite fixture).
        grant(USER, 50, "quest_reward", credit_key("quest_reward", "post_cutover_quest"))
        assert get_balance(USER) == 150

        second = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = second["rows"][0]
        assert row["tx_count"] == 0, "the backfill has nothing new to insert"
        assert get_balance(USER) == 150, "the post-cutover grant must survive the re-run untouched"

    def test_divergent_local_vs_r2_unions_both(self, pg_conn, tmp_path, monkeypatch):
        local_dir = tmp_path / "local"
        r2_dir = tmp_path / "r2"
        _make_user_sqlite(
            local_dir / USER / "user.sqlite", USER, balance=100,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
        )
        # R2 copy has an ADDITIONAL grant the local copy never received.
        _make_user_sqlite(
            r2_dir / "user.sqlite", USER, balance=150,
            ledger_rows=[
                (100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00"),
                (50, "quest_reward", "quest_1", None, "2026-01-02 00:00:00"),
            ],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", local_dir)

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert "divergent" in row["flags"]
        assert row["pg_balance_after"] == 150, "union of both copies -> the R2-only grant is not lost"

    def test_duplicate_multiplicity_difference_is_flagged_divergent(self, pg_conn, tmp_path, monkeypatch):
        """N3 regression: a SET comparison treats 'row X twice in R2, once in
        local' as equal to 'row X once in each' (same unique tuples) -- must
        use multiset (count-aware) comparison so a multiplicity difference is
        still caught as divergent."""
        local_dir = tmp_path / "local"
        r2_dir = tmp_path / "r2"
        # Same (source, ref, amount, created_at) content, but R2 has it TWICE
        # (e.g. a genuine double-grant bug) while local only has it once.
        # NULL reference_id (admin_grant-style) -- the legacy schema's
        # (user_id, source, reference_id) UNIQUE index only applies WHERE
        # reference_id IS NOT NULL, so two identical NULL-ref rows are legal.
        row = (100, "admin_grant", None, None, "2026-01-01 00:00:00")
        _make_user_sqlite(local_dir / USER / "user.sqlite", USER, balance=100, ledger_rows=[row])
        _make_user_sqlite(r2_dir / "user.sqlite", USER, balance=200, ledger_rows=[row, row])

        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", local_dir)

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row_result = report["rows"][0]

        assert "divergent" in row_result["flags"], (
            "a SET-based comparison would miss this -- the unique tuples match, "
            "only the COUNT differs"
        )

    def test_divergent_null_ref_rows_sharing_a_rowid_both_survive(self, pg_conn, tmp_path, monkeypatch):
        """BLOCKING-1 regression: two NULL-reference_id rows (admin_grant) that
        share the SAME SQLite rowid across diverged copies must NOT collapse
        into one via a shared `legacy:{id}` key -- that silently drops
        whichever copy loses the race, the exact 400-credit loss this epic
        exists to fix.

        base:            id=1 new_account_bonus(8,   ref NULL)   <- shared prefix
        machine A -> R2: id=2 admin_grant(400, ref NULL)          <- diverged tail
        machine B local: id=2 admin_grant(100, ref NULL)          <- diverged tail

        Both diverged grants must land in Postgres; only the shared prefix
        row collapses to one.
        """
        local_dir = tmp_path / "local"
        r2_dir = tmp_path / "r2"
        _make_user_sqlite(
            local_dir / USER / "user.sqlite", USER, balance=108,
            ledger_rows=[
                (8, "new_account_bonus", None, None, "2026-01-01 00:00:00"),
                (100, "admin_grant", None, None, "2026-01-02 00:00:00"),
            ],
        )
        _make_user_sqlite(
            r2_dir / "user.sqlite", USER, balance=408,
            ledger_rows=[
                (8, "new_account_bonus", None, None, "2026-01-01 00:00:00"),
                (400, "admin_grant", None, None, "2026-01-03 00:00:00"),
            ],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", local_dir)

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert "divergent" in row["flags"]
        # Shared prefix (8) inserted once + BOTH diverged admin_grants (400 + 100)
        # survive -- neither is dropped in favor of the other.
        assert row["pg_balance_after"] == 8 + 400 + 100, (
            f"expected both diverged admin_grant rows to survive, got balance={row['pg_balance_after']}"
        )
        assert row["tx_count"] == 3

    def test_rerun_after_divergent_null_ref_backfill_is_idempotent(self, pg_conn, tmp_path, monkeypatch):
        """Re-running the same divergent-NULL-ref scenario (SAME copy presence
        both times) must not insert the diverged rows a second time."""
        local_dir = tmp_path / "local"
        r2_dir = tmp_path / "r2"
        _make_user_sqlite(
            local_dir / USER / "user.sqlite", USER, balance=108,
            ledger_rows=[
                (8, "new_account_bonus", None, None, "2026-01-01 00:00:00"),
                (100, "admin_grant", None, None, "2026-01-02 00:00:00"),
            ],
        )
        _make_user_sqlite(
            r2_dir / "user.sqlite", USER, balance=408,
            ledger_rows=[
                (8, "new_account_bonus", None, None, "2026-01-01 00:00:00"),
                (400, "admin_grant", None, None, "2026-01-03 00:00:00"),
            ],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", local_dir)

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        credit_backfill.run_backfill(user_ids=[USER], apply=True)
        second = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = second["rows"][0]

        assert row["tx_count"] == 0, "re-run must insert nothing new"
        assert row["pg_balance_after"] == 8 + 400 + 100

    def test_rerun_after_machine_replacement_removes_local_copy_does_not_double_credit(
        self, pg_conn, tmp_path, monkeypatch
    ):
        """BLOCKING-A regression: a NULL-ref key that depends on which copies
        are present (the prior origin-tagged `legacy:shared:`/`legacy:r2:`/
        `legacy:local:` scheme) re-keys the SAME physical row after design
        4b's D2 cutover deploy wipes the machine's local volume -- a catch-up
        backfill run (B2 in the runbook) then sees a "new" key for a row it
        already inserted and doubles the signup bonus / admin grant. Every
        prior re-run test used the SAME copy presence on both runs, which is
        exactly why this slipped through review round 2.

        Run 1: local + R2 both present, identical content (a live machine
        before D2 -- B1). Run 2: local copy genuinely ABSENT (D2 wiped the
        volume), R2 unchanged -- B2's catch-up pass. The content-only key
        (multiset-max across copies) must resolve to the SAME key both times,
        so run 2 inserts nothing new and the balance does not move.
        """
        local_dir = tmp_path / "local"
        r2_dir = tmp_path / "r2"
        ledger_rows = [
            (8, "new_account_bonus", None, None, "2026-01-01 00:00:00"),
            (400, "admin_grant", None, None, "2026-01-02 00:00:00"),
        ]
        _make_user_sqlite(local_dir / USER / "user.sqlite", USER, balance=408, ledger_rows=ledger_rows)
        _make_user_sqlite(r2_dir / "user.sqlite", USER, balance=408, ledger_rows=ledger_rows)

        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", local_dir)

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        first = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        assert first["rows"][0]["tx_count"] == 2
        assert first["rows"][0]["pg_balance_after"] == 408

        # D2 cutover deploy: fresh volume, local copy is genuinely gone (not
        # unreadable -- the file no longer exists).
        import shutil
        shutil.rmtree(local_dir / USER)

        second = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = second["rows"][0]

        assert row["tx_count"] == 0, (
            "copy presence changed between runs (local vanished after D2) -- "
            "an origin-dependent key would re-key both rows here and double-insert"
        )
        assert row["pg_balance_now"] == row["pg_balance_after"] == 408, "balance must not double"

    def test_ledger_mismatch_flagged_not_silently_fixed(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        # Stored balance (999) does not match the ledger sum (100) -- a
        # historical corruption. The backfill must flag it, not "fix" it.
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=999,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert "ledger_mismatch" in row["flags"]
        assert row["pg_balance_after"] == 100, "balance is re-derived from the ledger, never copied from the stored value"

    def test_open_reservation_is_released_and_reported(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=40,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
            reservations=[("job_1", 60)],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert row["open_reservations"] == 1
        # Balance is re-derived from the ledger only (100), crediting the
        # reservation's 60 back -- exactly what recover_orphaned_reservations does.
        assert row["pg_balance_after"] == 100

    def test_no_user_db_reported_and_skipped(self, pg_conn, tmp_path, no_r2):
        report = credit_backfill.run_backfill(user_ids=["ghost-user"], apply=True)
        row = report["rows"][0]
        assert row["status"] == "no_user_db"
        assert row["flags"] == ["no_user_db"]

    def test_dry_run_makes_no_writes(self, pg_conn, tmp_path, no_r2, monkeypatch):
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=100,
            ledger_rows=[(100, "stripe_purchase", "pi_abc", None, "2026-01-01 00:00:00")],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=False)
        row = report["rows"][0]

        assert row["pg_balance_after"] == 100, "dry run PROJECTS the balance"
        assert get_balance(USER) == 0, "but writes nothing"
        assert has_key(USER, credit_key("stripe_purchase", "pi_abc")) is False

    def test_unreadable_local_copy_is_flagged_not_silently_dropped(self, pg_conn, tmp_path, no_r2, monkeypatch):
        """N2 regression: a LOCAL copy that exists but can't be read (corrupt/
        locked) must not silently degrade to 'as if it never existed' -- it
        might hold the very data we're missing."""
        user_dir = tmp_path / USER
        user_dir.mkdir(parents=True)
        # A file that exists but isn't a valid SQLite DB.
        (user_dir / "user.sqlite").write_bytes(b"not a real sqlite file")
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert row["status"] == "flagged_needs_review"
        assert "unreadable_copy" in row["flags"]
        assert row["status"] != "no_user_db", (
            "must not be reported as 'genuinely nothing to migrate' -- a "
            "human needs to look at why the file couldn't be read"
        )

    def test_unreadable_local_with_readable_r2_still_flags(self, pg_conn, tmp_path, monkeypatch):
        """Even when R2 has a perfectly good copy, an unreadable LOCAL copy
        must still be surfaced -- it might have diverged before it broke."""
        user_dir = tmp_path / USER
        user_dir.mkdir(parents=True)
        (user_dir / "user.sqlite").write_bytes(b"corrupt")
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        r2_dir = tmp_path / "r2copy"
        _make_user_sqlite(
            r2_dir / "user.sqlite", USER, balance=50,
            ledger_rows=[(50, "stripe_purchase", "pi_1", None, "2026-01-01 00:00:00")],
        )

        def _fake_download(uid, path):
            import shutil
            shutil.copy(str(r2_dir / "user.sqlite"), str(path))
            return True

        monkeypatch.setattr(credit_backfill, "_force_download_user_db", _fake_download)

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert "unreadable_copy" in row["flags"]
        assert row["pg_balance_after"] == 50, "the readable R2 copy is still migrated"


class TestPostCutoverReDerive:
    """M1/M2: post-cutover, the re-derive must account for OPEN Postgres
    reservations (reserve_credits debits balance without a ledger row) and
    must recompute from scratch so drift is visible even with nothing new to
    insert. Local user.sqlite is present-but-empty in these tests -- they're
    about a user who is entirely post-cutover (no legacy SQLite data left to
    migrate), re-running the "safe to re-run" catch-up tool."""

    def test_apply_does_not_re_credit_an_open_reservation(self, pg_conn, tmp_path, no_r2, monkeypatch):
        """M1 regression: a user mid-export (open reservation) whose backfill
        is re-run (design 4b's catch-up pass, or an admin re-click) must NOT
        have the reserved amount credited back -- that's free money and it
        breaks the balance invariant for as long as the export is in flight."""
        _make_user_sqlite(tmp_path / USER / "user.sqlite", USER, balance=0, ledger_rows=[])
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_live"))
        result = reserve_credits(USER, 20, "export-in-flight")
        assert result["success"] is True
        assert get_balance(USER) == 80, "sanity: reserve already debited balance"

        report = credit_backfill.run_backfill(user_ids=[USER], apply=True)
        row = report["rows"][0]

        assert row["pg_balance_after"] == 80, (
            "must equal ledger(100) - open_reservations(20), NOT ledger(100) alone"
        )
        assert row["delta"] == 0, "nothing should have changed for this user"
        assert get_balance(USER) == 80

    def test_dry_run_reports_drift_even_with_nothing_new_to_insert(self, pg_conn, tmp_path, no_r2, monkeypatch):
        """M2 regression: a stored balance that has drifted from Sigma(ledger)
        must show a nonzero delta in the DRY RUN (predicting what apply would
        do), not just when new rows are inserted."""
        _make_user_sqlite(tmp_path / USER / "user.sqlite", USER, balance=0, ledger_rows=[])
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        grant(USER, 50, "stripe_purchase", credit_key("stripe_purchase", "pi_drift"))
        assert get_balance(USER) == 50

        # Simulate historical corruption / a manual edit -- balance no longer
        # matches Sigma(ledger).
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute("UPDATE credits SET balance = 999 WHERE user_id = %s", (USER,))

        report = credit_backfill.run_backfill(user_ids=[USER], apply=False)
        row = report["rows"][0]

        assert row["pg_balance_now"] == 999
        assert row["pg_balance_after"] == 50, "dry run must predict the TRUE re-derived value"
        assert row["delta"] == 50 - 999, "drift must be visible even though tx_count == 0"
        assert row["tx_count"] == 0
        assert get_balance(USER) == 999, "dry run still writes nothing"


class TestCrossCutoverStripeRedelivery:
    def test_redelivered_webhook_after_backfill_does_not_double_grant(self, pg_conn, tmp_path, no_r2, monkeypatch):
        """Guards the design 3c step-4 hole: a legacy stripe_purchase row must
        key IDENTICALLY to how the live webhook would key a redelivered event."""
        user_dir = tmp_path / USER
        _make_user_sqlite(
            user_dir / "user.sqlite", USER, balance=100,
            ledger_rows=[(100, "stripe_purchase", "pi_X", None, "2026-01-01 00:00:00")],
        )
        import app.services.user_db as user_db_mod
        monkeypatch.setattr(user_db_mod, "USER_DATA_BASE", tmp_path)

        credit_backfill.run_backfill(user_ids=[USER], apply=True)
        assert get_balance(USER) == 100

        # Stripe redelivers the SAME pi_X post-cutover -- the webhook path keys
        # it identically via credit_key("stripe_purchase", "pi_X").
        result = grant(USER, 100, "stripe_purchase", credit_key("stripe_purchase", "pi_X"))
        assert result["applied"] is False
        assert get_balance(USER) == 100, "redelivery must not double-grant"


class TestChunkingAndStoredReport:
    """M7: full unbounded enumeration is chunkable, and only a COMPLETE,
    unchunked, full-population run is saved as the stored report."""

    def test_full_enumeration_saves_a_report(self, pg_conn, monkeypatch):
        monkeypatch.setattr(credit_backfill, "_enumerate_users", lambda: [])

        report = credit_backfill.run_backfill(user_ids=None, apply=False)

        stored = credit_backfill.load_last_report()
        assert stored is not None
        assert stored["report"]["summary"]["total_users"] == report["summary"]["total_users"]

    def test_chunked_run_does_not_save_a_report(self, pg_conn, monkeypatch):
        monkeypatch.setattr(credit_backfill, "_enumerate_users", lambda: [
            {"user_id": "u1", "email": None}, {"user_id": "u2", "email": None},
        ])
        # Seed a real prior report so we can prove the chunked call did NOT overwrite it.
        credit_backfill.save_report({"rows": [], "summary": {"sentinel": True}})

        credit_backfill.run_backfill(user_ids=None, apply=False, limit=1, offset=0)

        stored = credit_backfill.load_last_report()
        assert stored["report"]["summary"].get("sentinel") is True, (
            "a chunked (limit set) run must not overwrite the full stored report"
        )

    def test_targeted_user_ids_run_does_not_save_a_report(self, pg_conn, no_r2):
        credit_backfill.save_report({"rows": [], "summary": {"sentinel": True}})

        credit_backfill.run_backfill(user_ids=["ghost-user"], apply=False)

        stored = credit_backfill.load_last_report()
        assert stored["report"]["summary"].get("sentinel") is True

    def test_limit_offset_pages_through_users(self, pg_conn, monkeypatch):
        monkeypatch.setattr(credit_backfill, "_enumerate_users", lambda: [
            {"user_id": f"u{i}", "email": None} for i in range(5)
        ])
        with patch.object(credit_backfill, "_backfill_one_user", return_value={
            "user_id": "x", "email": None, "status": "no_user_db", "flags": ["no_user_db"],
            "ledger_sum": 0, "open_reservations": 0, "tx_count": 0,
            "pg_balance_now": None, "pg_balance_after": None, "delta": 0,
            "r2_balance": None, "local_balance": None,
        }):
            page = credit_backfill.run_backfill(user_ids=None, apply=False, limit=2, offset=0)

        assert page["summary"]["total_users"] == 2
        assert page["summary"]["total_enumerated"] == 5
        assert page["summary"]["has_more"] is True

    def test_load_last_report_none_when_never_generated(self, pg_conn):
        assert credit_backfill.load_last_report() is None

    def test_targeted_user_ids_with_limit_does_not_raise(self, pg_conn, no_r2):
        """MAJOR-1 regression: `total_enumerated` was bound only in the
        full-enumeration (user_ids=None) branch but read whenever `limit` is
        not None, so POST /api/admin/credits/backfill {"user_ids": [...],
        "limit": N} raised UnboundLocalError AFTER each targeted user's
        insert + balance UPDATE had already committed (per-user commit)."""
        report = credit_backfill.run_backfill(user_ids=["ghost-user"], apply=False, limit=10)

        assert report["summary"]["total_enumerated"] == 1
        assert report["summary"]["has_more"] is False


class TestReconcileAgainstStripe:
    def test_missing_stripe_grant_flagged(self, pg_conn, monkeypatch):
        pi = {
            "id": "pi_missing",
            "status": "succeeded",
            "livemode": True,
            "metadata": {"user_id": USER, "credits": "80"},
        }
        monkeypatch.setattr(
            "app.services.revenue_reconciliation.fetch_stripe_intents", lambda: [pi]
        )

        result = credit_backfill.reconcile_against_stripe()

        assert len(result["missing_stripe_grant"]) == 1
        assert result["missing_stripe_grant"][0]["pi_id"] == "pi_missing"
        assert result["missing_stripe_grant"][0]["user_id"] == USER

    def test_existing_ledger_row_not_flagged_missing(self, pg_conn, monkeypatch):
        grant(USER, 80, "stripe_purchase", credit_key("stripe_purchase", "pi_have"))
        pi = {
            "id": "pi_have",
            "status": "succeeded",
            "livemode": True,
            "metadata": {"user_id": USER, "credits": "80"},
        }
        monkeypatch.setattr(
            "app.services.revenue_reconciliation.fetch_stripe_intents", lambda: [pi]
        )

        result = credit_backfill.reconcile_against_stripe()

        assert result["missing_stripe_grant"] == []

    def test_unknown_stripe_grant_for_test_mode_era_row(self, pg_conn, monkeypatch):
        """A ledger row with no matching succeeded live PI (e.g. test-mode-era) -> flagged, not healed."""
        grant(
            USER, 999, "stripe_purchase", credit_key("stripe_purchase", "pi_test_mode_only"),
            reference_id="pi_test_mode_only",
        )
        monkeypatch.setattr("app.services.revenue_reconciliation.fetch_stripe_intents", lambda: [])

        result = credit_backfill.reconcile_against_stripe()

        assert any(u["pi_id"] == "pi_test_mode_only" for u in result["unknown_stripe_grant"])
